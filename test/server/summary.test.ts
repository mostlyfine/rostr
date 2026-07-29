import { randomUUID } from "node:crypto";
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_SUMMARY_CHARS,
  TRANSCRIPT_TAIL_BYTES,
  createSummarizer,
  readTranscriptFile,
  renderTurns,
  runClaudeHeadless,
  sanitizeSummary,
} from "../../server/summary";
import { parseTranscript, type ConversationTurn } from "../../server/transcript";

const user = (text: string): ConversationTurn => ({ role: "user", text });
const assistant = (text: string): ConversationTurn => ({ role: "assistant", text });

describe("renderTurns", () => {
  it("User と Assistant のラベルを付けて並べる", () => {
    expect(renderTurns([user("直したい"), assistant("直します")])).toBe(
      "User: 直したい\nAssistant: 直します",
    );
  });

  it("直近5件のユーザー発言までに絞る", () => {
    const turns = [1, 2, 3, 4, 5, 6, 7].map((n) => user(`req${n}`));
    expect(renderTurns(turns)).toBe(
      ["User: req3", "User: req4", "User: req5", "User: req6", "User: req7"].join("\n"),
    );
  });

  it("最後のアシスタント発言は1件だけ残す", () => {
    const turns = [user("req"), assistant("old"), assistant("new")];
    expect(renderTurns(turns)).toBe("User: req\nAssistant: new");
  });

  it("ウィンドウより前のアシスタント発言は捨てる", () => {
    const turns = [assistant("大昔"), ...[1, 2, 3, 4, 5, 6].map((n) => user(`req${n}`))];
    expect(renderTurns(turns)).toBe(
      ["User: req2", "User: req3", "User: req4", "User: req5", "User: req6"].join("\n"),
    );
  });

  it("ユーザー発言は600字で切る", () => {
    expect(renderTurns([user("あ".repeat(700))])).toBe(`User: ${"あ".repeat(599)}…`);
  });

  it("アシスタント発言は160字で切る", () => {
    expect(renderTurns([assistant("い".repeat(200))])).toBe(`Assistant: ${"い".repeat(159)}…`);
  });

  it("ターンが無ければ空文字を返す", () => {
    expect(renderTurns([])).toBe("");
  });
});

describe("sanitizeSummary", () => {
  it("前後の空白を落とす", () => {
    expect(sanitizeSummary("  サイドバーの実装  \n")).toBe("サイドバーの実装");
  });

  it("複数行なら最初の非空行だけ使う", () => {
    expect(sanitizeSummary("\nサイドバーの実装\n補足コメント")).toBe("サイドバーの実装");
  });

  it("囲みの引用符を外す", () => {
    expect(sanitizeSummary('"サイドバーの実装"')).toBe("サイドバーの実装");
    expect(sanitizeSummary("「サイドバーの実装」")).toBe("サイドバーの実装");
  });

  it("上限を超えたら省略記号を付ける", () => {
    expect(sanitizeSummary("x".repeat(200))).toBe(`${"x".repeat(MAX_SUMMARY_CHARS - 1)}…`);
  });

  it("空なら空文字を返す", () => {
    expect(sanitizeSummary("   \n  ")).toBe("");
  });
});

/** Promise の解決を外から操作できる runClaude のフェイク。 */
const deferredRunner = () => {
  const calls: { prompt: string; stdin: string }[] = [];
  const resolvers: ((value: string) => void)[] = [];
  const rejecters: ((reason: Error) => void)[] = [];
  const run = (input: { prompt: string; stdin: string }) =>
    new Promise<string>((resolve, reject) => {
      calls.push(input);
      resolvers.push(resolve);
      rejecters.push(reject);
    });
  return { calls, resolvers, rejecters, run };
};

const transcriptOf = (text: string) =>
  `${JSON.stringify({ type: "user", message: { role: "user", content: text } })}\n`;

