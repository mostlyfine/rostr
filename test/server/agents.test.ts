import { existsSync, rmSync } from "node:fs";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execPath } from "node:process";
import { AGENTS, AGENT_KINDS, isAgentKind } from "../../common/agents";
import { HOOKED_EVENTS } from "../../common/types";
import { createAgentRegistry } from "../../server/agents";
import { describe, expect, it } from "vitest";

const hookPath = "/abs/hook-notify.mjs";

describe("agent registry", () => {
  it("uses each agent's default binary", () => {
    const registry = createAgentRegistry({}, hookPath);
    const claude = registry.launch("claude", "default-session");
    const copilot = registry.launch("copilot", "default-session");
    const codex = registry.launch("codex", "default-session");
    try {
      expect(claude).toEqual({
        bin: "claude",
        args: ["--session-id", "default-session", "--settings", expect.any(String)],
      });
      expect(copilot).toMatchObject({ bin: "copilot", args: [], env: { COPILOT_HOME: expect.any(String) } });
      expect(codex).toMatchObject({ bin: "codex", args: ["-c", expect.stringContaining("notify =")] });
    } finally {
      rmSync(claude.args[3], { force: true });
      rmSync(copilot.env?.COPILOT_HOME ?? "", { recursive: true, force: true });
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

  it("adds isolated hook settings for every provider", () => {
    const registry = createAgentRegistry({}, hookPath);
    const claude = registry.launch("claude", "hooked-session");
    const copilot = registry.launch("copilot", "hooked-session");
    const codex = registry.launch("codex", "hooked-session");
    try {
      expect(claude.args).toEqual(["--session-id", "hooked-session", "--settings", expect.any(String)]);
      expect(existsSync(claude.args[3])).toBe(true);
      expect(copilot.args).toEqual([]);
      expect(copilot.env?.COPILOT_HOME).toEqual(expect.any(String));
      expect(JSON.parse(readFileSync(join(copilot.env!.COPILOT_HOME!, "hooks", "rostr.json"), "utf8"))).toMatchObject({
        hooks: { agentStop: expect.any(Array) },
      });
      expect(codex.args).toEqual([
        "-c",
        `notify = ${JSON.stringify([execPath, hookPath, "codex"])}`,
      ]);
    } finally {
      rmSync(claude.args[3], { force: true });
      rmSync(copilot.env?.COPILOT_HOME ?? "", { recursive: true, force: true });
    }
  });

  it("keeps summaries Claude-only while allowing only documented provider events", () => {
    const registry = createAgentRegistry({}, hookPath);

    expect(AGENT_KINDS.map((kind) => registry.supportsSummary(kind))).toEqual([true, false, false]);
    expect(AGENT_KINDS.map((kind) => registry.supportsHooks(kind))).toEqual([true, true, true]);
    expect(HOOKED_EVENTS.every((event) => registry.supportsHookEvent("claude", event))).toBe(true);
    expect(HOOKED_EVENTS.every((event) => registry.supportsHookEvent("copilot", event))).toBe(true);
    expect(registry.supportsHookEvent("codex", "Stop")).toBe(true);
    expect(registry.supportsHookEvent("codex", "UserPromptSubmit")).toBe(false);
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
