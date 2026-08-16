/**
 * 条件付きのクラス名を class 属性の形にまとめる。false / undefined は落とす。
 * Vue の :class="{ selected: ... }" に相当するものが JSX には無いので、その置き換え。
 */
export const classes = (...names: (string | false | undefined)[]): string =>
  names.filter(Boolean).join(" ");
