import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import TerminalView from "../../src/components/TerminalView.vue";

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

const mountTerminal = () =>
  mount(TerminalView, {
    props: { sessionId: "abc", visible: true },
    attachTo: document.body,
  });

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
    vi.useFakeTimers();
    const wrapper = mountTerminal();

    expect(FakeWebSocket.instances).toHaveLength(1);
    latest().triggerClose();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(FakeWebSocket.instances).toHaveLength(2);

    wrapper.unmount();
  });

  it("アンマウント後は close が来ても張り直さない", async () => {
    vi.useFakeTimers();
    const wrapper = mountTerminal();

    const socket = latest();
    wrapper.unmount();
    socket.triggerClose();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("再接続のたびに新しい replay ゲートを使い、DA 応答の抑制をやり直す", async () => {
    // xterm の write は内部で非同期に完了するので、fake timer とは相性が悪い。ここだけ実時間で進める。
    const wrapper = mountTerminal();
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
