import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentKind } from "../../common/agents";
import type { AgentLaunch } from "../../server/agents";
import { SessionManager } from "../../server/sessions";
import type { Summarizer } from "../../server/summary";
import { SHELL_TMUX_PREFIX, isTmuxAvailable, tmuxSessionName } from "../../server/tmux";

/** claude の代わりに sh を起動する。テストでは実際のエージェントは要らない。 */
const managers: SessionManager[] = [];

const newManager = (
  opts: {
    launch?: (kind: AgentKind, id: string) => AgentLaunch;
    scrollbackChars?: number;
    summarizer?: Summarizer;
  } = {},
) => {
  const manager = new SessionManager({
    launch: opts.launch ?? ((kind, id) => ({ kind, bin: "/bin/sh", args: [] })),
    supportsHooks: () => false,
    port: 0,
    scrollbackChars: opts.scrollbackChars ?? 64,
    summarizer: opts.summarizer,
    // この describe は tmux を挟まない直接起動の経路を見る。
    tmux: false,
  });
  managers.push(manager);
  return manager;
};

/** 依頼を記録するだけの summarizer。apply を手で呼んで結果の反映を確かめる。 */
const fakeSummarizer = () => {
  const requests: { id: string; path: string; apply: (summary: string) => void }[] = [];
  const resets: string[] = [];
  const summarizer: Summarizer = {
    request: (id, path, apply) => requests.push({ id, path, apply }),
    reset: (id) => resets.push(id),
  };
  return { requests, resets, summarizer };
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

  it("既定の Claude セッションは kind と id を一度だけ解決する", () => {
    const launch = vi.fn((kind: AgentKind, id: string): AgentLaunch => ({ kind, bin: "/bin/sh", args: [] }));
    const manager = newManager({ launch });
    const session = manager.create("/tmp", "claude-id");

    expect(session.agent).toBe("claude");
    expect(launch).toHaveBeenCalledTimes(1);
    expect(launch).toHaveBeenCalledWith("claude", "claude-id");
  });

  it("選択した Codex セッションに kind を保存して解決済みコマンドを起動する", async () => {
    const launch = vi.fn((kind: AgentKind, id: string): AgentLaunch => ({
      kind,
      bin: "/bin/sh",
      args: ["-c", `echo launched-${kind}-${id}; exec /bin/sh`],
    }));
    const manager = newManager({ launch });
    const session = manager.create("/tmp", "codex-id", "codex");

    await waitFor(() => manager.scrollback(session.id).includes("launched-codex-codex-id"));
    expect(session.agent).toBe("codex");
    expect(launch).toHaveBeenCalledTimes(1);
    expect(launch).toHaveBeenCalledWith("codex", "codex-id");
  });

  it("存在しないディレクトリは拒否する", () => {
    const manager = newManager();
    expect(() => manager.create("/no/such/dir/at/all")).toThrow(/ディレクトリ/);
  });

  // シェル用のマネージャは親エージェントと同じ id で登録し、対応づけを id だけで済ませる。
  it("id を渡すとその id で登録する", () => {
    const manager = newManager();
    const session = manager.create("/tmp", "given-id");
    expect(session.id).toBe("given-id");
    expect(manager.get("given-id")).toBeDefined();
  });

  it("同じ id を二度作ろうとしたら拒否する", () => {
    const manager = newManager();
    manager.create("/tmp", "given-id");
    expect(() => manager.create("/tmp", "given-id")).toThrow(/既に/);
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

  // スクロールバックは末尾しか残らないので、先頭にしか現れないモード設定は別に覚えておく。
  // 覚えていないと、後から繋いだブラウザでマウス報告が無効なままになりスクロールバックが死ぬ。
  it("PTY が設定した端末モードをスクロールバックとは別に覚える", async () => {
    const manager = newManager();
    const session = manager.create("/tmp");
    manager.write(session.id, "printf '\\033[?1049h\\033[?1006h\\033[?1000h\\033[?1002h'\n");
    await waitFor(() => manager.terminalModes(session.id).includes("\x1b[?1002h"));
    expect(manager.terminalModes(session.id)).toContain("\x1b[?1049h");
    expect(manager.terminalModes(session.id)).toContain("\x1b[?1006h");
    expect(manager.terminalModes(session.id)).toContain("\x1b[?1000h");
  });

  it("端末モードはスクロールバックが上限で切り詰められても残る", async () => {
    const manager = newManager({ scrollbackChars: 64 });
    const session = manager.create("/tmp");
    manager.write(session.id, "printf '\\033[?1002h'\n");
    await waitFor(() => manager.terminalModes(session.id).includes("\x1b[?1002h"));
    manager.write(session.id, "echo ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ\n");
    await waitFor(() => manager.scrollback(session.id).includes("ZZZZ"));

    expect(manager.scrollback(session.id)).not.toContain("\x1b[?1002h");
    expect(manager.terminalModes(session.id)).toContain("\x1b[?1002h");
  });

  it("未知の id の端末モードは空文字列", () => {
    expect(newManager().terminalModes("nope")).toBe("");
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
      await waitFor(() => manager.scrollback(session.id).includes(`SID=${session.id}`));
      const output = manager.scrollback(session.id);
      expect(output).toContain(`SID=${session.id}`);
      expect(output).toContain("PARENT=[]");
      expect(output).toContain("CC=[]");
    } finally {
      delete process.env.CLAUDECODE;
      delete process.env.CLAUDE_CODE_SESSION_ID;
    }
  });

  // node --watch の子は IPC で依存関係を報告する。エージェント内で走る別の node（vitest の
  // forks プールなど）まで巻き込むと、そちらの IPC プロトコルが壊れる。
  it("node --watch の印は子へ渡さない", async () => {
    process.env.WATCH_REPORT_DEPENDENCIES = "1";
    try {
      const manager = newManager({ scrollbackChars: 4096 });
      const session = manager.create("/tmp");
      manager.write(session.id, 'echo "WATCH=[${WATCH_REPORT_DEPENDENCIES}]"\n');
      // 打ち込んだ行がそのままエコーされるので、変数が展開された後の行だけを待つ。
      await waitFor(() => /WATCH=\[1?\]/.test(manager.scrollback(session.id)));
      expect(manager.scrollback(session.id)).toContain("WATCH=[]");
    } finally {
      delete process.env.WATCH_REPORT_DEPENDENCIES;
    }
  });

  it("launch にセッション id が渡る", () => {
    const launch = vi.fn((kind: AgentKind, id: string): AgentLaunch => ({ kind, bin: "/bin/sh", args: [] }));
    const manager = newManager({
      launch,
    });
    const session = manager.create("/tmp");
    expect(launch).toHaveBeenCalledWith("claude", session.id);
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
      launch: (kind, id) => ({ kind, bin: "/bin/sh", args: [] }),
      supportsHooks: () => false,
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

  it("tmux 越しでも node --watch の印は子へ渡らない", async () => {
    process.env.WATCH_REPORT_DEPENDENCIES = "1";
    try {
      const manager = newTmuxManager();
      const session = manager.create(process.cwd());
      manager.write(session.id, 'echo "WATCH=[${WATCH_REPORT_DEPENDENCIES}]"\n');
      // 打ち込んだ行がそのままエコーされるので、変数が展開された後の行だけを待つ。
      await waitFor(() => /WATCH=\[1?\]/.test(manager.scrollback(session.id)));
      expect(manager.scrollback(session.id)).toContain("WATCH=[]");
    } finally {
      delete process.env.WATCH_REPORT_DEPENDENCIES;
    }
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
    expect(recovered?.agent).toBe("claude");
  });

  it("Codex の tmux セッションを agent 付きの名前で起動し、復元しても再解決しない", async () => {
    const firstLaunch = vi.fn((kind: AgentKind, id: string): AgentLaunch => ({
      kind,
      bin: "/bin/sh",
      args: ["-c", `echo launched-${kind}-${id}; exec sh`],
    }));
    const first = new SessionManager({
      launch: firstLaunch,
      supportsHooks: () => false,
      port: 0,
      tmux: true,
      tmuxSocket: TEST_SOCKET,
    });
    managers.push(first);
    const created = first.create(process.cwd(), "codex-id", "codex");
    await waitFor(() => tmuxSessionNames().includes(tmuxSessionName(created.id, "codex")));
    await waitFor(() => first.scrollback(created.id).includes("launched-codex-codex-id"));
    first.disposeAll();

    const recoveredLaunch = vi.fn((kind: AgentKind, id: string): AgentLaunch => ({ kind, bin: "/bin/sh", args: [] }));
    const second = new SessionManager({
      launch: recoveredLaunch,
      supportsHooks: () => false,
      port: 0,
      tmux: true,
      tmuxSocket: TEST_SOCKET,
    });
    managers.push(second);
    second.recover();

    expect(second.get(created.id)?.agent).toBe("codex");
    expect(recoveredLaunch).not.toHaveBeenCalled();
  });

  it("旧形式の tmux セッションは Claude として復元する", async () => {
    const first = newTmuxManager();
    const created = first.create(process.cwd(), "legacy-id");
    const legacyName = `rostr-${created.id}`;
    await waitFor(() => tmuxSessionNames().includes(tmuxSessionName(created.id)));
    expect(
      spawnSync(
        "tmux",
        ["-L", TEST_SOCKET, "rename-session", "-t", tmuxSessionName(created.id), legacyName],
        { stdio: "ignore" },
      ).status,
    ).toBe(0);
    first.disposeAll();

    const second = newTmuxManager();
    second.recover();

    expect(second.get(created.id)?.agent).toBe("claude");
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

  /** シェル用のマネージャは前置きだけを変えた同じ仕組み。互いの tmux セッションを拾わない。 */
  describe("tmuxPrefix でシェル用に分ける", () => {
    const newShellManager = () => {
      const manager = new SessionManager({
        launch: (kind, id) => ({ kind, bin: "/bin/sh", args: [] }),
        supportsHooks: () => false,
        port: 0,
        scrollbackChars: 8192,
        tmux: true,
        tmuxSocket: TEST_SOCKET,
        tmuxPrefix: SHELL_TMUX_PREFIX,
      });
      managers.push(manager);
      return manager;
    };

    it("シェル用の前置きで tmux セッションが立つ", async () => {
      const shells = newShellManager();
      const session = shells.create(process.cwd(), "shared-id");
      const name = tmuxSessionName(session.id, "claude", SHELL_TMUX_PREFIX);
      await waitFor(() => tmuxSessionNames().includes(name));
      expect(tmuxSessionNames()).toContain(name);
    });

    it("エージェントとシェルが同じ id で共存でき、互いを recover で拾わない", async () => {
      const agents = newTmuxManager();
      const shells = newShellManager();
      const agent = agents.create(process.cwd());
      shells.create(process.cwd(), agent.id);
      await waitFor(() => tmuxSessionNames().length === 2);

      agents.disposeAll();
      shells.disposeAll();

      const recoveredAgents = newTmuxManager();
      const recoveredShells = newShellManager();
      recoveredAgents.recover();
      recoveredShells.recover();

      expect(recoveredAgents.list().map((s) => s.id)).toEqual([agent.id]);
      expect(recoveredShells.list().map((s) => s.id)).toEqual([agent.id]);
    });

    it("kill するのは自分の前置きの tmux セッションだけ", async () => {
      const agents = newTmuxManager();
      const shells = newShellManager();
      const agent = agents.create(process.cwd());
      shells.create(process.cwd(), agent.id);
      await waitFor(() => tmuxSessionNames().length === 2);

      shells.kill(agent.id);

      await waitFor(
        () => !tmuxSessionNames().includes(tmuxSessionName(agent.id, "claude", SHELL_TMUX_PREFIX)),
      );
      expect(tmuxSessionNames()).toContain(tmuxSessionName(agent.id));
    });
  });
});

describe("SessionManager の要約", () => {
  it("Stop で、覚えておいた transcript_path を使って要約を依頼する", () => {
    const fake = fakeSummarizer();
    const manager = newManager({ summarizer: fake.summarizer });
    const session = manager.create("/tmp");

    manager.applyHook(session.id, {
      hook_event_name: "UserPromptSubmit",
      prompt: "直したい",
      transcript_path: "/tmp/conv.jsonl",
    });
    manager.applyHook(session.id, { hook_event_name: "Stop" });

    // UserPromptSubmit の時点でも1回、Stop でさらに1回、あわせて2回依頼される。
    expect(fake.requests.map((r) => [r.id, r.path])).toEqual([
      [session.id, "/tmp/conv.jsonl"],
      [session.id, "/tmp/conv.jsonl"],
    ]);
  });

  it("transcript_path を一度も受け取っていなければ依頼しない", () => {
    const fake = fakeSummarizer();
    const manager = newManager({ summarizer: fake.summarizer });
    const session = manager.create("/tmp");

    manager.applyHook(session.id, { hook_event_name: "Stop" });
    expect(fake.requests).toEqual([]);
  });

  it("UserPromptSubmit でも transcript_path があれば直ちに要約を依頼する", () => {
    const fake = fakeSummarizer();
    const manager = newManager({ summarizer: fake.summarizer });
    const session = manager.create("/tmp");

    manager.applyHook(session.id, {
      hook_event_name: "UserPromptSubmit",
      prompt: "直したい",
      transcript_path: "/tmp/conv.jsonl",
    });

    expect(fake.requests.map((r) => [r.id, r.path])).toEqual([[session.id, "/tmp/conv.jsonl"]]);
  });

  it("バックグラウンドタスク通知による UserPromptSubmit では要約を依頼しない", () => {
    const fake = fakeSummarizer();
    const manager = newManager({ summarizer: fake.summarizer });
    const session = manager.create("/tmp");

    manager.applyHook(session.id, {
      hook_event_name: "UserPromptSubmit",
      prompt: "<task-notification>done</task-notification>",
      transcript_path: "/tmp/conv.jsonl",
    });

    expect(fake.requests).toEqual([]);
  });

  it("apply が呼ばれるとセッションに要約が入り、変更が通知される", () => {
    const fake = fakeSummarizer();
    const manager = newManager({ summarizer: fake.summarizer });
    const session = manager.create("/tmp");
    const changes = vi.fn();

    manager.applyHook(session.id, {
      hook_event_name: "Stop",
      transcript_path: "/tmp/conv.jsonl",
    });
    manager.onChange(changes);
    fake.requests[0].apply("サイドバー要約の表示");

    expect(manager.get(session.id)?.summary).toBe("サイドバー要約の表示");
    expect(changes).toHaveBeenCalledTimes(1);
  });

  it("消えたセッションへの apply は無視する", () => {
    const fake = fakeSummarizer();
    const manager = newManager({ summarizer: fake.summarizer });
    const session = manager.create("/tmp");

    manager.applyHook(session.id, {
      hook_event_name: "Stop",
      transcript_path: "/tmp/conv.jsonl",
    });
    manager.disposeAll();
    expect(() => fake.requests[0].apply("要約")).not.toThrow();
  });

  it("SessionStart で summarizer に reset を伝え、要約を消す", () => {
    const fake = fakeSummarizer();
    const manager = newManager({ summarizer: fake.summarizer });
    const session = manager.create("/tmp");

    manager.applyHook(session.id, {
      hook_event_name: "Stop",
      transcript_path: "/tmp/conv.jsonl",
    });
    fake.requests[0].apply("前の会話の要約");
    manager.applyHook(session.id, { hook_event_name: "SessionStart" });

    expect(fake.resets).toEqual([session.id]);
    expect(manager.get(session.id)?.summary).toBe("");
  });

  it("summarizer を渡さなくても hook の処理は落ちない", () => {
    const manager = newManager();
    const session = manager.create("/tmp");
    expect(
      manager.applyHook(session.id, {
        hook_event_name: "Stop",
        transcript_path: "/tmp/conv.jsonl",
      }),
    ).toBe(true);
  });
});
