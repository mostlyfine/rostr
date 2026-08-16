import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: { jsxImportSource: "hono/jsx/dom" },
  resolve: {
    alias: { "@common": fileURLToPath(new URL("./common", import.meta.url)) },
  },
  test: {
    // クライアントは DOM が要るので jsdom、サーバは node-pty を使うので node。
    projects: [
      {
        extends: true,
        test: { name: "client", include: ["test/client/**/*.test.{ts,tsx}"], environment: "jsdom" },
      },
      {
        extends: true,
        test: { name: "server", include: ["test/server/**/*.test.ts"], environment: "node" },
      },
    ],
  },
});
