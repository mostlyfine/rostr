import { expect, test } from "@playwright/test";
import { openApp, sessionView } from "./fixtures";

test("サーバから届いた出力をターミナルに描く", async ({ page }) => {
  const backend = await openApp(page, [sessionView({ id: "a" })]);
  await page.locator("[data-test=session-body]").click();
  await expect(page.locator(".terminals > .terminal:visible")).toHaveCount(1);

  backend.wsSend("hello from rostr");

  await expect(page.locator(".xterm-rows")).toContainText("hello from rostr");
});

test("打った文字は input としてサーバへ送られる", async ({ page }) => {
  const backend = await openApp(page, [sessionView({ id: "a" })]);
  await page.locator("[data-test=session-body]").click();
  await expect(page.locator(".terminals > .terminal:visible")).toHaveCount(1);

  // 行を選んだ時点で TerminalView が term.focus() を呼んでいるので、そのまま打てる。
  await page.keyboard.type("ls");

  await expect
    .poll(() => backend.wsSent)
    .toContainEqual(JSON.stringify({ type: "input", data: "l" }));
  await expect
    .poll(() => backend.wsSent)
    .toContainEqual(JSON.stringify({ type: "input", data: "s" }));
});

test("倍率を変えるとターミナルのフォントサイズも変わる", async ({ page }) => {
  await openApp(page, [sessionView({ id: "a" })]);
  await page.locator("[data-test=session-body]").click();
  await expect(page.locator(".terminals > .terminal:visible")).toHaveCount(1);

  const before = await page.locator(".xterm-rows").evaluate((el) => getComputedStyle(el).fontSize);
  expect(before).toBe("16px");

  await page.keyboard.press("Meta+Shift+Equal");

  await expect
    .poll(() => page.locator(".xterm-rows").evaluate((el) => getComputedStyle(el).fontSize))
    .toBe("18px");
});
