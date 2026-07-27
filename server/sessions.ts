import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import { basename, resolve } from "node:path";
import pty from "node-pty";
import type { IPty } from "node-pty";
import type { HookEvent, Session } from "../common/types";
import { applyHookEvent } from "./state";

export interface SessionManagerOptions {
  /** 起動するバイナリ。既定は claude。テストでは /bin/sh に差し替える。 */
  agentBin: string;
  /** セッション id から起動引数を組み立てる。 */
  buildArgs: (sessionId: string) => string[];
  /** hook スクリプトが POST する先のポート番号。子プロセスの env に渡す。 */
  port: number;
  /** 各セッションで保持する出力の文字数上限。 */
  scrollbackChars?: number;
}

type OutputListener = (data: string) => void;
type ChangeListener = () => void;

interface Entry {
  session: Session;
  proc: IPty;
  scrollback: string;
  listeners: Set<OutputListener>;
  killTimer?: NodeJS.Timeout;
}

/**
 * multi-agent 自身が Claude Code のセッション内から起動された場合、親の環境変数が子へ漏れる。
 * 子は独立したセッションなので、親を指す印は取り除いてから起動する。
 */
const INHERITED_CLAUDE_ENV_KEYS = [
  "CLAUDECODE",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_CODE_CHILD_SESSION",
  "CLAUDE_CODE_BRIDGE_SESSION_ID",
  "CLAUDE_CODE_EXECPATH",
  "CLAUDE_PID",
];

const DEFAULT_SCROLLBACK_CHARS = 200_000;
const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 30;
/** SIGTERM で死ななかった場合に SIGKILL へ切り替えるまでの猶予。 */
const KILL_GRACE_MS = 3_000;

export class SessionManager {
  private readonly entries = new Map<string, Entry>();
  private readonly changeListeners = new Set<ChangeListener>();
  private readonly scrollbackChars: number;

  constructor(private readonly options: SessionManagerOptions) {
    this.scrollbackChars = options.scrollbackChars ?? DEFAULT_SCROLLBACK_CHARS;
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

    const proc = pty.spawn(this.options.agentBin, this.options.buildArgs(id), {
      name: "xterm-256color",
      cols: DEFAULT_COLS,
      rows: DEFAULT_ROWS,
      cwd: absolute,
      env: this.buildEnv(id),
    });

    const entry: Entry = { session, proc, scrollback: "", listeners: new Set() };
    this.entries.set(id, entry);

    proc.onData((data) => {
      entry.scrollback = (entry.scrollback + data).slice(-this.scrollbackChars);
      for (const listener of entry.listeners) listener(data);
    });

    // プロセスが死んだらセッションごと消す。x ボタンでも claude 自身の終了でも同じ。
    proc.onExit(() => this.remove(id));

    this.emitChange();
    return session;
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

  /** サーバ終了時に全 PTY を落とす。 */
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

  /** 子プロセスへ渡す環境変数。親セッションの印を落とし、hook 用の変数を足す。 */
  private buildEnv(sessionId: string): Record<string, string> {
    const env = { ...(process.env as Record<string, string>) };
    for (const key of INHERITED_CLAUDE_ENV_KEYS) delete env[key];
    env.MA_SESSION_ID = sessionId;
    env.MA_PORT = String(this.options.port);
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
