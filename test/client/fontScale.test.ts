import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import {
  DEFAULT_SCALE,
  FONT_SCALE_KEY,
  MAX_SCALE,
  MIN_SCALE,
  loadFontScale,
  nextFontScale,
  saveFontScale,
  terminalFontSize,
} from "../../src/fontScale";

beforeEach(() => {
  localStorage.clear();
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
 * 描画前に倍率を確定させるスクリプトはモジュールを import できないので、保存キーだけを
 * index.html に書き写している。ずれると保存済みの倍率が読まれず、このスクリプトが防いで
 * いるちらつきそのものが起きるので、写し間違いをここで止める。
 */
describe("index.html の先読みスクリプト", () => {
  // jsdom 環境では import.meta.url が http なので、vitest の root から辿る。
  const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");

  it("fontScale.ts と同じ保存キーを読む", () => {
    expect(html).toContain(`localStorage.getItem("${FONT_SCALE_KEY}")`);
  });
});

/**
 * useFontScale はモジュールスコープに状態を持つシングルトンなので、テストごとに
 * vi.resetModules() で作り直してから動的 import する。
 */
const freshFontScale = async () => (await import("../../src/composables/useFontScale")).useFontScale();

const currentScale = () => document.documentElement.style.getPropertyValue("--font-scale");

describe("useFontScale", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    document.documentElement.style.removeProperty("--font-scale");
  });

  it("既定では等倍を適用する", async () => {
    await freshFontScale();
    expect(currentScale()).toBe("1");
  });

  it("保存済みの倍率を反映する", async () => {
    localStorage.setItem(FONT_SCALE_KEY, "130");
    await freshFontScale();
    expect(currentScale()).toBe("1.3");
  });

  it("拡大すると倍率を上げ、選択を保存する", async () => {
    const { increase } = await freshFontScale();

    increase();
    await nextTick();
    expect(currentScale()).toBe("1.1");
    expect(localStorage.getItem(FONT_SCALE_KEY)).toBe("110");
  });

  it("縮小すると倍率を下げ、選択を保存する", async () => {
    const { decrease } = await freshFontScale();

    decrease();
    await nextTick();
    expect(currentScale()).toBe("0.9");
    expect(localStorage.getItem(FONT_SCALE_KEY)).toBe("90");
  });

  it("リセットすると等倍に戻し、選択を保存する", async () => {
    localStorage.setItem(FONT_SCALE_KEY, "140");
    const { reset } = await freshFontScale();

    reset();
    await nextTick();
    expect(currentScale()).toBe("1");
    expect(localStorage.getItem(FONT_SCALE_KEY)).toBe(String(DEFAULT_SCALE));
  });

  /** 上下限に張り付いた状態で押し続けても書き込まない。clamp 自体は nextFontScale の担当。 */
  it("倍率が変わらないときは保存しない", async () => {
    localStorage.setItem(FONT_SCALE_KEY, String(MAX_SCALE));
    const { increase, scale } = await freshFontScale();
    localStorage.removeItem(FONT_SCALE_KEY);

    increase();
    expect(scale.value).toBe(MAX_SCALE);
    expect(localStorage.getItem(FONT_SCALE_KEY)).toBeNull();
  });
});
