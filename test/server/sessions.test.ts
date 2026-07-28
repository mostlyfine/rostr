import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionManager } from "../../server/sessions";
import { isTmuxAvailable, tmuxSessionName } from "../../server/tmux";

/** claude の代わりに sh を起動する。テストでは実際のエージェントは要らない。 */
const managers: SessionManager[] = [];

const newManager = (opts: { buildArgs?: (id: string) => string[]; scrollbackChars?: number } = {}) => {
  const manager = new SessionManager({
    agentBin: "/bin/sh",
    buildArgs: opts.buildArgs ?? (() => []),
    port: 0,
    scrollbackChars: opts.scrollbackChars ?? 64,
    // この describe は tmux を挟まない直接起動の経路を見る。
    tmux: false,
  });
  managers.push(manager);
  return manager;
};

const waitFor = async (predicate: () => boolean, timeoutMs = 5000) => {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

afterEach(() => {
  for (const manager of managers.splice(0)) manager.disposeAll();
});

describe("SessionManager", () => {
  it("create でセッションが一覧に現れる", () => {
    const manager = newManager();
    const session = manager.create("/tmp");
    expect(session.state).toBe("idle");
    expect(session.title).toBe("tmp");
    expect(session.cwd).toBe("/tmp");
    expect(manager.list().map((s) => s.id)).toEqual([session.id]);
  });

  it("存在しないディレクトリは拒否する", () => {
    const manager = newManager();
    expect(() => manager.create("/no/such/dir/at/all")).toThrow(/ディレクトリ/);
  });

  it("PTY の出力をスクロールバックに溜める", async () => {
    const manager = newManager();
    const session = manager.create("/tmp");
    manager.write(session.id, "echo marker-1\n");
    await waitFor(() => manager.scrollback(session.id).includes("marker-1"));
    expect(manager.scrollback(session.id)).toContain("marker-1");
  });

  it("スクロールバックは上限を超えたら古い方を捨てる", async () => {
    const manager = newManager();
    const session = manager.create("/tmp");
    manager.write(session.id, "echo AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n");
    manager.write(session.id, "echo ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ\n");
    await waitFor(() => manager.scrollback(session.id).includes("ZZZZ"));
    expect(manager.scrollback(session.id).length).toBeLessThanOrEqual(64);
  });

  it("onOutput の購読者に出力が流れる", async () => {
    const manager = newManager();
    const session = manager.create("/tmp");
    const chunks: string[] = [];
    manager.onOutput(session.id, (data) => chunks.push(data));
    manager.write(session.id, "echo subscribed\n");
    await waitFor(() => chunks.join("").includes("subscribed"));
    expect(chunks.join("")).toContain("subscribed");
  });

  it("hook イベントを適用して状態が変わる", () => {
    const manager = newManager();
    const session = manager.create("/tmp");
    manager.applyHook(session.id, { hook_event_name: "UserPromptSubmit", prompt: "やって" });
    const updated = manager.get(session.id);
    expect(updated?.state).toBe("working");
    expect(updated?.prompt).toBe("やって");
  });

  it("状態が変わったら change を通知する", () => {
    const manager = newManager();
    const onChange = vi.fn();
    manager.onChange(onChange);
    const session = manager.create("/tmp");
    expect(onChange).toHaveBeenCalledTimes(1);
    manager.applyHook(session.id, { hook_event_name: "Stop" });
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("変化のない hook では change を通知しない", () => {
    const manager = newManager();
    const session = manager.create("/tmp");
    const onChange = vi.fn();
    manager.onChange(onChange);
    manager.applyHook(session.id, { hook_event_name: "PreCompact" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("kill するとプロセスが終了して一覧から消える", async () => {
    const manager = newManager();
    const session = manager.create("/tmp");
    manager.kill(session.id);
    await waitFor(() => manager.list().length === 0);
    expect(manager.get(session.id)).toBeUndefined();
  });

  it("PTY が自然終了したら一覧から消える", async () => {
    const manager = newManager();
    const session = manager.create("/tmp");
    manager.write(session.id, "exit\n");
    await waitFor(() => manager.list().length === 0, 8000);
    expect(manager.get(session.id)).toBeUndefined();
  });

  it("未知の id への操作は false を返す", () => {
    const manager = newManager();
    expect(manager.write("nope", "x")).toBe(false);
    expect(manager.kill("nope")).toBe(false);
    expect(manager.applyHook("nope", { hook_event_name: "Stop" })).toBe(false);
  });

  it("子プロセスには ROSTR_SESSION_ID が渡り、親セッションの印は落とされる", async () => {
    process.env.CLAUDECODE = "1";
    process.env.CLAUDE_CODE_SESSION_ID = "parent-session";
    try {
      const manager = newManager({ scrollbackChars: 4096 });
      const session = manager.create("/tmp");
      manager.write(session.id, 'echo "SID=${ROSTR_SESSION_ID} PARENT=[${CLAUDE_CODE_SESSION_ID}] CC=[${CLAUDECODE}]"\n');
      await waitFor(() => manager.scrollback(session.id).includes("PARENT="));
      const output = manager.scrollback(session.id);
      expect(output).toContain(`SID=${session.id}`);
      expect(output).toContain("PARENT=[]");
      expect(output).toContain("CC=[]");
    } finally {
      delete process.env.CLAUDECODE;
      delete process.env.CLAUDE_CODE_SESSION_ID;
    }
  });

  it("buildArgs にセッション id が渡る", () => {
    const seen: string[] = [];
    const manager = newManager({
      buildArgs: (id) => {
        seen.push(id);
        return [];
      },
    });
    const session = manager.create("/tmp");
    expect(seen).toEqual([session.id]);
  });
});

/** 本番と混ざらないよう、テストは専用ソケットの tmux サーバを使う。 */
const TEST_SOCKET = "rostr-test";

const tmuxSessionNames = (): string[] => {
  const result = spawnSync("tmux", ["-L", TEST_SOCKET, "list-sessions", "-F", "#{session_name}"], {
    encoding: "utf8",
  });
  if (result.status !== 0 || typeof result.stdout !== "string") return [];
  return result.stdout.split("\n").filter(Boolean);
};

describe.skipIf(!isTmuxAvailable())("SessionManager (tmux)", () => {
  const newTmuxManager = () => {
    const manager = new SessionManager({
      agentBin: "/bin/sh",
      buildArgs: () => [],
      port: 0,
      scrollbackChars: 8192,
      tmux: true,
      tmuxSocket: TEST_SOCKET,
    });
    managers.push(manager);
    return manager;
  };

  afterEach(() => {
    spawnSync("tmux", ["-L", TEST_SOCKET, "kill-server"], { stdio: "ignore" });
  });

  it("create すると tmux セッションが立つ", async () => {
    const manager = newTmuxManager();
    const session = manager.create(process.cwd());
    await waitFor(() => tmuxSessionNames().includes(tmuxSessionName(session.id)));
    expect(tmuxSessionNames()).toContain(tmuxSessionName(session.id));
  });

  it("tmux 越しでも入出力が通り、ROSTR_SESSION_ID が渡る", async () => {
    const manager = newTmuxManager();
    const session = manager.create(process.cwd());
    manager.write(session.id, 'echo "SID=${ROSTR_SESSION_ID}"\n');
    await waitFor(() => manager.scrollback(session.id).includes(`SID=${session.id}`));
    expect(manager.scrollback(session.id)).toContain(`SID=${session.id}`);
  });

  it("disposeAll してもエージェントは生き残る", async () => {
    const manager = newTmuxManager();
    const session = manager.create(process.cwd());
    await waitFor(() => tmuxSessionNames().includes(tmuxSessionName(session.id)));

    manager.disposeAll();

    expect(manager.list()).toEqual([]);
    // サーバが落ちても tmux 側のプロセスは残る。これが永続化の本体。
    expect(tmuxSessionNames()).toContain(tmuxSessionName(session.id));
  });

  it("recover で生き残ったセッションが一覧に戻る", async () => {
    const first = newTmuxManager();
    const created = first.create(process.cwd());
    await waitFor(() => tmuxSessionNames().includes(tmuxSessionName(created.id)));
    first.disposeAll();

    const second = newTmuxManager();
    second.recover();

    const recovered = second.get(created.id);
    expect(recovered?.cwd).toBe(process.cwd());
    expect(recovered?.title).toBe(created.title);
    // 状態は hook 由来なので復元時は idle に戻り、次のイベントで追いつく。
    expect(recovered?.state).toBe("idle");
  });

  it("復元したセッションにも入力を流せる", async () => {
    const first = newTmuxManager();
    const created = first.create(process.cwd());
    await waitFor(() => tmuxSessionNames().includes(tmuxSessionName(created.id)));
    first.disposeAll();

    const second = newTmuxManager();
    second.recover();
    second.write(created.id, "echo recovered-marker\n");
    await waitFor(() => second.scrollback(created.id).includes("recovered-marker"));
    expect(second.scrollback(created.id)).toContain("recovered-marker");
  });

  it("kill すると tmux セッションごと消える", async () => {
    const manager = newTmuxManager();
    const session = manager.create(process.cwd());
    await waitFor(() => tmuxSessionNames().includes(tmuxSessionName(session.id)));

    manager.kill(session.id);

    await waitFor(() => !tmuxSessionNames().includes(tmuxSessionName(session.id)));
    await waitFor(() => manager.list().length === 0);
    expect(manager.get(session.id)).toBeUndefined();
  });

  it("recover は既に把握しているセッションを二重に登録しない", async () => {
    const manager = newTmuxManager();
    const session = manager.create(process.cwd());
    await waitFor(() => tmuxSessionNames().includes(tmuxSessionName(session.id)));

    manager.recover();

    expect(manager.list().map((s) => s.id)).toEqual([session.id]);
  });
});
