import { basename } from "node:path";
import type { HookEvent, Session } from "../common/types";

const PROMPT_MAX = 140;
const ACTIVITY_MAX = 100;

/** 改行と連続空白を潰して1行にし、長ければ省略する。 */
export const truncateOneLine = (text: string, max = PROMPT_MAX): string => {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
};

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
 * hook イベントを現在のセッションに適用し、変更したいフィールドだけを返す純関数。
 * 変更が無い場合は空オブジェクトを返す。
 */
export const applyHookEvent = (session: Session, event: HookEvent): Partial<Session> => {
  // 終了済みのセッションは、遅れて届いた hook で復活させない。
  if (session.state === "exited") return {};

  switch (event.hook_event_name) {
    case "UserPromptSubmit":
      return {
        state: "working",
        prompt: truncateOneLine(event.prompt ?? ""),
        activity: "",
      };
    case "PreToolUse":
      return {
        state: "working",
        activity: summarizeTool(event.tool_name ?? "", event.tool_input),
      };
    case "PostToolUse":
      // 直前の PreToolUse で入れた activity をそのまま残す。
      return { state: "working" };
    case "Notification":
      return {
        state: "waiting",
        activity: truncateOneLine(event.message ?? "入力待ち", ACTIVITY_MAX),
      };
    case "Stop":
      return { state: "done", activity: "" };
    case "SessionEnd":
      return { state: "exited" };
    default:
      return {};
  }
};
