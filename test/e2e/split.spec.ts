import { expect, test } from "@playwright/test";
import { openApp, sessionView } from "./fixtures";

test("セッションを選ぶまでスプリットのボタンは出ない", async ({ page }) => {
  await openApp(page, [sessionView({ id: "a" })]);

  await expect(page.locator("[data-test=split-toggle]")).toHaveCount(0);
});

test("押すと選択中セッションのシェルを開くよう頼む", async ({ page }) => {
  const backend = await openApp(page, [sessionView({ id: "a" })]);
  await page.locator("[data-test=session-body]").click();

  await page.locator("[data-test=split-toggle]").click();

  await expect.poll(() => backend.calls.map((call) => `${call.method} ${call.path}`)).toContain(
    "POST /api/sessions/a/shell",
  );
});

test("シェルが開いているセッションではペインが 2 枚並ぶ", async ({ page }) => {
  await openApp(page, [sessionView({ id: "a", shell: true })]);
  await page.locator("[data-test=session-body]").click();

  await expect(page.locator(".terminals > .terminal:visible")).toHaveCount(2);
  await expect(page.locator(".terminals > .terminal.shell:visible")).toHaveCount(1);
  await expect(page.locator("[data-test=split-toggle]")).toHaveClass(/active/);
});

test("シェルが開いていなければペインは 1 枚", async ({ page }) => {
  await openApp(page, [sessionView({ id: "a" })]);
  await page.locator("[data-test=session-body]").click();

  await expect(page.locator(".terminals > .terminal:visible")).toHaveCount(1);
  await expect(page.locator("[data-test=split-toggle]")).not.toHaveClass(/active/);
});

test("開いている状態で押すとシェルを閉じるよう頼む", async ({ page }) => {
  const backend = await openApp(page, [sessionView({ id: "a", shell: true })]);
  await page.locator("[data-test=session-body]").click();

  await page.locator("[data-test=split-toggle]").click();

  await expect.poll(() => backend.calls.map((call) => `${call.method} ${call.path}`)).toContain(
    "DELETE /api/sessions/a/shell",
  );
});

test("サーバが shell を配ってからペインが増える", async ({ page }) => {
  const backend = await openApp(page, [sessionView({ id: "a" })]);
  await page.locator("[data-test=session-body]").click();
  await expect(page.locator(".terminals > .terminal:visible")).toHaveCount(1);

  await page.locator("[data-test=split-toggle]").click();
  await backend.push([sessionView({ id: "a", shell: true })]);

  await expect(page.locator(".terminals > .terminal:visible")).toHaveCount(2);
});
