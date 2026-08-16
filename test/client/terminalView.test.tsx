import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { TerminalView } from "../../src/components/TerminalView";
import { flush, mount } from "./helpers";

class FakeResizeObserver {
  observe = vi.fn();
  disconnect = vi.fn();
  unobserve = vi.fn();
}

/** 再接続の呼び出し順を検証できる程度の最小限の WebSocket 実装。 */
class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  send = vi.fn();

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }

  /** テストからの明示的な close 呼び出し（unmount 相当）。 */
  close = vi.fn(() => {
    this.readyState = FakeWebSocket.CLOSED;
  });

  /** サーバー側や回線都合で切れた場合を模す。実装が拾うべき本命のイベント。 */
  triggerClose() {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }
}

const latest = () => FakeWebSocket.instances.at(-1)!;

const mountTerminal = async () => {
  const wrapper = mount(<TerminalView sessionId="abc" visible={true} />);
  // xterm の生成と WebSocket の接続は useEffect の中なので、描画の完了を待つ。
  await flush();
  return wrapper;
};

// xterm は開くときに devicePixelRatio の変化を購読する。jsdom には matchMedia が無いので補う。
// ResizeObserver も jsdom に無いので同様に補い、WebSocket は再接続を検証できる Fake に差し替える。
// 全部まとめて stub することで、テストごとの unstubAllGlobals による巻き添え解除を避ける。
beforeAll(() => {
  vi.stubGlobal("matchMedia", () => ({
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  vi.stubGlobal("WebSocket", FakeWebSocket);
});

afterEach(() => {
  vi.useRealTimers();
  FakeWebSocket.instances = [];
  document.body.replaceChildren();
});

describe("TerminalView の WebSocket 再接続", () => {
  it("close イベントから RECONNECT_MS 経過で張り直す", async () => {
    const wrapper = await mountTerminal();

    expect(FakeWebSocket.instances).toHaveLength(1);
    latest().triggerClose();
    await new Promise((resolve) => setTimeout(resolve, 1_100));

    expect(FakeWebSocket.instances).toHaveLength(2);

    wrapper.unmount();
  });

  it("アンマウント後は close が来ても張り直さない", async () => {
    const wrapper = await mountTerminal();

    const socket = latest();
    wrapper.unmount();
    await flush();
    socket.triggerClose();
    await new Promise((resolve) => setTimeout(resolve, 1_100));

    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("再接続のたびに新しい replay ゲートを使い、DA 応答の抑制をやり直す", async () => {
    const wrapper = await mountTerminal();
    const first = latest();

    // 1 回目の replay を消費させ、以後は抑制しない状態にしておく。書き込み完了を待つため長めに取る。
    first.onmessage?.({ data: "plain output" });
    await new Promise((resolve) => setTimeout(resolve, 300));

    first.triggerClose();
    await new Promise((resolve) => setTimeout(resolve, 1_100));

    const second = latest();
    expect(second).not.toBe(first);
    // send() は OPEN でない socket への送信を黙って捨てるので、DA 応答が本当に抑制されたのか
    // 単に送れなかっただけなのかを区別できるよう、先に OPEN にしておく。
    second.readyState = FakeWebSocket.OPEN;

    // tmux が attach 直後に送る DA1 + DA2 の問い合わせ。抑制されていなければ自動応答が send に載る。
    second.onmessage?.({ data: "\x1b[c\x1b[>c" });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(second.send).not.toHaveBeenCalled();

    wrapper.unmount();
  }, 10_000);
});

describe("TerminalView の表示切り替え", () => {
  it("選ばれていない間も要素を残し、hidden で隠すだけにする", async () => {
    const wrapper = mount(<TerminalView sessionId="abc" visible={true} />);
    await flush();
    const terminal = wrapper.find(".terminal-pane")!;
    expect(terminal.className).not.toContain("hidden");

    await wrapper.rerender(<TerminalView sessionId="abc" visible={false} />);

    // 同じ要素のままであること（作り直されると画面が失われる）。
    expect(wrapper.find(".terminal-pane")).toBe(terminal);
    expect(terminal.className).toContain("hidden");
    // WebSocket も張り直されていない。
    expect(FakeWebSocket.instances).toHaveLength(1);

    wrapper.unmount();
  });

  /*
   * xterm は自分のルート要素に terminal クラスを付ける。枠の指定を同じ名前で書くと
   * padding と背景が xterm 自身にも当たり、中身が内側へずれて xterm.css が
   * .xterm-viewport に敷いている黒が縁として見えてしまう（light テーマで露見する）。
   */
  it("枠の指定に xterm が使う terminal クラスを使わない", async () => {
    const wrapper = mount(<TerminalView sessionId="abc" visible={true} />);
    await flush();

    const xterm = wrapper.find(".xterm")!;
    expect(xterm.classList.contains("terminal")).toBe(true);
    expect(xterm.classList.contains("terminal-pane")).toBe(false);

    wrapper.unmount();
  });

  it("シェルとして開くと kind=shell で繋ぐ", async () => {
    const wrapper = mount(<TerminalView sessionId="abc" visible={true} kind="shell" />);
    await flush();

    expect(latest().url).toContain("session=abc");
    expect(latest().url).toContain("kind=shell");

    wrapper.unmount();
  });
});
