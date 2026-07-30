import { describe, expect, it } from "vitest";
import { parseRecentTurns, parseTranscript } from "../../server/transcript";
import { renderTurns } from "../../server/summary";

const line = (value: unknown) => `${JSON.stringify(value)}\n`;

const userText = (text: string, extra: Record<string, unknown> = {}) =>
  line({ type: "user", message: { role: "user", content: text }, ...extra });

const assistantText = (text: string, extra: Record<string, unknown> = {}) =>
  line({
    type: "assistant",
    message: { role: "assistant", content: [{ type: "text", text }] },
    ...extra,
  });

describe("parseTranscript", () => {
  it("ユーザーとアシスタントの発話を順に取り出す", () => {
    const jsonl = userText("直したい") + assistantText("直します");
    expect(parseTranscript(jsonl)).toEqual([
      { role: "user", text: "直したい" },
      { role: "assistant", text: "直します" },
    ]);
  });

  it("tool_result のユーザーレコードは捨てる", () => {
    const jsonl = line({
      type: "user",
      message: { role: "user", content: [{ type: "tool_result", content: "ok" }] },
    });
    expect(parseTranscript(jsonl)).toEqual([]);
  });

  it("assistant の text 以外のブロックは捨てる", () => {
    const jsonl = line({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "考え中" },
          { type: "tool_use", name: "Bash", input: {} },
        ],
      },
    });
    expect(parseTranscript(jsonl)).toEqual([]);
  });

  it("同じレコード内の複数 text ブロックは連結する", () => {
    const jsonl = line({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "前半" },
          { type: "tool_use", name: "Bash", input: {} },
          { type: "text", text: "後半" },
        ],
      },
    });
    expect(parseTranscript(jsonl)).toEqual([{ role: "assistant", text: "前半 後半" }]);
  });

  it("サブエージェントの会話とメタレコードは捨てる", () => {
    const jsonl =
      userText("本編") + userText("枝葉", { isSidechain: true }) + userText("メタ", { isMeta: true });
    expect(parseTranscript(jsonl)).toEqual([{ role: "user", text: "本編" }]);
  });

  it("バックグラウンドタスクの自動投入は人の入力ではないので捨てる", () => {
    const jsonl = userText("<task-notification>done</task-notification>") + userText("本編");
    expect(parseTranscript(jsonl)).toEqual([{ role: "user", text: "本編" }]);
  });

  it("スラッシュコマンドの展開結果は捨てる", () => {
    const jsonl = userText("<command-name>/clear</command-name>") + userText("本編");
    expect(parseTranscript(jsonl)).toEqual([{ role: "user", text: "本編" }]);
  });

  it("空行と壊れた行は飛ばして読み進める", () => {
    const jsonl = `\n{ this is not json\n${userText("本編")}`;
    expect(parseTranscript(jsonl)).toEqual([{ role: "user", text: "本編" }]);
  });

  it("空文字だけの発話は捨てる", () => {
    expect(parseTranscript(userText("   "))).toEqual([]);
  });

  it("改行や連続空白は1行に潰す", () => {
    expect(parseTranscript(userText("a\n b  c"))).toEqual([{ role: "user", text: "a b c" }]);
  });
});

/**
 * 要約が使うのは末尾の数ターンだけなので、長い会話でも全行を読まずに済ませる。
 * 切り出す範囲は renderTurns がウィンドウの先頭に選ぶ位置と一致していなければならない。
 */
describe("parseRecentTurns", () => {
  it("ユーザー発言が指定件数そろうところまでを返す", () => {
    const jsonl =
      userText("1") + userText("2") + userText("3") + userText("4") + userText("5");

    expect(parseRecentTurns(jsonl, 3)).toEqual([
      { role: "user", text: "3" },
      { role: "user", text: "4" },
      { role: "user", text: "5" },
    ]);
  });

  it("ウィンドウの中のアシスタント発言は順序を保って残す", () => {
    const jsonl =
      userText("古い") + assistantText("捨てられる") + userText("新しい") + assistantText("残る");

    expect(parseRecentTurns(jsonl, 1)).toEqual([
      { role: "user", text: "新しい" },
      { role: "assistant", text: "残る" },
    ]);
  });

  it("件数に満たなければ全体を返す", () => {
    const jsonl = assistantText("先頭") + userText("唯一");

    expect(parseRecentTurns(jsonl, 5)).toEqual(parseTranscript(jsonl));
  });

  it("全体を渡したときと同じ要約入力になる", () => {
    const jsonl =
      Array.from({ length: 40 }, (_, i) => userText(`u${i}`) + assistantText(`a${i}`)).join("") ;

    expect(renderTurns(parseRecentTurns(jsonl, 5))).toBe(renderTurns(parseTranscript(jsonl)));
  });

  it("壊れた行は飛ばして遡り続ける", () => {
    const jsonl = userText("本編") + "{ broken\n" + userText("末尾");

    expect(parseRecentTurns(jsonl, 2)).toEqual([
      { role: "user", text: "本編" },
      { role: "user", text: "末尾" },
    ]);
  });
});
