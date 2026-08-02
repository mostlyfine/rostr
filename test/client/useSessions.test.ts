import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick } from "vue";
import { mount } from "@vue/test-utils";
import type { Session } from "../../common/types";
import { useSessions } from "../../src/composables/useSessions";

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

/** useSessions を動かすためだけのホスト。onUnmounted を効かせるために component が要る。 */
const mountHost = () => {
  let api: ReturnType<typeof useSessions>;
  const wrapper = mount(
    defineComponent({
      setup() {
        api = useSessions();
        return () => h("div");
      },
    }),
  );
  // biome-ignore lint: setup は mount 中に必ず走る。
  return { wrapper, api: api! };
};

const latest = () => FakeEventSource.instances.at(-1)!;

beforeEach(() => {
  vi.useFakeTimers();
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useSessions の再接続", () => {
  it("恒久的に切れたら張り直し、一覧の更新を再開する", async () => {
    const { api } = mountHost();
    latest().emit([session({ id: "a", activity: "Bash npm test" })]);
    await nextTick();
    expect(api.sessions.value[0].activity).toBe("Bash npm test");

    latest().failPermanently();
    await vi.runOnlyPendingTimersAsync();

    expect(FakeEventSource.instances).toHaveLength(2);

    latest().emit([session({ id: "a", activity: "Edit App.vue" })]);
    await nextTick();
    expect(api.sessions.value[0].activity).toBe("Edit App.vue");
    expect(api.connected.value).toBe(true);
  });

  it("ブラウザが自力で繋ぎ直す切断では張り直さない", async () => {
    const { api } = mountHost();

    latest().failTemporarily();
    await vi.runOnlyPendingTimersAsync();

    expect(FakeEventSource.instances).toHaveLength(1);
    expect(api.connected.value).toBe(false);
  });

  it("アンマウント後は張り直さない", async () => {
    const { wrapper } = mountHost();

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
    const { api } = mountHost();

    await api.openShell("abc");

    expect(fetchMock).toHaveBeenCalledWith("/api/sessions/abc/shell", { method: "POST" });
  });

  it("openShell はサーバのエラーメッセージを投げる", async () => {
    stubFetch({ ok: false, json: async () => ({ error: "起動できません" }) });
    const { api } = mountHost();

    await expect(api.openShell("abc")).rejects.toThrow("起動できません");
  });

  it("closeShell はセッションのシェルを閉じる", async () => {
    const fetchMock = stubFetch({});
    const { api } = mountHost();

    await api.closeShell("abc");

    expect(fetchMock).toHaveBeenCalledWith("/api/sessions/abc/shell", { method: "DELETE" });
  });
});

describe("useSessions の作成", () => {
  it("選んだ Codex を作成リクエストに含める", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => session({ agent: "codex" }) }));
    vi.stubGlobal("fetch", fetchMock);
    const { api } = mountHost();

    await api.create("/tmp/proj", "codex");

    expect(fetchMock).toHaveBeenCalledWith("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cwd: "/tmp/proj", agent: "codex" }),
    });
  });
});
