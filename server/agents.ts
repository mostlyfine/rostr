import type { AgentKind } from "../common/agents";
import type { HookEvent } from "../common/types";
import { execPath } from "node:process";
import { writeCopilotHookSettings, writeHookSettings } from "./hookSettings";

export interface AgentLaunch {
  bin: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
}

interface AgentEnvironment {
  CLAUDE_BIN?: string;
  COPILOT_BIN?: string;
  CODEX_BIN?: string;
}

export interface AgentRegistry {
  bin(kind: AgentKind): string;
  launch(kind: AgentKind, sessionId: string): AgentLaunch;
  supportsSummary(kind: AgentKind): boolean;
  supportsHooks(kind: AgentKind): boolean;
  supportsHookEvent(kind: AgentKind, event: HookEvent["hook_event_name"]): boolean;
}

export const createAgentRegistry = (
  env: AgentEnvironment,
  notifyScriptPath: string,
): AgentRegistry => {
  const bin = (kind: AgentKind): string => {
    switch (kind) {
      case "claude":
        return env.CLAUDE_BIN ?? "claude";
      case "copilot":
        return env.COPILOT_BIN ?? "copilot";
      case "codex":
        return env.CODEX_BIN ?? "codex";
    }
  };

  return {
    bin,
    launch(kind, sessionId) {
      if (kind === "claude") {
        return {
          bin: bin(kind),
          args: ["--session-id", sessionId, "--settings", writeHookSettings(sessionId, notifyScriptPath)],
        };
      }
      if (kind === "copilot") {
        return {
          bin: bin(kind),
          args: [],
          env: { COPILOT_HOME: writeCopilotHookSettings(sessionId, notifyScriptPath) },
        };
      }
      return {
        bin: bin(kind),
        args: ["-c", `notify = ${JSON.stringify([execPath, notifyScriptPath, "codex"])}`],
      };
    },
    supportsSummary: (kind) => kind === "claude",
    supportsHooks: () => true,
    supportsHookEvent: (kind, event) => kind !== "codex" || event === "Stop",
  };
};
