#!/usr/bin/env node
import { spawn } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = fileURLToPath(new URL("..", import.meta.url));
const serverEntry = join(pkgRoot, "server", "index.ts");

// ベア指定子は --import 時に process.cwd() 基準で解決されるため、
// 呼び出し側の CWD に関係なく解決できるよう絶対パス化する。
const tsxLoader = import.meta.resolve("tsx");

const child = spawn(process.execPath, ["--import", tsxLoader, serverEntry], {
  stdio: "inherit",
  env: process.env,
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    if (child.exitCode === null && child.signalCode === null) child.kill(sig);
  });
}

child.on("error", (err) => {
  console.error(err);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exitCode = code ?? 0;
  }
});
