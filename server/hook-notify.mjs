import { normalizeProviderEvent } from "./providerEvents.mjs";

// provider hook から起動され、正規化した JSON を rostr サーバへ転送する。
// hook が非ゼロで終了するとエージェント本体の動作を妨げるため、何が起きても exit 0 で終わる。
const sessionId = process.env.ROSTR_SESSION_ID;
const port = process.env.ROSTR_PORT;
const provider = process.argv[2] ?? "claude";
const eventName = provider === "copilot" ? process.argv[3] : undefined;

const readStdin = async () => {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
};

try {
  if (sessionId && port) {
    const input = provider === "codex" ? process.argv[3] ?? "" : await readStdin();
    const payload = JSON.parse(input || "{}");
    const event = provider === "claude" ? payload : normalizeProviderEvent(provider, payload, eventName);
    if (!event) process.exit(0);
    await fetch(`http://127.0.0.1:${port}/api/hook/${sessionId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(1000),
    });
  }
} catch {
  // サーバが落ちていても Claude の実行は続けさせる。
}

process.exit(0);
