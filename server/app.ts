import { existsSync } from "node:fs";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { isAgentKind } from "../common/agents";
import type { HookEvent, SessionView } from "../common/types";
import type { SessionManager } from "./sessions";

/** 本文が無い・JSON として壊れている場合は null。呼び手が普段どおり 400 を返せるようにする。 */
const readJson = async (c: Context): Promise<Record<string, unknown> | null> => {
  const body: unknown = await c.req.json().catch(() => null);
  return typeof body === "object" && body !== null ? (body as Record<string, unknown>) : null;
};

/**
 * REST と SSE を提供する Hono アプリを作る。WebSocket は index.ts 側で載せる。
 * shells はスプリットで開くシェルの管理者で、親エージェントと同じ id でセッションを持つ。
 * distDir を渡すと、ビルド済みのフロントエンドも同じポートから配信する。
 */
export const createApp = (
  manager: SessionManager,
  shells: SessionManager,
  distDir?: string,
): Hono => {
  const app = new Hono();

  /** クライアントへ配る一覧。スプリットの開閉はシェルが居るかどうかで表す。 */
  const listView = (): SessionView[] =>
    manager.list().map((session) => ({ ...session, shell: shells.get(session.id) !== undefined }));

  app.get("/api/sessions", (c) => c.json(listView()));

  app.post("/api/sessions", async (c) => {
    const body = await readJson(c);
    const cwd = body?.cwd;
    if (typeof cwd !== "string" || cwd.trim() === "") {
      return c.json({ error: "cwd を指定してください" }, 400);
    }
    const suppliedAgent = body?.agent;
    const agent = suppliedAgent === undefined ? "claude" : suppliedAgent;
    if (!isAgentKind(agent)) {
      return c.json({ error: "agent が不正です" }, 400);
    }
    try {
      return c.json(manager.create(cwd.trim(), agent), 201);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.delete("/api/sessions/:id", (c) => {
    if (!manager.kill(c.req.param("id"))) {
      return c.json({ error: "セッションが見つかりません" }, 404);
    }
    return c.body(null, 204);
  });

  // スプリットで開くシェル。id はセッションと共有し、cwd もセッションのものをそのまま使う。
  app.post("/api/sessions/:id/shell", (c) => {
    const id = c.req.param("id");
    const session = manager.get(id);
    if (!session) {
      return c.json({ error: "セッションが見つかりません" }, 404);
    }
    // 開き直しを押しても増えないよう、既に居れば何もしない。
    if (shells.get(id)) {
      return c.body(null, 204);
    }
    try {
      shells.createWithId(session.cwd, id);
      return c.body(null, 201);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.delete("/api/sessions/:id/shell", (c) => {
    if (!shells.kill(c.req.param("id"))) {
      return c.json({ error: "シェルが見つかりません" }, 404);
    }
    return c.body(null, 204);
  });

  // hook スクリプトからの通知。ここで失敗を返すと Claude 本体が止まるので常に 204 を返す。
  app.post("/api/hook/:id", async (c) => {
    const event = (await readJson(c)) as HookEvent | null;
    if (event && typeof event.hook_event_name === "string") {
      manager.applyHook(c.req.param("id"), event);
    }
    return c.body(null, 204);
  });

  app.get("/api/events", (c) => {
    c.header("x-accel-buffering", "no");
    return streamSSE(c, async (stream) => {
      const send = () => void stream.writeSSE({ data: JSON.stringify(listView()) });
      send();

      // シェルの開閉も一覧の内容（shell フラグ）を変えるので、両方を購読する。
      const unsubscribe = manager.onChange(send);
      const unsubscribeShells = shells.onChange(send);
      // プロキシに切られないための定期的な空コメント。
      const heartbeat = setInterval(() => void stream.write(": ping\n\n"), 30_000);

      // このコールバックが解決するとストリームが閉じるので、切断されるまで待ち続ける。
      await new Promise<void>((resolve) => {
        stream.onAbort(() => {
          clearInterval(heartbeat);
          unsubscribe();
          unsubscribeShells();
          resolve();
        });
      });
    });
  });

  // 開発中は vite が配信するので dist は無い。ビルド済みのときだけ配信する。
  if (distDir && existsSync(distDir)) {
    app.use("*", serveStatic({ root: distDir }));
  }

  return app;
};
