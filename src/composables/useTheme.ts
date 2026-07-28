import { computed, ref, watchEffect } from "vue";
import {
  type ResolvedTheme,
  type ThemeChoice,
  loadThemeChoice,
  nextThemeChoice,
  saveThemeChoice,
} from "../theme";

const DARK_QUERY = "(prefers-color-scheme: dark)";

/**
 * サイドバーのトグルと、開いている全ターミナルが同じテーマを見る必要があるので、
 * 状態はモジュールスコープに置いて useTheme() の呼び出し間で共有する。
 */
const choice = ref<ThemeChoice>(loadThemeChoice());
const osTheme = ref<ResolvedTheme>("dark");

// jsdom や古い環境では matchMedia が無いことがある。その場合は OS 追従を諦めて dark 扱い。
const media = typeof matchMedia === "function" ? matchMedia(DARK_QUERY) : null;
if (media) {
  osTheme.value = media.matches ? "dark" : "light";
  media.addEventListener("change", (event) => {
    osTheme.value = event.matches ? "dark" : "light";
  });
}

const resolved = computed<ResolvedTheme>(() =>
  choice.value === "system" ? osTheme.value : choice.value,
);

watchEffect(() => {
  document.documentElement.dataset.theme = resolved.value;
});

const LABELS: Record<ThemeChoice, { icon: string; title: string }> = {
  system: { icon: "🖥", title: "テーマ: OS の設定に従う" },
  light: { icon: "☀", title: "テーマ: ライト" },
  dark: { icon: "🌙", title: "テーマ: ダーク" },
};

export const useTheme = () => {
  const label = computed(() => LABELS[choice.value]);

  const cycle = () => {
    choice.value = nextThemeChoice(choice.value);
    saveThemeChoice(choice.value);
  };

  return { choice, resolved, label, cycle };
};
