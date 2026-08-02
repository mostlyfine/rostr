const CLAUDE_TOOL_NAMES = {
  bash: "Bash",
  powershell: "Bash",
  view: "Read",
  create: "Write",
  edit: "Edit",
  str_replace_editor: "Edit",
  apply_patch: "Edit",
  grep: "Grep",
  rg: "Grep",
  glob: "Glob",
  web_fetch: "WebFetch",
  web_search: "WebSearch",
  ask_user: "AskUserQuestion",
  update_todo: "TodoWrite",
  task: "Agent",
};

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

const text = (value) => typeof value === "string" ? value : undefined;

const copilotToolName = (value) => {
  const name = text(value);
  return name ? CLAUDE_TOOL_NAMES[name] ?? name : undefined;
};

const copilotEvent = (payload, eventName) => {
  if (!isRecord(payload)) return undefined;

  const event = eventName ?? text(payload.hook_event_name);
  switch (event) {
    case "sessionStart":
    case "SessionStart":
      return { hook_event_name: "SessionStart" };
    case "sessionEnd":
    case "SessionEnd":
      return { hook_event_name: "SessionEnd" };
    case "userPromptSubmitted":
    case "UserPromptSubmit":
      return { hook_event_name: "UserPromptSubmit", prompt: text(payload.prompt) };
    case "preToolUse":
    case "PreToolUse":
      return {
        hook_event_name: "PreToolUse",
        tool_name: copilotToolName(payload.toolName ?? payload.tool_name),
        tool_input: isRecord(payload.toolArgs) ? payload.toolArgs : isRecord(payload.tool_input) ? payload.tool_input : undefined,
      };
    case "postToolUse":
    case "PostToolUse":
      return {
        hook_event_name: "PostToolUse",
        tool_name: copilotToolName(payload.toolName ?? payload.tool_name),
        tool_input: isRecord(payload.toolArgs) ? payload.toolArgs : isRecord(payload.tool_input) ? payload.tool_input : undefined,
      };
    case "notification":
    case "Notification": {
      const notificationType = text(payload.notification_type);
      if (notificationType !== "permission_prompt" && notificationType !== "elicitation_dialog") return undefined;
      return {
        hook_event_name: "Notification",
        message: text(payload.message),
        notification_type: notificationType,
      };
    }
    case "agentStop":
    case "Stop":
      return {
        hook_event_name: "Stop",
        transcript_path: text(payload.transcriptPath ?? payload.transcript_path),
      };
    default:
      return undefined;
  }
};

export const normalizeProviderEvent = (provider, payload, eventName) => {
  if (provider === "copilot") return copilotEvent(payload, eventName);
  if (provider === "codex" && isRecord(payload) && payload.type === "agent-turn-complete") {
    return { hook_event_name: "Stop" };
  }
  return undefined;
};
