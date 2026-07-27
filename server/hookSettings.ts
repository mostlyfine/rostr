import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { execPath } from "node:process";
import { join } from "node:path";
import { HOOKED_EVENTS, type HookedEvent } from "../common/types";

/** matcher を取るのはツール系イベントだけ。 */
const MATCHER_EVENTS = new Set<HookedEvent>(["PreToolUse", "PostToolUse"]);

interface HookCommand {
  type: "command";
  command: string;
}

interface HookMatcher {
  matcher?: string;
  hooks: HookCommand[];
}

export interface HookSettings {
  hooks: Record<HookedEvent, HookMatcher[]>;
}

/** claude に --settings で渡す設定オブジェクトを組み立てる。 */
export const buildHookSettings = (notifyScriptPath: string): HookSettings => {
  // Claude 本体を起動している node をそのまま使う。PATH に node が無い環境でも動く。
  const command = `"${execPath}" "${notifyScriptPath}"`;

  const hooks = {} as Record<HookedEvent, HookMatcher[]>;
  for (const event of HOOKED_EVENTS) {
    const entry: HookMatcher = { hooks: [{ type: "command", command }] };
    if (MATCHER_EVENTS.has(event)) entry.matcher = "*";
    hooks[event] = [entry];
  }
  return { hooks };
};

/** 設定を一時ファイルへ書き出し、そのパスを返す。 */
export const writeHookSettings = (sessionId: string, notifyScriptPath: string): string => {
  const dir = join(tmpdir(), "multi-agent-settings");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${sessionId}.json`);
  writeFileSync(path, JSON.stringify(buildHookSettings(notifyScriptPath), null, 2), "utf8");
  return path;
};
