import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SETTINGS_DIR_NAME = "rostr-settings";

export const writeSettingsFile = (filename: string, content: string): string => {
  const dir = join(tmpdir(), SETTINGS_DIR_NAME);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, filename);
  writeFileSync(path, content, "utf8");
  return path;
};
