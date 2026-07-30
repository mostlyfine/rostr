import type { Page } from "@playwright/test";
import type { Session, SessionView } from "../../common/types";

/** 一覧に載る 1 件。test/client/app.test.ts の session() と同じ形にしてある。 */
export const sessionView = (over: Partial<SessionView> = {}): SessionView => ({
  id: "id",
  cwd: "/tmp/proj",
  title: "proj",
  state: "idle",
  prompt: "",
  activity: "",
  summary: "",
  createdAt: 0,
  updatedAt: 0,
  shell: false,
  ...over,
});

export interface ApiCall {
  method: string;
  path: string;
  body: unknown;
}

/** REST の応答を差し替えるための指定。省略した口は既定の成功応答を返す。 */
export interface ApiOverrides {
  /** POST /api/sessions を失敗させる。ここに入れた文字列がそのままダイアログに出る。 */
  createError?: string;
  created?: Partial<Session>;
}

export interface Backend {
  /** SSE の 1 フレームを配る。サーバが一覧を配り直した状況になる。 */
  push(sessions: SessionView[]): Promise<void>;
  calls: ApiCall[];
  /** ブラウザが WebSocket へ送ったメッセージ。 */
  wsSent: string[];
  /** 開いている WebSocket からブラウザへ出力を流す。 */
  wsSend(data: string): void;
}

/**
 * SSE・REST・WebSocket をブラウザ側で差し替える。
 *
 * SSE だけは page.route ではなく EventSource の差し替えで行う。route.fulfill は本文を
 * 一度に返しきる API なので、テストの好きなタイミングでフレームを足せないため。
 */
export const mockBackend = async (page: Page, overrides: ApiOverrides = {}): Promise<Backend> => {
  const calls: ApiCall[] = [];
  const wsSent: string[] = [];
  let wsSend: (data: string) => void = () => {};

  await page.addInitScript(() => {
    const sources: { onmessage: ((event: { data: string }) => void) | null }[] = [];
    class FakeEventSource {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSED = 2;
      readonly url: string;
      readyState = FakeEventSource.OPEN;
      onmessage: ((event: { data: string }) => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(url: string) {
        this.url = url;
        sources.push(this);
      }
      close() {
        this.readyState = FakeEventSource.CLOSED;
      }
      addEventListener() {}
      removeEventListener() {}
    }
    (window as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
    (window as unknown as { __rostrPush: (data: string) => void }).__rostrPush = (data) => {
      for (const source of sources) source.onmessage?.({ data });
    };
  });

  await page.routeWebSocket(/\/ws\?/, (ws) => {
    // 実サーバへは繋がず、この関数自身がサーバとして振る舞う。
    wsSend = (data: string) => ws.send(data);
    ws.onMessage((message) => wsSent.push(String(message)));
  });

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    calls.push({ method, path: url.pathname, body: request.postDataJSON?.() ?? null });

    if (method === "POST" && url.pathname === "/api/sessions") {
      if (overrides.createError) {
        await route.fulfill({ status: 400, json: { error: overrides.createError } });
        return;
      }
      const created: Session = {
        id: "created",
        cwd: "/tmp/created",
        title: "created",
        state: "idle",
        prompt: "",
        activity: "",
        summary: "",
        createdAt: 0,
        updatedAt: 0,
        ...overrides.created,
      };
      await route.fulfill({ status: 201, json: created });
      return;
    }

    if (method === "POST") {
      await route.fulfill({ status: 201, body: "" });
      return;
    }
    await route.fulfill({ status: 204, body: "" });
  });

  const push = async (sessions: SessionView[]) => {
    await page.evaluate(
      (data) => (window as unknown as { __rostrPush: (d: string) => void }).__rostrPush(data),
      JSON.stringify(sessions),
    );
  };

  return { push, calls, wsSent, wsSend: (data: string) => wsSend(data) };
};

export const openApp = async (
  page: Page,
  sessions: SessionView[],
  overrides: ApiOverrides = {},
): Promise<Backend> => {
  const backend = await mockBackend(page, overrides);
  await page.goto("/");
  await backend.push(sessions);
  return backend;
};
