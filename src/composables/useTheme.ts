import { computed, ref, watchEffect } from "vue";
import { type Theme, loadTheme, nextTheme, saveTheme } from "../theme";

/**
 * サイドバーのトグルと、開いている全ターミナルが同じテーマを見る必要があるので、
 * 状態はモジュールスコープに置いて useTheme() の呼び出し間で共有する。
 */
const theme = ref<Theme>(loadTheme());

watchEffect(() => {
  document.documentElement.dataset.theme = theme.value;
});

const LABELS: Record<Theme, { icon: string; title: string }> = {
  light: { icon: "☀", title: "Theme: Light" },
  dark: { icon: "🌙", title: "Theme: Dark" },
};

export const useTheme = () => {
  const label = computed(() => LABELS[theme.value]);

  const toggle = () => {
    theme.value = nextTheme(theme.value);
    saveTheme(theme.value);
  };

  return { theme, label, toggle };
};
