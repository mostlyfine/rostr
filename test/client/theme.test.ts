import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { THEME_KEY, loadTheme, nextTheme, saveTheme } from "../../src/theme";
import type { Session } from "../../common/types";

beforeEach(() => {
  localStorage.clear();
});

describe("loadTheme", () => {
  it("未設定なら dark を返す", () => {
    expect(loadTheme()).toBe("dark");
  });

  it("保存済みの light / dark をそのまま返す", () => {
    localStorage.setItem(THEME_KEY, "light");
    expect(loadTheme()).toBe("light");
    localStorage.setItem(THEME_KEY, "dark");
    expect(loadTheme()).toBe("dark");
  });

  it("未知の値が入っていても dark を返す", () => {
    localStorage.setItem(THEME_KEY, "solarized");
    expect(loadTheme()).toBe("dark");
  });
});

describe("saveTheme", () => {
  it("保存した選択を読み戻せる", () => {
    saveTheme("light");
    expect(loadTheme()).toBe("light");
  });

  it("既定の dark でも値を書き残す", () => {
    saveTheme("dark");
    expect(localStorage.getItem(THEME_KEY)).toBe("dark");
  });
});

describe("nextTheme", () => {
  it("dark と light を入れ替える", () => {
    expect(nextTheme("dark")).toBe("light");
    expect(nextTheme("light")).toBe("dark");
  });
});

/**
 * useTheme はモジュールスコープに状態を持つシングルトンなので、テストごとに
 * vi.resetModules() で作り直し、Sidebar も新しいインスタンスを掴むよう動的 import する。
 */
const mountSidebar = async () => {
  const Sidebar = (await import("../../src/components/Sidebar.vue")).default;
  return mount(Sidebar, { props: { sessions: [] as Session[], selectedId: null } });
};

const currentTheme = () => document.documentElement.dataset.theme;

describe("テーマトグル", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    delete document.documentElement.dataset.theme;
  });

  it("既定では dark を適用する", async () => {
    await mountSidebar();
    expect(currentTheme()).toBe("dark");
  });

  it("押すたびに dark と light を往復し、選択を保存する", async () => {
    const wrapper = await mountSidebar();
    const toggle = wrapper.find("[data-test=theme-toggle]");

    await toggle.trigger("click");
    expect(currentTheme()).toBe("light");
    expect(localStorage.getItem(THEME_KEY)).toBe("light");

    await toggle.trigger("click");
    expect(currentTheme()).toBe("dark");
    expect(localStorage.getItem(THEME_KEY)).toBe("dark");
  });

  it("保存済みの選択を反映する", async () => {
    localStorage.setItem(THEME_KEY, "light");
    await mountSidebar();
    expect(currentTheme()).toBe("light");
  });
});
