import { beforeEach, describe, expect, it, vi } from "vitest";
import { NewSessionDialog } from "../../src/components/NewSessionDialog";
import { RECENT_DIRS_KEY, loadRecentDirs, rememberRecentDir } from "../../src/recentDirs";
import { flush, mount } from "./helpers";

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
  const onSubmit = vi.fn();
  const onCancel = vi.fn();

  const mountDialog = async (props: { error?: string | null; busy?: boolean } = {}) => {
    onSubmit.mockClear();
    onCancel.mockClear();
    const wrapper = mount(
      <NewSessionDialog
        error={props.error ?? null}
        busy={props.busy ?? false}
        onSubmit={onSubmit}
        onCancel={onCancel}
      />,
    );
    await flush();
    return wrapper;
  };

  it("入力したパスとデフォルトの Claude Code で onSubmit を呼ぶ", async () => {
    const wrapper = await mountDialog();
    await wrapper.setValue("input", "  /tmp/proj  ");
    await wrapper.submit("form");
    expect(onSubmit).toHaveBeenCalledWith("/tmp/proj", "claude");
    wrapper.unmount();
  });

  it("選んだ GitHub Copilot CLI で onSubmit を呼ぶ", async () => {
    const wrapper = await mountDialog();
    await wrapper.setValue("input", "/tmp/proj");
    await wrapper.select("[data-test=agent]", "copilot");
    await wrapper.submit("form");
    expect(onSubmit).toHaveBeenCalledWith("/tmp/proj", "copilot");
    wrapper.unmount();
  });

  it("空欄では onSubmit を呼ばない", async () => {
    const wrapper = await mountDialog();
    await wrapper.submit("form");
    expect(onSubmit).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("サーバのエラーを表示する", async () => {
    const wrapper = await mountDialog({ error: "ディレクトリが存在しません: /x" });
    expect(wrapper.el.textContent).toContain("ディレクトリが存在しません: /x");
    wrapper.unmount();
  });

  it("履歴をクリックすると入力欄に反映される", async () => {
    rememberRecentDir("/tmp/history");
    const wrapper = await mountDialog();
    await wrapper.click("[data-test=recent-dir]");
    expect((wrapper.find("input") as HTMLInputElement).value).toBe("/tmp/history");
    wrapper.unmount();
  });

  it("キャンセルで onCancel を呼ぶ", async () => {
    const wrapper = await mountDialog();
    await wrapper.click("[data-test=cancel]");
    expect(onCancel).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it("busy 中は起動ボタンを無効にする", async () => {
    const wrapper = await mountDialog({ busy: true });
    expect((wrapper.find("[data-test=submit]") as HTMLButtonElement).disabled).toBe(true);
    wrapper.unmount();
  });
});
