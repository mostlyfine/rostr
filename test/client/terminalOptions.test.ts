import { describe, expect, it } from "vitest";
import { createTerminalOptions } from "../../src/terminalOptions";
import { XTERM_THEMES } from "../../src/theme";

describe("createTerminalOptions", () => {
  it("Mac の Option ドラッグで選択を強制できるようにする", () => {
    // マウス報告が有効になってしまった場合の逃げ道。Mac では Shift ドラッグが効かない。
    expect(createTerminalOptions("dark").macOptionClickForcesSelection).toBe(true);
  });

  it("渡したテーマの配色を使う", () => {
    expect(createTerminalOptions("dark").theme).toEqual(XTERM_THEMES.dark);
    expect(createTerminalOptions("light").theme).toEqual(XTERM_THEMES.light);
  });

  it("tmux が無い環境向けのスクロールバックを保つ", () => {
    expect(createTerminalOptions("light").scrollback).toBe(10_000);
  });
});
