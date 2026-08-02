import { join } from "node:path";
import { execPath } from "node:process";
import { readFileSync, rmSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HOOKED_EVENTS } from "../../common/types";
import {
  buildCopilotHookSettings,
  buildHookSettings,
  writeCopilotHookSettings,
  writeHookSettings,
} from "../../server/hookSettings";

describe("buildHookSettings", () => {
  const settings = buildHookSettings("/abs/hook-notify.mjs");

  it("監視対象のイベントをすべて含む", () => {
    expect(Object.keys(settings.hooks).sort()).toEqual([...HOOKED_EVENTS].sort());
  });

  it("各イベントが hook-notify を command 型で呼ぶ", () => {
    for (const event of HOOKED_EVENTS) {
      const hook = settings.hooks[event][0].hooks[0];
      expect(hook.type).toBe("command");
      expect(hook.command).toContain("/abs/hook-notify.mjs");
    }
  });

  it("ツール系イベントだけ matcher を持つ", () => {
    expect(settings.hooks.PreToolUse[0].matcher).toBe("*");
    expect(settings.hooks.PostToolUse[0].matcher).toBe("*");
    expect(settings.hooks.Stop[0].matcher).toBeUndefined();
    expect(settings.hooks.UserPromptSubmit[0].matcher).toBeUndefined();
  });

  it("パスに空白があってもクォートされる", () => {
    const quoted = buildHookSettings("/a b/hook-notify.mjs");
    expect(quoted.hooks.Stop[0].hooks[0].command).toContain('"/a b/hook-notify.mjs"');
  });
});

describe("writeHookSettings", () => {
  it("セッションごとのファイルに JSON を書き出す", () => {
    const path = writeHookSettings("test-session-id", "/abs/hook-notify.mjs");
    try {
      expect(path).toContain("test-session-id");
      const parsed = JSON.parse(readFileSync(path, "utf8"));
      expect(parsed.hooks.UserPromptSubmit).toBeDefined();
    } finally {
      rmSync(path, { force: true });
    }
  });
});

describe("Copilot hook settings", () => {
  const events = [
    "sessionStart",
    "userPromptSubmitted",
    "preToolUse",
    "postToolUse",
    "notification",
    "agentStop",
    "sessionEnd",
  ] as const;

  it("bash 用の notifier コマンドを各 camelCase イベントに設定する", () => {
    const settings = buildCopilotHookSettings("/a b/hook-notify.mjs");
    expect(Object.keys(settings.hooks).sort()).toEqual([...events].sort());

    for (const event of events) {
      const hook = settings.hooks[event][0];
      expect(hook.type).toBe("command");
      expect(hook.bash).toBe(`"${execPath}" "/a b/hook-notify.mjs" copilot ${event}`);
    }
  });

  it("PowerShell 用の notifier コマンドは quoted Node execPath を call 演算子で実行する", () => {
    const settings = buildCopilotHookSettings("/a b/hook-notify.mjs");

    for (const event of events) {
      const hook = settings.hooks[event][0];
      expect(hook.powershell).toBe(`& "${execPath}" "/a b/hook-notify.mjs" copilot ${event}`);
    }
  });

  it("COPILOT_HOME 用にセッション単位の一時 hook 設定を作る", () => {
    const home = writeCopilotHookSettings("copilot-test-session", "/abs/hook-notify.mjs");
    try {
      const settings = JSON.parse(readFileSync(join(home, "hooks", "rostr.json"), "utf8"));
      expect(settings.hooks.agentStop).toBeDefined();
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
