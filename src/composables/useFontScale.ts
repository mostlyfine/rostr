import { computed, ref, watchEffect } from "vue";
import {
  MAX_SCALE,
  MIN_SCALE,
  loadFontScale,
  nextFontScale,
  saveFontScale,
} from "../fontScale";

/**
 * サイドバーのボタンと、開いている全ターミナルが同じ倍率を見る必要があるので、
 * 状態はモジュールスコープに置いて useFontScale() の呼び出し間で共有する。
 */
const scale = ref<number>(loadFontScale());

watchEffect(() => {
  // CSS 側は calc(13px * var(--font-scale)) の形で参照するので、比率にして渡す。
  document.documentElement.style.setProperty("--font-scale", String(scale.value / 100));
});

export const useFontScale = () => {
  const canIncrease = computed(() => scale.value < MAX_SCALE);
  const canDecrease = computed(() => scale.value > MIN_SCALE);
  const label = computed(() => `Font size: ${scale.value}%`);

  const step = (direction: 1 | -1) => {
    scale.value = nextFontScale(scale.value, direction);
    saveFontScale(scale.value);
  };

  return {
    scale,
    canIncrease,
    canDecrease,
    label,
    increase: () => step(1),
    decrease: () => step(-1),
  };
};
