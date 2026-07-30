import { existsSync } from "node:fs";
import express from "express";
import type { Express, Request, Response } from "express";
import { errorMessage } from "../common/error";
import type { HookEvent, SessionView } from "../common/types";
import type { SessionManager } from "./sessions";

/**
 * REST と SSE を提供する Express アプリを作る。WebSocket は index.ts 側で載せる。
 * shells はスプリットで開くシェルの管理者で、親エージェントと同じ id でセッションを持つ。
 * distDir を渡すと、ビルド済みのフロントエンドも同じポートから配信する。
 */
export const createApp = (
  manager: SessionManager,
  shells: SessionManager,
  distDir?: string,
): Express => {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  /** クライアントへ配る一覧。スプリットの開閉はシェルが居るかどうかで表す。 */
  const listView = (): SessionView[] =>
    manager.list().map((session) => ({ ...session, shell: shells.get(session.id) !== undefined }));

  /**
   * SSE で一覧を待っている接続。変化 1 回につき本文を 1 度だけ組み立てて全員へ配る。
   * 接続ごとに購読すると、タブの数だけ同じ一覧と JSON を作り直すことになる。
   */
  const streams = new Set<Response>();
  const broadcast = () => {
    if (streams.size === 0) return;
    const frame = `data: ${JSON.stringify(listView())}\n\n`;
    for (const stream of streams) stream.write(frame);
  };
  // シェルの開閉も一覧の内容（shell フラグ）を変えるので、両方を購読する。
  manager.onChange(broadcast);
  shells.onChange(broadcast);

  app.get("/api/sessions", (_req: Request, res: Response) => {
    res.json(listView());
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
      res.status(400).json({ error: errorMessage(error) });
    }
  });

  app.delete("/api/sessions/:id", (req: Request, res: Response) => {
    if (!manager.kill(String(req.params.id))) {
      res.status(404).json({ error: "セッションが見つかりません" });
      return;
    }
    res.status(204).end();
  });

  app.post("/api/sessions/:id/shell", (req: Request, res: Response) => {
    const id = String(req.params.id);
    const session = manager.get(id);
    if (!session) {
      res.status(404).json({ error: "セッションが見つかりません" });
      return;
    }
    // 開き直しを押しても増えないよう、既に居れば何もしない。
    if (shells.get(id)) {
      res.status(204).end();
      return;
    }
    try {
      shells.create(session.cwd, id);
      res.status(201).end();
    } catch (error) {
      res.status(400).json({ error: errorMessage(error) });
    }
  });

  app.delete("/api/sessions/:id/shell", (req: Request, res: Response) => {
    if (!shells.kill(String(req.params.id))) {
      res.status(404).json({ error: "シェルが見つかりません" });
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

    res.write(`data: ${JSON.stringify(listView())}\n\n`);
    streams.add(res);

    // プロキシに切られないための定期的な空コメント。
    const heartbeat = setInterval(() => res.write(": ping\n\n"), 30_000);

    res.on("close", () => {
      clearInterval(heartbeat);
      streams.delete(res);
      res.end();
    });
  });

  // 開発中は vite が配信するので dist は無い。ビルド済みのときだけ配信する。
  if (distDir && existsSync(distDir)) {
    app.use(express.static(distDir));
  }

  return app;
};
