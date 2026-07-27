import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../server/app";
import { SessionManager } from "../../server/sessions";

const managers: SessionManager[] = [];

const setup = () => {
  const manager = new SessionManager({
    agentBin: "/bin/sh",
    buildArgs: () => [],
    port: 0,
    scrollbackChars: 4096,
  });
  managers.push(manager);
  return { manager, app: createApp(manager) };
};

afterEach(() => {
  for (const manager of managers.splice(0)) manager.disposeAll();
});

describe("静的ファイルの配信", () => {
  it("dist を渡すと index.html を配信する", async () => {
    const manager = new SessionManager({ agentBin: "/bin/sh", buildArgs: () => [], port: 0 });
    managers.push(manager);
    const app = createApp(manager, resolve(import.meta.dirname, "../../dist"));
    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.text).toContain("<div id=\"app\">");
  });

  it("dist が無ければ 404 になるだけで落ちない", async () => {
    const { app } = setup();
    const res = await request(app).get("/");
    expect(res.status).toBe(404);
  });
});

describe("GET /api/sessions", () => {
  it("最初は空配列", async () => {
    const { app } = setup();
    const res = await request(app).get("/api/sessions");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe("POST /api/sessions", () => {
  it("セッションを作って返す", async () => {
    const { app, manager } = setup();
    const res = await request(app).post("/api/sessions").send({ cwd: "/tmp" });
    expect(res.status).toBe(201);
    expect(res.body.cwd).toBe("/tmp");
    expect(res.body.state).toBe("idle");
    expect(manager.list()).toHaveLength(1);
  });

  it("cwd が無ければ 400", async () => {
    const { app } = setup();
    const res = await request(app).post("/api/sessions").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it("存在しないディレクトリなら 400 とエラーメッセージ", async () => {
    const { app } = setup();
    const res = await request(app).post("/api/sessions").send({ cwd: "/no/such/dir" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/ディレクトリ/);
  });
});

describe("DELETE /api/sessions/:id", () => {
  it("既存セッションを終了する", async () => {
    const { app } = setup();
    const created = await request(app).post("/api/sessions").send({ cwd: "/tmp" });
    const res = await request(app).delete(`/api/sessions/${created.body.id}`);
    expect(res.status).toBe(204);
  });

  it("未知の id なら 404", async () => {
    const { app } = setup();
    const res = await request(app).delete("/api/sessions/unknown");
    expect(res.status).toBe(404);
  });
});

describe("POST /api/hook/:id", () => {
  it("hook イベントで状態が変わる", async () => {
    const { app, manager } = setup();
    const created = await request(app).post("/api/sessions").send({ cwd: "/tmp" });
    const res = await request(app)
      .post(`/api/hook/${created.body.id}`)
      .send({ hook_event_name: "UserPromptSubmit", prompt: "こんにちは" });
    expect(res.status).toBe(204);
    expect(manager.get(created.body.id)?.state).toBe("working");
    expect(manager.get(created.body.id)?.prompt).toBe("こんにちは");
  });

  it("未知の id でも 204 を返す（hook を失敗させない）", async () => {
    const { app } = setup();
    const res = await request(app).post("/api/hook/unknown").send({ hook_event_name: "Stop" });
    expect(res.status).toBe(204);
  });
});

describe("GET /api/events", () => {
  it("接続直後に現在の一覧を送り、変化のたびに追加で送る", async () => {
    const { app, manager } = setup();
    manager.create("/tmp");

    const server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    const port = (server.address() as AddressInfo).port;
    const controller = new AbortController();

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/events`, { signal: controller.signal });
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const readUntilFrames = async (count: number) => {
        while (buffer.split("\n\n").length - 1 < count) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
        }
        return buffer
          .split("\n\n")
          .filter((frame) => frame.startsWith("data: "))
          .map((frame) => JSON.parse(frame.slice("data: ".length)));
      };

      const [first] = await readUntilFrames(1);
      expect(first).toHaveLength(1);
      expect(first[0].cwd).toBe("/tmp");

      manager.create("/tmp");
      const frames = await readUntilFrames(2);
      expect(frames[1]).toHaveLength(2);
    } finally {
      controller.abort();
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
