/**
 * ホイールスクロールと文字選択を両立させるための道具。
 *
 * xterm.js はマウス報告が有効な間、選択機能を丸ごと無効化する（SelectionService.disable）。
 * tmux は mouse on なので attach 直後にマウス報告を要求してきて、そのままだとドラッグが
 * すべて tmux に吸われ、ブラウザで文字を選べなくなる。
 *
 * そこでマウス報告の要求だけを xterm に届かないよう落とし、代わりにホイールだけを自前で
 * SGR マウスシーケンスへ変換して tmux へ送る。tmux は相手が本当にマウス報告を有効にしたかを
 * 知らないので、送りつけたシーケンスはそのまま copy-mode の入口として解釈される。
 */
import type { Terminal } from "@xterm/xterm";

/**
 * 報告の符号化ではなく、報告そのものの有無を決めるモード。
 * これが立っている間だけホイールを自前で送る。tmux を使わない構成では誰も立てないので、
 * xterm 本来のスクロールバック操作がそのまま残る。
 */
const MOUSE_PROTOCOL_MODES = new Set([9, 1000, 1002, 1003]);

/**
 * xterm がマウス報告として扱う DEC プライベートモード。報告そのものに符号化の指定を足したもの。
 * このどれかが立つと選択が死ぬので、まとめて落とす。
 */
export const MOUSE_REPORT_MODES = new Set([...MOUSE_PROTOCOL_MODES, 1005, 1006, 1015, 1016]);

/** 1 回のホイールイベントで送る最大行数。トラックパッドの慣性で走りすぎないための蓋。 */
export const MAX_WHEEL_LINES_PER_EVENT = 20;

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

/**
 * CSI ? Pm h / l のパラメータを見て、xterm に渡さず握り潰すべきかを返す。
 *
 * 落としてよいのは全パラメータがマウス報告のときだけ。tmux はこれらを 1 つずつ送るので
 * それで足りるし、他のモードが混ざったものを落とすと代替画面や bracketed paste まで
 * 巻き添えになる。サブパラメータ付き（例: 1000:1）は解釈が変わり得るので触らない。
 */
const shouldSwallow = (params: (number | number[])[]): boolean =>
  params.length > 0 &&
  params.every((param) => typeof param === "number" && MOUSE_REPORT_MODES.has(param));

/** そのパラメータ列がマウス報告そのものの切り替えを含むか。符号化だけの指定は含まない。 */
const togglesProtocol = (params: (number | number[])[]): boolean =>
  params.some((param) => typeof param === "number" && MOUSE_PROTOCOL_MODES.has(param));

/**
 * マウス報告の要求を xterm へ渡さないよう、パーサに割り込みを仕込む。
 * 戻り値は「PTY 側が今マウス報告を欲しがっているか」を読む関数。
 *
 * カスタムハンドラは後から登録したものが先に呼ばれ、true を返すと既定の処理には届かない。
 * パーサ層で止めるので、チャンクの切れ目やサーバのリプレイを気にしなくてよい。代償として
 * 公開 API は (prefix, final) 単位でしか絞れず、`?25h`（カーソル表示）のような頻出の
 * シーケンスでもハンドラが呼ばれ、その都度パラメータ配列が確保される。
 */
export const installMouseReportFilter = (term: Terminal): (() => boolean) => {
  let wanted = false;

  const handle = (params: (number | number[])[], enabling: boolean): boolean => {
    if (!shouldSwallow(params)) return false;
    if (togglesProtocol(params)) wanted = enabling;
    return true;
  };

  term.parser.registerCsiHandler({ prefix: "?", final: "h" }, (params) => handle(params, true));
  term.parser.registerCsiHandler({ prefix: "?", final: "l" }, (params) => handle(params, false));

  return () => wanted;
};

/** ホイール 1 段ぶんの SGR マウス報告。座標は 1 始まり。 */
export const sgrWheelSequence = (up: boolean, col: number, row: number): string =>
  `\x1b[<${up ? 64 : 65};${col};${row}M`;

/**
 * 端末の左上からのピクセル数を 1 始まりのセル座標へ落とす。
 * tmux はペインの外を指す座標を無視するので、画面内へ丸めてから渡す。
 */
export const toCell = (offset: number, cellSize: number, max: number): number =>
  clamp(Math.floor(offset / cellSize) + 1, 1, max);

/** WheelEvent.deltaMode の値。ブラウザによってピクセル・行・ページのどれかで来る。 */
const DELTA_MODE_PIXEL = 0;
const DELTA_MODE_LINE = 1;

const clampLines = (lines: number): number =>
  clamp(lines, -MAX_WHEEL_LINES_PER_EVENT, MAX_WHEEL_LINES_PER_EVENT);

/**
 * ホイールの移動量をセル行数へ均す関数。端数はイベントをまたいで持ち越すので、
 * トラックパッドの細かいスクロールでも取りこぼさない。
 * 返す値は符号付きの行数で、正が下方向。
 */
export type WheelAccumulator = (deltaY: number, deltaMode: number, cellHeight: number) => number;

export const createWheelAccumulator = (): WheelAccumulator => {
  let carry = 0;

  return (deltaY, deltaMode, cellHeight) => {
    if (deltaY === 0) return 0;

    if (deltaMode !== DELTA_MODE_PIXEL) {
      carry = 0;
      // ページ単位を行数へ換算する術は無いので、1 ページを 1 行として最低限動かす。
      if (deltaMode !== DELTA_MODE_LINE) return Math.sign(deltaY);
      return clampLines(Math.trunc(deltaY) || Math.sign(deltaY));
    }

    // 向きが変わったら反対向きの持ち越しは捨てる。残すと折り返し直後の 1 回が鈍る。
    if (Math.sign(deltaY) !== Math.sign(carry)) carry = 0;

    carry += deltaY;
    const lines = Math.trunc(carry / cellHeight);
    // 1 行に満たなければ持ち越したまま何も送らない。Math.trunc の -0 もここで潰れる。
    if (lines === 0) return 0;

    carry -= lines * cellHeight;
    return clampLines(lines);
  };
};
