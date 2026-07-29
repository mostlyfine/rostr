import { describe, expect, it } from "vitest";
import { createTerminalOptions } from "../../src/terminalOptions";
import { terminalFontSize } from "../../src/fontScale";
import { XTERM_THEMES } from "../../src/theme";

describe("createTerminalOptions", () => {
  it("Mac の Option ドラッグで選択を強制できるようにする", () => {
    // マウス報告が有効になってしまった場合の逃げ道。Mac では Shift ドラッグが効かない。
    expect(createTerminalOptions("dark", 100).macOptionClickForcesSelection).toBe(true);
  });

  it("渡したテーマの配色を使う", () => {
    expect(createTerminalOptions("dark", 100).theme).toEqual(XTERM_THEMES.dark);
    expect(createTerminalOptions("light", 100).theme).toEqual(XTERM_THEMES.light);
  });

  it("tmux が無い環境向けのスクロールバックを保つ", () => {
    expect(createTerminalOptions("light", 100).scrollback).toBe(10_000);
  });

  it("渡した倍率をフォントサイズに反映する", () => {
    expect(createTerminalOptions("dark", 100).fontSize).toBe(terminalFontSize(100));
    expect(createTerminalOptions("dark", 150).fontSize).toBe(terminalFontSize(150));
  });
});
