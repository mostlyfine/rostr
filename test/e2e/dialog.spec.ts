import { expect, test } from "@playwright/test";
import { openApp, sessionView } from "./fixtures";

test("+ New でダイアログが開き、入力欄にフォーカスが載る", async ({ page }) => {
  await openApp(page, []);

  await page.locator("[data-test=new-session]").click();

  await expect(page.locator(".dialog h2")).toHaveText("Launch New Agent");
  await expect(page.locator(".dialog input")).toBeFocused();
});

test("Cancel で閉じる", async ({ page }) => {
  await openApp(page, []);
  await page.locator("[data-test=new-session]").click();

  await page.locator("[data-test=cancel]").click();

  await expect(page.locator(".dialog")).toHaveCount(0);
});

test("パスを入れて Launch すると起動を頼み、ダイアログが閉じる", async ({ page }) => {
  const backend = await openApp(page, []);
  await page.locator("[data-test=new-session]").click();

  await page.locator(".dialog input").fill("/tmp/proj");
  await page.locator("[data-test=submit]").click();

  await expect(page.locator(".dialog")).toHaveCount(0);
  expect(backend.calls).toContainEqual({
    method: "POST",
    path: "/api/sessions",
    body: { cwd: "/tmp/proj" },
  });
});

test("空のまま Launch しても何も起きない", async ({ page }) => {
  const backend = await openApp(page, []);
  await page.locator("[data-test=new-session]").click();

  await page.locator("[data-test=submit]").click();

  await expect(page.locator(".dialog")).toHaveCount(1);
  expect(backend.calls.filter((call) => call.method === "POST")).toHaveLength(0);
});

test("サーバのエラー文言をそのまま出し、ダイアログは開いたままにする", async ({ page }) => {
  await openApp(page, [], { createError: "ディレクトリが存在しません: /nope" });
  await page.locator("[data-test=new-session]").click();

  await page.locator(".dialog input").fill("/nope");
  await page.locator("[data-test=submit]").click();

  await expect(page.locator(".dialog .error")).toHaveText("ディレクトリが存在しません: /nope");
  await expect(page.locator(".dialog")).toHaveCount(1);
});

test("起動したディレクトリは次に開いたときの履歴に出る", async ({ page }) => {
  await openApp(page, [], { created: { cwd: "/tmp/remembered" } });
  await page.locator("[data-test=new-session]").click();
  await page.locator(".dialog input").fill("/tmp/remembered");
  await page.locator("[data-test=submit]").click();
  await expect(page.locator(".dialog")).toHaveCount(0);

  await page.locator("[data-test=new-session]").click();

  await expect(page.locator("[data-test=recent-dir]")).toHaveText(["/tmp/remembered"]);
});

test("履歴を押すと入力欄へ入る", async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem("rostr:recent-dirs", JSON.stringify(["/tmp/one", "/tmp/two"])),
  );
  await openApp(page, []);
  await page.locator("[data-test=new-session]").click();

  await expect(page.locator("[data-test=recent-dir]")).toHaveText(["/tmp/one", "/tmp/two"]);
  await page.locator("[data-test=recent-dir]").nth(1).click();

  await expect(page.locator(".dialog input")).toHaveValue("/tmp/two");
});
