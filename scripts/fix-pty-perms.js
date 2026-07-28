// npm/yarn は tarball 内の実行ビットを落とすことがあり、node-pty の spawn-helper が
// 非実行のまま展開されると spawn 時に "posix_spawnp failed." で失敗する。
// postinstall で実行ビットを戻す。
import { chmodSync, existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

// node-pty は依存として上位へ hoist されるため、rostr 配下の node_modules には無い。
// 実際の解決先を node に尋ね、どこへ置かれていても辿り着けるようにする。
const require = createRequire(import.meta.url);

let prebuilds;
try {
  prebuilds = join(dirname(require.resolve("node-pty/package.json")), "prebuilds");
} catch {
  console.warn("[rostr] node-pty が見つからず、spawn-helper の実行ビットを直せませんでした。");
  process.exit(0);
}

// prebuilds が無いのは自前ビルドの構成なので、その場合は直すものが無い。
if (!existsSync(prebuilds)) {
  console.warn(`[rostr] node-pty の prebuilds がありません: ${prebuilds}`);
  process.exit(0);
}

for (const platform of readdirSync(prebuilds)) {
  const helper = join(prebuilds, platform, "spawn-helper");
  if (existsSync(helper)) {
    chmodSync(helper, 0o755);
  }
}
