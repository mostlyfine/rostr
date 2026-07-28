import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** ユーザー個人の tmux サーバと混ざらないよう、専用ソケットで動かす。 */
export const DEFAULT_TMUX_SOCKET = "multi-agent";

/** tmux セッション名の前置き。名前の残りがそのままセッション id になる。 */
const SESSION_PREFIX = "ma-";

/**
 * ユーザーの ~/.tmux.conf を読ませないための最小設定。
 * prefix を殺しておかないと C-b などが tmux に吸われて Claude の TUI に届かない。
 */
const TMUX_CONF = [
  "set -g prefix None",
  "set -g prefix2 None",
  "unbind-key -a",
  "set -g status off",
  // 最後に attach したクライアント（＝ブラウザ）の寸法に追従させる。
  "set -g window-size latest",
  "set -g escape-time 0",
  "set -g history-limit 100000",
  "set -g mouse off",
  'set -g default-terminal "xterm-256color"',
  "set -g allow-passthrough on",
  "",
].join("\n");

/** list-sessions から復元に必要な項目だけ取り出す書式。 */
const LIST_FORMAT = "#{session_name}\t#{session_path}\t#{session_created}";

export interface TmuxSessionInfo {
  id: string;
  cwd: string;
  createdAt: number;
}

export interface NewSessionOptions {
  socket: string;
  conf: string;
  name: string;
  cwd: string;
  cols: number;
  rows: number;
  command: string[];
}

export interface AgentCommandOptions {
  agentBin: string;
  args: string[];
  sessionId: string;
  port: number;
  /** 親から継承した印。子には渡さない。 */
  unsetKeys: readonly string[];
}

export const tmuxSessionName = (id: string): string => `${SESSION_PREFIX}${id}`;

export const sessionIdFromName = (name: string): string | undefined => {
  if (!name.startsWith(SESSION_PREFIX)) return undefined;
  const id = name.slice(SESSION_PREFIX.length);
  return id === "" ? undefined : id;
};

/** 設定を一時ファイルへ書き出し、そのパスを返す。 */
export const writeTmuxConf = (): string => {
  const dir = join(tmpdir(), "multi-agent-settings");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "tmux.conf");
  writeFileSync(path, TMUX_CONF, "utf8");
  return path;
};

/**
 * tmux の子プロセスは tmux サーバ起動時の環境を継承するので、node-pty に渡した env は届かない。
 * 環境変数の付け外しは env(1) で明示的に行う。
 */
export const buildAgentCommand = (options: AgentCommandOptions): string[] => [
  "env",
  ...options.unsetKeys.flatMap((key) => ["-u", key]),
  `MA_SESSION_ID=${options.sessionId}`,
  `MA_PORT=${options.port}`,
  options.agentBin,
  ...options.args,
];

export const buildNewSessionArgs = (options: NewSessionOptions): string[] => [
  "-L",
  options.socket,
  "-f",
  options.conf,
  "new-session",
  "-d",
  "-s",
  options.name,
  "-c",
  options.cwd,
  "-x",
  String(options.cols),
  "-y",
  String(options.rows),
  "--",
  ...options.command,
];

/** `=` 前置きは tmux での完全一致指定。前方一致で別セッションを掴まないようにする。 */
const exactTarget = (name: string): string => `=${name}`;

export const buildAttachArgs = (socket: string, conf: string, name: string): string[] => [
  "-L",
  socket,
  "-f",
  conf,
  "attach-session",
  "-t",
  exactTarget(name),
  // 他のクライアントを切り離して、寸法の主導権をこの接続に持たせる。
  "-d",
];

export const buildKillArgs = (socket: string, name: string): string[] => [
  "-L",
  socket,
  "kill-session",
  "-t",
  exactTarget(name),
];

export const buildListArgs = (socket: string): string[] => [
  "-L",
  socket,
  "list-sessions",
  "-F",
  LIST_FORMAT,
];

export const parseListSessions = (stdout: string): TmuxSessionInfo[] => {
  const sessions: TmuxSessionInfo[] = [];
  for (const line of stdout.split("\n")) {
    const [name, cwd, created] = line.split("\t");
    const id = name ? sessionIdFromName(name) : undefined;
    if (!id || !cwd) continue;
    const seconds = Number(created);
    // session_created は秒。読めない場合は復元時刻で代用する。
    const createdAt = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : Date.now();
    sessions.push({ id, cwd, createdAt });
  }
  return sessions;
};

let available: boolean | undefined;

/** tmux が使えるか。MA_TMUX=0 で明示的に無効化できる。 */
export const isTmuxAvailable = (): boolean => {
  if (process.env.MA_TMUX === "0") return false;
  if (available === undefined) {
    const result = spawnSync("tmux", ["-V"], { stdio: "ignore" });
    available = result.status === 0;
  }
  return available;
};

/** デタッチしたままセッションを起こす。失敗したら理由を添えて投げる。 */
export const startTmuxSession = (options: NewSessionOptions): void => {
  const result = spawnSync("tmux", buildNewSessionArgs(options), { encoding: "utf8" });
  if (result.status === 0) return;
  const reason = result.stderr?.trim() || result.error?.message || `exit ${result.status}`;
  throw new Error(`tmux セッションを開始できません: ${reason}`);
};

export const killTmuxSession = (socket: string, name: string): void => {
  spawnSync("tmux", buildKillArgs(socket, name), { stdio: "ignore" });
};

/** 生き残っている multi-agent のセッションを列挙する。 */
export const listTmuxSessions = (socket: string): TmuxSessionInfo[] => {
  const result = spawnSync("tmux", buildListArgs(socket), { encoding: "utf8" });
  // tmux サーバがまだ無いときは "error connecting to ..." で非ゼロ終了する。0 件として扱う。
  if (result.status !== 0 || typeof result.stdout !== "string") return [];
  return parseListSessions(result.stdout);
};
