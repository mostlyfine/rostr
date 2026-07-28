import { describe, expect, it } from "vitest";
import { createTerminalOptions } from "../../src/terminalOptions";
import { XTERM_THEMES } from "../../src/theme";

describe("createTerminalOptions", () => {
  it("Mac の Option ドラッグで選択を強制できるようにする", () => {
    // tmux の mouse on でマウスイベントが tmux へ渡るため、これが無いと Mac では選択できない。
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
