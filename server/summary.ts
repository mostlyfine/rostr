import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { truncate } from "./text";
import { parseTranscript, type ConversationTurn } from "./transcript";

/** 要約に渡す直近のユーザー発言数。 */
const USER_TURN_WINDOW = 5;
/** ユーザー発言1件あたりの文字数上限。 */
const USER_TURN_CHARS = 600;
/** アシスタント発言1件あたりの文字数上限。 */
const ASSISTANT_TURN_CHARS = 160;
/** サイドバーに出す要約の文字数上限。 */
export const MAX_SUMMARY_CHARS = 80;

/** claude -p に渡す指示。会話そのものは stdin から流す。 */
export const SUMMARY_PROMPT = [
  "Below (on stdin) is the recent transcript of a coding session between a User and an AI Assistant.",
  "Summarize what the USER is trying to accomplish as a short, concise title: a phrase, NOT a full",
  "sentence — no trailing punctuation. Base it on the User's intent, not the Assistant's wording.",
  "Match the User's language.",
  "Output ONLY the title: no quotes, no labels, no explanation.",
].join("\n");

/**
 * 要約の入力にするターンを絞って1つのテキストにする。
 * 全部渡すとトークンが際限なく増えるので、直近のユーザー発言と最後のアシスタント発言だけにする。
 * アシスタント発言を1件しか残さないのは、要約したいのがユーザーの意図であって作業ログではないため。
 */
export const renderTurns = (turns: ConversationTurn[]): string => {
  const users = turns.filter((turn) => turn.role === "user").slice(-USER_TURN_WINDOW);
  // ウィンドウの先頭より前のアシスタント発言は文脈にならないので捨てる。
  const windowStart = users[0] ? turns.indexOf(users[0]) : 0;
  const keepAssistant = turns.slice(windowStart).filter((turn) => turn.role === "assistant").at(-1);

  const lines = [
    ...users.map((turn) => `User: ${truncate(turn.text, USER_TURN_CHARS)}`),
    ...(keepAssistant ? [`Assistant: ${truncate(keepAssistant.text, ASSISTANT_TURN_CHARS)}`] : []),
  ];
  return lines.join("\n");
};

