import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: { "@common": fileURLToPath(new URL("./common", import.meta.url)) },
  },
  test: {
    // クライアントは DOM が要るので jsdom、サーバは node-pty を使うので node。
    projects: [
      {
        extends: true,
        test: { name: "client", include: ["test/client/**/*.test.ts"], environment: "jsdom" },
      },
      {
        extends: true,
        test: { name: "server", include: ["test/server/**/*.test.ts"], environment: "node" },
      },
    ],
  },
});
