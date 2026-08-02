export const AGENT_KINDS = ["claude", "copilot", "codex"] as const;

export type AgentKind = (typeof AGENT_KINDS)[number];

export const AGENTS: Record<AgentKind, { label: string }> = {
  claude: { label: "Claude Code" },
  copilot: { label: "GitHub Copilot CLI" },
  codex: { label: "OpenAI Codex CLI" },
};

export const isAgentKind = (value: unknown): value is AgentKind =>
  typeof value === "string" && (AGENT_KINDS as readonly string[]).includes(value);
