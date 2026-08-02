import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const SETTINGS_DIR_NAME = "rostr-settings";

/** rostr が書き出す一時設定ファイル用のディレクトリへ、内容を書き出してパスを返す。 */
export const writeSettingsFile = (filename: string, content: string): string => {
  const dir = join(tmpdir(), SETTINGS_DIR_NAME);
  const path = join(dir, filename);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
  return path;
};
