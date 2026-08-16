import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "../../common/types";
import { useSessions } from "../../src/hooks/useSessions";
import { flush, mount } from "./helpers";

/** EventSource の readyState。仕様どおりの値を使う。 */
const CONNECTING = 0;
const OPEN = 1;
const CLOSED = 2;

class FakeEventSource {
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

  emit(sessions: Session[]) {
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

const session = (over: Partial<Session>): Session => ({
  id: "id",
  agent: "claude",
  cwd: "/tmp/proj",
  title: "proj",
  state: "idle",
  prompt: "",
  activity: "",
  summary: "",
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

/** useSessions を動かすためだけのホスト。購読の後始末を効かせるために component が要る。 */
const mountHost = async () => {
  let latestApi: ReturnType<typeof useSessions> | null = null;
  const Host = () => {
    latestApi = useSessions();
    return <div />;
  };
  const wrapper = mount(<Host />);
  await flush();
  // 描き直しのたびに新しい戻り値になるので、都度いまのものを読む。
  return { wrapper, api: () => latestApi! };
};

const latest = () => FakeEventSource.instances.at(-1)!;

beforeEach(() => {
  // requestAnimationFrame は偽物にしない。描画の完了待ちがこれを使う。
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useSessions の再接続", () => {
  it("恒久的に切れたら張り直し、一覧の更新を再開する", async () => {
    const { api, wrapper } = await mountHost();
    latest().emit([session({ id: "a", activity: "Bash npm test" })]);
    await flush();
    expect(api().sessions[0].activity).toBe("Bash npm test");

    latest().failPermanently();
    await vi.runOnlyPendingTimersAsync();

    expect(FakeEventSource.instances).toHaveLength(2);

    latest().emit([session({ id: "a", activity: "Edit App.tsx" })]);
    await flush();
    expect(api().sessions[0].activity).toBe("Edit App.tsx");
    expect(api().connected).toBe(true);
    wrapper.unmount();
  });

  it("ブラウザが自力で繋ぎ直す切断では張り直さない", async () => {
    const { api, wrapper } = await mountHost();

    latest().failTemporarily();
    await vi.runOnlyPendingTimersAsync();
    await flush();

    expect(FakeEventSource.instances).toHaveLength(1);
    expect(api().connected).toBe(false);
    wrapper.unmount();
  });

  it("アンマウント後は張り直さない", async () => {
    const { wrapper } = await mountHost();

    latest().failPermanently();
    wrapper.unmount();
    await vi.runOnlyPendingTimersAsync();

    expect(FakeEventSource.instances).toHaveLength(1);
  });
});

describe("useSessions のシェル操作", () => {
  const stubFetch = (response: Partial<Response>) => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}), ...response }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  };

  it("openShell はセッションのシェルを開く", async () => {
    const fetchMock = stubFetch({});
    const { api, wrapper } = await mountHost();

    await api().openShell("abc");

    expect(fetchMock).toHaveBeenCalledWith("/api/sessions/abc/shell", { method: "POST" });
    wrapper.unmount();
  });

  it("openShell はサーバのエラーメッセージを投げる", async () => {
    stubFetch({ ok: false, json: async () => ({ error: "起動できません" }) });
    const { api, wrapper } = await mountHost();

    await expect(api().openShell("abc")).rejects.toThrow("起動できません");
    wrapper.unmount();
  });

  it("closeShell はセッションのシェルを閉じる", async () => {
    const fetchMock = stubFetch({});
    const { api, wrapper } = await mountHost();

    await api().closeShell("abc");

    expect(fetchMock).toHaveBeenCalledWith("/api/sessions/abc/shell", { method: "DELETE" });
    wrapper.unmount();
  });
});

describe("useSessions の作成", () => {
  it("選んだ Codex を作成リクエストに含める", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => session({ agent: "codex" }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const { api, wrapper } = await mountHost();

    await api().create("/tmp/proj", "codex");

    expect(fetchMock).toHaveBeenCalledWith("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cwd: "/tmp/proj", agent: "codex" }),
    });
    wrapper.unmount();
  });
});
