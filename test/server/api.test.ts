import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { createApp } from "../../server/app";
import { SessionManager } from "../../server/sessions";

const managers: SessionManager[] = [];

const newManager = () => {
  const manager = new SessionManager({
    launch: (_kind, _sessionId) => ({ bin: "/bin/sh", args: [] }),
    supportsHooks: (kind) => kind === "claude",
    port: 0,
    scrollbackChars: 4096,
    // API の形だけを見るテストなので、本番の tmux サーバへセッションを残さない。
    tmux: false,
  });
  managers.push(manager);
  return manager;
};

const setup = () => {
  const manager = newManager();
  const shells = newManager();
  return { manager, shells, app: createApp(manager, shells) };
};

/** JSON を POST する。Hono の app.request は fetch と同じ形の init を取る。 */
const post = (app: Hono, path: string, body?: unknown) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const del = (app: Hono, path: string) => app.request(path, { method: "DELETE" });

/** 応答の本文。Response.json() は unknown なので、テストから読みやすい形に緩める。 */
const json = (res: Response): Promise<any> => res.json();

const waitFor = async (predicate: () => boolean, timeoutMs = 5000) => {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

/**
 * SSE の応答を少しずつ読む。cancel すると読み手が消えるので、サーバ側の購読解除
 * （streamSSE の onAbort）もそこで走る。
 */
const sseReader = (response: Response) => {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  return {
    /** data フレームが count 個たまるまで読み、それまでの全フレームを返す。 */
    async readFrames(count: number): Promise<any[]> {
      while (buffer.split("\n\n").length - 1 < count) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
      }
      return buffer
        .split("\n\n")
        .filter((frame) => frame.startsWith("data: "))
        .map((frame) => JSON.parse(frame.slice("data: ".length)));
    },
    cancel: () => reader.cancel(),
  };
};

afterEach(() => {
  for (const manager of managers.splice(0)) manager.disposeAll();
});

describe("静的ファイルの配信", () => {
  it("dist を渡すと index.html を配信する", async () => {
    const app = createApp(newManager(), newManager(), resolve(import.meta.dirname, "../../dist"));
    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<div id="app">');
  });

  it("dist が無ければ 404 になるだけで落ちない", async () => {
    const { app } = setup();
    const res = await app.request("/");
    expect(res.status).toBe(404);
  });
});

describe("GET /api/sessions", () => {
  it("最初は空配列", async () => {
    const { app } = setup();
    const res = await app.request("/api/sessions");
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual([]);
  });

  it("シェルを開いていなければ shell は false", async () => {
    const { app } = setup();
    await post(app, "/api/sessions", { cwd: "/tmp" });
    const res = await app.request("/api/sessions");
    expect((await json(res))[0].shell).toBe(false);
  });
});

describe("POST /api/sessions", () => {
  it("セッションを作って返す", async () => {
    const { app, manager } = setup();
    const res = await post(app, "/api/sessions", { cwd: "/tmp" });
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.cwd).toBe("/tmp");
    expect(body.state).toBe("idle");
    expect(manager.list()).toHaveLength(1);
  });

  it("Codex を指定すると Codex セッションを作って返す", async () => {
    const { app } = setup();
    const res = await post(app, "/api/sessions", { cwd: "/tmp", agent: "codex" });
    expect(res.status).toBe(201);
    expect((await json(res)).agent).toBe("codex");
  });

  it("未知の agent なら 400 でセッションを作らない", async () => {
    const { app, manager } = setup();
    const res = await post(app, "/api/sessions", { cwd: "/tmp", agent: "unknown" });
    expect(res.status).toBe(400);
    expect(await json(res)).toEqual({ error: "agent が不正です" });
    expect(manager.list()).toEqual([]);
  });

  it("cwd が無ければ 400", async () => {
    const { app } = setup();
    const res = await post(app, "/api/sessions", {});
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBeTruthy();
  });

  it("本文が無くても落ちずに 400", async () => {
    const { app } = setup();
    const res = await post(app, "/api/sessions");
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBeTruthy();
  });

  it("存在しないディレクトリなら 400 とエラーメッセージ", async () => {
    const { app } = setup();
    const res = await post(app, "/api/sessions", { cwd: "/no/such/dir" });
    expect(res.status).toBe(400);
    expect((await json(res)).error).toMatch(/ディレクトリ/);
  });
});

