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

let settingsPath: string | undefined;

/**
 * 設定を一時ファイルへ書き出し、そのパスを返す。
 * 中身は notifyScriptPath と node の場所しか見ておらずセッションごとに違わないので、
 * 1 本を共有する。セッションごとに書いていた頃は、終了時に消す口が無いまま
 * 一時ディレクトリへ同じ内容のファイルが際限なく溜まっていた。
 */
export const writeHookSettings = (notifyScriptPath: string): string =>
  (settingsPath ??= writeSettingsFile(
    "hooks.json",
    JSON.stringify(buildHookSettings(notifyScriptPath), null, 2),
  ));
