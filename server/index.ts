import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import type { ClientMessage } from "../common/types";
import { createApp } from "./app";
import { writeHookSettings } from "./hookSettings";
import { SessionManager } from "./sessions";
import { createSummarizerFromEnv } from "./summary";

const here = dirname(fileURLToPath(import.meta.url));
const notifyScriptPath = join(here, "hook-notify.mjs");

const port = Number(process.env.PORT ?? 8787);
const agentBin = process.env.CLAUDE_BIN ?? "claude";
const { summarizer, model: summaryModel } = createSummarizerFromEnv(agentBin);

const manager = new SessionManager({
  agentBin,
  buildArgs: (sessionId) => [
    "--session-id",
    sessionId,
    // ユーザー自身の設定は残したまま、状態通知用の hook だけを追加で読ませる。
    "--settings",
    writeHookSettings(sessionId, notifyScriptPath),
  ],
  port,
  summarizer,
});

const app = createApp(manager, join(here, "..", "dist"));
const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname !== "/ws") {
    socket.destroy();
    return;
  }
  const sessionId = url.searchParams.get("session");
  if (!sessionId || !manager.get(sessionId)) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => attach(ws, sessionId));
});

/** WebSocket と PTY を双方向につなぐ。 */
const attach = (ws: WebSocket, sessionId: string) => {
  // 途中から接続したブラウザにも直前までの画面を見せる。
  // スクロールバックは末尾しか残らず、tmux が attach 直後に一度だけ送る端末モード
  // ——代替画面・bracketed paste・SGR マウス報告——は早々に切り捨てられる。
  // 落ちたままだとホイールがマウスイベントとして tmux へ届かず、copy-mode に入れない。
  // 画面を描き直す前に端末をその状態へ戻しておく。
  const replay = manager.terminalModes(sessionId) + manager.scrollback(sessionId);
  if (replay) ws.send(replay);

  const unsubscribeOutput = manager.onOutput(sessionId, (data) => {
    if (ws.readyState === ws.OPEN) ws.send(data);
  });

  // セッションが消えたら接続も閉じる。
  const unsubscribeChange = manager.onChange(() => {
    if (!manager.get(sessionId)) ws.close();
  });

  ws.on("message", (raw) => {
    let message: ClientMessage;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (message.type === "input") {
      manager.write(sessionId, message.data);
    } else if (message.type === "resize") {
      manager.resize(sessionId, message.cols, message.rows);
    }
  });

  ws.on("close", () => {
    unsubscribeOutput();
    unsubscribeChange();
  });
};

const shutdown = () => {
  manager.disposeAll();
  if (manager.tmuxEnabled) {
    console.log("tmux セッションから切り離しました。エージェントは動き続けます。");
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// 前回のサーバが残した tmux セッションを拾い直してから待ち受ける。
const recovered = manager.recover();
if (recovered > 0) console.log(`tmux から ${recovered} 件のセッションを復元しました`);

server.listen(port, () => {
  const tmuxState = manager.tmuxEnabled ? "on" : "off";
  console.log(
    `rostr server listening on http://127.0.0.1:${port} (agent: ${agentBin}, tmux: ${tmuxState}, summary: ${summaryModel})`,
  );
});
