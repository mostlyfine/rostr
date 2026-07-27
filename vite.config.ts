import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

const serverPort = Number(process.env.PORT ?? 8787);

export default defineConfig({
  plugins: [vue()],
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
