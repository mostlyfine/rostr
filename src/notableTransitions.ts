import type { AgentState, Session } from "../common/types";
import { NOTABLE_STATES } from "./sessionGroups";

export type NotableState = "waiting" | "done";

/**
 * 直前の状態一覧と比べ、新たに waiting/done へ入ったセッションの状態を列挙する。
 * 選択中かどうかは問わない。音は見ていないセッションにも鳴らしたいため。
 */
export const detectNotableTransitions = (
  list: Session[],
  prevStates: Map<string, AgentState>,
): NotableState[] =>
  list
    .filter((session) => {
      const prev = prevStates.get(session.id);
      return prev !== undefined && !NOTABLE_STATES.includes(prev) && NOTABLE_STATES.includes(session.state);
    })
    .map((session) => session.state as NotableState);
