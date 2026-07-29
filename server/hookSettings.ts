import { createHash } from "node:crypto";
import { execPath } from "node:process";
import { HOOKED_EVENTS, type HookedEvent } from "../common/types";
import { writeSettingsFile } from "./settingsDir";

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

/**
 * 設定を一時ファイルへ書き出し、そのパスを返す。
 * 内容は notifyScriptPath にしか依存しないので、ファイル名もそこから決める。セッションごとに
 * 分けると一時ディレクトリに増え続け、別の worktree で動く rostr と共有していても壊れない。
 */
export const writeHookSettings = (notifyScriptPath: string): string => {
  const digest = createHash("sha256").update(notifyScriptPath).digest("hex").slice(0, 12);
  return writeSettingsFile(
    `hooks-${digest}.json`,
    JSON.stringify(buildHookSettings(notifyScriptPath), null, 2),
  );
};
