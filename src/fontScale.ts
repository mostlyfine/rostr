export const FONT_SCALE_KEY = "rostr:font-scale";

/**
 * 表示倍率は整数パーセントで持つ。0.1 刻みの小数だと押すたびに誤差が乗って
 * 1.0999999 のような値が保存されてしまう。
 */
export const DEFAULT_SCALE = 100;
export const MIN_SCALE = 80;
export const MAX_SCALE = 160;
export const SCALE_STEP = 10;

/** ターミナルの等倍サイズ。UI 側の px と違い CSS では持てないので JS に置く。 */
export const BASE_TERMINAL_FONT_SIZE = 16;

/** 倍率を扱える範囲に収める。数値でないものは既定に倒す。 */
export const clampScale = (percent: number): number => {
  if (!Number.isFinite(percent)) return DEFAULT_SCALE;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, percent));
};

/** 保存された倍率を返す。未設定・壊れた値・範囲外はいずれも扱える値に直す。 */
export const loadFontScale = (): number => {
  try {
    return clampScale(Number.parseInt(localStorage.getItem(FONT_SCALE_KEY) ?? "", 10));
  } catch {
    return DEFAULT_SCALE;
  }
};

/** 倍率を保存する。 */
export const saveFontScale = (percent: number): void => {
  try {
    localStorage.setItem(FONT_SCALE_KEY, String(percent));
  } catch {
    // プライベートモード等で書けなくても、その回の表示は続けられるので黙って諦める。
  }
};

/** +/- を押したときの次の倍率。上下限で頭打ちになる。 */
export const nextFontScale = (percent: number, direction: 1 | -1): number =>
  clampScale(percent + direction * SCALE_STEP);

/**
 * 倍率に対応するターミナルのフォントサイズ。xterm は小数も受け付けるが、セル幅が
 * 半端になって描画がにじむので整数に丸める。
 */
export const terminalFontSize = (percent: number): number =>
  Math.round((BASE_TERMINAL_FONT_SIZE * percent) / 100);
