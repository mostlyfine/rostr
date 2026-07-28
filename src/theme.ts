export const THEME_KEY = "rostr:theme";

/** ユーザーが選んだもの。system は OS の設定に従う。 */
export type ThemeChoice = "system" | "light" | "dark";
/** system を解決した後の、実際に適用される見た目。 */
export type ResolvedTheme = "light" | "dark";

const CHOICES: ThemeChoice[] = ["system", "light", "dark"];

const isChoice = (value: unknown): value is ThemeChoice =>
  CHOICES.includes(value as ThemeChoice);

/** 保存されたテーマの選択を返す。未設定・未知の値はどちらも system に倒す。 */
export const loadThemeChoice = (): ThemeChoice => {
  try {
    const raw = localStorage.getItem(THEME_KEY);
    return isChoice(raw) ? raw : "system";
  } catch {
    return "system";
  }
};

/** テーマの選択を保存する。system は既定なので、値を残さず消す。 */
export const saveThemeChoice = (choice: ThemeChoice): void => {
  try {
    if (choice === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, choice);
  } catch {
    // プライベートモード等で書けなくても、その回の表示は続けられるので黙って諦める。
  }
};

/** トグルを押したときの次の選択。system → light → dark → system と巡回する。 */
export const nextThemeChoice = (choice: ThemeChoice): ThemeChoice =>
  CHOICES[(CHOICES.indexOf(choice) + 1) % CHOICES.length];

/**
 * xterm は Canvas に描くので CSS 変数を読めない。ここだけ style.css のトークンと
 * 同じ色を JS 側にも持つ。--bg-app / --text-strong を変えたらこちらも合わせること。
 */
export const XTERM_THEMES: Record<
  ResolvedTheme,
  { background: string; foreground: string; cursor: string }
> = {
  dark: { background: "#0d1117", foreground: "#d8dee9", cursor: "#d8dee9" },
  light: { background: "#f7f9fb", foreground: "#1f2328", cursor: "#1f2328" },
};
