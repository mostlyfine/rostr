import { beforeEach, describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import NewSessionDialog from "../../src/components/NewSessionDialog.vue";
import { RECENT_DIRS_KEY, loadRecentDirs, rememberRecentDir } from "../../src/recentDirs";

beforeEach(() => {
  localStorage.clear();
});

describe("recentDirs", () => {
  it("保存したディレクトリを新しい順で返す", () => {
    rememberRecentDir("/a");
    rememberRecentDir("/b");
    expect(loadRecentDirs()).toEqual(["/b", "/a"]);
  });

  it("同じディレクトリは重複させず先頭へ移す", () => {
    rememberRecentDir("/a");
    rememberRecentDir("/b");
    rememberRecentDir("/a");
    expect(loadRecentDirs()).toEqual(["/a", "/b"]);
  });

  it("10件までしか保持しない", () => {
    for (let i = 0; i < 12; i += 1) rememberRecentDir(`/dir${i}`);
    expect(loadRecentDirs()).toHaveLength(10);
    expect(loadRecentDirs()[0]).toBe("/dir11");
  });

  it("壊れた値が入っていても空配列を返す", () => {
    localStorage.setItem(RECENT_DIRS_KEY, "{ not json");
    expect(loadRecentDirs()).toEqual([]);
  });
});

describe("NewSessionDialog", () => {
  it("入力したパスとデフォルトの Claude Code で submit を emit する", async () => {
    const wrapper = mount(NewSessionDialog, { props: { error: null, busy: false } });
    await wrapper.find("input").setValue("  /tmp/proj  ");
    await wrapper.find("form").trigger("submit");
    expect(wrapper.emitted("submit")?.[0]).toEqual(["/tmp/proj", "claude"]);
  });

  it("選んだ GitHub Copilot CLI で submit を emit する", async () => {
    const wrapper = mount(NewSessionDialog, { props: { error: null, busy: false } });
    await wrapper.find("input").setValue("/tmp/proj");
    await wrapper.find("[data-test=agent]").setValue("copilot");
    await wrapper.find("form").trigger("submit");
    expect(wrapper.emitted("submit")?.[0]).toEqual(["/tmp/proj", "copilot"]);
  });

  it("空欄では submit しない", async () => {
    const wrapper = mount(NewSessionDialog, { props: { error: null, busy: false } });
    await wrapper.find("form").trigger("submit");
    expect(wrapper.emitted("submit")).toBeUndefined();
  });

  it("サーバのエラーを表示する", () => {
    const wrapper = mount(NewSessionDialog, {
      props: { error: "ディレクトリが存在しません: /x", busy: false },
    });
    expect(wrapper.text()).toContain("ディレクトリが存在しません: /x");
  });

  it("履歴をクリックすると入力欄に反映される", async () => {
    rememberRecentDir("/tmp/history");
    const wrapper = mount(NewSessionDialog, { props: { error: null, busy: false } });
    await wrapper.find("[data-test=recent-dir]").trigger("click");
    expect((wrapper.find("input").element as HTMLInputElement).value).toBe("/tmp/history");
  });

  it("キャンセルで cancel を emit する", async () => {
    const wrapper = mount(NewSessionDialog, { props: { error: null, busy: false } });
    await wrapper.find("[data-test=cancel]").trigger("click");
    expect(wrapper.emitted("cancel")).toHaveLength(1);
  });

  it("busy 中は起動ボタンを無効にする", () => {
    const wrapper = mount(NewSessionDialog, { props: { error: null, busy: true } });
    expect(wrapper.find("[data-test=submit]").attributes("disabled")).toBeDefined();
  });
});
