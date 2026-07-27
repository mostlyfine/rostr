// npm/yarn は tarball 内の実行ビットを落とすことがあり、node-pty の spawn-helper が
// 非実行のまま展開されると spawn 時に "posix_spawnp failed." で失敗する。
// postinstall で実行ビットを戻す。
import { chmodSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const prebuilds = join(root, "..", "node_modules", "node-pty", "prebuilds");

if (existsSync(prebuilds)) {
  for (const platform of readdirSync(prebuilds)) {
    const helper = join(prebuilds, platform, "spawn-helper");
    if (existsSync(helper)) {
      chmodSync(helper, 0o755);
    }
  }
}