describe("DELETE /api/sessions/:id", () => {
  it("既存セッションを終了する", async () => {
    const { app } = setup();
    const created = await json(await post(app, "/api/sessions", { cwd: "/tmp" }));
    const res = await del(app, `/api/sessions/${created.id}`);
    expect(res.status).toBe(204);
  });

  it("未知の id なら 404", async () => {
    const { app } = setup();
    const res = await del(app, "/api/sessions/unknown");
    expect(res.status).toBe(404);
  });
});

describe("/api/sessions/:id/shell", () => {
  const createSession = async (app: Hono) => {
    const res = await post(app, "/api/sessions", { cwd: "/tmp" });
    return (await json(res)).id as string;
  };

  it("親と同じ id・同じ cwd でシェルを起動する", async () => {
    const { app, shells } = setup();
    const id = await createSession(app);

    const res = await post(app, `/api/sessions/${id}/shell`);

    expect(res.status).toBe(201);
    expect(shells.get(id)?.cwd).toBe("/tmp");
  });

  it("シェルを開くと一覧の shell が true になる", async () => {
    const { app } = setup();
    const id = await createSession(app);
    await post(app, `/api/sessions/${id}/shell`);
    const res = await app.request("/api/sessions");
    expect((await json(res))[0].shell).toBe(true);
  });

  it("既に開いていれば二重に起動せず 204", async () => {
    const { app, shells } = setup();
    const id = await createSession(app);
    await post(app, `/api/sessions/${id}/shell`);

    const res = await post(app, `/api/sessions/${id}/shell`);

    expect(res.status).toBe(204);
    expect(shells.list()).toHaveLength(1);
  });

  it("親セッションが無ければ 404", async () => {
    const { app } = setup();
    const res = await post(app, "/api/sessions/unknown/shell");
    expect(res.status).toBe(404);
  });

  it("DELETE でシェルを終了する", async () => {
    const { app, shells } = setup();
    const id = await createSession(app);
    await post(app, `/api/sessions/${id}/shell`);

    const res = await del(app, `/api/sessions/${id}/shell`);

    expect(res.status).toBe(204);
    // 一覧から消えるのはプロセスが終わってから。
    await waitFor(() => shells.get(id) === undefined);
    expect(shells.list()).toEqual([]);
  });

  it("開いていないシェルの DELETE は 404", async () => {
    const { app } = setup();
    const id = await createSession(app);
    const res = await del(app, `/api/sessions/${id}/shell`);
    expect(res.status).toBe(404);
  });
});

describe("POST /api/hook/:id", () => {
  it("hook イベントで状態が変わる", async () => {
    const { app, manager } = setup();
    const created = await json(await post(app, "/api/sessions", { cwd: "/tmp" }));
    const res = await post(app, `/api/hook/${created.id}`, {
      hook_event_name: "UserPromptSubmit",
      prompt: "こんにちは",
    });
    expect(res.status).toBe(204);
    expect(manager.get(created.id)?.state).toBe("working");
    expect(manager.get(created.id)?.prompt).toBe("こんにちは");
  });

  it("未知の id でも 204 を返す（hook を失敗させない）", async () => {
    const { app } = setup();
    const res = await post(app, "/api/hook/unknown", { hook_event_name: "Stop" });
    expect(res.status).toBe(204);
  });
});

describe("GET /api/events", () => {
  it("接続直後に現在の一覧を送り、変化のたびに追加で送る", async () => {
    const { app, manager } = setup();
    manager.create("/tmp");

    const reader = sseReader(await app.request("/api/events"));
    try {
      const [first] = await reader.readFrames(1);
      expect(first).toHaveLength(1);
      expect(first[0].cwd).toBe("/tmp");

      manager.create("/tmp");
      const frames = await reader.readFrames(2);
      expect(frames[1]).toHaveLength(2);
    } finally {
      await reader.cancel();
    }
  });

  it("シェルを開いても配り直す", async () => {
    const { app, manager, shells } = setup();
    const session = manager.create("/tmp");

    const reader = sseReader(await app.request("/api/events"));
    try {
      const [first] = await reader.readFrames(1);
      expect(first[0].shell).toBe(false);

      shells.createWithId("/tmp", session.id);
      const frames = await reader.readFrames(2);
      expect(frames[1][0].shell).toBe(true);
    } finally {
      await reader.cancel();
    }
  });
});
