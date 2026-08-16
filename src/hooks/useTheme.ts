import { useSyncExternalStore } from "hono/jsx/dom";
import { type Theme, loadTheme, nextTheme, saveTheme } from "../theme";
import { createStore } from "../store";

/**
 * サイドバーのトグルと、開いている全ターミナルが同じテーマを見る必要があるので、
 * 状態はモジュールスコープに置いて useTheme() の呼び出し間で共有する。
 */
const store = createStore<Theme>(loadTheme(), (theme) => {
  document.documentElement.dataset.theme = theme;
});

const LABELS: Record<Theme, { icon: string; title: string }> = {
  light: { icon: "☀", title: "Theme: Light" },
  dark: { icon: "🌙", title: "Theme: Dark" },
};

export const toggleTheme = () => {
  const next = nextTheme(store.get());
  store.set(next);
  saveTheme(next);
};

export const useTheme = () => {
  const theme = useSyncExternalStore(store.subscribe, store.get);
  return { theme, label: LABELS[theme], toggle: toggleTheme };
};
