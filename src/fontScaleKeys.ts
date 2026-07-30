import type { ModifierKeys } from "./terminalKeys";

export type FontScaleCommand = "increase" | "decrease" | "reset";

/** 押されたキーの位置も要るので、Shift+Enter の判定より code の分だけ広い。 */
type PressedKeys = ModifierKeys & Pick<KeyboardEvent, "code">;

/**
 * 文字で拾うもの。配列によって位置が変わるキーはこちらで受ける。JIS の + は Shift+; なので
 * 位置は Semicolon になり、Equal では拾えない。
 */
const BY_KEY: Record<string, FontScaleCommand> = {
  "+": "increase",
  _: "decrease",
  "0": "reset",
};

/**
 * 位置で拾うもの。JIS の Shift+- は文字が = になるため、文字だけで見ると拡大と取り違える。
 * = を BY_KEY に置かないことで、その取り違えが起きない。
 */
const BY_CODE: Record<string, FontScaleCommand> = {
  Equal: "increase",
  Minus: "decrease",
  Digit0: "reset",
};

/**
 * 押されたキーが表す倍率の操作。割り当てが無ければ null を返し、呼び手はそのキーを
 * ターミナルへ通す。Shift を必須にしているのは、ブラウザのズーム（Cmd/Ctrl と +/- だけ）
 * を奪わないため。
 */
export const toFontScaleCommand = (event: PressedKeys): FontScaleCommand | null => {
  if (!event.shiftKey || event.altKey) return null;
  if (!event.metaKey && !event.ctrlKey) return null;
  return BY_KEY[event.key] ?? BY_CODE[event.code] ?? null;
};
