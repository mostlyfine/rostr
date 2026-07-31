import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { SOUND_ENABLED_KEY, loadSoundEnabled, saveSoundEnabled } from "../../src/soundSettings";
import type { Session } from "../../common/types";

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
  const Sidebar = (await import("../../src/components/Sidebar.vue")).default;
  return mount(Sidebar, { props: { sessions: [] as Session[], selectedId: null } });
};

describe("サウンドトグル", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("既定ではオンのアイコンを表示する", async () => {
    const wrapper = await mountSidebar();
    expect(wrapper.find("[data-test=sound-toggle]").text()).toBe("🔔");
  });

  it("押すたびに on/off を往復し、選択を保存する", async () => {
    const wrapper = await mountSidebar();
    const toggle = wrapper.find("[data-test=sound-toggle]");

    await toggle.trigger("click");
    expect(wrapper.find("[data-test=sound-toggle]").text()).toBe("🔕");
    expect(localStorage.getItem(SOUND_ENABLED_KEY)).toBe("false");

    await toggle.trigger("click");
    expect(wrapper.find("[data-test=sound-toggle]").text()).toBe("🔔");
    expect(localStorage.getItem(SOUND_ENABLED_KEY)).toBe("true");
  });

  it("保存済みの選択を反映する", async () => {
    localStorage.setItem(SOUND_ENABLED_KEY, "false");
    const wrapper = await mountSidebar();
    expect(wrapper.find("[data-test=sound-toggle]").text()).toBe("🔕");
  });
});
