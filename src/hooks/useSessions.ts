import { useEffect, useState } from "hono/jsx/dom";
import type { AgentKind } from "../../common/agents";
import type { Session, SessionView } from "../../common/types";

/** 張り直すまでの間隔。サーバの再起動が終わる程度には待ち、人が気づく前には戻る長さ。 */
const RECONNECT_MS = 1_000;

/** 起動に失敗した場合はサーバのエラーメッセージを throw する。 */
const create = async (cwd: string, agent: AgentKind): Promise<Session> => {
  const res = await fetch("/api/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cwd, agent }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error ?? "Failed to launch");
  return body as Session;
};

const close = async (id: string): Promise<void> => {
  await fetch(`/api/sessions/${id}`, { method: "DELETE" });
};

/** スプリットのシェルを開く。開閉の状態は SSE で配られる shell フラグが持つ。 */
const openShell = async (id: string): Promise<void> => {
  const res = await fetch(`/api/sessions/${id}/shell`, { method: "POST" });
  if (res.ok) return;
  const body = await res.json().catch(() => null);
  throw new Error(body?.error ?? "Failed to open shell");
};

const closeShell = async (id: string): Promise<void> => {
  await fetch(`/api/sessions/${id}/shell`, { method: "DELETE" });
};

/** サーバの一覧を SSE で購読し、操作用の API 呼び出しをまとめる。 */
export const useSessions = () => {
  const [sessions, setSessions] = useState<SessionView[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let source: EventSource | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const connect = () => {
      source = new EventSource("/api/events");

      source.onmessage = (event) => {
        setSessions(JSON.parse(event.data) as SessionView[]);
        setConnected(true);
      };

      /*
       * 落ちただけの接続はブラウザが自分で繋ぎ直すので、こちらは何もしない。
       * 手を出すのは CLOSED になったときだけ。繋ぎ直した先が SSE として不正な応答
       * ——サーバ再起動中に開発プロキシが返す 500 など——を返すとブラウザは打ち切ってしまい、
       * 以降サーバが戻っても一覧が二度と更新されない。状態も実行内容も古いまま固まる。
       */
      source.onerror = () => {
        setConnected(false);
        if (source?.readyState !== EventSource.CLOSED) return;
        source.close();
        source = undefined;
        if (stopped) return;
        retryTimer = setTimeout(connect, RECONNECT_MS);
      };
    };

    connect();

    return () => {
      stopped = true;
      clearTimeout(retryTimer);
      source?.close();
    };
  }, []);

  return { sessions, connected, create, close, openShell, closeShell };
};
