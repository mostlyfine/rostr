import { describe, expect, it } from "vitest";
import { parseTranscript } from "../../server/transcript";

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
