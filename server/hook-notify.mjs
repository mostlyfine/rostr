import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { normalizeProviderEvent } from "./providerEvents.mjs";

// provider hook から起動され、正規化した JSON を rostr サーバへ転送する。
// hook が非ゼロで終了するとエージェント本体の動作を妨げるため、何が起きても exit 0 で終わる。
const dispatch = async (url, body) => {
  try {
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      signal: AbortSignal.timeout(1000),
    });
  } catch {
    // サーバが落ちていても provider の実行は続けさせる。
  }
};

if (process.argv[2] === "--dispatch") {
  await dispatch(process.argv[3], process.argv[4]);
  process.exit(0);
}

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
    const worker = spawn(process.execPath, [
      fileURLToPath(import.meta.url),
      "--dispatch",
      `http://127.0.0.1:${port}/api/hook/${sessionId}`,
      JSON.stringify(event),
    ], {
      detached: true,
      stdio: "ignore",
    });
    worker.unref();
  }
} catch {
  // 何が起きても provider の実行は続けさせる。
}

process.exit(0);
