import { basename } from "node:path";
import type { HookEvent, Session } from "../common/types";
import { oneLine, truncate } from "./text";

const PROMPT_MAX = 140;
const ACTIVITY_MAX = 100;

/** 改行と連続空白を潰して1行にし、長ければ省略する。 */
export const truncateOneLine = (text: string, max = PROMPT_MAX): string => truncate(oneLine(text), max);

/** ツール名と入力から、サイドバーに出す1行のサマリを作る。 */
export const summarizeTool = (toolName: string, toolInput?: Record<string, unknown>): string => {
  const pick = (key: string): string | undefined => {
    const value = toolInput?.[key];
    return typeof value === "string" && value.length > 0 ? value : undefined;
  };

  const detail = (() => {
    switch (toolName) {
      case "Bash":
        return pick("command");
      case "Edit":
      case "Write":
      case "Read":
      case "NotebookEdit": {
        const path = pick("file_path");
        return path ? basename(path) : undefined;
      }
      case "Task":
        return pick("description");
      case "Grep":
      case "Glob":
        return pick("pattern");
      default:
        return undefined;
    }
  })();

  return truncateOneLine(detail ? `${toolName} ${detail}` : toolName, ACTIVITY_MAX);
};

/**
 * hook イベントを適用した結果。patch は変更したいフィールドだけで、変更が無ければ空。
 * 残り 2 つは「何が起きたか」を言葉にしたもので、要約の生成を振り分ける側が読む。
 * これらを patch の中身から逆算すると、要約の制御が state 側の返り値の形という
 * 偶然の性質にぶら下がってしまうため、意味はここで明示的に宣言する。
 */
export interface HookOutcome {
  patch: Partial<Session>;
  /** 会話が作り直された。走っている要約の結果は捨てさせる。 */
  conversationReset: boolean;
  /** 人が新しく入力した。機械が差し込んだ疑似入力は含まない。 */
  userIntentChanged: boolean;
}

const outcome = (
  patch: Partial<Session>,
  flags: Partial<Omit<HookOutcome, "patch">> = {},
): HookOutcome => ({
  patch,
  conversationReset: flags.conversationReset ?? false,
  userIntentChanged: flags.userIntentChanged ?? false,
});

/**
 * hook イベントを現在のセッションに適用し、何が起きたかを返す純関数。
 *
 * exited は他の状態と同じ扱いで、後から来たイベントで上書きされる。worktree への移動や
 * /clear ではエージェントが生きたまま会話セッションだけが終わって SessionEnd が飛ぶので、
 * ここで固着させると動き続けている行が二度と更新されなくなる。本当に死んだ場合は
 * PTY の終了が行ごと消すので、状態を据え置く必要はない。
 */
export const applyHookEvent = (session: Session, event: HookEvent): HookOutcome => {
  switch (event.hook_event_name) {
    // 会話が作り直された。前の会話のプロンプトと実行内容は残しても誤解を招くだけなので消す。
    case "SessionStart":
      return outcome(
        { state: "idle", prompt: "", activity: "", summary: "" },
        { conversationReset: true },
      );
    case "UserPromptSubmit": {
      const prompt = event.prompt ?? "";
      // バックグラウンドタスク完了通知が次のターンとして自動挿入された場合もこのイベントが
      // 発火する。ユーザーの実入力ではないので、サイドバーの表示は書き換えない。
      if (prompt.includes("<task-notification")) return outcome({});
      return outcome(
        {
          state: "working",
          prompt: truncateOneLine(prompt),
          activity: "",
        },
        { userIntentChanged: true },
      );
    }
    case "PreToolUse":
      return outcome({
        state: "working",
        activity: summarizeTool(event.tool_name ?? "", event.tool_input),
      });
    case "PostToolUse":
      // 直前の PreToolUse で入れた activity をそのまま残す。
      return outcome({ state: "working" });
    case "Notification":
      // idle_prompt は一定時間操作が無いだけの催促で、人の対応が要る通知ではない。
      if (event.notification_type === "idle_prompt") return outcome({});
      return outcome({
        state: "waiting",
        activity: truncateOneLine(event.message ?? "入力待ち", ACTIVITY_MAX),
      });
    case "Stop":
      return outcome({ state: "done", activity: "" });
    case "SessionEnd":
      return outcome({ state: "exited" });
    default:
      return outcome({});
  }
};
