import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import { basename, resolve } from "node:path";
import pty from "node-pty";
import type { IPty } from "node-pty";
import type { HookEvent, Session } from "../common/types";
import { applyHookEvent } from "./state";
import {
  DEFAULT_TMUX_SOCKET,
  buildAgentCommand,
  buildAttachArgs,
  isTmuxAvailable,
  killTmuxSession,
  listTmuxSessions,
  reloadTmuxConf,
  startTmuxSession,
  tmuxSessionName,
  writeTmuxConf,
} from "./tmux";

export interface SessionManagerOptions {
  /** 起動するバイナリ。既定は claude。テストでは /bin/sh に差し替える。 */
  agentBin: string;
  /** セッション id から起動引数を組み立てる。 */
  buildArgs: (sessionId: string) => string[];
  /** hook スクリプトが POST する先のポート番号。子プロセスの env に渡す。 */
  port: number;
  /** 各セッションで保持する出力の文字数上限。 */
  scrollbackChars?: number;
  /** tmux 経由で起動するか。既定は tmux が使えるかどうかで決まる。 */
  tmux?: boolean;
  /** tmux のソケット名。テストでは本番と分けるために差し替える。 */
  tmuxSocket?: string;
}

type OutputListener = (data: string) => void;
type ChangeListener = () => void;

interface Entry {
  session: Session;
  /** tmux 経由なら attach しているクライアント、そうでなければエージェント本体。 */
  proc: IPty;
  scrollback: string;
  listeners: Set<OutputListener>;
  /** tmux 経由のときだけ入る。 */
  tmuxName?: string;
  killTimer?: NodeJS.Timeout;
}

/**
 * multi-agent 自身が Claude Code のセッション内から起動された場合、親の環境変数が子へ漏れる。
 * 子は独立したセッションなので、親を指す印は取り除いてから起動する。
 */
export const INHERITED_CLAUDE_ENV_KEYS = [
  "CLAUDECODE",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_CODE_CHILD_SESSION",
  "CLAUDE_CODE_BRIDGE_SESSION_ID",
  "CLAUDE_CODE_EXECPATH",
  "CLAUDE_PID",
];

/** tmux の中から multi-agent を起動していると、attach がネストを嫌って失敗する。 */
const NESTED_TMUX_ENV_KEYS = ["TMUX", "TMUX_PANE"];

const DEFAULT_SCROLLBACK_CHARS = 200_000;
const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 30;
/** SIGTERM で死ななかった場合に SIGKILL へ切り替えるまでの猶予。 */
const KILL_GRACE_MS = 3_000;

export class SessionManager {
  private readonly entries = new Map<string, Entry>();
  private readonly changeListeners = new Set<ChangeListener>();
  private readonly scrollbackChars: number;
  private readonly useTmux: boolean;
  private readonly tmuxSocket: string;
  private tmuxConfPath?: string;

  constructor(private readonly options: SessionManagerOptions) {
    this.scrollbackChars = options.scrollbackChars ?? DEFAULT_SCROLLBACK_CHARS;
    this.useTmux = options.tmux ?? isTmuxAvailable();
    this.tmuxSocket = options.tmuxSocket ?? DEFAULT_TMUX_SOCKET;
  }

  /** tmux 経由で起動しているか。起動ログの表示に使う。 */
  get tmuxEnabled(): boolean {
    return this.useTmux;
  }

  /** 指定ディレクトリでエージェントを起動する。 */
  create(cwd: string): Session {
    const absolute = resolve(cwd);
    let stat;
    try {
      stat = statSync(absolute);
    } catch {
      throw new Error(`ディレクトリが存在しません: ${absolute}`);
    }
    if (!stat.isDirectory()) {
      throw new Error(`ディレクトリではありません: ${absolute}`);
    }

    const id = randomUUID();
    const now = Date.now();
    const session: Session = {
      id,
      cwd: absolute,
      title: basename(absolute) || absolute,
      state: "idle",
      prompt: "",
      activity: "",
      createdAt: now,
      updatedAt: now,
    };

    if (this.useTmux) {
      const name = tmuxSessionName(id);
      reloadTmuxConf(this.tmuxSocket, this.tmuxConf());
      startTmuxSession({
        socket: this.tmuxSocket,
        conf: this.tmuxConf(),
        name,
        cwd: absolute,
        cols: DEFAULT_COLS,
        rows: DEFAULT_ROWS,
        command: buildAgentCommand({
          agentBin: this.options.agentBin,
          args: this.options.buildArgs(id),
          sessionId: id,
          port: this.options.port,
          unsetKeys: INHERITED_CLAUDE_ENV_KEYS,
        }),
      });
      this.register(session, this.attach(name), name);
    } else {
      const proc = pty.spawn(this.options.agentBin, this.options.buildArgs(id), {
        name: "xterm-256color",
        cols: DEFAULT_COLS,
        rows: DEFAULT_ROWS,
        cwd: absolute,
        env: this.buildEnv(id),
      });
      this.register(session, proc);
    }

    this.emitChange();
    return session;
  }

