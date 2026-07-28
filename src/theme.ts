import type { ITheme } from "@xterm/xterm";

export const THEME_KEY = "rostr:theme";

/** 適用される見た目。 */
export type Theme = "light" | "dark";

const isTheme = (value: unknown): value is Theme => value === "light" || value === "dark";

/** 保存されたテーマを返す。未設定・未知の値はどちらも既定の dark に倒す。 */
export const loadTheme = (): Theme => {
  try {
    const raw = localStorage.getItem(THEME_KEY);
    return isTheme(raw) ? raw : "dark";
  } catch {
    return "dark";
  }
};

/** テーマを保存する。 */
export const saveTheme = (theme: Theme): void => {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // プライベートモード等で書けなくても、その回の表示は続けられるので黙って諦める。
  }
};

/** トグルを押したときの次のテーマ。dark と light を往復する。 */
export const nextTheme = (theme: Theme): Theme => (theme === "dark" ? "light" : "dark");

/**
 * xterm は Canvas に描くので CSS 変数を読めない。ここだけ style.css と同じ Catppuccin の
 * 色を JS 側にも持つ。background は --bg-app（base）と一致させること。ズレると
 * TerminalView の親要素に敷いた --bg-app との差でリサイズ時に縁が出る。
 * ANSI 16 色は catppuccin/palette の ansiColors、cursor は nvim の Cursor に倣って
 * rosewater、selectionBackground は Visual に倣って surface1。
 */
export const XTERM_THEMES: Record<Theme, ITheme> = {
  // Catppuccin Macchiato
  dark: {
    background: "#24273a",
    foreground: "#cad3f5",
    cursor: "#f4dbd6",
    cursorAccent: "#24273a",
    selectionBackground: "#494d64",
    black: "#494d64",
    red: "#ed8796",
    green: "#a6da95",
    yellow: "#eed49f",
    blue: "#8aadf4",
    magenta: "#f5bde6",
    cyan: "#8bd5ca",
    white: "#a5adcb",
    brightBlack: "#5b6078",
    brightRed: "#ec7486",
    brightGreen: "#8ccf7f",
    brightYellow: "#e1c682",
    brightBlue: "#78a1f6",
    brightMagenta: "#f2a9dd",
    brightCyan: "#63cbc0",
    brightWhite: "#b8c0e0",
  },
  // Catppuccin Latte
  light: {
    background: "#eff1f5",
    foreground: "#4c4f69",
    cursor: "#dc8a78",
    cursorAccent: "#eff1f5",
    selectionBackground: "#bcc0cc",
    black: "#5c5f77",
    red: "#d20f39",
    green: "#40a02b",
    yellow: "#df8e1d",
    blue: "#1e66f5",
    magenta: "#ea76cb",
    cyan: "#179299",
    white: "#acb0be",
    brightBlack: "#6c6f85",
    brightRed: "#de293e",
    brightGreen: "#49af3d",
    brightYellow: "#eea02d",
    brightBlue: "#456eff",
    brightMagenta: "#fe85d8",
    brightCyan: "#2d9fa8",
    brightWhite: "#bcc0cc",
  },
};
