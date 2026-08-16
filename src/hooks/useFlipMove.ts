import { useLayoutEffect, useRef } from "hono/jsx/dom";
import type { RefObject } from "hono/jsx";

/** 行が移動して見える時間。入退場より少し長く取って、動きを目で追えるようにする。 */
export const MOVE_MS = 260;

/**
 * 並び替わった子要素を、元の位置から新しい位置へ滑らせる（FLIP）。
 * Vue の TransitionGroup が持っていた row-move の置き換え。
 *
 * 直前の位置を覚えておき、DOM が入れ替わった直後に差分ぶんだけ逆向きの transform を当てて
 * 元の場所に見せかけ、次のフレームで transition 付きで外す。useLayoutEffect は DOM 反映後に
 * 同期で走るので、引き戻しは一度も描かれないうちに間に合う。
 *
 * 位置は getBoundingClientRect ではなく offsetTop で測る。transform はレイアウトを動かさない
 * ので、アニメーションの最中に測り直しても値が濁らず、一覧のスクロール位置にも影響されない。
 *
 * isStatic は動かさない行を呼び手が教えるためのもの。流れの外へ出した行（退場中など）は
 * 位置を測る意味がなく、こちらが当てたインライン指定も邪魔になる。
 */
export const useFlipMove = (
  container: RefObject<HTMLElement | null>,
  isStatic: (row: HTMLElement) => boolean = () => false,
): void => {
  /**
   * 要素そのものをキーにする。key が同じ行は同じ DOM 要素が使い回されるので、
   * 行の側に目印を持たせなくても追える。消えた行は WeakMap から自然に落ちる。
   */
  const positions = useRef(new WeakMap<HTMLElement, number>());

  useLayoutEffect(() => {
    const rows = container.current?.children;
    if (!rows) return;

    const moved: HTMLElement[] = [];

    for (const row of [...rows] as HTMLElement[]) {
      if (isStatic(row)) {
        // 前の移動の名残を残さない。インラインの transition はクラス側の指定を
        // 上書きするので、置いたままだと退場のフェードが消えてしまう。
        row.style.transition = "";
        row.style.transform = "";
        continue;
      }

      const top = row.offsetTop;
      const previous = positions.current.get(row);
      positions.current.set(row, top);
      // 位置を知らない行は今回現れたもの。入場のフェードに任せる。
      if (previous === undefined || previous === top) continue;

      row.style.transition = "none";
      row.style.transform = `translateY(${previous - top}px)`;
      moved.push(row);
    }

    if (moved.length === 0) return;

    // 引き戻しが一度描かれた次のフレームでまとめて外す。予約は 1 回で足りる。
    requestAnimationFrame(() => {
      for (const row of moved) {
        row.style.transition = `transform ${MOVE_MS}ms ease`;
        row.style.transform = "";
      }
    });
  });
};
