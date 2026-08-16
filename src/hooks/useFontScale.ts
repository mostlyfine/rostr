import { useSyncExternalStore } from "hono/jsx/dom";
import { DEFAULT_SCALE, loadFontScale, nextFontScale, saveFontScale } from "../fontScale";
import { createStore } from "../store";

/**
 * ショートカットを受けるところと、開いている全ターミナルが同じ倍率を見る必要があるので、
 * 状態はモジュールスコープに置いて useFontScale() の呼び出し間で共有する。
 */
const store = createStore<number>(loadFontScale(), (scale) => {
  // CSS 側は calc(13px * var(--font-scale)) の形で参照するので、比率にして渡す。
  document.documentElement.style.setProperty("--font-scale", String(scale / 100));
});

// 上下限に張り付いた状態で押し続けても、同じ値を localStorage へ書き直さない。
const apply = (percent: number) => {
  if (percent === store.get()) return;
  store.set(percent);
  saveFontScale(percent);
};

// ショートカットの購読を張り直さずに済むよう、変更の入口はフックの外に置く。
export const increaseFontScale = () => apply(nextFontScale(store.get(), 1));
export const decreaseFontScale = () => apply(nextFontScale(store.get(), -1));
export const resetFontScale = () => apply(DEFAULT_SCALE);

export const useFontScale = () => ({
  scale: useSyncExternalStore(store.subscribe, store.get),
  increase: increaseFontScale,
  decrease: decreaseFontScale,
  reset: resetFontScale,
});
