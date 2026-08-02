export const AGENT_KINDS = ["claude", "copilot", "codex"] as const;

export type AgentKind = (typeof AGENT_KINDS)[number];

export const AGENTS: Record<AgentKind, string> = {
  claude: "Claude Code",
  copilot: "GitHub Copilot CLI",
  codex: "OpenAI Codex CLI",
};

export const isAgentKind = (value: unknown): value is AgentKind =>
  typeof value === "string" && (AGENT_KINDS as readonly string[]).includes(value);
