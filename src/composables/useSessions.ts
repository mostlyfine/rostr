import { onUnmounted, ref } from "vue";
import type { Session } from "../../common/types";

/** サーバの一覧を SSE で購読し、操作用の API 呼び出しをまとめる。 */
export const useSessions = () => {
  const sessions = ref<Session[]>([]);
  const connected = ref(false);

  const source = new EventSource("/api/events");
  source.onmessage = (event) => {
    sessions.value = JSON.parse(event.data) as Session[];
    connected.value = true;
  };
  source.onerror = () => {
    connected.value = false;
  };

  onUnmounted(() => source.close());

  /** 起動に失敗した場合はサーバのエラーメッセージを throw する。 */
  const create = async (cwd: string): Promise<Session> => {
    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cwd }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body?.error ?? "起動に失敗しました");
    return body as Session;
  };

  const close = async (id: string): Promise<void> => {
    await fetch(`/api/sessions/${id}`, { method: "DELETE" });
  };

  return { sessions, connected, create, close };
};
