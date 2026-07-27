import { existsSync } from "node:fs";
import express from "express";
import type { Express, Request, Response } from "express";
import type { HookEvent } from "../common/types";
import type { SessionManager } from "./sessions";

/**
 * REST と SSE を提供する Express アプリを作る。WebSocket は index.ts 側で載せる。
 * distDir を渡すと、ビルド済みのフロントエンドも同じポートから配信する。
 */
export const createApp = (manager: SessionManager, distDir?: string): Express => {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/sessions", (_req: Request, res: Response) => {
    res.json(manager.list());
  });

  app.post("/api/sessions", (req: Request, res: Response) => {
    const cwd = req.body?.cwd;
    if (typeof cwd !== "string" || cwd.trim() === "") {
      res.status(400).json({ error: "cwd を指定してください" });
      return;
    }
    try {
      res.status(201).json(manager.create(cwd.trim()));
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.delete("/api/sessions/:id", (req: Request, res: Response) => {
    if (!manager.kill(String(req.params.id))) {
      res.status(404).json({ error: "セッションが見つかりません" });
      return;
    }
    res.status(204).end();
  });

  // hook スクリプトからの通知。ここで失敗を返すと Claude 本体が止まるので常に 204 を返す。
  app.post("/api/hook/:id", (req: Request, res: Response) => {
    const event = req.body as HookEvent | undefined;
    if (event && typeof event.hook_event_name === "string") {
      manager.applyHook(String(req.params.id), event);
    }
    res.status(204).end();
  });

  app.get("/api/events", (_req: Request, res: Response) => {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });

    const send = () => res.write(`data: ${JSON.stringify(manager.list())}\n\n`);
    send();

    const unsubscribe = manager.onChange(send);
    // プロキシに切られないための定期的な空コメント。
    const heartbeat = setInterval(() => res.write(": ping\n\n"), 30_000);

    res.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
      res.end();
    });
  });

  // 開発中は vite が配信するので dist は無い。ビルド済みのときだけ配信する。
  if (distDir && existsSync(distDir)) {
    app.use(express.static(distDir));
  }

  return app;
};
