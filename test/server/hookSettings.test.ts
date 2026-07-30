import { readFileSync, rmSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
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
  afterAll(() => rmSync(writeHookSettings("/abs/hook-notify.mjs"), { force: true }));

  it("共有の 1 ファイルに JSON を書き出す", () => {
    const path = writeHookSettings("/abs/hook-notify.mjs");
    expect(path).toContain("hooks.json");
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    expect(parsed.hooks.UserPromptSubmit).toBeDefined();
  });

  // 中身はセッションに依存しないので、書くのは初回だけでよい。
  it("二度目以降は書き直さず同じパスを返す", () => {
    expect(writeHookSettings("/abs/hook-notify.mjs")).toBe(writeHookSettings("/abs/hook-notify.mjs"));
  });
});
