import { defineConfig, devices } from "@playwright/test";

/**
 * 画面の挙動を固定するための E2E。サーバは起動せず、SSE・REST・WebSocket はすべて
 * ブラウザ側で差し替える（test/e2e/fixtures.ts）。tmux も claude も要らず、結果は決定的になる。
 * dev サーバの既定ポートとぶつからないよう 5174 を使う。
 */
export default defineConfig({
  testDir: "./test/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:5174",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npx vite --host 127.0.0.1 --port 5174 --strictPort",
    url: "http://127.0.0.1:5174",
    reuseExistingServer: !process.env.CI,
    stdout: "ignore",
  },
});
