import { describe, expect, it } from "vitest";
import { applyHookEvent, summarizeTool, truncateOneLine } from "../../server/state";
import type { Session } from "../../common/types";

const base: Session = {
  id: "s1",
  cwd: "/tmp/proj",
  title: "proj",
  state: "idle",
  prompt: "",
  activity: "",
  createdAt: 0,
  updatedAt: 0,
};

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
    const patch = applyHookEvent(base, { hook_event_name: "UserPromptSubmit", prompt: "テストを書いて" });
    expect(patch).toMatchObject({ state: "working", prompt: "テストを書いて", activity: "" });
  });

  it("PreToolUse で activity が更新される", () => {
    const patch = applyHookEvent(base, {
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "ls -la" },
    });
    expect(patch).toMatchObject({ state: "working", activity: "Bash ls -la" });
  });

  it("PostToolUse は activity を消さない", () => {
    const patch = applyHookEvent({ ...base, activity: "Bash ls" }, { hook_event_name: "PostToolUse" });
    expect(patch.state).toBe("working");
    expect(patch.activity).toBeUndefined();
  });

  it("Notification で waiting になりメッセージを activity に入れる", () => {
    const patch = applyHookEvent(base, {
      hook_event_name: "Notification",
      message: "Claude needs your permission to use Bash",
    });
    expect(patch).toMatchObject({ state: "waiting", activity: "Claude needs your permission to use Bash" });
  });

  it("Stop で done になり activity が消える", () => {
    const patch = applyHookEvent({ ...base, state: "working", activity: "Bash ls" }, { hook_event_name: "Stop" });
    expect(patch).toMatchObject({ state: "done", activity: "" });
  });

  it("SessionEnd で exited になる", () => {
    const patch = applyHookEvent(base, { hook_event_name: "SessionEnd" });
    expect(patch.state).toBe("exited");
  });

  // worktree 移動や /clear では、プロセスが生きたまま会話セッションだけが終わって SessionEnd が飛ぶ。
  // ここで固着させると、動き続けているエージェントの行が二度と更新されなくなる。
  it("exited でも次のイベントで復帰する", () => {
    const patch = applyHookEvent({ ...base, state: "exited" }, { hook_event_name: "UserPromptSubmit", prompt: "x" });
    expect(patch).toMatchObject({ state: "working", prompt: "x" });
  });

  it("SessionStart で idle に戻り前の会話の内容が消える", () => {
    const patch = applyHookEvent(
      { ...base, state: "exited", prompt: "npm run rebuild", activity: "Bash ls" },
      { hook_event_name: "SessionStart" },
    );
    expect(patch).toMatchObject({ state: "idle", prompt: "", activity: "" });
  });

  it("未知のイベントは何も変えない", () => {
    expect(applyHookEvent(base, { hook_event_name: "PreCompact" })).toEqual({});
  });

  it("長いプロンプトは1行に丸められる", () => {
    const patch = applyHookEvent(base, { hook_event_name: "UserPromptSubmit", prompt: "a\nb" });
    expect(patch.prompt).toBe("a b");
  });

  it("task-notification由来のprompt(バックグラウンドタスク完了通知)は無視する", () => {
    const patch = applyHookEvent(
      { ...base, state: "working", prompt: "元のプロンプト", activity: "Bash npm test" },
      { hook_event_name: "UserPromptSubmit", prompt: "<task-notification>agent finished</task-notification>" },
    );
    expect(patch).toEqual({});
  });
});
