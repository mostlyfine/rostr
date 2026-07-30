import { expect, test } from "@playwright/test";
import { openApp, sessionView } from "./fixtures";

test("セッションが無いときは案内文だけを出す", async ({ page }) => {
  await openApp(page, []);

  await expect(page.locator(".empty")).toHaveText('No agents. Click "+ New" to launch one.');
  await expect(page.locator("[data-test=group-label]")).toHaveCount(0);
});

test("見出しは done → waiting → working → idle → exited の順に並ぶ", async ({ page }) => {
  await openApp(page, [
    sessionView({ id: "e", state: "exited" }),
    sessionView({ id: "i", state: "idle" }),
    sessionView({ id: "w", state: "working" }),
    sessionView({ id: "b", state: "waiting" }),
    sessionView({ id: "d", state: "done" }),
  ]);

  await expect(page.locator("[data-test=group-label]")).toHaveText([
    "Done",
    "Blocked",
    "Working",
    "Idle",
    "Exited",
  ]);
});

test("該当するセッションが無い状態の見出しは出さない", async ({ page }) => {
  await openApp(page, [sessionView({ id: "a", state: "working" })]);

  await expect(page.locator("[data-test=group-label]")).toHaveText(["Working"]);
});

test("見出しのバッジはその状態の件数を出す", async ({ page }) => {
  await openApp(page, [
    sessionView({ id: "a", state: "working" }),
    sessionView({ id: "b", state: "working" }),
    sessionView({ id: "c", state: "done" }),
  ]);

  await expect(page.locator(".group-label.done .count")).toHaveText("1");
  await expect(page.locator(".group-label.working .count")).toHaveText("2");
});

test("同じ状態の中は作成が古い順に並ぶ", async ({ page }) => {
  await openApp(page, [
    sessionView({ id: "new", title: "newer", state: "working", createdAt: 200 }),
    sessionView({ id: "old", title: "older", state: "working", createdAt: 100 }),
  ]);

  await expect(page.locator(".item .title")).toHaveText(["older", "newer"]);
});

test("状態が変わった行は新しいグループへ移る", async ({ page }) => {
  const backend = await openApp(page, [
    sessionView({ id: "a", title: "alpha", state: "working" }),
    sessionView({ id: "b", title: "bravo", state: "working" }),
  ]);

  await backend.push([
    sessionView({ id: "a", title: "alpha", state: "working" }),
    sessionView({ id: "b", title: "bravo", state: "done" }),
  ]);

  await expect(page.locator("[data-test=group-label]")).toHaveText(["Done", "Working"]);
  await expect(page.locator(".group-label.done + .item .title")).toHaveText("bravo");
});

test("プロンプト・要約・実行内容がそろって出る", async ({ page }) => {
  await openApp(page, [
    sessionView({ id: "a", title: "proj", summary: "テストを直す", prompt: "テストが落ちる", activity: "Bash npm test" }),
  ]);

  await expect(page.locator("[data-test=session-summary]")).toHaveText("テストを直す");
  await expect(page.locator(".prompt")).toHaveText("テストが落ちる");
  await expect(page.locator(".activity")).toHaveText("Bash npm test");
});

test("プロンプトが空の行は代替の文言を薄く出す", async ({ page }) => {
  await openApp(page, [sessionView({ id: "a" })]);

  const prompt = page.locator(".prompt");
  await expect(prompt).toHaveText("No prompt entered");
  await expect(prompt).toHaveClass(/empty/);
  await expect(page.locator("[data-test=session-summary]")).toHaveCount(0);
});
