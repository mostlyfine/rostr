import { vi } from "vitest";
import type { Session, SessionView } from "../../../common/types";

/** EventSource の readyState。仕様どおりの値を使う。 */
const CONNECTING = 0;
const OPEN = 1;
const CLOSED = 2;

/** SSE の代わりにテストから直接流し込めるスタブ。vi.stubGlobal("EventSource", ...) で差し込む。 */
export class FakeEventSource {
  static CONNECTING = CONNECTING;
  static OPEN = OPEN;
  static CLOSED = CLOSED;
  static instances: FakeEventSource[] = [];

  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = OPEN;
  close = vi.fn(() => {
    this.readyState = CLOSED;
  });

  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }

  emit(sessions: Session[] | SessionView[]) {
    this.onmessage?.({ data: JSON.stringify(sessions) });
  }

  /** ブラウザが自力で繋ぎ直す一時的な切断。 */
  failTemporarily() {
    this.readyState = CONNECTING;
    this.onerror?.();
  }

  /** 再接続先が SSE として不正だった場合の恒久的な失敗。 */
  failPermanently() {
    this.readyState = CLOSED;
    this.onerror?.();
  }
}

/** 直近に作られた接続。再接続を挟むテストでは張り直した後のものを指す。 */
export const latestEventSource = (): FakeEventSource => FakeEventSource.instances.at(-1)!;
