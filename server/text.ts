/** 改行と連続空白を潰して1行にする。 */
export const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();

/** 上限を超えたら末尾を省略記号に置き換える。 */
export const truncate = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;
