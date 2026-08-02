import type { AgentKind } from "../common/agents";
import { writeHookSettings } from "./hookSettings";

export interface AgentLaunch {
  kind: AgentKind;
  bin: string;
  args: string[];
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
          kind,
          bin: bin(kind),
          args: ["--session-id", sessionId, "--settings", writeHookSettings(sessionId, notifyScriptPath)],
        };
      }
      return { kind, bin: bin(kind), args: [] };
    },
    supportsSummary: (kind) => kind === "claude",
    supportsHooks: (kind) => kind === "claude",
  };
};
