import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import { basename, resolve } from "node:path";
import pty from "node-pty";
import type { IPty } from "node-pty";
import type { HookEvent, Session } from "../common/types";
import { applyHookEvent, type HookOutcome } from "./state";
import type { Summarizer } from "./summary";
import { createModeTracker, type ModeTracker } from "./terminalModes";
import {
  AGENT_TMUX_PREFIX,
  DEFAULT_TMUX_SOCKET,
  buildAgentCommand,
  buildAttachArgs,
  isTmuxAvailable,
  killTmuxSession,
  listTmuxSessions,
  parseListSessions,
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
  /** tmux セッション名の前置き。シェル用のマネージャはここを変えて名前空間を分ける。 */
  tmuxPrefix?: string;
  /** 要約の生成先。渡さなければ要約は作られない。 */
  summarizer?: Summarizer;
}

type OutputListener = (data: string) => void;
/**
 * 一覧が変わったときの通知。セッションが消えた場合だけその id が入る。
 * 「消えた」は購読者が一覧を舐め直さないと分からない情報なので、通知そのものに載せる。
 */
type ChangeListener = (removedId?: string) => void;

interface Entry {
  session: Session;
  /** tmux 経由なら attach しているクライアント、そうでなければエージェント本体。 */
  proc: IPty;
  scrollback: string;
  /** スクロールバックの切り詰めで失われる端末モードを別に覚えておく。 */
  modes: ModeTracker;
  listeners: Set<OutputListener>;
  /** tmux 経由のときだけ入る。 */
  tmuxName?: string;
  /** hook が知らせてきた会話 JSONL のパス。要約の入力に使う。 */
  transcriptPath?: string;
  killTimer?: NodeJS.Timeout;
}

/**
 * rostr 自身が Claude Code のセッション内から起動された場合、親の環境変数が子へ漏れる。
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

/**
 * node --watch が子へ付ける印。これが付いた node の子は IPC で依存ファイルを親へ報告する。
 * rostr を npm run dev（--watch）で動かしていると、エージェントの中で走る別の node
 * ——vitest の forks プールなど、IPC で自前のプロトコルを喋るもの——にまで報告が混ざって壊れる。
 */
const WATCH_MODE_ENV_KEYS = ["WATCH_REPORT_DEPENDENCIES"];

/** エージェントへ渡す前に落とす環境変数。tmux 経由でも直接起動でも同じものを落とす。 */
export const STRIPPED_ENV_KEYS = [...INHERITED_CLAUDE_ENV_KEYS, ...WATCH_MODE_ENV_KEYS];

/** tmux の中から rostr を起動していると、attach がネストを嫌って失敗する。 */
const NESTED_TMUX_ENV_KEYS = ["TMUX", "TMUX_PANE"];

const DEFAULT_SCROLLBACK_CHARS = 200_000;
const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 30;
/** SIGTERM で死ななかった場合に SIGKILL へ切り替えるまでの猶予。 */
const KILL_GRACE_MS = 3_000;

/** 起動直後・復元直後の Session を組み立てる。状態やプロンプトは hook が来るまで空のまま。 */
const makeIdleSession = (id: string, cwd: string, createdAt: number): Session => ({
  id,
  cwd,
  title: basename(cwd) || cwd,
  state: "idle",
  prompt: "",
  activity: "",
  summary: "",
  createdAt,
  updatedAt: createdAt,
});

export class SessionManager {
  private readonly entries = new Map<string, Entry>();
  private readonly changeListeners = new Set<ChangeListener>();
  private readonly scrollbackChars: number;
  private readonly useTmux: boolean;
  private readonly tmuxSocket: string;
  private readonly tmuxPrefix: string;
  private tmuxConfPath?: string;
  private tmuxConfLoaded = false;
  /** STRIPPED_ENV_KEYS を落とし終えた env。セッションごとの値だけを上から足して使う。 */
  private baseEnv?: Record<string, string>;

  constructor(private readonly options: SessionManagerOptions) {
    this.scrollbackChars = options.scrollbackChars ?? DEFAULT_SCROLLBACK_CHARS;
    this.useTmux = options.tmux ?? isTmuxAvailable();
    this.tmuxSocket = options.tmuxSocket ?? DEFAULT_TMUX_SOCKET;
    this.tmuxPrefix = options.tmuxPrefix ?? AGENT_TMUX_PREFIX;
  }

  /** tmux 経由で起動しているか。起動ログの表示に使う。 */
  get tmuxEnabled(): boolean {
    return this.useTmux;
  }

