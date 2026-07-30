import { expect, test } from "@playwright/test";
import { openApp, sessionView } from "./fixtures";

test("何も選んでいないときは案内を出し、ヘッダを出さない", async ({ page }) => {
  await openApp(page, [sessionView({ id: "a" })]);

  await expect(page.locator(".placeholder")).toHaveText(
    'Select an agent from the sidebar, or launch one with "+ New".',
  );
  await expect(page.locator(".main-header")).toHaveCount(0);
});

test("行を選ぶとヘッダにタイトルと作業ディレクトリが出る", async ({ page }) => {
  await openApp(page, [sessionView({ id: "a", title: "proj", cwd: "/tmp/proj" })]);

  await page.locator("[data-test=session-body]").click();

  await expect(page.locator(".main-title")).toHaveText("proj");
  await expect(page.locator(".main-cwd")).toHaveText("/tmp/proj");
  await expect(page.locator(".item")).toHaveClass(/selected/);
});

test("別の行を選ぶと選択が移る", async ({ page }) => {
  await openApp(page, [
    sessionView({ id: "a", title: "alpha", state: "working", createdAt: 1 }),
    sessionView({ id: "b", title: "bravo", state: "working", createdAt: 2 }),
  ]);

  await page.locator("[data-test=session-body]").nth(0).click();
  await expect(page.locator(".main-title")).toHaveText("alpha");

  await page.locator("[data-test=session-body]").nth(1).click();
  await expect(page.locator(".main-title")).toHaveText("bravo");
  await expect(page.locator(".item.selected .title")).toHaveText("bravo");
});

test("選択中のセッションが一覧から消えたら残った行へ移る", async ({ page }) => {
  const backend = await openApp(page, [
    sessionView({ id: "a", title: "alpha", state: "working", createdAt: 1 }),
    sessionView({ id: "b", title: "bravo", state: "working", createdAt: 2 }),
  ]);

  await page.locator("[data-test=session-body]").nth(0).click();
  await expect(page.locator(".main-title")).toHaveText("alpha");

  await backend.push([sessionView({ id: "b", title: "bravo", state: "working", createdAt: 2 })]);

  await expect(page.locator(".main-title")).toHaveText("bravo");
});

test("x ボタンは選択を動かさずに終了だけを頼む", async ({ page }) => {
  const backend = await openApp(page, [
    sessionView({ id: "a", title: "alpha", state: "working", createdAt: 1 }),
    sessionView({ id: "b", title: "bravo", state: "working", createdAt: 2 }),
  ]);

  await page.locator("[data-test=session-body]").nth(0).click();
  await expect(page.locator(".main-title")).toHaveText("alpha");

  await page.locator("[data-test=session-close]").nth(1).click();

  await expect.poll(() => backend.calls.map((call) => `${call.method} ${call.path}`)).toContain(
    "DELETE /api/sessions/b",
  );
  await expect(page.locator(".main-title")).toHaveText("alpha");
});
