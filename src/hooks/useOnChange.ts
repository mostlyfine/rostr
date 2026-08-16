import { useEffect, useRef } from "hono/jsx/dom";

/**
 * 値が変わったときだけ呼ぶ。マウント時には呼ばない。
 * useEffect は初回にも走ってしまうので、Vue の watch（immediate なし）と同じ意味に揃えるための包み。
 * 「いまの状態」ではなく「状態が変わったこと」に反応したい場所——点滅の開始や、
 * 表示に戻った瞬間のフォーカス移動——で使う。
 */
export const useOnChange = <T>(value: T, effect: (value: T) => void): void => {
  const previous = useRef(value);

  useEffect(() => {
    const changed = previous.current !== value;
    previous.current = value;
    if (changed) effect(value);
  }, [value]);
};