/** マイクロタスクが片付くまで少しだけ待つ。「何も起きない」ことの確認に使う。 */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("createSummarizer", () => {
  it("読み込んだ会話を claude へ渡し、整えた要約を apply へ返す", async () => {
    const runner = deferredRunner();
    const summarizer = createSummarizer({
      runClaude: runner.run,
      readTranscript: async () => transcriptOf("サイドバーに要約を出したい"),
    });
    const applied: string[] = [];

    summarizer.request("s1", "/tmp/s1.jsonl", (summary) => applied.push(summary));
    await vi.waitFor(() => expect(runner.calls).toHaveLength(1));
    expect(runner.calls[0].stdin).toBe("User: サイドバーに要約を出したい");

    runner.resolvers[0]('"サイドバー要約の表示"\n');
    await vi.waitFor(() => expect(applied).toEqual(["サイドバー要約の表示"]));
  });

  it("生成中に来た依頼は捨てて二重に走らせない", async () => {
    const runner = deferredRunner();
    const summarizer = createSummarizer({
      runClaude: runner.run,
      readTranscript: async () => transcriptOf("依頼"),
    });

    summarizer.request("s1", "/tmp/s1.jsonl", () => {});
    await vi.waitFor(() => expect(runner.calls).toHaveLength(1));
    summarizer.request("s1", "/tmp/s1.jsonl", () => {});
    await settle();
    expect(runner.calls).toHaveLength(1);
  });

  it("終わったあとの依頼は改めて走る", async () => {
    const runner = deferredRunner();
    const summarizer = createSummarizer({
      runClaude: runner.run,
      readTranscript: async () => transcriptOf("依頼"),
    });

    summarizer.request("s1", "/tmp/s1.jsonl", () => {});
    await vi.waitFor(() => expect(runner.calls).toHaveLength(1));
    runner.resolvers[0]("要約");
    await settle();

    summarizer.request("s1", "/tmp/s1.jsonl", () => {});
    await vi.waitFor(() => expect(runner.calls).toHaveLength(2));
  });

  it("reset を挟んだら生成中の結果は捨てる", async () => {
    const runner = deferredRunner();
    const summarizer = createSummarizer({
      runClaude: runner.run,
      readTranscript: async () => transcriptOf("依頼"),
    });
    const applied: string[] = [];

    summarizer.request("s1", "/tmp/s1.jsonl", (summary) => applied.push(summary));
    await vi.waitFor(() => expect(runner.calls).toHaveLength(1));
    summarizer.reset("s1");
    runner.resolvers[0]("古い会話の要約");
    await settle();
    expect(applied).toEqual([]);
  });

  it("claude が失敗しても apply は呼ばず、次の依頼は受け付ける", async () => {
    const runner = deferredRunner();
    const summarizer = createSummarizer({
      runClaude: runner.run,
      readTranscript: async () => transcriptOf("依頼"),
    });
    const applied: string[] = [];

    summarizer.request("s1", "/tmp/s1.jsonl", (summary) => applied.push(summary));
    await vi.waitFor(() => expect(runner.calls).toHaveLength(1));
    runner.rejecters[0](new Error("boom"));
    await settle();
    expect(applied).toEqual([]);

    summarizer.request("s1", "/tmp/s1.jsonl", () => {});
    await vi.waitFor(() => expect(runner.calls).toHaveLength(2));
  });

  it("会話が読めなければ claude を起動しない", async () => {
    const runner = deferredRunner();
    const summarizer = createSummarizer({
      runClaude: runner.run,
      readTranscript: async () => {
        throw new Error("ENOENT");
      },
    });

    summarizer.request("s1", "/tmp/none.jsonl", () => {});
    await settle();
    expect(runner.calls).toEqual([]);
  });

  it("要約できるターンが無ければ claude を起動しない", async () => {
    const runner = deferredRunner();
    const summarizer = createSummarizer({
      runClaude: runner.run,
      readTranscript: async () => "",
    });

    summarizer.request("s1", "/tmp/s1.jsonl", () => {});
    await settle();
    expect(runner.calls).toEqual([]);
  });

  it("空の要約が返ってきたら apply しない", async () => {
    const runner = deferredRunner();
    const summarizer = createSummarizer({
      runClaude: runner.run,
      readTranscript: async () => transcriptOf("依頼"),
    });
    const applied: string[] = [];

    summarizer.request("s1", "/tmp/s1.jsonl", (summary) => applied.push(summary));
    await vi.waitFor(() => expect(runner.calls).toHaveLength(1));
    runner.resolvers[0]("   \n ");
    await settle();
    expect(applied).toEqual([]);
  });

  it("セッションごとに独立して走る", async () => {
    const runner = deferredRunner();
    const summarizer = createSummarizer({
      runClaude: runner.run,
      readTranscript: async () => transcriptOf("依頼"),
    });

    summarizer.request("s1", "/tmp/s1.jsonl", () => {});
    summarizer.request("s2", "/tmp/s2.jsonl", () => {});
    await vi.waitFor(() => expect(runner.calls).toHaveLength(2));
  });
});

