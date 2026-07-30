import { describe, expect, it } from "vitest";
import { applyHookEvent, summarizeTool, truncateOneLine } from "../../server/state";
import type { HookEvent, Session } from "../../common/types";

const base: Session = {
  id: "s1",
  cwd: "/tmp/proj",
  title: "proj",
  state: "idle",
  prompt: "",
  activity: "",
  summary: "",
  createdAt: 0,
  updatedAt: 0,
};

/** 状態そのものを見るテスト用。要約の振り分けに使うフラグは別の describe で見る。 */
const patchOf = (session: Session, event: HookEvent) => applyHookEvent(session, event).patch;

describe("truncateOneLine", () => {
  it("改行を空白に潰す", () => {
    expect(truncateOneLine("a\nb\n  c")).toBe("a b c");
  });

  it("上限を超えたら省略記号を付ける", () => {
    expect(truncateOneLine("x".repeat(150), 10)).toBe("xxxxxxxxx…");
  });

  it("上限ちょうどなら省略しない", () => {
    expect(truncateOneLine("x".repeat(10), 10)).toBe("x".repeat(10));
  });
});

describe("summarizeTool", () => {
  it("Bash はコマンドを出す", () => {
    expect(summarizeTool("Bash", { command: "npm test" })).toBe("Bash npm test");
  });

  it("Edit はファイル名だけ出す", () => {
    expect(summarizeTool("Edit", { file_path: "/a/b/App.vue" })).toBe("Edit App.vue");
  });

  it("Write と Read も同様", () => {
    expect(summarizeTool("Write", { file_path: "/a/b/x.ts" })).toBe("Write x.ts");
    expect(summarizeTool("Read", { file_path: "/a/b/y.ts" })).toBe("Read y.ts");
  });

  it("Task は description を出す", () => {
    expect(summarizeTool("Task", { description: "調査する" })).toBe("Task 調査する");
  });

  it("Grep と Glob は pattern を出す", () => {
    expect(summarizeTool("Grep", { pattern: "foo" })).toBe("Grep foo");
    expect(summarizeTool("Glob", { pattern: "**/*.ts" })).toBe("Glob **/*.ts");
  });

  it("未知のツールはツール名だけ", () => {
    expect(summarizeTool("WebFetch", { url: "https://example.com" })).toBe("WebFetch");
  });

  it("期待するフィールドが無ければツール名だけ", () => {
    expect(summarizeTool("Bash", {})).toBe("Bash");
  });

  it("tool_input が無くても落ちない", () => {
    expect(summarizeTool("Bash", undefined)).toBe("Bash");
  });
});

