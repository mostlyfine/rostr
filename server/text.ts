/** 改行と連続空白を潰して1行にする。 */
export const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();

/** 上限を超えたら末尾を省略記号に置き換える。 */
export const truncate = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/**
 * 人の入力ではない、機械が差し込んだ疑似ユーザー入力の印。
 * バックグラウンドタスクの完了通知やスラッシュコマンドの展開は、ユーザーの発言と同じ経路で
 * 流れてくるが意図を表していない。サイドバーの表示（state.ts）でも要約の入力（transcript.ts）
 * でも同じものを落とす必要があるので、定義はここ 1 箇所に置く。
 */
const SYNTHETIC_USER_MARKERS = ["<task-notification", "<command-name>", "<local-command-stdout>"];

/** 機械が差し込んだ疑似ユーザー入力か。 */
export const isSyntheticUserPrompt = (text: string): boolean =>
  SYNTHETIC_USER_MARKERS.some((marker) => text.includes(marker));