  /**
   * 指定ディレクトリでエージェントを起動する。
   * id を渡すとそれを使う。シェル用のマネージャが親エージェントと同じ id で登録するための口。
   */
  create(cwd: string, id: string = randomUUID()): Session {
    if (this.entries.has(id)) throw new Error(`セッションは既に存在します: ${id}`);

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

    const session = makeIdleSession(id, absolute, Date.now());

    if (this.useTmux) {
      const name = tmuxSessionName(id, this.tmuxPrefix);
      this.ensureTmuxConfLoaded();
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
          unsetKeys: STRIPPED_ENV_KEYS,
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
  recover(listOutput?: string): number {
    if (!this.useTmux) return 0;

    // 同じソケットを見る管理者が複数あるので、list-sessions は呼び出し側で 1 回だけ取って配れる。
    const infos =
      listOutput === undefined
        ? listTmuxSessions(this.tmuxSocket, this.tmuxPrefix)
        : parseListSessions(listOutput, this.tmuxPrefix);
    if (infos.length === 0) return 0;

    // 古い設定のまま動き続けているサーバにも、今の設定を届けてから繋ぎ直す。
    this.ensureTmuxConfLoaded();

    let recovered = 0;
    for (const info of infos) {
      if (this.entries.has(info.id)) continue;
      const name = tmuxSessionName(info.id, this.tmuxPrefix);
      const session = makeIdleSession(info.id, info.cwd, info.createdAt);
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

  /** 接続してきたブラウザに見せる直前までの画面。切り詰めはここで行う。 */
  scrollback(id: string): string {
    const scrollback = this.entries.get(id)?.scrollback ?? "";
    return scrollback.slice(-this.scrollbackChars);
  }

  /**
   * 今この PTY で有効な端末モードを再現するシーケンス。
   * スクロールバックは末尾しか残らないため、先頭にしか現れないモード設定はここから補う。
   */
  terminalModes(id: string): string {
    return this.entries.get(id)?.modes.replay() ?? "";
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

    // 会話ファイルの場所は毎回同じとは限らない（worktree 移動などで変わる）ので都度上書きする。
    if (typeof event.transcript_path === "string" && event.transcript_path !== "") {
      entry.transcriptPath = event.transcript_path;
    }

    const outcome = applyHookEvent(entry.session, event);
    if (Object.keys(outcome.patch).length > 0) {
      entry.session = { ...entry.session, ...outcome.patch, updatedAt: Date.now() };
      this.emitChange();
    }

    this.updateSummary(id, entry, event, outcome);
    return true;
  }

  /**
   * 要約の生成をきっかけごとに振り分ける。
   * 会話が作り直されたら世代を進めて古い結果を捨てさせ、ターンが終わったら生成を依頼する。
   *
   * UserPromptSubmit は Stop を待たず即座に依頼する。ユーザーの新しい意図をサイドバーに
   * 早く反映するためだが、バックグラウンドタスク通知の自動投入まで依頼してしまうと無駄な
   * 生成が増えるので、それを除いたことを applyHookEvent が明示してきた場合に限る。
   */
  private updateSummary(id: string, entry: Entry, event: HookEvent, outcome: HookOutcome): void {
    const summarizer = this.options.summarizer;
    if (!summarizer) return;

    if (outcome.conversationReset) {
      summarizer.reset(id);
      return;
    }
    const isStop = event.hook_event_name === "Stop";
    if (!isStop && !outcome.userIntentChanged) return;
    if (!entry.transcriptPath) return;

    summarizer.request(id, entry.transcriptPath, (summary) => this.setSummary(id, summary));
  }

  /** 要約が届いたら書き戻す。生成中にセッションが消えていることがあるので存在を確かめる。 */
  private setSummary(id: string, summary: string): void {
    const entry = this.entries.get(id);
    if (!entry || entry.session.summary === summary) return;
    entry.session = { ...entry.session, summary, updatedAt: Date.now() };
    this.emitChange();
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

  /** 動いている tmux サーバへの読み直しは、この設定で一度届けていれば済む。 */
  private ensureTmuxConfLoaded(): void {
    if (this.tmuxConfLoaded) return;
    reloadTmuxConf(this.tmuxSocket, this.tmuxConf());
    this.tmuxConfLoaded = true;
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
    const entry: Entry = {
      session,
      proc,
      scrollback: "",
      modes: createModeTracker(),
      listeners: new Set(),
      tmuxName,
    };
    this.entries.set(session.id, entry);

    proc.onData((data) => {
      entry.modes.feed(data);
      // 出力のたびに上限ちょうどへ切ると、そのたびに上限ぶんの文字列を作り直すことになる。
      // 上限の 2 倍まで溜めてから落とし、実際の切り詰めは読み出す scrollback() に任せる。
      entry.scrollback += data;
      if (entry.scrollback.length > this.scrollbackChars * 2) {
        entry.scrollback = entry.scrollback.slice(-this.scrollbackChars);
      }
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
    // process.env の各項目は C++ のアクセサなので、展開は見た目より高い。
    // 落とすキーは固定なので、削除済みの土台は一度だけ作って使い回す。
    this.baseEnv ??= (() => {
      const env = { ...(process.env as Record<string, string>) };
      for (const key of STRIPPED_ENV_KEYS) delete env[key];
      for (const key of NESTED_TMUX_ENV_KEYS) delete env[key];
      return env;
    })();
    if (!sessionId) return this.baseEnv;
    return {
      ...this.baseEnv,
      ROSTR_SESSION_ID: sessionId,
      ROSTR_PORT: String(this.options.port),
    };
  }

  private remove(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    if (entry.killTimer) clearTimeout(entry.killTimer);
    entry.listeners.clear();
    this.entries.delete(id);
    this.emitChange(id);
  }

  private emitChange(removedId?: string): void {
    for (const listener of this.changeListeners) listener(removedId);
  }
}
