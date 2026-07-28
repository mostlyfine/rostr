import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const scriptSource = fileURLToPath(new URL("../../scripts/fix-pty-perms.js", import.meta.url));

let root: string;

/**
 * npm が node-pty を上位へ hoist した配置を作る。
 * rostr 自身の node_modules は作らない——実際の npx / npm install でも作られない。
 */
const layout = (platform: string) => {
  const ptyDir = join(root, "node_modules", "node-pty");
  const helper = join(ptyDir, "prebuilds", platform, "spawn-helper");
  const script = join(root, "node_modules", "rostr", "scripts", "fix-pty-perms.js");

  mkdirSync(join(ptyDir, "prebuilds", platform), { recursive: true });
  writeFileSync(join(ptyDir, "package.json"), JSON.stringify({ name: "node-pty", version: "0.0.0" }));
  writeFileSync(helper, "binary", { mode: 0o644 });
  mkdirSync(join(root, "node_modules", "rostr", "scripts"), { recursive: true });
  copyFileSync(scriptSource, script);

  return { helper, script };
};

const isExecutable = (path: string): boolean => (statSync(path).mode & 0o111) !== 0;

describe("fix-pty-perms", () => {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "rostr-perms-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("hoist された node-pty の spawn-helper にも実行ビットを戻す", () => {
    const { helper, script } = layout("darwin-arm64");
    expect(isExecutable(helper)).toBe(false);

    execFileSync(process.execPath, [script]);

    expect(isExecutable(helper)).toBe(true);
  });

  it("node-pty が見つからない場合は警告を残しつつ正常終了する", () => {
    const script = join(root, "node_modules", "rostr", "scripts", "fix-pty-perms.js");
    mkdirSync(join(root, "node_modules", "rostr", "scripts"), { recursive: true });
    copyFileSync(scriptSource, script);

    const result = spawnSync(process.execPath, [script], { encoding: "utf8" });

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("node-pty");
  });
});
