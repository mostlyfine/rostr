import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick } from "vue";
import { mount } from "@vue/test-utils";
import type { Session } from "../../common/types";

const focusSpy = vi.fn();
let hasFocusReturn = false;

// xterm.js は jsdom で動かないので、ターミナルは focus/hasFocus だけ持つスタブに差し替える。
vi.mock("../../src/components/TerminalView.vue", () => ({
  default: defineComponent({
    name: "TerminalView",
    props: { sessionId: { type: String, required: true }, visible: { type: Boolean, required: true } },
    setup(props, { expose }) {
      expose({ focus: () => focusSpy(props.sessionId), hasFocus: () => hasFocusReturn });
      return () => h("div", { class: "terminal-stub" });
    },
  }),
}));

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();

  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }

  emit(sessions: Session[]) {
    this.onmessage?.({ data: JSON.stringify(sessions) });
  }
}

const session = (over: Partial<Session>): Session => ({
  id: "id",
  cwd: "/tmp/proj",
  title: "proj",
  state: "idle",
  prompt: "",
  activity: "",
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

const mountApp = async (sessions: Session[]) => {
  const App = (await import("../../src/App.vue")).default;
  const wrapper = mount(App, { attachTo: document.body });
  FakeEventSource.instances.at(-1)!.emit(sessions);
  await nextTick();
  return wrapper;
};

beforeEach(() => {
  focusSpy.mockClear();
  hasFocusReturn = false;
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  vi.stubGlobal("fetch", vi.fn());
  localStorage.clear();
});

describe("App のフォーカス制御", () => {
  it("サイドバーのセッションを選ぶとそのターミナルにフォーカスが移る", async () => {
    const wrapper = await mountApp([session({ id: "a" })]);

    await wrapper.find("[data-test=session-body]").trigger("click");
    await nextTick();

    expect(focusSpy).toHaveBeenCalledWith("a");
  });

  it("選択中のセッションを再クリックしてもフォーカスが移る", async () => {
    const wrapper = await mountApp([session({ id: "a" })]);

    await wrapper.find("[data-test=session-body]").trigger("click");
    await nextTick();
    focusSpy.mockClear();

    await wrapper.find("[data-test=session-body]").trigger("click");
    await nextTick();

    expect(focusSpy).toHaveBeenCalledWith("a");
  });

  it("別のセッションへ切り替えると切り替え先にフォーカスが移る", async () => {
    const wrapper = await mountApp([session({ id: "a" }), session({ id: "b", title: "other" })]);

    const items = wrapper.findAll("[data-test=session-body]");
    await items[0].trigger("click");
    await nextTick();
    focusSpy.mockClear();

    await items[1].trigger("click");
    await nextTick();

    expect(focusSpy).toHaveBeenCalledWith("b");
    expect(focusSpy).not.toHaveBeenCalledWith("a");
  });

  it("x ボタンではフォーカスも選択も動かさない", async () => {
    const wrapper = await mountApp([session({ id: "a" }), session({ id: "b" })]);

    await wrapper.findAll("[data-test=session-close]")[1].trigger("click");
    await nextTick();

    expect(focusSpy).not.toHaveBeenCalled();
  });

  it("選択中のセッションが消えたら残ったセッションへフォーカスが移る", async () => {
    const wrapper = await mountApp([session({ id: "a" }), session({ id: "b" })]);

    await wrapper.findAll("[data-test=session-body]")[0].trigger("click");
    await nextTick();
    focusSpy.mockClear();

    // サーバから a が消えた一覧が届く。
    FakeEventSource.instances.at(-1)!.emit([session({ id: "b" })]);
    await nextTick();
    await nextTick();

    expect(focusSpy).toHaveBeenCalledWith("b");
  });
});

describe("waiting/done への自動フォーカス", () => {
  it("選択中でないセッションが waiting になり、選択中ターミナルにフォーカスが無ければ自動で切り替わる", async () => {
    const wrapper = await mountApp([session({ id: "a", state: "working" }), session({ id: "b", state: "working" })]);

    await wrapper.findAll("[data-test=session-body]")[0].trigger("click");
    await nextTick();
    focusSpy.mockClear();
    hasFocusReturn = false;

    FakeEventSource.instances.at(-1)!.emit([
      session({ id: "a", state: "working" }),
      session({ id: "b", state: "waiting" }),
    ]);
    await nextTick();
    await nextTick();

    expect(focusSpy).toHaveBeenCalledWith("b");
  });

  it("選択中ターミナルにフォーカスがある場合は自動切り替えしない", async () => {
    const wrapper = await mountApp([session({ id: "a", state: "working" }), session({ id: "b", state: "working" })]);

    await wrapper.findAll("[data-test=session-body]")[0].trigger("click");
    await nextTick();
    focusSpy.mockClear();
    hasFocusReturn = true;

    FakeEventSource.instances.at(-1)!.emit([
      session({ id: "a", state: "working" }),
      session({ id: "b", state: "waiting" }),
    ]);
    await nextTick();
    await nextTick();

    expect(focusSpy).not.toHaveBeenCalled();
  });

  it("選択中のセッション自身が waiting になっても自動切り替えは起きない", async () => {
    const wrapper = await mountApp([session({ id: "a", state: "working" })]);

    await wrapper.find("[data-test=session-body]").trigger("click");
    await nextTick();
    focusSpy.mockClear();

    FakeEventSource.instances.at(-1)!.emit([session({ id: "a", state: "waiting" })]);
    await nextTick();
    await nextTick();

    expect(focusSpy).not.toHaveBeenCalled();
  });

  it("何も選択していない状態で他セッションが done になったら自動選択される", async () => {
    await mountApp([session({ id: "a", state: "idle" }), session({ id: "b", state: "working" })]);
    focusSpy.mockClear();

    FakeEventSource.instances.at(-1)!.emit([
      session({ id: "a", state: "idle" }),
      session({ id: "b", state: "done" }),
    ]);
    await nextTick();
    await nextTick();

    expect(focusSpy).toHaveBeenCalledWith("b");
  });
});
