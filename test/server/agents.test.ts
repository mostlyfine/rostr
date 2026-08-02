import { existsSync, rmSync } from "node:fs";
import { AGENTS, AGENT_KINDS, isAgentKind } from "../../common/agents";
import { createAgentRegistry } from "../../server/agents";
import { describe, expect, it } from "vitest";

const hookPath = "/abs/hook-notify.mjs";

describe("agent registry", () => {
  it("uses each agent's default binary", () => {
    const registry = createAgentRegistry({}, hookPath);
    const claude = registry.launch("claude", "default-session");
    try {
      expect(claude).toMatchObject({ kind: "claude", bin: "claude" });
      expect(registry.launch("copilot", "default-session")).toMatchObject({
        kind: "copilot",
        bin: "copilot",
      });
      expect(registry.launch("codex", "default-session")).toMatchObject({ kind: "codex", bin: "codex" });
    } finally {
      rmSync(claude.args[3], { force: true });
    }
  });

  it("uses configured binary overrides", () => {
    const registry = createAgentRegistry(
      { CLAUDE_BIN: "custom-claude", COPILOT_BIN: "custom-copilot", CODEX_BIN: "custom-codex" },
      hookPath,
    );
    const claude = registry.launch("claude", "override-session");
    try {
      expect(claude.bin).toBe("custom-claude");
      expect(registry.launch("copilot", "override-session").bin).toBe("custom-copilot");
      expect(registry.launch("codex", "override-session").bin).toBe("custom-codex");
    } finally {
      rmSync(claude.args[3], { force: true });
    }
  });

  it("adds Claude hook settings but leaves other agents unconfigured", () => {
    const registry = createAgentRegistry({}, hookPath);
    const claude = registry.launch("claude", "hooked-session");
    try {
      expect(claude.args).toEqual(["--session-id", "hooked-session", "--settings", expect.any(String)]);
      expect(existsSync(claude.args[3])).toBe(true);
      expect(registry.launch("copilot", "hooked-session").args).toEqual([]);
      expect(registry.launch("codex", "hooked-session").args).toEqual([]);
    } finally {
      rmSync(claude.args[3], { force: true });
    }
  });

  it("only enables summaries and hooks for Claude", () => {
    const registry = createAgentRegistry({}, hookPath);

    expect(AGENT_KINDS.map((kind) => registry.supportsSummary(kind))).toEqual([true, false, false]);
    expect(AGENT_KINDS.map((kind) => registry.supportsHooks(kind))).toEqual([true, false, false]);
  });
});

describe("agent kinds", () => {
  it("provides labels and rejects unknown kinds", () => {
    expect(AGENTS).toEqual({
      claude: { label: "Claude Code" },
      copilot: { label: "GitHub Copilot CLI" },
      codex: { label: "OpenAI Codex CLI" },
    });
    expect(AGENT_KINDS.every(isAgentKind)).toBe(true);
    expect(isAgentKind("other")).toBe(false);
  });
});
