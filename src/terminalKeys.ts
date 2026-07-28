/** Shift+Enter で送るバイト列。Claude Code は Meta+Enter (ESC + CR) を改行の挿入として扱う。 */
export const SHIFT_ENTER_INPUT = "\x1b\r";

type ModifierKeys = Pick<KeyboardEvent, "key" | "shiftKey" | "ctrlKey" | "altKey" | "metaKey">;

/**
 * xterm の既定では Shift+Enter が素の Enter と同じ CR になり、入力欄では送信になってしまう。
 * 横取りするのは修飾キーが Shift だけの Enter に限り、他の組み合わせは既定のままにする。
 * 単体テストできるようコンポーネントから切り出してある。
 */
export const isShiftEnter = (event: ModifierKeys): boolean =>
  event.key === "Enter" && event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey;
