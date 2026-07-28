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

/** サイドバーの1行。見出しとセッションを同じ列に混ぜて並べる。 */
export type SidebarRow =
  | { kind: "header"; key: string; state: AgentState; label: string; count: number }
  | { kind: "session"; key: string; session: Session };

/**
 * 状態ごとにまとめたうえで、見出しとセッションを1列へ平らに並べる。該当が無い状態は落とす。
 * 状態をまたぐ行の移動をアニメーションさせるには、TransitionGroup の親が1つである必要があるため、
 * グループごとにリストを分けずにこの形にしている。
 */
export const toSidebarRows = (sessions: Session[]): SidebarRow[] =>
  STATE_ORDER.flatMap((state): SidebarRow[] => {
    const members = sessions.filter((session) => session.state === state);
    if (members.length === 0) return [];
    return [
      // セッションの id は UUID なので、接頭辞を付けておけば見出しの key と衝突しない。
      { kind: "header", key: `header:${state}`, state, label: STATE_LABEL[state], count: members.length },
      ...members.map((session): SidebarRow => ({ kind: "session", key: session.id, session })),
    ];
  });
