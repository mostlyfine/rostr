import { Terminal } from "@xterm/xterm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createReplayGate } from "../../src/terminalReplay";

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

afterEach(() => {
  opened?.dispose();
  opened = null;
  document.body.replaceChildren();
});

/** tmux が attach 直後に送る DA1 + DA2 の問い合わせ。xterm はこれに自動応答する。 */
const DA_QUERY = "\x1b[c\x1b[>c";

describe("createReplayGate", () => {
  it("最初の書き込み（replay）が終わるまで抑制フラグが立つ", async () => {
    const term = openTerminal();
    const gate = createReplayGate(term);
    const suppressedDuringWrite: boolean[] = [];
    term.onData(() => suppressedDuringWrite.push(gate.shouldSuppress()));

    await gate.write(DA_QUERY);

    expect(suppressedDuringWrite).toEqual([true, true]);
    expect(gate.shouldSuppress()).toBe(false);
  });

  it("2 回目以降の書き込みでは抑制しない", async () => {
    const term = openTerminal();
    const gate = createReplayGate(term);
    const suppressedDuringWrite: boolean[] = [];
    term.onData(() => suppressedDuringWrite.push(gate.shouldSuppress()));

    await gate.write("plain output");

    suppressedDuringWrite.length = 0;
    await gate.write(DA_QUERY);

    expect(suppressedDuringWrite).toEqual([false, false]);
  });
});
