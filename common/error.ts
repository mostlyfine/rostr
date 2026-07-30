/**
 * 想定していない throw を人に見せる 1 行にする。
 * サーバが API のエラー本文に入れる文字列と、クライアントがダイアログに出す文字列を
 * 同じ規則で作るため、両方から見えるここに置く。
 */
export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
