import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { resolve } from "node:path";
import { execPath } from "node:process";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";

const notifier = resolve(import.meta.dirname, "../../server/hook-notify.mjs");

const runNotifier = (args: string[], input = "", env: NodeJS.ProcessEnv = {}) =>
  new Promise<{ code: number | null; elapsed: number }>((resolveRun, reject) => {
    const started = Date.now();
    const child = spawn(execPath, [notifier, ...args], {
      env: { ...process.env, ...env },
      stdio: ["pipe", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (stderr) reject(new Error(stderr));
      else resolveRun({ code, elapsed: Date.now() - started });
    });
    child.stdin.end(input);
  });

const collectOneHook = async () => {
  let body = "";
  let received!: () => void;
  const requestReceived = new Promise<void>((resolve) => { received = resolve; });
  const server = createServer((req, res) => {
    req.setEncoding("utf8");
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      received();
      res.end();
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as AddressInfo).port;
  return {
    env: { ROSTR_SESSION_ID: "session-1", ROSTR_PORT: String(port) },
    body: () => body,
    requestReceived,
    close: () => new Promise<void>((resolveClose) => server.close(() => resolveClose())),
  };
};

describe("hook-notify", () => {
  it("Copilot の camelCase payload を正規化して POST し、成功で終了する", async () => {
    const hook = await collectOneHook();
    try {
      const result = await runNotifier(
        ["copilot", "preToolUse"],
        JSON.stringify({ toolName: "bash", toolArgs: { command: "npm test" } }),
        hook.env,
      );
      expect(result.code).toBe(0);
      await hook.requestReceived;
      expect(JSON.parse(hook.body())).toEqual({
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_input: { command: "npm test" },
      });
    } finally {
      await hook.close();
    }
  });

  it("Codex の notify 引数を Stop に正規化して POST する", async () => {
    const hook = await collectOneHook();
    try {
      const result = await runNotifier(["codex", JSON.stringify({ type: "agent-turn-complete" })], "", hook.env);
      expect(result.code).toBe(0);
      await hook.requestReceived;
      expect(JSON.parse(hook.body())).toEqual({ hook_event_name: "Stop" });
    } finally {
      await hook.close();
    }
  });

  it("不正な入力でも exit 0 で終了する", async () => {
    await expect(runNotifier(["copilot", "sessionStart"], "not-json")).resolves.toMatchObject({ code: 0 });
  });

  it("localhost の応答を待たずに dispatch して exit 0 にする", async () => {
    let dispatched!: () => void;
    const dispatchedRequest = new Promise<void>((resolve) => { dispatched = resolve; });
    const server = createServer((req) => {
      req.resume();
      req.on("end", dispatched);
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;
    try {
      const result = await runNotifier(
        ["copilot", "agentStop"],
        JSON.stringify({ transcriptPath: "/project/session.jsonl" }),
        { ROSTR_SESSION_ID: "session-1", ROSTR_PORT: String(port) },
      );
      expect(result.code).toBe(0);
      expect(result.elapsed).toBeLessThan(500);
      await dispatchedRequest;
    } finally {
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    }
  });
});
