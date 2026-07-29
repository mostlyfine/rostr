import type { ITerminalOptions } from "@xterm/xterm";
import { XTERM_THEMES } from "./theme";
import type { Theme } from "./theme";

/** ターミナル生成時に渡すオプション。単体テストできるようコンポーネントから切り出してある。 */
export const createTerminalOptions = (theme: Theme): ITerminalOptions => ({
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, "Courier New", monospace',
  fontSize: 16,
  cursorBlink: true,
  allowProposedApi: true,
  // 普段はマウス報告を xterm へ渡さない（terminalMouse.ts）ので素のドラッグで選択できる。
  // 何かの拍子に報告が有効になった場合の逃げ道として、Mac の Option ドラッグを残しておく。
  // Mac 以外は既定で Shift ドラッグが強制選択になるので、追加の指定は要らない。
  macOptionClickForcesSelection: true,
  // tmux 経由では代替画面なので効かない（履歴は tmux 側にある）。
  // tmux が無い環境ではこれが唯一のスクロールバックになる。
  scrollback: 10_000,
  theme: XTERM_THEMES[theme],
});
