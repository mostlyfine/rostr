import { describe, expect, it } from "vitest";
import { toFontScaleCommand } from "../../src/fontScaleKeys";

/** 押されたキーを表す最小の形。既定は Cmd+Shift 相当の修飾キー。 */
const press = (over: { key: string; code: string; [k: string]: unknown }) => ({
  shiftKey: true,
  ctrlKey: false,
  altKey: false,
  metaKey: true,
  ...over,
});

describe("toFontScaleCommand", () => {
  it("US 配列の Cmd+Shift+= を拡大と読む", () => {
    expect(toFontScaleCommand(press({ key: "+", code: "Equal" }))).toBe("increase");
  });

  it("US 配列の Cmd+Shift+- を縮小と読む", () => {
    expect(toFontScaleCommand(press({ key: "_", code: "Minus" }))).toBe("decrease");
  });

  it("JIS 配列の Cmd+Shift+; を拡大と読む", () => {
    expect(toFontScaleCommand(press({ key: "+", code: "Semicolon" }))).toBe("increase");
  });

  /** JIS では Shift+- が = になる。key だけで見ると拡大と取り違えるので、位置で読む。 */
  it("JIS 配列の Cmd+Shift+- を縮小と読む", () => {
    expect(toFontScaleCommand(press({ key: "=", code: "Minus" }))).toBe("decrease");
  });

  it("Cmd+Shift+0 を等倍への復帰と読む", () => {
    expect(toFontScaleCommand(press({ key: "0", code: "Digit0" }))).toBe("reset");
  });

  it("Cmd の代わりに Ctrl でも同じ", () => {
    const ctrl = { shiftKey: true, ctrlKey: true, altKey: false, metaKey: false };
    expect(toFontScaleCommand({ ...ctrl, key: "+", code: "Equal" })).toBe("increase");
    expect(toFontScaleCommand({ ...ctrl, key: "_", code: "Minus" })).toBe("decrease");
    expect(toFontScaleCommand({ ...ctrl, key: "0", code: "Digit0" })).toBe("reset");
  });

  /** Shift 無しはブラウザのズーム。奪わずにそのまま通す。 */
  it("Shift が無ければ何も返さない", () => {
    expect(toFontScaleCommand(press({ key: "=", code: "Equal", shiftKey: false }))).toBeNull();
    expect(toFontScaleCommand(press({ key: "-", code: "Minus", shiftKey: false }))).toBeNull();
  });

  /** Alt+Shift+- などはターミナル側の入力なので触らない。 */
  it("Alt を伴う場合は何も返さない", () => {
    expect(toFontScaleCommand(press({ key: "_", code: "Minus", altKey: true }))).toBeNull();
  });

  it("Cmd も Ctrl も無ければ何も返さない", () => {
    expect(toFontScaleCommand(press({ key: "_", code: "Minus", metaKey: false }))).toBeNull();
  });

  it("割り当てのないキーは何も返さない", () => {
    expect(toFontScaleCommand(press({ key: "A", code: "KeyA" }))).toBeNull();
    expect(toFontScaleCommand(press({ key: ")", code: "Digit9" }))).toBeNull();
  });
});
