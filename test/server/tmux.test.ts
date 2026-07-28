import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  buildAgentCommand,
  buildAttachArgs,
  buildKillArgs,
  buildListArgs,
  buildNewSessionArgs,
  buildSourceFileArgs,
  isTmuxAvailable,
  parseListSessions,
  reloadTmuxConf,
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

  it("rostr 以外のセッション名からは id を取り出さない", () => {
    expect(sessionIdFromName("my-work")).toBeUndefined();
    expect(sessionIdFromName("rostr-")).toBeUndefined();
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
    expect(command).toContain("ROSTR_SESSION_ID=abc");
    expect(command).toContain("ROSTR_PORT=8787");
  });

  it("エージェントと引数が末尾に並ぶ", () => {
    expect(command.slice(-3)).toEqual(["claude", "--session-id", "abc"]);
  });
});

describe("buildNewSessionArgs", () => {
  const args = buildNewSessionArgs({
    socket: "rostr",
    conf: "/tmp/rostr.conf",
    name: "rostr-abc",
    cwd: "/work",
    cols: 120,
    rows: 30,
    command: ["env", "claude"],
  });

  it("専用ソケットと専用 conf を使う", () => {
    expect(args.slice(0, 4)).toEqual(["-L", "rostr", "-f", "/tmp/rostr.conf"]);
  });

  it("デタッチしたまま指定の名前と cwd で起動する", () => {
    expect(args).toContain("new-session");
    expect(args).toContain("-d");
    expect(args.join(" ")).toContain("-s rostr-abc");
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
    const args = buildAttachArgs("rostr", "/tmp/rostr.conf", "rostr-abc");
    expect(args).toContain("attach-session");
    expect(args).toContain("-d");
    expect(args.join(" ")).toContain("-t =rostr-abc");
  });

  it("kill も名前を完全一致で指す", () => {
    const args = buildKillArgs("rostr", "rostr-abc");
    expect(args).toContain("kill-session");
    expect(args.join(" ")).toContain("-t =rostr-abc");
  });

  it("list は cwd と作成時刻を取れる書式を使う", () => {
    const args = buildListArgs("rostr");
    expect(args).toContain("list-sessions");
    const format = args[args.indexOf("-F") + 1];
    expect(format).toContain("#{session_name}");
    expect(format).toContain("#{session_path}");
    expect(format).toContain("#{session_created}");
  });
});

describe("parseListSessions", () => {
  it("rostr のセッションを取り出す", () => {
    const parsed = parseListSessions("rostr-abc\t/work\t1700000000\n");
    expect(parsed).toEqual([{ id: "abc", cwd: "/work", createdAt: 1_700_000_000_000 }]);
  });

  it("rostr 以外のセッションは無視する", () => {
    const parsed = parseListSessions("rostr-abc\t/work\t1700000000\nmy-work\t/other\t1700000001\n");
    expect(parsed.map((s) => s.id)).toEqual(["abc"]);
  });

  it("空行や欠けた行は捨てる", () => {
    const parsed = parseListSessions("\nrostr-broken\n\nrostr-abc\t/work\t1700000000\n");
    expect(parsed.map((s) => s.id)).toEqual(["abc"]);
  });

  it("作成時刻が読めなければ現在時刻で埋める", () => {
    const before = Date.now();
    const [session] = parseListSessions("rostr-abc\t/work\t-\n");
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
  });

  it("読み直せる設定にする", () => {
    path = writeTmuxConf();
    const conf = readFileSync(path, "utf8");
    // unbind-key -a は prefix テーブルごと消すので、2 回目の source-file が失敗する。
    // prefix が None なら prefix テーブルには到達しようがないので、そもそも要らない。
    expect(conf).not.toContain("unbind-key");
  });

  it("ステータス行を消し、最後に attach したクライアントの寸法に追従させる", () => {
    path = writeTmuxConf();
    const conf = readFileSync(path, "utf8");
    expect(conf).toContain("set -g status off");
    expect(conf).toContain("set -g window-size latest");
  });

  it("ホイールが tmux まで届くようにする", () => {
    path = writeTmuxConf();
    const conf = readFileSync(path, "utf8");
    // マウスが無効だと tmux にホイールが届かず、履歴へ入る手段が無くなる。
    expect(conf).toContain("set -g mouse on");
    expect(conf).not.toContain("set -g mouse off");
  });

  it("キーバインドには手を出さない", () => {
    path = writeTmuxConf();
    const conf = readFileSync(path, "utf8");
    // 履歴を遡る操作は tmux の既定バインドがそのまま担う。自前で縛るとキーを奪う。
    expect(conf).not.toContain("bind-key");
  });
});

