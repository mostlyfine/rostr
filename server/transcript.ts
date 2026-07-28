/**
 * Claude Code の会話 JSONL を要約用のターン列に変換する。
 * 1行1レコードで、要約に使うのは人の入力とアシスタントの発話だけ。ツールの入出力や
 * 思考ブロック、添付やモード変更のような付随レコードは落とす。
 */

import { oneLine } from "./text";

export interface ConversationTurn {
  role: "user" | "assistant";
  text: string;
}

/** 人の入力ではない、機械が差し込んだ疑似ユーザー入力の印。 */
const SYNTHETIC_USER_MARKERS = ["<task-notification", "<command-name>", "<local-command-stdout>"];

interface RawRecord {
  type?: unknown;
  isSidechain?: unknown;
  isMeta?: unknown;
  message?: { role?: unknown; content?: unknown };
}

/** assistant レコードの content 配列から text ブロックだけを繋ぐ。 */
const assistantText = (content: unknown): string => {
  if (!Array.isArray(content)) return "";
  const parts = content
    .filter(
      (block): block is { type: string; text: string } =>
        typeof block === "object" &&
        block !== null &&
        (block as { type?: unknown }).type === "text" &&
        typeof (block as { text?: unknown }).text === "string",
    )
    .map((block) => block.text);
  return oneLine(parts.join(" "));
};

/** 1レコードを1ターンに変換する。要約に使わないレコードは undefined を返す。 */
const toTurn = (record: RawRecord): ConversationTurn | undefined => {
  if (record.isSidechain === true || record.isMeta === true) return undefined;

  const content = record.message?.content;

  if (record.type === "user") {
    // content が配列のものは tool_result で、人が書いた文ではない。
    if (typeof content !== "string") return undefined;
    const text = oneLine(content);
    if (text === "") return undefined;
    if (SYNTHETIC_USER_MARKERS.some((marker) => text.includes(marker))) return undefined;
    return { role: "user", text };
  }

  if (record.type === "assistant") {
    const text = assistantText(content);
    return text === "" ? undefined : { role: "assistant", text };
  }

  return undefined;
};

/** JSONL 全体をターン列にする。壊れた行は黙って飛ばす。 */
export const parseTranscript = (jsonl: string): ConversationTurn[] => {
  const turns: ConversationTurn[] = [];
  for (const line of jsonl.split("\n")) {
    if (line.trim() === "") continue;
    let record: RawRecord;
    try {
      record = JSON.parse(line) as RawRecord;
    } catch {
      continue;
    }
    const turn = toTurn(record);
    if (turn) turns.push(turn);
  }
  return turns;
};
