import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import { PANE_KIND_PARAM, isPaneKind, type ClientMessage, type PaneKind } from "../common/types";
import { createApp } from "./app";
import { writeHookSettings } from "./hookSettings";
import { SessionManager } from "./sessions";
import { createSummarizerFromEnv } from "./summary";
import { DEFAULT_TMUX_SOCKET, SHELL_TMUX_PREFIX, readTmuxSessionList } from "./tmux";

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
    writeHookSettings(notifyScriptPath),
  ],
  port,
  summarizer,
});

/**
 * スプリットで開くシェル。エージェントと同じ仕組みで動かし、起動するバイナリと
 * tmux セッション名の前置きだけを差し替える。id は親エージェントと共有する。
 */
const shells = new SessionManager({
  agentBin: process.env.ROSTR_SHELL ?? process.env.SHELL ?? "/bin/bash",
  buildArgs: () => [],
  port,
  tmuxPrefix: SHELL_TMUX_PREFIX,
});

/** ペイン種別ごとの管理者。WebSocket はクエリの kind でこの表を引く。 */
const managers: Record<PaneKind, SessionManager> = { agent: manager, shell: shells };

manager.onChange((removedId) => {
  if (removedId !== undefined) shells.kill(removedId);
});

const app = createApp(manager, shells, join(here, "..", "dist"));
const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname !== "/ws") {
    socket.destroy();
    return;
  }
  const sessionId = url.searchParams.get("session");
  // スプリットで開いたシェルは同じ id を別の管理者が持つので、kind で振り分ける。
  const kind = url.searchParams.get(PANE_KIND_PARAM);
  const target = managers[isPaneKind(kind) ? kind : "agent"];
  if (!sessionId || !target.get(sessionId)) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => attach(ws, target, sessionId));
});

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
// エージェントとシェルは同じソケットを名前の前置きで分けているだけなので、
// list-sessions は 1 回だけ引いて両方へ配る。
const tmuxSessions = manager.tmuxEnabled ? readTmuxSessionList(DEFAULT_TMUX_SOCKET) : "";
const recovered = manager.recover(tmuxSessions);
if (recovered > 0) console.log(`tmux から ${recovered} 件のセッションを復元しました`);

// 脇に開いていたシェルも同じく拾い直す。id が親と同じなので対応づけはそれだけで済む。
const recoveredShells = shells.recover(tmuxSessions);
if (recoveredShells > 0) console.log(`tmux から ${recoveredShells} 件のシェルを復元しました`);

server.listen(port, () => {
  const tmuxState = manager.tmuxEnabled ? "on" : "off";
  console.log(
    `rostr server listening on http://127.0.0.1:${port} (agent: ${agentBin}, tmux: ${tmuxState}, summary: ${summaryModel})`,
  );
});