  /**
   * 生き残っている tmux セッションを拾い直す。サーバ再起動後に一度だけ呼ぶ。
   * 状態・プロンプト・実行内容は hook 由来なので復元されず、次のイベントで追いつく。
   */
  recover(): number {
    if (!this.useTmux) return 0;

    const infos = listTmuxSessions(this.tmuxSocket);
    if (infos.length === 0) return 0;

    // 古い設定のまま動き続けているサーバにも、今の設定を届けてから繋ぎ直す。
    reloadTmuxConf(this.tmuxSocket, this.tmuxConf());

    let recovered = 0;
    for (const info of infos) {
      if (this.entries.has(info.id)) continue;
      const name = tmuxSessionName(info.id);
      const session: Session = {
        id: info.id,
        cwd: info.cwd,
        title: basename(info.cwd) || info.cwd,
        state: "idle",
        prompt: "",
        activity: "",
        createdAt: info.createdAt,
        updatedAt: Date.now(),
      };
      this.register(session, this.attach(name), name);
      recovered += 1;
    }

    if (recovered > 0) this.emitChange();
    return recovered;
  }

  get(id: string): Session | undefined {
    return this.entries.get(id)?.session;
  }

  list(): Session[] {
    return [...this.entries.values()].map((entry) => entry.session);
  }

  scrollback(id: string): string {
    return this.entries.get(id)?.scrollback ?? "";
  }

  /** PTY へ入力を送る。 */
  write(id: string, data: string): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    entry.proc.write(data);
    return true;
  }

  resize(id: string, cols: number, rows: number): boolean {
    const entry = this.entries.get(id);
    if (!entry || cols < 1 || rows < 1) return false;
    entry.proc.resize(cols, rows);
    return true;
  }

  /** hook イベントを状態へ反映する。変化があれば change を通知する。 */
  applyHook(id: string, event: HookEvent): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;

    const patch = applyHookEvent(entry.session, event);
    if (Object.keys(patch).length === 0) return true;

    entry.session = { ...entry.session, ...patch, updatedAt: Date.now() };
    this.emitChange();
    return true;
  }

  /** SIGTERM を送り、猶予を過ぎても残っていれば SIGKILL する。 */
  kill(id: string): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;

    // tmux 経由ではクライアントを落としても本体は残るので、セッションごと畳む。
    if (entry.tmuxName) killTmuxSession(this.tmuxSocket, entry.tmuxName);

    entry.proc.kill();
    entry.killTimer ??= setTimeout(() => {
      if (this.entries.has(id)) entry.proc.kill("SIGKILL");
    }, KILL_GRACE_MS);
    entry.killTimer.unref?.();
    return true;
  }

  /** 出力を購読する。戻り値を呼ぶと購読解除。 */
  onOutput(id: string, listener: OutputListener): () => void {
    const entry = this.entries.get(id);
    if (!entry) return () => {};
    entry.listeners.add(listener);
    return () => entry.listeners.delete(listener);
  }

  /** 一覧の内容が変わったときに呼ばれる。戻り値を呼ぶと購読解除。 */
  onChange(listener: ChangeListener): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  /**
   * サーバ終了時に PTY を手放す。
   * tmux 経由なら落ちるのは attach しているクライアントだけで、エージェントは動き続ける。
   * 次の起動で recover() が拾い直す。tmux が無い場合はエージェントごと終わる。
   */
  disposeAll(): void {
    for (const [id, entry] of this.entries) {
      if (entry.killTimer) clearTimeout(entry.killTimer);
      try {
        entry.proc.kill("SIGKILL");
      } catch {
        // 既に死んでいる場合は無視する。
      }
      this.entries.delete(id);
    }
  }

  /** tmux の設定ファイルは初回に一度だけ書き出す。 */
  private tmuxConf(): string {
    this.tmuxConfPath ??= writeTmuxConf();
    return this.tmuxConfPath;
  }

  /** 既存の tmux セッションへ繋ぐクライアントを PTY として起動する。 */
  private attach(name: string): IPty {
    return pty.spawn("tmux", buildAttachArgs(this.tmuxSocket, this.tmuxConf(), name), {
      name: "xterm-256color",
      cols: DEFAULT_COLS,
      rows: DEFAULT_ROWS,
      env: this.buildEnv(),
    });
  }

  /** PTY を出力の配線ごと登録する。直接起動でも tmux クライアントでも扱いは同じ。 */
  private register(session: Session, proc: IPty, tmuxName?: string): void {
    const entry: Entry = { session, proc, scrollback: "", listeners: new Set(), tmuxName };
    this.entries.set(session.id, entry);

    proc.onData((data) => {
      entry.scrollback = (entry.scrollback + data).slice(-this.scrollbackChars);
      for (const listener of entry.listeners) listener(data);
    });

    // プロセスが死んだらセッションごと消す。x ボタンでも claude 自身の終了でも同じ。
    proc.onExit(() => this.remove(session.id));
  }

  /**
   * 子プロセスへ渡す環境変数。親セッションの印と tmux のネスト情報を落とす。
   * sessionId を渡した直接起動のときだけ hook 用の変数を足す。
   * tmux 経由の場合はここではなく env(1) 側で渡す（tmux の子は tmux サーバの環境を継ぐため）。
   */
  private buildEnv(sessionId?: string): Record<string, string> {
    const env = { ...(process.env as Record<string, string>) };
    for (const key of INHERITED_CLAUDE_ENV_KEYS) delete env[key];
    for (const key of NESTED_TMUX_ENV_KEYS) delete env[key];
    if (sessionId) {
      env.MA_SESSION_ID = sessionId;
      env.MA_PORT = String(this.options.port);
    }
    return env;
  }

  private remove(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    if (entry.killTimer) clearTimeout(entry.killTimer);
    entry.listeners.clear();
    this.entries.delete(id);
    this.emitChange();
  }

  private emitChange(): void {
    for (const listener of this.changeListeners) listener();
  }
}