describe("applyHookEvent", () => {
  it("UserPromptSubmit で working になりプロンプトを記録する", () => {
    const patch = patchOf(base, { hook_event_name: "UserPromptSubmit", prompt: "テストを書いて" });
    expect(patch).toMatchObject({ state: "working", prompt: "テストを書いて", activity: "" });
  });

  it("PreToolUse で activity が更新される", () => {
    const patch = patchOf(base, {
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "ls -la" },
    });
    expect(patch).toMatchObject({ state: "working", activity: "Bash ls -la" });
  });

  it("PostToolUse は activity を消さない", () => {
    const patch = patchOf({ ...base, activity: "Bash ls" }, { hook_event_name: "PostToolUse" });
    expect(patch.state).toBe("working");
    expect(patch.activity).toBeUndefined();
  });

  it("Notification で waiting になりメッセージを activity に入れる", () => {
    const patch = patchOf(base, {
      hook_event_name: "Notification",
      message: "Claude needs your permission to use Bash",
    });
    expect(patch).toMatchObject({ state: "waiting", activity: "Claude needs your permission to use Bash" });
  });

  // idle_prompt は「一定時間操作が無い」という単なる催促で、人の対応が要る通知ではない。
  // ここまで waiting にすると、/clear 後に放置しただけの行が「要対応」に化けてしまう。
  it("Notification の idle_prompt は放置しているだけなので状態を変えない", () => {
    const patch = patchOf(base, {
      hook_event_name: "Notification",
      message: "Claude is waiting for your input",
      notification_type: "idle_prompt",
    });
    expect(patch).toEqual({});
  });

  it("Stop で done になり activity が消える", () => {
    const patch = patchOf({ ...base, state: "working", activity: "Bash ls" }, { hook_event_name: "Stop" });
    expect(patch).toMatchObject({ state: "done", activity: "" });
  });

  it("SessionEnd で exited になる", () => {
    const patch = patchOf(base, { hook_event_name: "SessionEnd" });
    expect(patch.state).toBe("exited");
  });

  // worktree 移動や /clear では、プロセスが生きたまま会話セッションだけが終わって SessionEnd が飛ぶ。
  // ここで固着させると、動き続けているエージェントの行が二度と更新されなくなる。
  it("exited でも次のイベントで復帰する", () => {
    const patch = patchOf({ ...base, state: "exited" }, { hook_event_name: "UserPromptSubmit", prompt: "x" });
    expect(patch).toMatchObject({ state: "working", prompt: "x" });
  });

  it("SessionStart で idle に戻り前の会話の内容が消える", () => {
    const patch = patchOf(
      { ...base, state: "exited", prompt: "npm run rebuild", activity: "Bash ls" },
      { hook_event_name: "SessionStart" },
    );
    expect(patch).toMatchObject({ state: "idle", prompt: "", activity: "" });
  });

  it("未知のイベントは何も変えない", () => {
    expect(patchOf(base, { hook_event_name: "PreCompact" })).toEqual({});
  });

  it("長いプロンプトは1行に丸められる", () => {
    const patch = patchOf(base, { hook_event_name: "UserPromptSubmit", prompt: "a\nb" });
    expect(patch.prompt).toBe("a b");
  });

  it("task-notification由来のprompt(バックグラウンドタスク完了通知)は無視する", () => {
    const patch = patchOf(
      { ...base, state: "working", prompt: "元のプロンプト", activity: "Bash npm test" },
      { hook_event_name: "UserPromptSubmit", prompt: "<task-notification>agent finished</task-notification>" },
    );
    expect(patch).toEqual({});
  });
});

describe("applyHookEvent の summary", () => {
  it("SessionStart は要約も消す", () => {
    const session = { ...base, summary: "サイドバーの実装" };
    expect(patchOf(session, { hook_event_name: "SessionStart" })).toEqual({
      state: "idle",
      prompt: "",
      activity: "",
      summary: "",
    });
  });

  it("Stop は要約を触らない", () => {
    const patch = patchOf(base, { hook_event_name: "Stop" });
    expect(patch).not.toHaveProperty("summary");
  });
});

/**
 * 要約を作り直すか捨てるかの判断は、パッチの中身から逆算せずここが宣言する。
 * SessionManager.updateSummary はこのフラグだけを見る。
 */
describe("applyHookEvent が返すきっかけ", () => {
  it("SessionStart は会話の作り直しとして知らせる", () => {
    const outcome = applyHookEvent(base, { hook_event_name: "SessionStart" });
    expect(outcome.conversationReset).toBe(true);
    expect(outcome.userIntentChanged).toBe(false);
  });

  it("人が入力した UserPromptSubmit は意図の変化として知らせる", () => {
    const outcome = applyHookEvent(base, { hook_event_name: "UserPromptSubmit", prompt: "直して" });
    expect(outcome.userIntentChanged).toBe(true);
    expect(outcome.conversationReset).toBe(false);
  });

  it("task-notification の自動投入は意図の変化にしない", () => {
    const outcome = applyHookEvent(base, {
      hook_event_name: "UserPromptSubmit",
      prompt: "<task-notification>agent finished</task-notification>",
    });
    expect(outcome.userIntentChanged).toBe(false);
    expect(outcome.conversationReset).toBe(false);
  });

  it("Stop や PreToolUse はどちらのきっかけでもない", () => {
    for (const name of ["Stop", "PreToolUse", "PostToolUse", "Notification", "SessionEnd"]) {
      const outcome = applyHookEvent(base, { hook_event_name: name });
      expect(outcome.conversationReset).toBe(false);
      expect(outcome.userIntentChanged).toBe(false);
    }
  });
});
