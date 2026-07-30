import { expect, test, type Page } from "@playwright/test";
import { openApp, sessionView } from "./fixtures";

const working = (id: string, title: string, createdAt: number) =>
  sessionView({ id, title, state: "working", createdAt });

const waiting = (id: string, title: string, createdAt: number) =>
  sessionView({ id, title, state: "waiting", createdAt });

/** ターミナルからフォーカスを外す。行を押すと選び直しになってしまうので見出しを押す。 */
const blurTerminal = (page: Page) => page.locator(".sidebar h1").click();

test("入力中のターミナルからは選択を奪わず、点滅だけで知らせる", async ({ page }) => {
  const backend = await openApp(page, [working("a", "alpha", 1), working("b", "bravo", 2)]);
  await page.locator("[data-test=session-body]").nth(0).click();
  await expect(page.locator(".main-title")).toHaveText("alpha");

  await backend.push([working("a", "alpha", 1), waiting("b", "bravo", 2)]);

  await expect(page.locator(".main-title")).toHaveText("alpha");
  await expect(page.locator(".item", { hasText: "bravo" })).toHaveClass(/blink/);
});

test("ターミナルに入力していなければ waiting になった行へ自動で移る", async ({ page }) => {
  const backend = await openApp(page, [working("a", "alpha", 1), working("b", "bravo", 2)]);
  await page.locator("[data-test=session-body]").nth(0).click();
  await expect(page.locator(".main-title")).toHaveText("alpha");
  await blurTerminal(page);

  await backend.push([working("a", "alpha", 1), waiting("b", "bravo", 2)]);

  await expect(page.locator(".main-title")).toHaveText("bravo");
});

test("何も選んでいない状態で done になった行は自動で選ばれる", async ({ page }) => {
  const backend = await openApp(page, [
    sessionView({ id: "a", title: "alpha", state: "idle", createdAt: 1 }),
    working("b", "bravo", 2),
  ]);

  await backend.push([
    sessionView({ id: "a", title: "alpha", state: "idle", createdAt: 1 }),
    sessionView({ id: "b", title: "bravo", state: "done", createdAt: 2 }),
  ]);

  await expect(page.locator(".main-title")).toHaveText("bravo");
});

test("選択中のセッション自身が waiting になっても選択は動かない", async ({ page }) => {
  const backend = await openApp(page, [working("a", "alpha", 1)]);
  await page.locator("[data-test=session-body]").click();
  await blurTerminal(page);

  await backend.push([waiting("a", "alpha", 1)]);

  await expect(page.locator(".main-title")).toHaveText("alpha");
});

test("開いた時点で既に waiting の行は点滅しない", async ({ page }) => {
  await openApp(page, [sessionView({ id: "a", state: "waiting" })]);

  await expect(page.locator(".item")).not.toHaveClass(/blink/);
});

test("点滅はクリックで止まる", async ({ page }) => {
  const backend = await openApp(page, [working("a", "alpha", 1), working("b", "bravo", 2)]);
  await page.locator("[data-test=session-body]").nth(0).click();

  await backend.push([working("a", "alpha", 1), waiting("b", "bravo", 2)]);

  const bravo = page.locator(".item", { hasText: "bravo" });
  await expect(bravo).toHaveClass(/blink/);

  await bravo.locator("[data-test=session-body]").click();

  await expect(bravo).not.toHaveClass(/blink/);
});

test("done へ遷移した行も点滅する", async ({ page }) => {
  const backend = await openApp(page, [working("a", "alpha", 1), working("b", "bravo", 2)]);
  await page.locator("[data-test=session-body]").nth(0).click();

  await backend.push([
    working("a", "alpha", 1),
    sessionView({ id: "b", title: "bravo", state: "done", createdAt: 2 }),
  ]);

  await expect(page.locator(".item", { hasText: "bravo" })).toHaveClass(/blink/);
});

test("working へ戻る遷移では点滅しない", async ({ page }) => {
  const backend = await openApp(page, [
    sessionView({ id: "a", title: "alpha", state: "idle", createdAt: 1 }),
  ]);

  await backend.push([working("a", "alpha", 1)]);

  await expect(page.locator(".item")).not.toHaveClass(/blink/);
});
