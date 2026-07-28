// Claude Code の hook から起動され、stdin に来た JSON をそのまま rostr サーバへ転送する。
// hook が非ゼロで終了すると Claude 本体の動作を妨げるため、何が起きても exit 0 で終わる。
const sessionId = process.env.ROSTR_SESSION_ID;
const port = process.env.ROSTR_PORT;

const readStdin = async () => {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
};

try {
  if (sessionId && port) {
    const body = await readStdin();
    await fetch(`http://127.0.0.1:${port}/api/hook/${sessionId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body || "{}",
      signal: AbortSignal.timeout(1000),
    });
  }
} catch {
  // サーバが落ちていても Claude の実行は続けさせる。
}

process.exit(0);
