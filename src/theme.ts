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

const CUBE_LEVELS = [0, 95, 135, 175, 215, 255];
const toHex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;

/**
 * xterm 標準の 256 色パレット（16〜255）を計算し、overrides で指定した番号だけ差し替える。
 * claude CLI 自身が Markdown のインラインコードなどに 256 色（例: 153）を直接指定してくる
 * ため、ITheme の基本 16 色だけでは色をコントロールしきれない。他の番号は標準値のまま
 * 引き継がないと、指定していない色まで変わってしまう。
 */
const buildExtendedAnsi = (overrides: Record<number, string>): string[] => {
  const colors: string[] = [];
  for (let i = 16; i <= 255; i++) {
    if (overrides[i]) {
      colors.push(overrides[i]);
    } else if (i < 232) {
      const n = i - 16;
      colors.push(toHex(CUBE_LEVELS[Math.floor(n / 36) % 6], CUBE_LEVELS[Math.floor(n / 6) % 6], CUBE_LEVELS[n % 6]));
    } else {
      const v = 8 + (i - 232) * 10;
      colors.push(toHex(v, v, v));
    }
  }
  return colors;
};

/**
 * cube のコーナー 231（純白）とグレースケール域 232〜255 は dark 用の値では base
 * （#eff1f5）とほぼ同化してしまう（255番=v238 で contrast 比約1.1:1）。
 * white/brightWhite を overlay2/overlay1 に差し替えたのと同じ理由で、明るい側の
 * 上限を overlay2 相当の輝度（v=128、white の contrast 比 3.5:1 と同水準）に
 * 頭打ちさせる。
 */
const LIGHT_GRAYSCALE_MAX = 128;
const buildLightGrayscaleOverrides = (): Record<number, string> => {
  const overrides: Record<number, string> = { 231: toHex(LIGHT_GRAYSCALE_MAX, LIGHT_GRAYSCALE_MAX, LIGHT_GRAYSCALE_MAX) };
  for (let i = 232; i <= 255; i++) {
    const t = (i - 232) / (255 - 232);
    const v = Math.round(8 + t * (LIGHT_GRAYSCALE_MAX - 8));
    overrides[i] = toHex(v, v, v);
  }
  return overrides;
};

/**
 * xterm は Canvas に描くので CSS 変数を読めない。ここだけ style.css と同じ Catppuccin の
 * 色を JS 側にも持つ。background は --bg-app（base）と一致させること。ズレると
 * TerminalView の親要素に敷いた --bg-app との差でリサイズ時に縁が出る。
 * ANSI 16 色は catppuccin/palette の ansiColors、cursor は nvim の Cursor に倣って
 * rosewater、selectionBackground は Visual に倣って surface1。
 * ただし light の white/brightWhite は ansiColors 準拠の値（surface2/surface1）だと
 * base に対するコントラストが 2:1 未満で読めないため、overlay2/overlay1 に差し替えている。
 * 同様に claude CLI がインラインコードに使う 256 色パレットの 153 番（薄い水色）も
 * base に対して 1.33:1 しかないため、extendedAnsi で blue と同じ色に差し替えている。
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
    white: "#7c7f93",
    brightBlack: "#6c6f85",
    brightRed: "#de293e",
    brightGreen: "#49af3d",
    brightYellow: "#eea02d",
    brightBlue: "#456eff",
    brightMagenta: "#fe85d8",
    brightCyan: "#2d9fa8",
    brightWhite: "#8c8fa1",
    extendedAnsi: buildExtendedAnsi({ 153: "#0a50dc", ...buildLightGrayscaleOverrides() }),
  },
};
