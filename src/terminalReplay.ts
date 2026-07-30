/**
 * 再接続直後に流し込む replay（端末モード再現 + スクロールバック）を書き込む間だけ、
 * xterm 自身が生成する制御応答をサーバーへ送り返させないための関所。
 *
 * tmux は attach 直後に一度だけ Device Attributes（DA1/DA2）を問い合わせ、xterm はそれに
 * 自動応答する。サーバーはその問い合わせ自体を PTY 出力としてスクロールバックへ記録して
 * いるため、リロードのたびに replay として再生され、xterm は毎回律儀に応答を作り直す。
 * その応答が来た頃には tmux はもう問い合わせを待っておらず、ただの入力として現在の pane
 * （シェル）へ素通しし、プロンプトに `1;2c0;276;0c` のような文字列が入力されてしまう。
 */
import type { Terminal } from "@xterm/xterm";

export interface ReplayGate {
  /** term.onData の中で最初に呼ぶ。replay の書き込み中なら true（サーバーへ送るな）。 */
  shouldSuppress(): boolean;
  /** socket.onmessage の中で書き込むときに使う。最初の 1 回だけ replay として扱う。 */
  write(data: string): Promise<void>;
}

export const createReplayGate = (term: Terminal): ReplayGate => {
  let isFirstMessage = true;
  let replaying = false;

  return {
    shouldSuppress: () => replaying,
    write(data: string): Promise<void> {
      // replay かどうかは呼ばれた時点で決まる。ここでローカルに退避しないと、
      // 1 通目の書き込み中に 2 通目が届いたときに抑止が早く解けてしまう。
      const isReplay = isFirstMessage;
      isFirstMessage = false;
      if (isReplay) replaying = true;
      return new Promise((resolve) => {
        term.write(data, () => {
          if (isReplay) replaying = false;
          resolve();
        });
      });
    },
  };
};