describe("runClaudeHeadless", () => {
  const scripts: string[] = [];

  /**
   * 引数を無視して body だけを実行する、claude の身代わり。
   * runClaudeHeadless は -p と --model を必ず付けるので、それらを知らない既製コマンド
   * （cat や sleep）は引数エラーで即死してしまい、確かめたい挙動まで届かない。
   */
  const fakeClaude = (body: string): string => {
    const path = join(tmpdir(), `rostr-fake-claude-${randomUUID()}.sh`);
    writeFileSync(path, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    scripts.push(path);
    return path;
  };

  afterEach(() => {
    for (const path of scripts.splice(0)) rmSync(path, { force: true });
  });

  it("stdin を渡してプロセスの標準出力を返す", async () => {
    const run = runClaudeHeadless({ bin: fakeClaude("cat"), model: "haiku", timeoutMs: 5_000 });
    expect(await run({ prompt: "ignored", stdin: "hello" })).toBe("hello");
  });

  it("終了コードが 0 でなければ失敗させる", async () => {
    const run = runClaudeHeadless({
      bin: fakeClaude('echo "bad model" >&2\nexit 3'),
      model: "haiku",
      timeoutMs: 5_000,
    });
    await expect(run({ prompt: "ignored", stdin: "hello" })).rejects.toThrow(/code 3/);
  });

  it("起動できないバイナリなら失敗させる", async () => {
    const run = runClaudeHeadless({ bin: "/no/such/binary", model: "haiku", timeoutMs: 5_000 });
    await expect(run({ prompt: "ignored", stdin: "hello" })).rejects.toThrow();
  });

  it("時間内に終わらなければ打ち切る", async () => {
    const run = runClaudeHeadless({ bin: fakeClaude("sleep 10"), model: "haiku", timeoutMs: 50 });
    await expect(run({ prompt: "ignored", stdin: "" })).rejects.toThrow(/タイムアウト/);
  });
});

describe("readTranscriptFile", () => {
  const files: string[] = [];

  const write = (content: string): string => {
    const path = join(tmpdir(), `rostr-transcript-${randomUUID()}.jsonl`);
    writeFileSync(path, content, "utf8");
    files.push(path);
    return path;
  };

  afterEach(() => {
    for (const path of files.splice(0)) rmSync(path, { force: true });
  });

  it("上限より小さいファイルは丸ごと読む", async () => {
    const path = write('{"type":"user"}\n{"type":"assistant"}\n');
    expect(await readTranscriptFile(path)).toBe('{"type":"user"}\n{"type":"assistant"}\n');
  });

  /*
   * 会話 JSONL は数 MB になるが、要約に使うのは末尾のユーザー発言 5 件と最後のアシスタント
   * 発言 1 件だけ。Stop のたびに全体を読んで全行を JSON.parse する必要はない。
   */
  it("上限を超えるファイルは末尾だけ読む", async () => {
    const filler = `${"x".repeat(1000)}\n`.repeat(TRANSCRIPT_TAIL_BYTES / 1000);
    const path = write(`${filler}{"type":"user","tail":true}\n`);
    const read = await readTranscriptFile(path);
    expect(read.length).toBeLessThanOrEqual(TRANSCRIPT_TAIL_BYTES);
    expect(read).toContain('{"type":"user","tail":true}');
  });

  it("先頭が行の途中で切れても壊れた行として捨てられる", async () => {
    const filler = `${"x".repeat(1000)}\n`.repeat(TRANSCRIPT_TAIL_BYTES / 1000);
    const path = write(`${filler}{"type":"user","message":{"content":"最後の発言"}}\n`);
    const turns = parseTranscript(await readTranscriptFile(path));
    expect(turns).toEqual([{ role: "user", text: "最後の発言" }]);
  });
});
