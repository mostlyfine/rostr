import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import {
  DEFAULT_SCALE,
  FONT_SCALE_KEY,
  MAX_SCALE,
  MIN_SCALE,
  clampScale,
  loadFontScale,
  nextFontScale,
  saveFontScale,
  terminalFontSize,
} from "../../src/fontScale";
import type { Session } from "../../common/types";

beforeEach(() => {
  localStorage.clear();
});

describe("clampScale", () => {
  it("範囲外は上下限に丸める", () => {
    expect(clampScale(MIN_SCALE - 10)).toBe(MIN_SCALE);
    expect(clampScale(MAX_SCALE + 10)).toBe(MAX_SCALE);
  });

  it("範囲内はそのまま返す", () => {
    expect(clampScale(120)).toBe(120);
  });

  it("数値でない値は既定に倒す", () => {
    expect(clampScale(Number.NaN)).toBe(DEFAULT_SCALE);
  });
});

describe("loadFontScale", () => {
  it("未設定なら 100 を返す", () => {
    expect(loadFontScale()).toBe(DEFAULT_SCALE);
  });

  it("保存済みの値をそのまま返す", () => {
    localStorage.setItem(FONT_SCALE_KEY, "130");
    expect(loadFontScale()).toBe(130);
  });

  it("数値でない値が入っていても 100 を返す", () => {
    localStorage.setItem(FONT_SCALE_KEY, "huge");
    expect(loadFontScale()).toBe(DEFAULT_SCALE);
  });

  it("範囲外の値は上下限に丸める", () => {
    localStorage.setItem(FONT_SCALE_KEY, "500");
    expect(loadFontScale()).toBe(MAX_SCALE);
    localStorage.setItem(FONT_SCALE_KEY, "10");
    expect(loadFontScale()).toBe(MIN_SCALE);
  });
});

describe("saveFontScale", () => {
  it("保存した倍率を読み戻せる", () => {
    saveFontScale(120);
    expect(loadFontScale()).toBe(120);
  });
});

describe("nextFontScale", () => {
  it("刻み幅ぶん増減する", () => {
    expect(nextFontScale(100, 1)).toBe(110);
    expect(nextFontScale(100, -1)).toBe(90);
  });

  it("上限・下限で止まる", () => {
    expect(nextFontScale(MAX_SCALE, 1)).toBe(MAX_SCALE);
    expect(nextFontScale(MIN_SCALE, -1)).toBe(MIN_SCALE);
  });
});

describe("terminalFontSize", () => {
  it("100% では既定の 16px", () => {
    expect(terminalFontSize(100)).toBe(16);
  });

  it("倍率をかけた整数の px を返す", () => {
    expect(terminalFontSize(150)).toBe(24);
    // 16 * 0.9 = 14.4。小数のままだと xterm の描画がにじむので丸める。
    expect(terminalFontSize(90)).toBe(14);
  });
});

/**
 * useFontScale はモジュールスコープに状態を持つシングルトンなので、テストごとに
 * vi.resetModules() で作り直し、Sidebar も新しいインスタンスを掴むよう動的 import する。
 */
const mountSidebar = async () => {
  const Sidebar = (await import("../../src/components/Sidebar.vue")).default;
  return mount(Sidebar, { props: { sessions: [] as Session[], selectedId: null } });
};

const currentScale = () => document.documentElement.style.getPropertyValue("--font-scale");

describe("フォントサイズのボタン", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    document.documentElement.style.removeProperty("--font-scale");
  });

  it("既定では等倍を適用する", async () => {
    await mountSidebar();
    expect(currentScale()).toBe("1");
  });

  it("+ を押すと拡大し、選択を保存する", async () => {
    const wrapper = await mountSidebar();

    await wrapper.find("[data-test=font-increase]").trigger("click");
    expect(currentScale()).toBe("1.1");
    expect(localStorage.getItem(FONT_SCALE_KEY)).toBe("110");
  });

  it("- を押すと縮小し、選択を保存する", async () => {
    const wrapper = await mountSidebar();

    await wrapper.find("[data-test=font-decrease]").trigger("click");
    expect(currentScale()).toBe("0.9");
    expect(localStorage.getItem(FONT_SCALE_KEY)).toBe("90");
  });

  it("保存済みの倍率を反映する", async () => {
    localStorage.setItem(FONT_SCALE_KEY, "130");
    await mountSidebar();
    expect(currentScale()).toBe("1.3");
  });

  it("上限では + を、下限では - を押せなくする", async () => {
    localStorage.setItem(FONT_SCALE_KEY, String(MAX_SCALE));
    const atMax = await mountSidebar();
    expect(atMax.find("[data-test=font-increase]").attributes("disabled")).toBeDefined();
    expect(atMax.find("[data-test=font-decrease]").attributes("disabled")).toBeUndefined();

    vi.resetModules();
    localStorage.setItem(FONT_SCALE_KEY, String(MIN_SCALE));
    const atMin = await mountSidebar();
    expect(atMin.find("[data-test=font-decrease]").attributes("disabled")).toBeDefined();
    expect(atMin.find("[data-test=font-increase]").attributes("disabled")).toBeUndefined();
  });
});
