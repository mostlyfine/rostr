import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SOUND_ENABLED_KEY, loadSoundEnabled, saveSoundEnabled } from "../../src/soundSettings";
import type { Session } from "../../common/types";
import { flush, mount } from "./helpers";

beforeEach(() => {
  localStorage.clear();
});

describe("loadSoundEnabled", () => {
  it("未設定なら true を返す", () => {
    expect(loadSoundEnabled()).toBe(true);
  });

  it("保存済みの true / false をそのまま返す", () => {
    localStorage.setItem(SOUND_ENABLED_KEY, "false");
    expect(loadSoundEnabled()).toBe(false);
    localStorage.setItem(SOUND_ENABLED_KEY, "true");
    expect(loadSoundEnabled()).toBe(true);
  });

  it("未知の値が入っていても true を返す", () => {
    localStorage.setItem(SOUND_ENABLED_KEY, "yes");
    expect(loadSoundEnabled()).toBe(true);
  });
});

describe("saveSoundEnabled", () => {
  it("保存した選択を読み戻せる", () => {
    saveSoundEnabled(false);
    expect(loadSoundEnabled()).toBe(false);
  });

  it("既定の true でも値を書き残す", () => {
    saveSoundEnabled(true);
    expect(localStorage.getItem(SOUND_ENABLED_KEY)).toBe("true");
  });
});

/**
 * useSoundSettings はモジュールスコープに状態を持つシングルトンなので、テストごとに
 * vi.resetModules() で作り直し、Sidebar も新しいインスタンスを掴むよう動的 import する。
 */
const mountSidebar = async () => {
  const { Sidebar } = await import("../../src/components/Sidebar");
  const noop = () => {};
  const wrapper = mount(
    <Sidebar
      sessions={[] as Session[]}
      selectedId={null}
      onSelect={noop}
      onClose={noop}
      onCreate={noop}
    />,
  );
  await flush();
  return wrapper;
};

describe("サウンドトグル", () => {
  const mounted: { unmount: () => void }[] = [];

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    localStorage.clear();
  });

  const sidebar = async () => {
    const wrapper = await mountSidebar();
    mounted.push(wrapper);
    return wrapper;
  };

  it("既定ではオンのアイコンを表示する", async () => {
    const wrapper = await sidebar();
    expect(wrapper.text("[data-test=sound-toggle]")).toBe("🔔");
  });

  it("押すたびに on/off を往復し、選択を保存する", async () => {
    const wrapper = await sidebar();

    await wrapper.click("[data-test=sound-toggle]");
    expect(wrapper.text("[data-test=sound-toggle]")).toBe("🔕");
    expect(localStorage.getItem(SOUND_ENABLED_KEY)).toBe("false");

    await wrapper.click("[data-test=sound-toggle]");
    expect(wrapper.text("[data-test=sound-toggle]")).toBe("🔔");
    expect(localStorage.getItem(SOUND_ENABLED_KEY)).toBe("true");
  });

  it("保存済みの選択を反映する", async () => {
    localStorage.setItem(SOUND_ENABLED_KEY, "false");
    const wrapper = await sidebar();
    expect(wrapper.text("[data-test=sound-toggle]")).toBe("🔕");
  });
});
