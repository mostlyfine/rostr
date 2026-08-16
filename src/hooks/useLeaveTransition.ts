import { useEffect, useRef, useState } from "hono/jsx/dom";

/** 退場のフェードに使う時間。CSS 側の transition と揃えること。 */
export const LEAVE_MS = 160;

export interface LeaveTransitionRow<T> {
  key: string;
  item: T;
  /** 一覧から消えた後、フェードのために残されている行。 */
  leaving: boolean;
}

interface Leaving<T> {
  key: string;
  item: T;
  /** 消えた時点で何番目にあったか。同じ場所に置き直すために覚える。 */
  index: number;
  removedAt: number;
}

/**
 * 一覧から消えた項目を、消える直前の中身と位置のまま一定時間だけ残す。
 * Vue の TransitionGroup が持っていた退場アニメーションの置き換えで、
 * 呼び手は leaving が立った行に「消えていく」見た目のクラスを当てる。
 *
 * 判定は描画中に行う。effect まで待つと、消えた行が 1 フレーム分だけ本当に
 * 消えてから戻ってきて、フェードの頭がちらついてしまう。
 */
export const useLeaveTransition = <T>(
  items: T[],
  keyOf: (item: T) => string,
  durationMs: number = LEAVE_MS,
): LeaveTransitionRow<T>[] => {
  /** 前回描いたときの並び。消えた項目とその位置を割り出すのに使う。 */
  const previous = useRef<{ key: string; item: T }[]>([]);
  const leaving = useRef<Leaving<T>[]>([]);
  /** タイマーから描き直しを促すためだけの状態。値そのものに意味は無い。 */
  const [, bump] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const current = items.map((item) => ({ key: keyOf(item), item }));
  const currentKeys = new Set(current.map((row) => row.key));

  // 戻ってきた項目は退場を取り消す。残りに、今回消えた項目を足す。
  leaving.current = leaving.current.filter((row) => !currentKeys.has(row.key));
  const stillLeaving = new Set(leaving.current.map((row) => row.key));
  previous.current.forEach((row, index) => {
    if (currentKeys.has(row.key) || stillLeaving.has(row.key)) return;
    leaving.current.push({ ...row, index, removedAt: Date.now() });
  });

  previous.current = current;

  const rows: LeaveTransitionRow<T>[] = current.map((row) => ({ ...row, leaving: false }));
  // 消えた順ではなく元の位置の順に差し込む。後ろから入れると先の index がずれる。
  for (const row of [...leaving.current].sort((a, b) => a.index - b.index)) {
    rows.splice(Math.min(row.index, rows.length), 0, { key: row.key, item: row.item, leaving: true });
  }

  // 残っている中で最も古いものが期限を迎えたら、まとめて片付けて描き直す。
  // 依存を持たないので、cleanup が次の描画前と unmount の両方で予約を取り消す。
  useEffect(() => {
    if (leaving.current.length === 0) return;

    const oldest = Math.min(...leaving.current.map((row) => row.removedAt));
    timer.current = setTimeout(
      () => {
        const limit = Date.now() - durationMs;
        leaving.current = leaving.current.filter((row) => row.removedAt > limit);
        bump((count) => count + 1);
      },
      Math.max(oldest + durationMs - Date.now(), 0),
    );

    return () => clearTimeout(timer.current);
  });

  return rows;
};
