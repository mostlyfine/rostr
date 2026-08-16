import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

const serverPort = Number(process.env.PORT ?? 8787);

export default defineConfig({
  // ブラウザで動かすので、JSX は hono/jsx ではなく DOM 版のランタイムへ向ける。
  esbuild: { jsxImportSource: "hono/jsx/dom" },
  resolve: {
    alias: {
      "@common": fileURLToPath(new URL("./common", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: `http://127.0.0.1:${serverPort}` },
      "/ws": { target: `ws://127.0.0.1:${serverPort}`, ws: true },
    },
  },
});
