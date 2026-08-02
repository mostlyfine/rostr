import type { AgentKind } from "./agents";

/** エージェントの状態。サイドバーのグループ分けに使う。 */
export type AgentState = "idle" | "working" | "waiting" | "done" | "exited";

export interface Session {
  /** UUID。claude --session-id にもそのまま渡す。 */
  id: string;
  agent: AgentKind;
  cwd: string;
  /** cwd の basename。 */
  title: string;
  state: AgentState;
  /** 直近の UserPromptSubmit の本文。 */
  prompt: string;
  /** いま何をしているか。例: "Edit App.vue" */
  activity: string;
  /** 会話全体で何をしようとしているかの1行要約。未生成なら空文字。 */
  summary: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * API が返すセッション。スプリットの開閉はサーバ側のシェルの有無で表すので、
 * クライアントは自前で開閉状態を持たず、この値だけを見る。
 */
export interface SessionView extends Session {
  shell: boolean;
}

/** 状態遷移に必要な hook イベント。設定生成と状態遷移の両方がこの一覧を参照する。 */
export const HOOKED_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "Notification",
  "Stop",
  "SessionEnd",
] as const;

export type HookedEvent = (typeof HOOKED_EVENTS)[number];

/** Claude Code の hook から POST されてくるイベント。必要なフィールドだけ拾う。 */
export interface HookEvent {
  /** 監視対象外のイベントも届くので、既知の名前に限定はしない。 */
  hook_event_name: HookedEvent | (string & {});
  prompt?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  message?: string;
  /** Notification イベントの種別。permission_prompt / idle_prompt など。 */
  notification_type?: string;
  /** この会話の JSONL ファイルの絶対パス。要約の入力に使う。 */
  transcript_path?: string;
  [key: string]: unknown;
}

/** クライアント → サーバの WebSocket メッセージ。 */
export type ClientMessage =
  | { type: "input"; data: string }
  | { type: "resize"; cols: number; rows: number };
