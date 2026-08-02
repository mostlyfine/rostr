import { describe, expect, it } from "vitest";
import { normalizeProviderEvent } from "../../server/providerEvents.mjs";

describe("normalizeProviderEvent", () => {
  it("Copilot camelCase payloads を既存の HookEvent に正規化する", () => {
    expect(
      normalizeProviderEvent("copilot", {
        sessionId: "copilot-session",
        timestamp: 1,
        cwd: "/project",
        toolName: "bash",
        toolArgs: { command: "npm test" },
      }, "preToolUse"),
    ).toEqual({
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "npm test" },
    });

    expect(
      normalizeProviderEvent("copilot", {
        sessionId: "copilot-session",
        timestamp: 1,
        cwd: "/project",
        prompt: "実装して",
      }, "userPromptSubmitted"),
    ).toEqual({
      hook_event_name: "UserPromptSubmit",
      prompt: "実装して",
    });

    expect(
      normalizeProviderEvent("copilot", {
        sessionId: "copilot-session",
        timestamp: 1,
        cwd: "/project",
        transcriptPath: "/project/session.jsonl",
        stopReason: "end_turn",
      }, "agentStop"),
    ).toEqual({
      hook_event_name: "Stop",
      transcript_path: "/project/session.jsonl",
    });
  });

  it("Copilot の対話を要する通知だけを waiting 用のイベントにする", () => {
    expect(
      normalizeProviderEvent("copilot", {
        message: "Permission needed",
        notification_type: "permission_prompt",
      }, "notification"),
    ).toEqual({
      hook_event_name: "Notification",
      message: "Permission needed",
      notification_type: "permission_prompt",
    });

    expect(
      normalizeProviderEvent("copilot", {
        message: "Agent completed",
        notification_type: "agent_completed",
      }, "notification"),
    ).toBeUndefined();
  });

  it("Codex の agent-turn-complete だけを Stop にする", () => {
    expect(normalizeProviderEvent("codex", { type: "agent-turn-complete" })).toEqual({
      hook_event_name: "Stop",
    });
    expect(normalizeProviderEvent("codex", { type: "agent-turn-start" })).toBeUndefined();
  });
});
