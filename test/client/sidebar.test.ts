import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import Sidebar from "../../src/components/Sidebar.vue";
import SessionItem from "../../src/components/SessionItem.vue";
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