/** モデルの出力をサイドバーに出せる1行に整える。 */
export const sanitizeSummary = (raw: string): string => {
  const firstLine =
    raw
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line !== "") ?? "";
  const unquoted = firstLine.replace(/^["'「『]|["'」』]$/g, "").trim();
  return truncate(unquoted, MAX_SUMMARY_CHARS);
};

/** claude をヘッドレスで動かす関数。テストではフェイクに差し替える。 */
export type RunClaude = (input: { prompt: string; stdin: string }) => Promise<string>;

export interface SummarizerDeps {
  runClaude: RunClaude;
  /** 会話 JSONL を丸ごと読む。失敗したら例外を投げてよい。 */
  readTranscript: (path: string) => Promise<string>;
}

export interface Summarizer {
  /**
   * 要約の生成を依頼する。生成は非同期に進み、成功したときだけ apply が呼ばれる。
   * 同じセッションの生成が走っている間の依頼は捨てる。
   */
  request(sessionId: string, transcriptPath: string, apply: (summary: string) => void): void;
  /** 会話が作り直されたことを伝える。走っている生成の結果は捨てられる。 */
  reset(sessionId: string): void;
}

/**
 * 要約生成の交通整理をする。
 * Stop は1ターンごとに飛んでくるので、走っている間の依頼は捨てて多重起動を防ぐ。
 * また /clear で会話が入れ替わったあとに前の会話の結果が届くと嘘の要約が残るため、
 * セッションごとの世代番号を持ち、reset で番号を進めて古い結果を捨てる。
 */
export const createSummarizer = (deps: SummarizerDeps): Summarizer => {
  const inFlight = new Set<string>();
  const epochs = new Map<string, number>();

  const run = async (sessionId: string, transcriptPath: string, apply: (s: string) => void) => {
    const epoch = epochs.get(sessionId) ?? 0;
    try {
      const jsonl = await deps.readTranscript(transcriptPath);
      const turns: ConversationTurn[] = parseTranscript(jsonl);
      const stdin = renderTurns(turns);
      if (stdin === "") return;

      const raw = await deps.runClaude({ prompt: SUMMARY_PROMPT, stdin });
      // 待っている間に会話が作り直されていたら、この結果はもう別の会話のものになる。
      if ((epochs.get(sessionId) ?? 0) !== epoch) return;

      const summary = sanitizeSummary(raw);
      if (summary !== "") apply(summary);
    } catch {
      // 要約は無くても支障が無い。次の Stop で取り直す。
    } finally {
      inFlight.delete(sessionId);
    }
  };

  return {
    request(sessionId, transcriptPath, apply) {
      if (inFlight.has(sessionId)) return;
      inFlight.add(sessionId);
      void run(sessionId, transcriptPath, apply);
    },
    reset(sessionId) {
      epochs.set(sessionId, (epochs.get(sessionId) ?? 0) + 1);
    },
  };
};

/** 要約に使うモデル。速くて安いものを既定にする。 */
export const DEFAULT_SUMMARY_MODEL = "haiku";
/** 要約1回に許す時間。これを過ぎたらプロセスごと畳む。 */
export const SUMMARY_TIMEOUT_MS = 30_000;

export interface RunClaudeOptions {
  bin: string;
  model: string;
  timeoutMs: number;
}

/**
 * claude -p を子プロセスとして動かす。会話は引数ではなく stdin から渡す。
 * 引数に長文を載せると環境ごとの上限に当たるうえ、ps に会話が丸見えになる。
 */
export const runClaudeHeadless =
  (options: RunClaudeOptions): RunClaude =>
  ({ prompt, stdin }) =>
    new Promise<string>((resolve, reject) => {
      const child = spawn(options.bin, ["-p", prompt, "--model", options.model], {
        stdio: ["pipe", "pipe", "pipe"],
      });

      let out = "";
      let err = "";
      let settled = false;

      const timer = setTimeout(() => {
        settled = true;
        child.kill("SIGKILL");
        reject(new Error(`要約がタイムアウトしました (${options.timeoutMs}ms)`));
      }, options.timeoutMs);
      timer.unref?.();

      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        out += chunk;
      });
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        err += chunk;
      });

      child.on("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      });

      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (code === 0) resolve(out);
        else reject(new Error(`claude が異常終了しました (code ${code}): ${err.trim()}`));
      });

      // 子が stdin を読まずに終わると EPIPE が飛ぶ。要約の失敗としては扱わない。
      child.stdin.on("error", () => {});
      child.stdin.end(stdin);
    });

/** 会話 JSONL を読む既定の実装。 */
export const readTranscriptFile = (path: string): Promise<string> => readFile(path, "utf8");

export interface SummarizerFromEnv {
  /** ROSTR_SUMMARY=0 なら undefined。呼び出し側は要約機能そのものが無いものとして扱う。 */
  summarizer?: Summarizer;
  /** 表示用。無効なら "off"。 */
  model: string;
}

/**
 * 環境変数から要約機能の有効・無効とモデルを決め、Summarizer を組み立てる。
 * ROSTR_TMUX が tmux.ts の isTmuxAvailable() に閉じているのに合わせ、
 * ROSTR_SUMMARY 系の読み取りもここに閉じる。
 */
export const createSummarizerFromEnv = (agentBin: string): SummarizerFromEnv => {
  if (process.env.ROSTR_SUMMARY === "0") return { model: "off" };

  const model = process.env.ROSTR_SUMMARY_MODEL ?? DEFAULT_SUMMARY_MODEL;
  const summarizer = createSummarizer({
    runClaude: runClaudeHeadless({ bin: agentBin, model, timeoutMs: SUMMARY_TIMEOUT_MS }),
    readTranscript: readTranscriptFile,
  });
  return { summarizer, model };
};
