import { expect, test, type Page } from "@playwright/test";
import { openApp, sessionView } from "./fixtures";

const scaleVar = (page: Page) =>
  page.evaluate(() => document.documentElement.style.getPropertyValue("--font-scale"));

const toast = (page: Page) => page.locator("[data-test=font-scale-toast]");

test("拡大のショートカットで倍率が上がり、倍率が浮かぶ", async ({ page }) => {
  await openApp(page, [sessionView({ id: "a" })]);

  await page.keyboard.press("Meta+Shift+Equal");

  expect(await scaleVar(page)).toBe("1.1");
  await expect(toast(page)).toHaveText("110%");
});

test("縮小のショートカットで倍率が下がる", async ({ page }) => {
  await openApp(page, [sessionView({ id: "a" })]);

  await page.keyboard.press("Meta+Shift+Minus");

  expect(await scaleVar(page)).toBe("0.9");
  await expect(toast(page)).toHaveText("90%");
});

test("リセットのショートカットで等倍へ戻る", async ({ page }) => {
  await openApp(page, [sessionView({ id: "a" })]);

  await page.keyboard.press("Meta+Shift+Equal");
  await page.keyboard.press("Meta+Shift+Equal");
  expect(await scaleVar(page)).toBe("1.2");

  await page.keyboard.press("Meta+Shift+Digit0");

  expect(await scaleVar(page)).toBe("1");
  await expect(toast(page)).toHaveText("100%");
});

test("浮かんだ倍率はフェードが終わると消える", async ({ page }) => {
  await openApp(page, [sessionView({ id: "a" })]);

  await page.keyboard.press("Meta+Shift+Equal");
  await expect(toast(page)).toBeVisible();

  await expect(toast(page)).toHaveCount(0, { timeout: 5_000 });
});

test("上限で頭打ちになっても倍率は浮かぶ", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("rostr:font-scale", "160"));
  await openApp(page, [sessionView({ id: "a" })]);

  await page.keyboard.press("Meta+Shift+Equal");

  expect(await scaleVar(page)).toBe("1.6");
  await expect(toast(page)).toHaveText("160%");
});

test("下限で頭打ちになっても倍率は浮かぶ", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("rostr:font-scale", "80"));
  await openApp(page, [sessionView({ id: "a" })]);

  await page.keyboard.press("Meta+Shift+Minus");

  expect(await scaleVar(page)).toBe("0.8");
  await expect(toast(page)).toHaveText("80%");
});

test("倍率は保存され、リロード後も初回描画から効く", async ({ page }) => {
  await openApp(page, [sessionView({ id: "a" })]);

  await page.keyboard.press("Meta+Shift+Equal");
  expect(await page.evaluate(() => localStorage.getItem("rostr:font-scale"))).toBe("110");

  await page.reload({ waitUntil: "commit" });

  expect(await scaleVar(page)).toBe("1.1");
});

/** ブラウザのズーム（Shift 無し）は奪わない。 */
test("Shift を伴わない Cmd と = は倍率を変えない", async ({ page }) => {
  await openApp(page, [sessionView({ id: "a" })]);

  await page.keyboard.press("Meta+Equal");

  expect(await scaleVar(page)).toBe("1");
  await expect(toast(page)).toHaveCount(0);
});

test("サイドバーの幅も倍率に追従する", async ({ page }) => {
  await openApp(page, [sessionView({ id: "a" })]);
  const before = (await page.locator(".sidebar").boundingBox())!.width;

  await page.keyboard.press("Meta+Shift+Equal");

  const after = (await page.locator(".sidebar").boundingBox())!.width;
  expect(after).toBeCloseTo(before * 1.1, 0);
});
