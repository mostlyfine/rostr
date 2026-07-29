import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick } from "vue";
import { mount } from "@vue/test-utils";
import { useSessions } from "../../src/composables/useSessions";
import { FakeEventSource, latestEventSource as latest } from "./helpers/fakeEventSource";
import { session } from "../helpers/session";

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
  });

  it("ブラウザが自力で繋ぎ直す切断では張り直さない", async () => {
    mountHost();

    latest().failTemporarily();
    await vi.runOnlyPendingTimersAsync();

    expect(FakeEventSource.instances).toHaveLength(1);
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
