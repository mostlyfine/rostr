import { readFileSync, rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildAgentCommand,
  buildAttachArgs,
  buildKillArgs,
  buildListArgs,
  buildNewSessionArgs,
  isTmuxAvailable,
  parseListSessions,
  sessionIdFromName,
  tmuxSessionName,
  writeTmuxConf,
} from "../../server/tmux";

describe("tmuxSessionName / sessionIdFromName", () => {
  it("id を往復できる", () => {
    const id = "0f0b8a3c-1111-2222-3333-444455556666";
    expect(sessionIdFromName(tmuxSessionName(id))) .toBe(id);
  });

  it("tmux が嫌う . と : を含まない", () => {
    expect(tmuxSessionName("0f0b8a3c-1111-2222-3333-444455556666")).not.toMatch(/[.:]/);
  });

  it("multi-agent 以外のセッション名からは id を取り出さない", () => {
    expect(sessionIdFromName("my-work")).toBeUndefined();
    expect(sessionIdFromName("ma-")).toBeUndefined();
    expect(sessionIdFromName("")).toBeUndefined();
  });
});

describe("buildAgentCommand", () => {
  const command = buildAgentCommand({
    agentBin: "claude",
    args: ["--session-id", "abc"],
    sessionId: "abc",
    port: 8787,
    unsetKeys: ["CLAUDECODE", "CLAUDE_PID"],
  });

  it("env(1) 経由で起動する", () => {
    expect(command[0]).toBe("env");
  });

  it("親から継承した印を -u で落とす", () => {
    expect(command).toContain("-u");
    expect(command.join(" ")).toContain("-u CLAUDECODE");
    expect(command.join(" ")).toContain("-u CLAUDE_PID");
  });

  it("hook 用の変数を渡す", () => {
    expect(command).toContain("MA_SESSION_ID=abc");
    expect(command).toContain("MA_PORT=8787");
  });

  it("エージェントと引数が末尾に並ぶ", () => {
    expect(command.slice(-3)).toEqual(["claude", "--session-id", "abc"]);
  });
});

describe("buildNewSessionArgs", () => {
  const args = buildNewSessionArgs({
    socket: "multi-agent",
    conf: "/tmp/ma.conf",
    name: "ma-abc",
    cwd: "/work",
    cols: 120,
    rows: 30,
    command: ["env", "claude"],
  });

  it("専用ソケットと専用 conf を使う", () => {
    expect(args.slice(0, 4)).toEqual(["-L", "multi-agent", "-f", "/tmp/ma.conf"]);
  });

  it("デタッチしたまま指定の名前と cwd で起動する", () => {
    expect(args).toContain("new-session");
    expect(args).toContain("-d");
    expect(args.join(" ")).toContain("-s ma-abc");
    expect(args.join(" ")).toContain("-c /work");
  });

  it("初期サイズを渡す", () => {
    expect(args.join(" ")).toContain("-x 120");
    expect(args.join(" ")).toContain("-y 30");
  });

  it("-- の後ろにコマンドを置く", () => {
    const separator = args.indexOf("--");
    expect(separator).toBeGreaterThan(0);
    expect(args.slice(separator + 1)).toEqual(["env", "claude"]);
  });
});

describe("buildAttachArgs / buildKillArgs / buildListArgs", () => {
  it("attach は他クライアントを切り離して名前を完全一致で指す", () => {
    const args = buildAttachArgs("multi-agent", "/tmp/ma.conf", "ma-abc");
    expect(args).toContain("attach-session");
    expect(args).toContain("-d");
    expect(args.join(" ")).toContain("-t =ma-abc");
  });

  it("kill も名前を完全一致で指す", () => {
    const args = buildKillArgs("multi-agent", "ma-abc");
    expect(args).toContain("kill-session");
    expect(args.join(" ")).toContain("-t =ma-abc");
  });

  it("list は cwd と作成時刻を取れる書式を使う", () => {
    const args = buildListArgs("multi-agent");
    expect(args).toContain("list-sessions");
    const format = args[args.indexOf("-F") + 1];
    expect(format).toContain("#{session_name}");
    expect(format).toContain("#{session_path}");
    expect(format).toContain("#{session_created}");
  });
});

describe("parseListSessions", () => {
  it("multi-agent のセッションを取り出す", () => {
    const parsed = parseListSessions("ma-abc\t/work\t1700000000\n");
    expect(parsed).toEqual([{ id: "abc", cwd: "/work", createdAt: 1_700_000_000_000 }]);
  });

  it("multi-agent 以外のセッションは無視する", () => {
    const parsed = parseListSessions("ma-abc\t/work\t1700000000\nmy-work\t/other\t1700000001\n");
    expect(parsed.map((s) => s.id)).toEqual(["abc"]);
  });

  it("空行や欠けた行は捨てる", () => {
    const parsed = parseListSessions("\nma-broken\n\nma-abc\t/work\t1700000000\n");
    expect(parsed.map((s) => s.id)).toEqual(["abc"]);
  });

  it("作成時刻が読めなければ現在時刻で埋める", () => {
    const before = Date.now();
    const [session] = parseListSessions("ma-abc\t/work\t-\n");
    expect(session.createdAt).toBeGreaterThanOrEqual(before);
  });

  it("何も無ければ空配列", () => {
    expect(parseListSessions("")).toEqual([]);
  });
});

describe("writeTmuxConf", () => {
  let path: string | undefined;

  afterEach(() => {
    if (path) rmSync(path, { force: true });
    path = undefined;
  });

  it("Claude の入力を奪わない設定を書き出す", () => {
    path = writeTmuxConf();
    const conf = readFileSync(path, "utf8");
    // prefix が生きていると C-b が tmux に吸われて Claude の TUI に届かない。
    expect(conf).toContain("set -g prefix None");
    expect(conf).toContain("set -g prefix2 None");
    expect(conf).toContain("unbind-key -a");
  });

  it("ステータス行を消し、最後に attach したクライアントの寸法に追従させる", () => {
    path = writeTmuxConf();
    const conf = readFileSync(path, "utf8");
    expect(conf).toContain("set -g status off");
    expect(conf).toContain("set -g window-size latest");
  });
});

describe("isTmuxAvailable", () => {
  afterEach(() => {
    delete process.env.MA_TMUX;
  });

  it("MA_TMUX=0 なら無効", () => {
    process.env.MA_TMUX = "0";
    expect(isTmuxAvailable()).toBe(false);
  });
});
