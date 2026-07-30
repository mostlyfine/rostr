import { ref, watchEffect } from "vue";
import { DEFAULT_SCALE, loadFontScale, nextFontScale, saveFontScale } from "../fontScale";

/**
 * ショートカットを受けるところと、開いている全ターミナルが同じ倍率を見る必要があるので、
 * 状態はモジュールスコープに置いて useFontScale() の呼び出し間で共有する。
 */
const scale = ref<number>(loadFontScale());

watchEffect(() => {
  // CSS 側は calc(13px * var(--font-scale)) の形で参照するので、比率にして渡す。
  document.documentElement.style.setProperty("--font-scale", String(scale.value / 100));
});

export const useFontScale = () => {
  // 上下限に張り付いた状態で押し続けても、同じ値を localStorage へ書き直さない。
  const apply = (percent: number) => {
    if (percent === scale.value) return;
    scale.value = percent;
    saveFontScale(percent);
  };

  return {
    scale,
    increase: () => apply(nextFontScale(scale.value, 1)),
    decrease: () => apply(nextFontScale(scale.value, -1)),
    reset: () => apply(DEFAULT_SCALE),
  };
};
