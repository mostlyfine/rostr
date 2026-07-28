import { Terminal } from "@xterm/xterm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  MAX_WHEEL_LINES_PER_EVENT,
  MOUSE_REPORT_MODES,
  createWheelAccumulator,
  installMouseReportFilter,
  sgrWheelSequence,
  toCell,
} from "../../src/terminalMouse";

// xterm は開くときに devicePixelRatio の変化を購読する。jsdom には matchMedia が無いので補う。
beforeAll(() => {
  vi.stubGlobal("matchMedia", () => ({
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
});

let opened: Terminal | null = null;

/** xterm を本物の DOM に載せて、書き込んだシーケンスがどう効くかを確かめる。 */
const openTerminal = (): Terminal => {
  const host = document.createElement("div");
  document.body.append(host);
  opened = new Terminal({ allowProposedApi: true });
  opened.open(host);
  return opened;
};

/** term.write は非同期に解釈されるので、書き終わるまで待つ。 */
const write = (term: Terminal, data: string) =>
  new Promise<void>((resolve) => term.write(data, resolve));

/** マウス報告が有効になると xterm が付けるクラス。選択が無効になった印でもある。 */
const mouseEventsEnabled = (term: Terminal) =>
  term.element?.classList.contains("enable-mouse-events") ?? false;

afterEach(() => {
  opened?.dispose();
  opened = null;
  document.body.replaceChildren();
});

describe("installMouseReportFilter", () => {
  it("フィルタが無ければ tmux のマウス報告要求で選択が無効になる", async () => {
    const term = openTerminal();

    await write(term, "\x1b[?1000h\x1b[?1002h\x1b[?1006h");

    expect(mouseEventsEnabled(term)).toBe(true);
  });

  it("xterm がマウス報告として扱うモードをすべて握り潰す", async () => {
    // 一覧が xterm の分類からずれると、漏れたモードで選択が黙って死ぬ。実物に照らして固定する。
    for (const mode of MOUSE_REPORT_MODES) {
      const term = openTerminal();
      installMouseReportFilter(term);

      await write(term, `\x1b[?${mode}h`);

      expect(mouseEventsEnabled(term), `mode ${mode}`).toBe(false);
      term.dispose();
    }
  });

  it("報告を要求されている間だけ true を返す", async () => {
    const term = openTerminal();
    const isWanted = installMouseReportFilter(term);

    expect(isWanted()).toBe(false);

    await write(term, "\x1b[?1000h\x1b[?1002h\x1b[?1006h");
    expect(isWanted()).toBe(true);

    await write(term, "\x1b[?1000l\x1b[?1002l\x1b[?1006l");
    expect(isWanted()).toBe(false);
  });

  it("符号化だけを切っても報告は続いているとみなす", async () => {
    const term = openTerminal();
    const isWanted = installMouseReportFilter(term);

    await write(term, "\x1b[?1000h\x1b[?1006h");
    await write(term, "\x1b[?1006l");

    expect(isWanted()).toBe(true);
  });

  it("代替画面と bracketed paste は握り潰さずに通す", async () => {
    const term = openTerminal();
    const isWanted = installMouseReportFilter(term);

    // tmux が attach 直後に送る並び。マウス報告だけが落ち、残りは効かなければならない。
    await write(term, "\x1b[?1049h\x1b[?1000h\x1b[?1002h\x1b[?1006h\x1b[?2004h");

    expect(term.buffer.active.type).toBe("alternate");
    expect(term.modes.bracketedPasteMode).toBe(true);
    expect(mouseEventsEnabled(term)).toBe(false);
    expect(isWanted()).toBe(true);
  });

  it("マウス報告と他のモードが混ざっていたら握り潰さない", async () => {
    const term = openTerminal();
    installMouseReportFilter(term);

    // 巻き添えで代替画面まで落とすより、マウス報告が通ってしまう方がまだ軽い。
    await write(term, "\x1b[?1000;1049h");

    expect(term.buffer.active.type).toBe("alternate");
  });
});

describe("セル寸法の測り方", () => {
  it("open した直後に .xterm-screen が居る", () => {
    // TerminalView はこの要素の実寸を列数・行数で割ってセル寸法を出す。
    // 名前が変わると寸法が測れず、ホイールが黙って効かなくなる。
    const term = openTerminal();

    expect(term.element?.querySelector(".xterm-screen")).not.toBeNull();
  });
});

describe("sgrWheelSequence", () => {
  it("上方向はボタン 64 を報告する", () => {
    expect(sgrWheelSequence(true, 3, 5)).toBe("\x1b[<64;3;5M");
  });

  it("下方向はボタン 65 を報告する", () => {
    expect(sgrWheelSequence(false, 12, 40)).toBe("\x1b[<65;12;40M");
  });
});

describe("toCell", () => {
  it("ピクセル数を 1 始まりのセル座標へ直す", () => {
    expect(toCell(0, 8, 80)).toBe(1);
    expect(toCell(7, 8, 80)).toBe(1);
    expect(toCell(8, 8, 80)).toBe(2);
  });

  it("端をはみ出した座標は画面内へ丸める", () => {
    // tmux はペイン外を指す座標を無視するので、はみ出しは端に寄せる。
    expect(toCell(-40, 8, 80)).toBe(1);
    expect(toCell(10_000, 8, 80)).toBe(80);
  });
});

describe("createWheelAccumulator", () => {
  const cellHeight = 17;

  it("セル高に満たないピクセル量は持ち越して、溜まった時点で 1 行ぶん返す", () => {
    const accumulate = createWheelAccumulator();
    expect(accumulate(9, 0, cellHeight)).toBe(0);
    expect(accumulate(9, 0, cellHeight)).toBe(1);
  });

  it("向きが変わったら持ち越しを捨てる", () => {
    const accumulate = createWheelAccumulator();
    expect(accumulate(9, 0, cellHeight)).toBe(0);
    // 直前の下向き 9px を残したまま足すと 11px にしかならず、1 回目の上スクロールが鈍る。
    expect(accumulate(-20, 0, cellHeight)).toBe(-1);
  });

  it("deltaMode が行単位ならそのまま行数として扱う", () => {
    const accumulate = createWheelAccumulator();
    expect(accumulate(3, 1, cellHeight)).toBe(3);
  });

  it("deltaMode がページ単位なら 1 ページを 1 行として扱う", () => {
    // ページ単位を送る環境は稀で、行数へ正確に換算する術も無い。最低限 1 行は動かす。
    const accumulate = createWheelAccumulator();
    expect(accumulate(1, 2, cellHeight)).toBe(1);
  });

  it("1 イベントで送る行数に上限を設ける", () => {
    const accumulate = createWheelAccumulator();
    expect(accumulate(cellHeight * 1000, 0, cellHeight)).toBe(MAX_WHEEL_LINES_PER_EVENT);
    expect(accumulate(cellHeight * -1000, 0, cellHeight)).toBe(-MAX_WHEEL_LINES_PER_EVENT);
  });
});
