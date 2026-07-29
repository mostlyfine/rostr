import { readFileSync, rmSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HOOKED_EVENTS } from "../../common/types";
import { buildHookSettings, writeHookSettings } from "../../server/hookSettings";

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
  it("JSON を書き出してパスを返す", () => {
    const path = writeHookSettings("/abs/hook-notify.mjs");
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8"));
      expect(parsed.hooks.UserPromptSubmit).toBeDefined();
    } finally {
      rmSync(path, { force: true });
    }
  });

  // 内容は notifyScriptPath にしか依存しない。セッションごとに増やすとファイルが溜まり続ける。
  it("同じ notifyScriptPath なら同じパスを返す", () => {
    const path = writeHookSettings("/abs/hook-notify.mjs");
    try {
      expect(writeHookSettings("/abs/hook-notify.mjs")).toBe(path);
    } finally {
      rmSync(path, { force: true });
    }
  });

  // 別の worktree で動く rostr と tmpdir を共有しても上書きし合わない。
  it("notifyScriptPath が違えば別のパスになる", () => {
    const a = writeHookSettings("/abs/one/hook-notify.mjs");
    const b = writeHookSettings("/abs/two/hook-notify.mjs");
    try {
      expect(a).not.toBe(b);
    } finally {
      rmSync(a, { force: true });
      rmSync(b, { force: true });
    }
  });
});
