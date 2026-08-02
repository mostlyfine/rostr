import { describe, expect, it } from "vitest";
import { detectNotableTransitions } from "../../src/notableTransitions";
import type { AgentState, Session } from "../../common/types";

const session = (over: Partial<Session>): Session => ({
  id: "id",
  agent: "claude",
  cwd: "/tmp/proj",
  title: "proj",
  state: "idle",
  prompt: "",
  activity: "",
  summary: "",
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

const prevStatesOf = (entries: [string, AgentState][]): Map<string, AgentState> => new Map(entries);

describe("detectNotableTransitions", () => {
  it("working から waiting への遷移を検出する", () => {
    const list = [session({ id: "a", state: "waiting" })];
    const prev = prevStatesOf([["a", "working"]]);
    expect(detectNotableTransitions(list, prev)).toEqual(["waiting"]);
  });

  it("working から done への遷移を検出する", () => {
    const list = [session({ id: "a", state: "done" })];
    const prev = prevStatesOf([["a", "working"]]);
    expect(detectNotableTransitions(list, prev)).toEqual(["done"]);
  });

  it("既に waiting/done だったセッションは検出しない", () => {
    const list = [session({ id: "a", state: "waiting" })];
    const prev = prevStatesOf([["a", "waiting"]]);
    expect(detectNotableTransitions(list, prev)).toEqual([]);
  });

  it("初出のセッション(prev未定義)は検出しない", () => {
    const list = [session({ id: "a", state: "done" })];
    const prev = prevStatesOf([]);
    expect(detectNotableTransitions(list, prev)).toEqual([]);
  });

  it("working のままなら検出しない", () => {
    const list = [session({ id: "a", state: "working" })];
    const prev = prevStatesOf([["a", "idle"]]);
    expect(detectNotableTransitions(list, prev)).toEqual([]);
  });

  it("複数セッションの遷移をまとめて返す", () => {
    const list = [
      session({ id: "a", state: "waiting" }),
      session({ id: "b", state: "working" }),
      session({ id: "c", state: "done" }),
    ];
    const prev = prevStatesOf([
      ["a", "working"],
      ["b", "working"],
      ["c", "working"],
    ]);
    expect(detectNotableTransitions(list, prev)).toEqual(["waiting", "done"]);
  });
});
