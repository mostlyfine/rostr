import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { THEME_KEY, loadThemeChoice, nextThemeChoice, saveThemeChoice } from "../../src/theme";
import type { Session } from "../../common/types";

beforeEach(() => {
  localStorage.clear();
});

describe("loadThemeChoice", () => {
  it("未設定なら system を返す", () => {
    expect(loadThemeChoice()).toBe("system");
  });

  it("保存済みの light / dark をそのまま返す", () => {
    localStorage.setItem(THEME_KEY, "light");
    expect(loadThemeChoice()).toBe("light");
    localStorage.setItem(THEME_KEY, "dark");
    expect(loadThemeChoice()).toBe("dark");
  });

  it("未知の値が入っていても system を返す", () => {
    localStorage.setItem(THEME_KEY, "solarized");
    expect(loadThemeChoice()).toBe("system");
  });
});

describe("saveThemeChoice", () => {
  it("保存した選択を読み戻せる", () => {
    saveThemeChoice("dark");
    expect(loadThemeChoice()).toBe("dark");
  });

  it("system はキー自体を消す", () => {
    saveThemeChoice("light");
    saveThemeChoice("system");
    expect(localStorage.getItem(THEME_KEY)).toBeNull();
    expect(loadThemeChoice()).toBe("system");
  });
});

describe("nextThemeChoice", () => {
  it("system → light → dark → system の順で巡回する", () => {
    expect(nextThemeChoice("system")).toBe("light");
    expect(nextThemeChoice("light")).toBe("dark");
    expect(nextThemeChoice("dark")).toBe("system");
  });
});

/**
 * useTheme はモジュールスコープに状態を持つシングルトンなので、テストごとに
 * vi.resetModules() で作り直し、Sidebar も新しいインスタンスを掴むよう動的 import する。
 */
type OsTheme = "light" | "dark";

/** matchMedia の change リスナーを捕まえて、OS 側のテーマ変更を後から起こせるようにする。 */
const stubMatchMedia = (initial: OsTheme) => {
  const listeners = new Set<(event: { matches: boolean }) => void>();
  let prefersDark = initial === "dark";
  vi.stubGlobal("matchMedia", () => ({
    get matches() {
      return prefersDark;
    },
    addEventListener: (_: string, fn: (event: { matches: boolean }) => void) => {
      listeners.add(fn);
    },
    removeEventListener: (_: string, fn: (event: { matches: boolean }) => void) => {
      listeners.delete(fn);
    },
  }));
  return (next: OsTheme) => {
    prefersDark = next === "dark";
    for (const fn of listeners) fn({ matches: prefersDark });
  };
};

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
    vi.unstubAllGlobals();
    delete document.documentElement.dataset.theme;
  });

  it("既定では OS の設定を反映する", async () => {
    stubMatchMedia("light");
    await mountSidebar();
    expect(currentTheme()).toBe("light");
  });

  it("押すたびに light → dark → system と巡回し、選択を保存する", async () => {
    stubMatchMedia("dark");
    const wrapper = await mountSidebar();
    const toggle = wrapper.find("[data-test=theme-toggle]");

    await toggle.trigger("click");
    expect(currentTheme()).toBe("light");
    expect(localStorage.getItem(THEME_KEY)).toBe("light");

    await toggle.trigger("click");
    expect(currentTheme()).toBe("dark");
    expect(localStorage.getItem(THEME_KEY)).toBe("dark");

    await toggle.trigger("click");
    expect(currentTheme()).toBe("dark"); // system かつ OS がダーク
    expect(localStorage.getItem(THEME_KEY)).toBeNull();
  });

  it("保存済みの選択があれば OS の設定より優先する", async () => {
    localStorage.setItem(THEME_KEY, "light");
    stubMatchMedia("dark");
    await mountSidebar();
    expect(currentTheme()).toBe("light");
  });

  it("system のときは OS 側の変更にリロード無しで追従する", async () => {
    const changeOs = stubMatchMedia("dark");
    await mountSidebar();
    expect(currentTheme()).toBe("dark");

    changeOs("light");
    await new Promise((resolve) => setTimeout(resolve));
    expect(currentTheme()).toBe("light");
  });

  it("明示的に選んだ後は OS 側の変更を無視する", async () => {
    const changeOs = stubMatchMedia("dark");
    const wrapper = await mountSidebar();
    await wrapper.find("[data-test=theme-toggle]").trigger("click");
    expect(currentTheme()).toBe("light");

    changeOs("light");
    await new Promise((resolve) => setTimeout(resolve));
    expect(currentTheme()).toBe("light");
  });
});
