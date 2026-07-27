import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: { "@common": fileURLToPath(new URL("./common", import.meta.url)) },
  },
  test: {
    include: ["test/**/*.test.ts"],
    // クライアントは DOM が要るので jsdom、サーバは node-pty を使うので node。
    environmentMatchGlobs: [
      ["test/client/**", "jsdom"],
      ["test/server/**", "node"],
    ],
  },
});
