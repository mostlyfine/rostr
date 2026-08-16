import { describe, expect, it, vi } from "vitest";
import { Sidebar } from "../../src/components/Sidebar";
import { SessionItem } from "../../src/components/SessionItem";
import { toSidebarRows } from "../../src/sessionGroups";
import type { Session } from "../../common/types";
import { mount, flush } from "./helpers";

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

const noop = () => {};

describe("toSidebarRows", () => {
  it("見出しとセッションを状態順に1列へ並べる", () => {
    const rows = toSidebarRows([
      session({ id: "a", state: "done" }),
      session({ id: "b", state: "waiting" }),
      session({ id: "c", state: "done" }),
    ]);
    expect(rows.map((row) => [row.kind, row.key])).toEqual([
      ["header", "header:done"],
      ["session", "a"],
      ["session", "c"],
      ["header", "header:waiting"],
      ["session", "b"],
    ]);
  });

  it("同じ状態の中では作成が古いものを上に置く", () => {
    const rows = toSidebarRows([
      session({ id: "new", createdAt: 300 }),
      session({ id: "old", createdAt: 100 }),
      session({ id: "mid", createdAt: 200 }),
    ]);
    expect(rows.filter((row) => row.kind === "session").map((row) => row.key)).toEqual([
      "old",
      "mid",
      "new",
    ]);
  });

  it("並べ替えても渡された配列は書き換えない", () => {
    const sessions = [session({ id: "new", createdAt: 300 }), session({ id: "old", createdAt: 100 })];
    toSidebarRows(sessions);
    expect(sessions.map((s) => s.id)).toEqual(["new", "old"]);
  });

  it("見出しはラベルと件数を持つ", () => {
    const rows = toSidebarRows([session({ id: "a" }), session({ id: "b" })]);
    expect(rows[0]).toMatchObject({ kind: "header", state: "idle", label: "Idle", count: 2 });
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
  const mountSidebar = async (
    sessions: Session[],
    over: Partial<Parameters<typeof Sidebar>[0]> = {},
  ) => {
    const wrapper = mount(
      <Sidebar
        sessions={sessions}
        selectedId={null}
        onSelect={noop}
        onClose={noop}
        onCreate={noop}
        {...over}
      />,
    );
    await flush();
    return wrapper;
  };

  it("状態ごとにグループ分けして、完了・要対応・実行中の順に置く", async () => {
    const wrapper = await mountSidebar([
      session({ id: "a", state: "done" }),
      session({ id: "b", state: "waiting" }),
      session({ id: "c", state: "working" }),
    ]);
    const headings = wrapper.findAll("[data-test=group-label]").map((el) => el.textContent);
    expect(headings).toEqual(["Done", "Blocked", "Working"]);
    wrapper.unmount();
  });

  it("該当セッションが無い状態のグループは描画しない", async () => {
    const wrapper = await mountSidebar([session({ state: "idle" })]);
    expect(wrapper.findAll("[data-test=group-label]").map((el) => el.textContent)).toEqual(["Idle"]);
    wrapper.unmount();
  });

  /* 件数バッジを状態色で塗るために、見出しへ状態クラスを付けている。 */
  it("見出しに状態クラスを付ける", async () => {
    const wrapper = await mountSidebar([
      session({ id: "a", state: "done" }),
      session({ id: "b", state: "waiting" }),
      session({ id: "c", state: "working" }),
    ]);
    const headings = wrapper.findAll("li.group-label");
    expect(headings.map((el) => el.className)).toEqual([
      "group-label done",
      "group-label waiting",
      "group-label working",
    ]);
    wrapper.unmount();
  });

  it("セッションが無いときは案内を出す", async () => {
    const wrapper = await mountSidebar([]);
    expect(wrapper.el.textContent).toContain("No agents.");
    wrapper.unmount();
  });

  it("新規作成ボタンで onCreate を呼ぶ", async () => {
    const onCreate = vi.fn();
    const wrapper = await mountSidebar([], { onCreate });
    await wrapper.click("[data-test=new-session]");
    expect(onCreate).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it("入退場の扱いを揃えるため、見出しも行も1つのリストに入れる", async () => {
    const wrapper = await mountSidebar([
      session({ id: "a", state: "done" }),
      session({ id: "b", state: "waiting" }),
    ]);
    expect(wrapper.findAll("ul")).toHaveLength(1);
    expect(wrapper.findAll("ul > li")).toHaveLength(4);
    wrapper.unmount();
  });

  it("行のクリックを onSelect / onClose にそのまま中継する", async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const wrapper = await mountSidebar([session({ id: "x" })], { onSelect, onClose });

    await wrapper.click("[data-test=session-body]");
    await wrapper.click("[data-test=session-close]");

    expect(onSelect).toHaveBeenCalledWith("x");
    expect(onClose).toHaveBeenCalledWith("x");
    wrapper.unmount();
  });

  /* 消えた行はフェードのために少しの間だけ残る（useLeaveTransition）。 */
  it("消えたセッションの行は退場中として一度残る", async () => {
    const wrapper = await mountSidebar([
      session({ id: "a", state: "done" }),
      session({ id: "b", state: "done" }),
    ]);

    await wrapper.rerender(
      <Sidebar
        sessions={[session({ id: "a", state: "done" })]}
        selectedId={null}
        onSelect={noop}
        onClose={noop}
        onCreate={noop}
      />,
    );

    expect(wrapper.findAll("li.item")).toHaveLength(2);
    expect(wrapper.findAll("li.row-leaving")).toHaveLength(1);
    wrapper.unmount();
  });
});

describe("SessionItem", () => {
  const mountItem = async (over: Partial<Session>, props: { selected?: boolean } = {}) => {
    const wrapper = mount(
      <SessionItem
        session={session(over)}
        selected={props.selected ?? false}
        onSelect={noop}
        onClose={noop}
      />,
    );
    await flush();
    return wrapper;
  };

  it("タイトルの横にエージェント名を表示する", async () => {
    const wrapper = await mountItem({ agent: "copilot" });
    expect(wrapper.el.textContent).toContain("GitHub Copilot CLI");
    wrapper.unmount();
  });

  it("タイトル・プロンプト・activity を表示する", async () => {
    const wrapper = await mountItem({ prompt: "テストを書いて", activity: "Bash npm test" });
    expect(wrapper.el.textContent).toContain("proj");
    expect(wrapper.el.textContent).toContain("テストを書いて");
    expect(wrapper.el.textContent).toContain("Bash npm test");
    wrapper.unmount();
  });

  it("プロンプトが空ならプレースホルダを出す", async () => {
    const wrapper = await mountItem({});
    expect(wrapper.el.textContent).toContain("No prompt entered");
    wrapper.unmount();
  });

  it("クリックで onSelect を呼ぶ", async () => {
    const onSelect = vi.fn();
    const wrapper = mount(
      <SessionItem
        session={session({ id: "s9" })}
        selected={false}
        onSelect={onSelect}
        onClose={noop}
      />,
    );
    await flush();
    await wrapper.click("[data-test=session-body]");
    expect(onSelect).toHaveBeenCalledWith("s9");
    wrapper.unmount();
  });

  it("x ボタンは onClose だけを呼び、onSelect は呼ばない", async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const wrapper = mount(
      <SessionItem
        session={session({ id: "s9" })}
        selected={false}
        onSelect={onSelect}
        onClose={onClose}
      />,
    );
    await flush();
    await wrapper.click("[data-test=session-close]");
    expect(onClose).toHaveBeenCalledWith("s9");
    expect(onSelect).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("選択中は selected クラスが付く", async () => {
    const wrapper = await mountItem({}, { selected: true });
    expect(wrapper.find("li")!.className).toContain("selected");
    wrapper.unmount();
  });
});

describe("SessionItem のブリンク", () => {
  const item = (state: Session["state"], onSelect = noop) => (
    <SessionItem session={session({ state })} selected={false} onSelect={onSelect} onClose={noop} />
  );

  const mountWith = async (state: Session["state"], onSelect = noop) => {
    const wrapper = mount(item(state, onSelect));
    await flush();
    return wrapper;
  };

  const rowClass = (wrapper: ReturnType<typeof mount>) => wrapper.find("li")!.className;

  it("完了へ遷移すると点滅を始める", async () => {
    const wrapper = await mountWith("working");
    await wrapper.rerender(item("done"));
    expect(rowClass(wrapper)).toContain("blink");
    wrapper.unmount();
  });

  it("要対応へ遷移すると点滅を始める", async () => {
    const wrapper = await mountWith("working");
    await wrapper.rerender(item("waiting"));
    expect(rowClass(wrapper)).toContain("blink");
    wrapper.unmount();
  });

  it("実行中へ遷移しても点滅しない", async () => {
    const wrapper = await mountWith("idle");
    await wrapper.rerender(item("working"));
    expect(rowClass(wrapper)).not.toContain("blink");
    wrapper.unmount();
  });

  it("最初から完了の行は点滅しない", async () => {
    const wrapper = await mountWith("done");
    expect(rowClass(wrapper)).not.toContain("blink");
    wrapper.unmount();
  });

  it("クリックすると点滅が止まる", async () => {
    const onSelect = vi.fn();
    const wrapper = await mountWith("working", onSelect);
    await wrapper.rerender(item("done", onSelect));
    expect(rowClass(wrapper)).toContain("blink");

    await wrapper.click("[data-test=session-body]");
    expect(rowClass(wrapper)).not.toContain("blink");
    expect(onSelect).toHaveBeenCalled();
    wrapper.unmount();
  });

  it("続けて別の状態へ遷移しても点滅が続く", async () => {
    const wrapper = await mountWith("working");
    await wrapper.rerender(item("done"));
    await wrapper.rerender(item("waiting"));
    expect(rowClass(wrapper)).toContain("blink");
    wrapper.unmount();
  });

  it("状態に応じた色分けのため状態クラスを付ける", async () => {
    const wrapper = await mountWith("waiting");
    expect(rowClass(wrapper)).toContain("waiting");
    wrapper.unmount();
  });
});

describe("SessionItem の要約", () => {
  const mountItem = async (over: Partial<Session>) => {
    const wrapper = mount(
      <SessionItem session={session(over)} selected={false} onSelect={noop} onClose={noop} />,
    );
    await flush();
    return wrapper;
  };

  it("要約があれば表示する", async () => {
    const wrapper = await mountItem({ summary: "サイドバー要約の表示" });
    expect(wrapper.text('[data-test="session-summary"]')).toBe("サイドバー要約の表示");
    wrapper.unmount();
  });

  it("要約が無ければ行ごと出さない", async () => {
    const wrapper = await mountItem({ summary: "" });
    expect(wrapper.find('[data-test="session-summary"]')).toBeNull();
    wrapper.unmount();
  });

  it("要約があってもプロンプトと実行内容は残す", async () => {
    const wrapper = await mountItem({
      summary: "要約",
      prompt: "直したい",
      activity: "Bash npm test",
    });
    expect(wrapper.el.textContent).toContain("直したい");
    expect(wrapper.el.textContent).toContain("Bash npm test");
    wrapper.unmount();
  });
});
