import { execPath } from "node:process";
import { dirname } from "node:path";
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

/** 設定を一時ファイルへ書き出し、そのパスを返す。 */
export const writeHookSettings = (sessionId: string, notifyScriptPath: string): string =>
  writeSettingsFile(`${sessionId}.json`, JSON.stringify(buildHookSettings(notifyScriptPath), null, 2));

const COPILOT_HOOK_EVENTS = [
  "sessionStart",
  "userPromptSubmitted",
  "preToolUse",
  "postToolUse",
  "notification",
  "agentStop",
  "sessionEnd",
] as const;

type CopilotHookEvent = (typeof COPILOT_HOOK_EVENTS)[number];

interface CopilotHookCommand {
  type: "command";
  command: string;
}

export interface CopilotHookSettings {
  version: 1;
  hooks: Record<CopilotHookEvent, CopilotHookCommand[]>;
}

/** Copilot CLI の camelCase hook payload を notifier へ渡す設定を作る。 */
export const buildCopilotHookSettings = (notifyScriptPath: string): CopilotHookSettings => {
  const hooks = {} as Record<CopilotHookEvent, CopilotHookCommand[]>;
  for (const event of COPILOT_HOOK_EVENTS) {
    hooks[event] = [{
      type: "command",
      command: `"${execPath}" "${notifyScriptPath}" copilot ${event}`,
    }];
  }
  return { version: 1, hooks };
};

/** COPILOT_HOME に渡す、セッションごとの hook 設定ディレクトリを作る。 */
export const writeCopilotHookSettings = (sessionId: string, notifyScriptPath: string): string => {
  const path = writeSettingsFile(
    `${sessionId}/hooks/rostr.json`,
    JSON.stringify(buildCopilotHookSettings(notifyScriptPath), null, 2),
  );
  return dirname(dirname(path));
};
