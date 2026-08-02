import { spawnSync } from "node:child_process";
import { AGENT_KINDS, type AgentKind } from "../common/agents";
import type { AgentLaunch } from "./agents";
import { writeSettingsFile } from "./settingsDir";

/** ユーザー個人の tmux サーバと混ざらないよう、専用ソケットで動かす。 */
export const DEFAULT_TMUX_SOCKET = "rostr";

/**
 * tmux セッション名の前置き。エージェントは kind と id、シェルは id を後ろに続ける。
 * シェルは親エージェントと同じ id を使うので、区別できるのは前置きだけ。
 * どちらか一方がもう一方の前置きで始まっていると復元時に取り違えるため、
 * "rostr-" と "rostr_shell-" のように互いに前方一致しない綴りにしてある。
 */
export const AGENT_TMUX_PREFIX = "rostr-";
export const SHELL_TMUX_PREFIX = "rostr_shell-";

/**
 * ユーザーの ~/.tmux.conf を読ませないための最小設定。
 * prefix を殺しておかないと C-b などが tmux に吸われて Claude の TUI に届かない。
 * prefix が None なら prefix テーブルには到達しようがないので、unbind-key -a は置かない。
 * 置くと 2 回目以降の source-file が「table prefix doesn't exist」で失敗する。
 */
const TMUX_CONF = [
  "set -g prefix None",
  "set -g prefix2 None",
  "set -g status off",
  // 最後に attach したクライアント（＝ブラウザ）の寸法に追従させる。
  "set -g window-size latest",
  "set -g escape-time 0",
  "set -g history-limit 100000",
  // ホイールを tmux まで届けるための唯一の設定。root の既定バインド
  // WheelUpPane -> copy-mode -e がそのまま履歴の入口になり、最下部まで戻ると自動で抜ける。
  // tmux が要求するマウス報告はブラウザ側で握り潰し、ホイールだけ自前で組み立てて送る
  // （src/terminalMouse.ts）。tmux は要求が通ったかを知らないので、これで両立する。
  "set -g mouse on",
  'set -g default-terminal "xterm-256color"',
  "set -g allow-passthrough on",
  "",
].join("\n");

/** list-sessions から復元に必要な項目だけ取り出す書式。 */
const LIST_FORMAT = "#{session_name}\t#{session_path}\t#{session_created}";

export interface TmuxSessionInfo {
  name: string;
  id: string;
  agent: AgentKind;
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

export type AgentCommandOptions = Pick<AgentLaunch, "bin" | "args"> & {
  sessionId: string;
  port: number;
  /** 親から継承した印。子には渡さない。 */
  unsetKeys: readonly string[];
};

export const tmuxSessionName = (
  id: string,
  agent: AgentKind = "claude",
  prefix = AGENT_TMUX_PREFIX,
): string => (prefix === AGENT_TMUX_PREFIX ? `${prefix}${agent}-${id}` : `${prefix}${id}`);

const sessionInfoFromName = (
  name: string,
  prefix = AGENT_TMUX_PREFIX,
): Pick<TmuxSessionInfo, "id" | "agent"> | undefined => {
  if (!name.startsWith(prefix)) return undefined;
  const rest = name.slice(prefix.length);
  if (rest === "") return undefined;
  if (prefix !== AGENT_TMUX_PREFIX) return { id: rest, agent: "claude" };

  for (const agent of AGENT_KINDS) {
    const agentPrefix = `${agent}-`;
    if (rest.startsWith(agentPrefix) && rest.length > agentPrefix.length) {
      return { id: rest.slice(agentPrefix.length), agent };
    }
  }
  return { id: rest, agent: "claude" };
};

export const sessionIdFromName = (
  name: string,
  prefix = AGENT_TMUX_PREFIX,
): string | undefined => sessionInfoFromName(name, prefix)?.id;

/** 設定を一時ファイルへ書き出し、そのパスを返す。 */
export const writeTmuxConf = (): string => writeSettingsFile("tmux.conf", TMUX_CONF);

/**
 * tmux の子プロセスは tmux サーバ起動時の環境を継承するので、node-pty に渡した env は届かない。
 * 環境変数の付け外しは env(1) で明示的に行う。
 */
export const buildAgentCommand = (options: AgentCommandOptions): string[] => [
  "env",
  ...options.unsetKeys.flatMap((key) => ["-u", key]),
  `ROSTR_SESSION_ID=${options.sessionId}`,
  `ROSTR_PORT=${options.port}`,
  options.bin,
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

export const buildSourceFileArgs = (socket: string, conf: string): string[] => [
  "-L",
  socket,
  "source-file",
  conf,
];

export const buildListArgs = (socket: string): string[] => [
  "-L",
  socket,
  "list-sessions",
  "-F",
  LIST_FORMAT,
];

export const parseListSessions = (
  stdout: string,
  prefix = AGENT_TMUX_PREFIX,
): TmuxSessionInfo[] => {
  const sessions: TmuxSessionInfo[] = [];
  for (const line of stdout.split("\n")) {
    const [name, cwd, created] = line.split("\t");
    const session = name ? sessionInfoFromName(name, prefix) : undefined;
    if (!session || !cwd) continue;
    const seconds = Number(created);
    // session_created は秒。読めない場合は復元時刻で代用する。
    const createdAt = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : Date.now();
    sessions.push({ name, ...session, cwd, createdAt });
  }
  return sessions;
};

let available: boolean | undefined;

/** tmux が使えるか。ROSTR_TMUX=0 で明示的に無効化できる。 */
export const isTmuxAvailable = (): boolean => {
  if (process.env.ROSTR_TMUX === "0") return false;
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

/**
 * -f で渡した設定は tmux サーバの起動時にしか読まれない。
 * 既に動いているサーバにも新しい設定を届けるため、繋ぐ前に読み直させる。
 * サーバがまだ無ければ失敗するが、その場合は new-session の -f が読むので放っておく。
 */
export const reloadTmuxConf = (socket: string, conf: string): void => {
  spawnSync("tmux", buildSourceFileArgs(socket, conf), { stdio: "ignore" });
};

export const killTmuxSession = (socket: string, name: string): void => {
  spawnSync("tmux", buildKillArgs(socket, name), { stdio: "ignore" });
};

/** 生き残っている rostr のセッションを、指定した前置きのものだけ列挙する。 */
export const listTmuxSessions = (
  socket: string,
  prefix = AGENT_TMUX_PREFIX,
): TmuxSessionInfo[] => {
  const result = spawnSync("tmux", buildListArgs(socket), { encoding: "utf8" });
  // tmux サーバがまだ無いときは "error connecting to ..." で非ゼロ終了する。0 件として扱う。
  if (result.status !== 0 || typeof result.stdout !== "string") return [];
  return parseListSessions(result.stdout, prefix);
};
