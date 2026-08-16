import { useImperativeHandle, useRef } from "hono/jsx/dom";
import type { RefObject } from "hono/jsx";

/**
 * 親へ操作の口を渡す。hono の useImperativeHandle は ref.current へ無条件に代入するので、
 * 親が口を欲しがらないとき（forwardRef が ref に undefined を渡す）そのままでは落ちる。
 * 捨てる先を用意して、呼ぶ側が毎回この回避を書かずに済むようにする。
 */
export const useOptionalHandle = <T>(
  ref: RefObject<T | null> | undefined,
  createHandle: () => T,
): void => {
  const unused = useRef<T | null>(null);
  useImperativeHandle(ref ?? unused, createHandle, []);
};
