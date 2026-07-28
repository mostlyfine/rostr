import { describe, expect, it } from "vitest";
import { SHIFT_ENTER_INPUT, isShiftEnter } from "../../src/terminalKeys";

const key = (overrides: Partial<KeyboardEvent> = {}) => ({
  key: "Enter",
  shiftKey: false,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  ...overrides,
});

describe("isShiftEnter", () => {
  it("Shift+Enter を捕まえる", () => {
    expect(isShiftEnter(key({ shiftKey: true }))).toBe(true);
  });

  it("素の Enter は捕まえない", () => {
    expect(isShiftEnter(key())).toBe(false);
  });

  it("Enter 以外のキーは Shift 付きでも捕まえない", () => {
    expect(isShiftEnter(key({ key: "a", shiftKey: true }))).toBe(false);
  });

  it("他の修飾キーが付いた Shift+Enter は xterm の既定に任せる", () => {
    // Ctrl / Alt / Cmd との組み合わせは別のシーケンスを持つので横取りしない。
    expect(isShiftEnter(key({ shiftKey: true, ctrlKey: true }))).toBe(false);
    expect(isShiftEnter(key({ shiftKey: true, altKey: true }))).toBe(false);
    expect(isShiftEnter(key({ shiftKey: true, metaKey: true }))).toBe(false);
  });

  it("Claude Code が改行として扱う Meta+Enter 相当のシーケンスを送る", () => {
    expect(SHIFT_ENTER_INPUT).toBe("\x1b\r");
  });
});
