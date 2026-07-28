import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import Sidebar from "../../src/components/Sidebar.vue";
import SessionItem from "../../src/components/SessionItem.vue";
import { BLINK_MS } from "../../src/blink";
import { toSidebarRows } from "../../src/sessionGroups";
import type { Session } from "../../common/types";

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

describe("toSidebarRows", () => {
  it("見出しとセッションを状態順に1列へ並べる", () => {
    const rows = toSidebarRows([
      session({ id: "a", state: "done" }),
      session({ id: "b", state: "waiting" }),
      session({ id: "c", state: "done" }),
    ]);
    expect(rows.map((row) => [row.kind, row.key])).toEqual([
      ["header", "header:waiting"],
      ["session", "b"],
      ["header", "header:done"],
      ["session", "a"],
      ["session", "c"],
    ]);
  });

  it("見出しはラベルと件数を持つ", () => {
    const rows = toSidebarRows([session({ id: "a" }), session({ id: "b" })]);
    expect(rows[0]).toMatchObject({ kind: "header", state: "idle", label: "待機", count: 2 });
  });

  it("該当セッションが無い状態の見出しは並べない", () => {
    const rows = toSidebarRows([session({ state: "working" })]);
    expect(rows.filter((row) => row.kind === "header")).toHaveLength(1);
  });

  it("セッションが無ければ空になる", () => {
    expect(toSidebarRows([])).toEqual([]);
  });

  it("見出しの key はセッション id と衝突しない", () => {
    const rows = toSidebarRows([session({ id: "waiting", state: "waiting" })]);
    expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length);
  });
});

describe("Sidebar", () => {
  it("状態ごとにグループ分けして、要対応を先頭に置く", () => {
    const wrapper = mount(Sidebar, {
      props: {
        sessions: [
          session({ id: "a", state: "done" }),
          session({ id: "b", state: "waiting" }),
          session({ id: "c", state: "working" }),
        ],
        selectedId: null,
      },
    });
    const headings = wrapper.findAll("[data-test=group-label]").map((el) => el.text());
    expect(headings).toEqual(["要対応", "実行中", "完了"]);
  });

  it("該当セッションが無い状態のグループは描画しない", () => {
    const wrapper = mount(Sidebar, {
      props: { sessions: [session({ state: "idle" })], selectedId: null },
    });
    expect(wrapper.findAll("[data-test=group-label]").map((el) => el.text())).toEqual(["待機"]);
  });

  it("セッションが無いときは案内を出す", () => {
    const wrapper = mount(Sidebar, { props: { sessions: [], selectedId: null } });
    expect(wrapper.text()).toContain("エージェントがありません");
  });

  it("新規作成ボタンで create を emit する", async () => {
    const wrapper = mount(Sidebar, { props: { sessions: [], selectedId: null } });
    await wrapper.find("[data-test=new-session]").trigger("click");
    expect(wrapper.emitted("create")).toHaveLength(1);
  });

  it("移動アニメーションが効くよう、見出しも行も1つのリストに入れる", () => {
    const wrapper = mount(Sidebar, {
      props: {
        sessions: [session({ id: "a", state: "done" }), session({ id: "b", state: "waiting" })],
        selectedId: null,
      },
      // TransitionGroup は既定でスタブされるが、ここでは実際に描かれる DOM を見たい。
      global: { stubs: { "transition-group": false } },
    });
    expect(wrapper.findAll("ul")).toHaveLength(1);
    expect(wrapper.findAll("ul > li")).toHaveLength(4);
  });

  it("子から上がった select と close をそのまま中継する", () => {
    const wrapper = mount(Sidebar, {
      props: { sessions: [session({ id: "x" })], selectedId: null },
    });
    const item = wrapper.findComponent(SessionItem);
    item.vm.$emit("select", "x");
    item.vm.$emit("close", "x");
    expect(wrapper.emitted("select")?.[0]).toEqual(["x"]);
    expect(wrapper.emitted("close")?.[0]).toEqual(["x"]);
  });
});

describe("SessionItem", () => {
  it("タイトル・プロンプト・activity を表示する", () => {
    const wrapper = mount(SessionItem, {
      props: {
        session: session({ prompt: "テストを書いて", activity: "Bash npm test" }),
        selected: false,
      },
    });
    expect(wrapper.text()).toContain("proj");
    expect(wrapper.text()).toContain("テストを書いて");
    expect(wrapper.text()).toContain("Bash npm test");
  });

  it("プロンプトが空ならプレースホルダを出す", () => {
    const wrapper = mount(SessionItem, { props: { session: session({}), selected: false } });
    expect(wrapper.text()).toContain("プロンプト未入力");
  });

  it("クリックで select を emit する", async () => {
    const wrapper = mount(SessionItem, { props: { session: session({ id: "s9" }), selected: false } });
    await wrapper.find("[data-test=session-body]").trigger("click");
    expect(wrapper.emitted("select")?.[0]).toEqual(["s9"]);
  });

  it("x ボタンは close を emit し、select は emit しない", async () => {
    const wrapper = mount(SessionItem, { props: { session: session({ id: "s9" }), selected: false } });
    await wrapper.find("[data-test=session-close]").trigger("click");
    expect(wrapper.emitted("close")?.[0]).toEqual(["s9"]);
    expect(wrapper.emitted("select")).toBeUndefined();
  });

  it("選択中は selected クラスが付く", () => {
    const wrapper = mount(SessionItem, { props: { session: session({}), selected: true } });
    expect(wrapper.classes()).toContain("selected");
  });
});

describe("SessionItem のブリンク", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const mountWith = (state: Session["state"]) =>
    mount(SessionItem, { props: { session: session({ state }), selected: false } });

  it("完了へ遷移すると点滅を始める", async () => {
    const wrapper = mountWith("working");
    await wrapper.setProps({ session: session({ state: "done" }) });
    expect(wrapper.classes()).toContain("blink");
  });

  it("要対応へ遷移すると点滅を始める", async () => {
    const wrapper = mountWith("working");
    await wrapper.setProps({ session: session({ state: "waiting" }) });
    expect(wrapper.classes()).toContain("blink");
  });

  it("実行中へ遷移しても点滅しない", async () => {
    const wrapper = mountWith("idle");
    await wrapper.setProps({ session: session({ state: "working" }) });
    expect(wrapper.classes()).not.toContain("blink");
  });

  it("最初から完了の行は点滅しない", () => {
    expect(mountWith("done").classes()).not.toContain("blink");
  });

  it("点滅時間を過ぎるとクラスが外れる", async () => {
    const wrapper = mountWith("working");
    await wrapper.setProps({ session: session({ state: "done" }) });
    vi.advanceTimersByTime(BLINK_MS);
    await wrapper.vm.$nextTick();
    expect(wrapper.classes()).not.toContain("blink");
  });

  it("続けて別の状態へ遷移すると点滅をやり直す", async () => {
    const wrapper = mountWith("working");
    await wrapper.setProps({ session: session({ state: "done" }) });
    vi.advanceTimersByTime(BLINK_MS - 1);
    await wrapper.setProps({ session: session({ state: "waiting" }) });

    // 前のタイマーが残っていると、ここで点滅が打ち切られてしまう。
    vi.advanceTimersByTime(1);
    await wrapper.vm.$nextTick();
    expect(wrapper.classes()).toContain("blink");
  });

  it("状態に応じた色分けのため状態クラスを付ける", () => {
    expect(mountWith("waiting").classes()).toContain("waiting");
  });
});
