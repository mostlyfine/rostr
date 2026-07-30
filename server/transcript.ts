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

/** 1 行をターンにする。空行と壊れた行は undefined を返す。 */
const parseLine = (line: string): ConversationTurn | undefined => {
  if (line.trim() === "") return undefined;
  try {
    return toTurn(JSON.parse(line) as RawRecord);
  } catch {
    return undefined;
  }
};

/** JSONL 全体をターン列にする。壊れた行は黙って飛ばす。 */
export const parseTranscript = (jsonl: string): ConversationTurn[] => {
  const turns: ConversationTurn[] = [];
  for (const line of jsonl.split("\n")) {
    const turn = parseLine(line);
    if (turn) turns.push(turn);
  }
  return turns;
};

/**
 * 末尾から遡り、ユーザーの発言が userTurns 件そろうところまでを返す。
 *
 * 会話 JSONL は長いセッションで数 MB〜数十 MB に育つが、要約が実際に使うのは末尾の
 * 数ターンだけなので、全行を JSON.parse すると履歴の長さに比例した停止時間が毎ターン乗る。
 * 切り出す範囲は renderTurns がウィンドウの先頭として選ぶ位置と同じなので、
 * 返り値をそのまま renderTurns に渡せば全体を渡したときと同じ結果になる。
 */
export const parseRecentTurns = (jsonl: string, userTurns: number): ConversationTurn[] => {
  const lines = jsonl.split("\n");
  const tail: ConversationTurn[] = [];
  let users = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const turn = parseLine(lines[i]);
    if (!turn) continue;
    tail.push(turn);
    if (turn.role !== "user") continue;
    users += 1;
    if (users === userTurns) break;
  }
  return tail.reverse();
};
