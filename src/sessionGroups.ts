import type { AgentState, Session } from "../common/types";

/** サイドバーでの表示順。要対応のものを上に置く。 */
export const STATE_ORDER: AgentState[] = ["waiting", "working", "done", "idle", "exited"];

export const STATE_LABEL: Record<AgentState, string> = {
  waiting: "要対応",
  working: "実行中",
  done: "完了",
  idle: "待機",
  exited: "終了",
};

export interface SessionGroup {
  state: AgentState;
  label: string;
  sessions: Session[];
}

/** 状態ごとにまとめ、該当が無いグループは落とす。 */
export const groupByState = (sessions: Session[]): SessionGroup[] =>
  STATE_ORDER.map((state) => ({
    state,
    label: STATE_LABEL[state],
    sessions: sessions.filter((session) => session.state === state),
  })).filter((group) => group.sessions.length > 0);