describe("buildSourceFileArgs", () => {
  it("指定ソケットの tmux サーバに設定を読み直させる", () => {
    const args = buildSourceFileArgs("rostr", "/tmp/rostr.conf");
    expect(args).toEqual(["-L", "rostr", "source-file", "/tmp/rostr.conf"]);
  });
});

/**
 * 履歴を遡れるかどうかは tmux 側の既定バインド頼みなので、設定文字列だけを見ても分からない。
 * 本物の tmux を専用ソケットで起こして、実際にそうなっているかを確かめる。
 */
describe.skipIf(!isTmuxAvailable())("本物の tmux に設定を読ませる", () => {
  const socket = "rostr-test-conf";
  const name = "rostr-test";
  const tmux = (...args: string[]) =>
    spawnSync("tmux", ["-L", socket, ...args], { encoding: "utf8" });
  const display = (format: string) =>
    tmux("display-message", "-p", "-t", name, format).stdout.trim();
  // 設定ファイルのパスは固定なので、前の describe が消した後に書き直す。
  let conf = "";

  beforeAll(async () => {
    conf = writeTmuxConf();
    tmux("kill-server");
    spawnSync(
      "tmux",
      [
        "-L",
        socket,
        "-f",
        conf,
        "new-session",
        "-d",
        "-s",
        name,
        "-x",
        "80",
        "-y",
        "10",
        "--",
        "sh",
        "-c",
        "seq 1 500; sleep 60",
      ],
      { encoding: "utf8" },
    );
    // seq の出力が履歴に積まれるまで待つ。
    for (let i = 0; i < 40 && Number(display("#{history_size}")) < 490; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  });

  afterAll(() => {
    tmux("kill-server");
  });

  it("マウスが有効になる", () => {
    expect(tmux("show-options", "-g", "mouse").stdout.trim()).toBe("mouse on");
  });

  it("ホイール上が履歴の入口になる", () => {
    const wheelUp = tmux("list-keys", "-T", "root")
      .stdout.split("\n")
      .find((line) => line.includes("WheelUpPane"));
    // -e が付いているので、最下部まで戻れば自動で copy-mode を抜ける。
    expect(wheelUp).toContain("copy-mode -e");
  });

  it("copy-mode から q で抜けられるバインドが残っている", () => {
    // 実際に使われるテーブルは mode-keys 次第（$EDITOR が vi なら copy-mode-vi）。
    // Escape の意味は両者で違うが、q はどちらでも cancel。
    const table = tmux("show-options", "-g", "mode-keys").stdout.includes("vi")
      ? "copy-mode-vi"
      : "copy-mode";
    const quit = tmux("list-keys", "-T", table)
      .stdout.split("\n")
      .find((line) => / q +/.test(line));
    expect(quit).toContain("send-keys -X cancel");
  });

  it("画面から流れた出力が履歴に残る", () => {
    // 画面に出ているのは末尾だけで、その前は履歴にある。
    expect(tmux("capture-pane", "-p", "-t", name).stdout.split("\n")[0]).not.toBe("1");
    expect(tmux("capture-pane", "-p", "-S", "-", "-t", name).stdout.split("\n")[0]).toBe("1");
  });

  it("copy-mode で遡れて、最下部まで戻ると自動で抜ける", () => {
    tmux("copy-mode", "-e", "-t", name);
    tmux("send-keys", "-X", "-t", name, "-N", "20", "scroll-up");
    expect(display("#{pane_in_mode}")).toBe("1");
    expect(Number(display("#{scroll_position}"))).toBeGreaterThan(0);

    tmux("send-keys", "-X", "-t", name, "-N", "40", "scroll-down");
    // copy-mode -e の -e。最下部で自動的に通常の入力へ戻る。
    expect(display("#{pane_in_mode}")).toBe("0");
  });

  it("q で copy-mode を抜けられる", () => {
    tmux("copy-mode", "-e", "-t", name);
    tmux("send-keys", "-X", "-t", name, "-N", "20", "scroll-up");
    tmux("send-keys", "-t", name, "q");
    expect(display("#{pane_in_mode}")).toBe("0");
  });

  it("動いているサーバへ設定を配り直せる", () => {
    tmux("set-option", "-g", "mouse", "off");
    reloadTmuxConf(socket, conf);
    expect(tmux("show-options", "-g", "mouse").stdout.trim()).toBe("mouse on");
    // 読み直しでエラーを出さないこと。unbind-key -a があると失敗する。
    expect(tmux("source-file", conf).status).toBe(0);
  });
});

describe("isTmuxAvailable", () => {
  afterEach(() => {
    delete process.env.ROSTR_TMUX;
  });

  it("ROSTR_TMUX=0 なら無効", () => {
    process.env.ROSTR_TMUX = "0";
    expect(isTmuxAvailable()).toBe(false);
  });
});
