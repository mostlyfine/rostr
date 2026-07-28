export const RECENT_DIRS_KEY = "rostr:recent-dirs";
const MAX_RECENT = 10;

/** 最近起動したディレクトリを新しい順で返す。 */
export const loadRecentDirs = (): string[] => {
  try {
    const raw = localStorage.getItem(RECENT_DIRS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === "string");
  } catch {
    return [];
  }
};

/** ディレクトリを履歴の先頭へ入れる。既にあれば重複させず移動する。 */
export const rememberRecentDir = (dir: string): string[] => {
  const next = [dir, ...loadRecentDirs().filter((entry) => entry !== dir)].slice(0, MAX_RECENT);
  localStorage.setItem(RECENT_DIRS_KEY, JSON.stringify(next));
  return next;
};
