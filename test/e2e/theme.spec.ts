import { expect, test } from "@playwright/test";
import { openApp, sessionView } from "./fixtures";

const themeAttr = (page: import("@playwright/test").Page) =>
  page.evaluate(() => document.documentElement.dataset.theme);

test("既定は dark で、トグルには月のアイコンが出る", async ({ page }) => {
  await openApp(page, [sessionView({ id: "a" })]);

  expect(await themeAttr(page)).toBe("dark");
  await expect(page.locator("[data-test=theme-toggle]")).toHaveText("🌙");
  await expect(page.locator("[data-test=theme-toggle]")).toHaveAttribute("title", "Theme: Dark");
});

test("押すと light に切り替わり、保存される", async ({ page }) => {
  await openApp(page, [sessionView({ id: "a" })]);

  await page.locator("[data-test=theme-toggle]").click();

  expect(await themeAttr(page)).toBe("light");
  await expect(page.locator("[data-test=theme-toggle]")).toHaveText("☀");
  await expect(page.locator("[data-test=theme-toggle]")).toHaveAttribute("title", "Theme: Light");
  expect(await page.evaluate(() => localStorage.getItem("rostr:theme"))).toBe("light");
});

test("もう一度押すと dark に戻る", async ({ page }) => {
  await openApp(page, [sessionView({ id: "a" })]);

  await page.locator("[data-test=theme-toggle]").click();
  await page.locator("[data-test=theme-toggle]").click();

  expect(await themeAttr(page)).toBe("dark");
  expect(await page.evaluate(() => localStorage.getItem("rostr:theme"))).toBe("dark");
});

/** Vue のマウントを待たずに head のスクリプトが決めるので、読み込み直後から light になる。 */
test("light はリロード後も初回描画から保たれる", async ({ page }) => {
  await openApp(page, [sessionView({ id: "a" })]);
  await page.locator("[data-test=theme-toggle]").click();
  expect(await themeAttr(page)).toBe("light");

  await page.reload({ waitUntil: "commit" });

  expect(await themeAttr(page)).toBe("light");
});

test("保存された値が壊れていても dark で描く", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("rostr:theme", "chartreuse"));
  await openApp(page, [sessionView({ id: "a" })]);

  expect(await themeAttr(page)).toBe("dark");
});
