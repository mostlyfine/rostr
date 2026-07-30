import { clamp } from "./clamp";
import { readStored, writeStored } from "./storage";

export const FONT_SCALE_KEY = "rostr:font-scale";

/**
 * 表示倍率は整数パーセントで持つ。0.1 刻みの小数だと押すたびに誤差が乗って
 * 1.0999999 のような値が保存されてしまう。
 */
export const DEFAULT_SCALE = 100;
export const MIN_SCALE = 80;
export const MAX_SCALE = 160;
const SCALE_STEP = 10;

/** ターミナルの等倍サイズ。UI 側の px と違い CSS では持てないので JS に置く。 */
const BASE_TERMINAL_FONT_SIZE = 16;

/** 倍率を扱える範囲に収める。数値でないものは既定に倒す。 */
const clampScale = (percent: number): number =>
  Number.isFinite(percent) ? clamp(percent, MIN_SCALE, MAX_SCALE) : DEFAULT_SCALE;

/** 保存された倍率を返す。未設定・壊れた値・範囲外はいずれも扱える値に直す。 */
export const loadFontScale = (): number =>
  clampScale(Number.parseInt(readStored(FONT_SCALE_KEY) ?? "", 10));

/** 倍率を保存する。 */
export const saveFontScale = (percent: number): void =>
  writeStored(FONT_SCALE_KEY, String(percent));

/** +/- を押したときの次の倍率。上下限で頭打ちになる。 */
export const nextFontScale = (percent: number, direction: 1 | -1): number =>
  clampScale(percent + direction * SCALE_STEP);

/**
 * 倍率に対応するターミナルのフォントサイズ。xterm は小数も受け付けるが、セル幅が
 * 半端になって描画がにじむので整数に丸める。
 */
export const terminalFontSize = (percent: number): number =>
  Math.round((BASE_TERMINAL_FONT_SIZE * percent) / 100);
