import type { AgentState, Session } from "../common/types";

/** ユーザーの目を引きたい状態。これ以上は勝手に進まず、人の操作を待っている。 */
export const NOTABLE_STATES: AgentState[] = ["waiting", "done"];

/** サイドバーでの表示順。人の番が回ってきたものを上に置き、まだ手が要らないものを下にする。 */
export const STATE_ORDER: AgentState[] = ["done", "waiting", "working", "idle", "exited"];

export const STATE_LABEL: Record<AgentState, string> = {
  waiting: "Blocked",
  working: "Working",
  done: "Done",
  idle: "Idle",
  exited: "Exited",
};

export type SidebarRow =
  | { kind: "header"; key: string; state: AgentState; label: string; count: number }
  | { kind: "session"; key: string; session: Session };

/**
 * 状態ごとにまとめたうえで、見出しとセッションを1列へ平らに並べる。該当が無い状態は落とす。
 * 同じ状態の中は作成が古い順。サーバの一覧は tmux から復元したときに順序が変わるので、ここで決める。
 * 状態をまたぐ行の移動をアニメーションさせるには、TransitionGroup の親が1つである必要があるため、
 * グループごとにリストを分けずにこの形にしている。
 */
export const toSidebarRows = (sessions: Session[]): SidebarRow[] => {
  // 状態ごとに 1 周で振り分ける。ここへは SSE が届くたびに来るので、状態の数だけ
  // 一覧を舐め直さない。バケツは新しい配列なので、並べ替えても呼び出し元は動かない。
  const buckets = new Map<AgentState, Session[]>();
  for (const session of sessions) {
    const bucket = buckets.get(session.state);
    if (bucket) bucket.push(session);
    else buckets.set(session.state, [session]);
  }

  const rows: SidebarRow[] = [];
  for (const state of STATE_ORDER) {
    const members = buckets.get(state);
    if (!members) continue;
    members.sort((a, b) => a.createdAt - b.createdAt);
    // セッションの id は UUID なので、接頭辞を付けておけば見出しの key と衝突しない。
    rows.push({ kind: "header", key: `header:${state}`, state, label: STATE_LABEL[state], count: members.length });
    for (const session of members) rows.push({ kind: "session", key: session.id, session });
  }
  return rows;
};

/**
 * waiting/done へ新しく遷移したセッションを1件返す。判定に使うのは状態そのものではなく
 * 遷移なので、前回の一覧に居なかったセッションは対象にしない。選択中のものも対象外。
 * DOM に触れない純関数にしてあるのは、フォーカスを奪う条件だけを単体で確かめられるようにするため。
 */
export const findNewlyNotable = (
  previous: Session[],
  current: Session[],
  selectedId: string | null,
): Session | undefined => {
  const before = new Map(previous.map((session) => [session.id, session.state]));
  return current.find((session) => {
    const prev = before.get(session.id);
    return (
      prev !== undefined &&
      !NOTABLE_STATES.includes(prev) &&
      NOTABLE_STATES.includes(session.state) &&
      session.id !== selectedId
    );
  });
};
