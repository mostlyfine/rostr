import { dirname, join } from "node:path";
import { createAdaptorServer } from "@hono/node-server";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import type { ClientMessage } from "../common/types";
import { createAgentRegistry } from "./agents";
import { createApp } from "./app";
import { SessionManager } from "./sessions";
import { createSummarizerFromEnv } from "./summary";
import { SHELL_TMUX_PREFIX } from "./tmux";

const here = dirname(fileURLToPath(import.meta.url));
const notifyScriptPath = join(here, "hook-notify.mjs");

const port = Number(process.env.PORT ?? 8787);
const agents = createAgentRegistry(process.env, notifyScriptPath);
const agentBin = agents.bin("claude");
const { summarizer, model: summaryModel } = createSummarizerFromEnv(agentBin);

const manager = new SessionManager({
  launch: agents.launch,
  supportsHooks: agents.supportsHooks,
  supportsHookEvent: agents.supportsHookEvent,
  supportsSummary: agents.supportsSummary,
  port,
  summarizer,
});

/**
 * スプリットで開くシェル。エージェントと同じ仕組みで動かし、起動するバイナリと
 * tmux セッション名の前置きだけを差し替える。id は親エージェントと共有する。
 */
const shells = new SessionManager({
  launch: (kind) => ({
    bin: process.env.ROSTR_SHELL ?? process.env.SHELL ?? "/bin/bash",
    args: [],
  }),
  supportsHooks: () => false,
  supportsSummary: () => false,
  port,
  tmuxPrefix: SHELL_TMUX_PREFIX,
});

// エージェントが終わったら、その脇で開いていたシェルも畳む。
manager.onChange(() => {
  for (const shell of shells.list()) {
    if (!manager.get(shell.id)) shells.kill(shell.id);
  }
});

const app = createApp(manager, shells, join(here, "..", "dist"));
// serve() は即 listen してしまうので、upgrade ハンドラを張ってから自分で listen する。
const server = createAdaptorServer({ fetch: app.fetch });
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname !== "/ws") {
    socket.destroy();
    return;
  }
  const sessionId = url.searchParams.get("session");
  // スプリットで開いたシェルは同じ id を別の管理者が持つので、kind で振り分ける。
  const target = url.searchParams.get("kind") === "shell" ? shells : manager;
  if (!sessionId || !target.get(sessionId)) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => attach(ws, target, sessionId));
});

/** WebSocket と PTY を双方向につなぐ。 */
const attach = (ws: WebSocket, target: SessionManager, sessionId: string) => {
  // 途中から接続したブラウザにも直前までの画面を見せる。
  // スクロールバックは末尾しか残らず、tmux が attach 直後に一度だけ送る端末モード
  // ——代替画面・bracketed paste・SGR マウス報告——は早々に切り捨てられる。
  // 落ちたままだと画面が壊れ、ブラウザは tmux がマウスを欲しがっていることも知れずに
  // ホイールを送らなくなる。画面を描き直す前に端末をその状態へ戻しておく。
  const replay = target.terminalModes(sessionId) + target.scrollback(sessionId);
  if (replay) ws.send(replay);

  const unsubscribeOutput = target.onOutput(sessionId, (data) => {
    if (ws.readyState === ws.OPEN) ws.send(data);
  });

  // セッションが消えたら接続も閉じる。
  const unsubscribeChange = target.onChange(() => {
    if (!target.get(sessionId)) ws.close();
  });

  ws.on("message", (raw) => {
    let message: ClientMessage;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (message.type === "input") {
      target.write(sessionId, message.data);
    } else if (message.type === "resize") {
      target.resize(sessionId, message.cols, message.rows);
    }
  });

  ws.on("close", () => {
    unsubscribeOutput();
    unsubscribeChange();
  });
};

const shutdown = () => {
  manager.disposeAll();
  shells.disposeAll();
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

// 脇に開いていたシェルも同じく拾い直す。id が親と同じなので対応づけはそれだけで済む。
const recoveredShells = shells.recover();
if (recoveredShells > 0) console.log(`tmux から ${recoveredShells} 件のシェルを復元しました`);

server.listen(port, () => {
  const tmuxState = manager.tmuxEnabled ? "on" : "off";
  console.log(
    `rostr server listening on http://127.0.0.1:${port} (agent: ${agentBin}, tmux: ${tmuxState}, summary: ${summaryModel})`,
  );
});
