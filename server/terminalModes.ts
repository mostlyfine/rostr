/**
 * PTY が送る DEC プライベートモード（CSI ? Pm h / l）を追いかけ、後から繋いだ端末へ再現するための道具。
 *
 * tmux は attach した直後に一度だけ、代替画面・bracketed paste・SGR マウス報告を要求する。
 * ブラウザへ流すスクロールバックは末尾しか残らないので、この先頭部分は早々に失われる。
 * 失うと代替画面にも bracketed paste にも戻れず、途中から繋いだ画面が壊れる。
 *
 * マウス報告のモードは、ブラウザに届いても xterm には渡らない（src/terminalMouse.ts が握り潰す）。
 * それでも再現し続ける必要がある。ブラウザはこれを見て初めて「tmux がマウスを欲しがっている」と
 * 知り、ホイールを SGR マウス報告に組み立て直して送るようになる。ここで 1000/1002/1006 を
 * 追うのをやめると、再接続したブラウザのホイールスクロールが無言で効かなくなる。
 */

const PREFIX = "\x1b[?";

/** 完成したモード設定。パラメータはセミコロン区切りで複数並ぶことがある。 */
const MODE_PATTERN = /\x1b\[\?([0-9;]+)([hl])/g;

/**
 * 末尾に残った、次のチャンクと繋げばモード設定になり得る部分。
 * ESC / CSI / CSI ? / CSI ? パラメータ のいずれかで終わっていれば繰り越す。
 */
const PENDING_PATTERN = /\x1b(?:\[(?:\?[0-9;]*)?)?$/;

export interface ModeTracker {
  /** PTY の出力をそのまま食わせる。チャンクの切れ目は気にしなくてよい。 */
  feed(data: string): void;
  /** 今までに観測したモードを、最初に現れた順で再現するシーケンス。 */
  replay(): string;
}

export const createModeTracker = (): ModeTracker => {
  // 挿入順を保つ Map。tmux が送る順序（代替画面 → マウス報告）をそのまま再現するために要る。
  const modes = new Map<string, "h" | "l">();
  let carry = "";

  return {
    feed(data: string): void {
      const buffer = carry + data;
      for (const [, params, action] of buffer.matchAll(MODE_PATTERN)) {
        for (const param of params.split(";")) {
          if (param === "") continue;
          modes.set(param, action as "h" | "l");
        }
      }

      carry = buffer.match(PENDING_PATTERN)?.[0] ?? "";
    },

    replay(): string {
      let out = "";
      for (const [mode, action] of modes) out += `${PREFIX}${mode}${action}`;
      return out;
    },
  };
};
