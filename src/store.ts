/**
 * 購読できる値をひとつだけ持つ入れ物。設定（テーマ・文字倍率・音）のように、
 * 画面のあちこちから同じ値を見て同じ値を書き換えるものを、モジュールスコープに
 * 1 個だけ置くために使う。フック側は useSyncExternalStore で読む。
 */
export interface Store<T> {
  get: () => T;
  /** 同じ値なら通知しない。上下限に張り付いた状態で押し続けても描き直さない。 */
  set: (next: T) => void;
  subscribe: (listener: () => void) => () => void;
}

/**
 * onChange は生成直後にも一度呼ぶ。テーマや倍率の DOM への反映は、誰かが画面を
 * 開くのを待たずに済ませておく必要がある（描く前に確定していないと一瞬ちらつく）。
 */
export const createStore = <T>(initial: T, onChange?: (value: T) => void): Store<T> => {
  let value = initial;
  const listeners = new Set<() => void>();

  onChange?.(value);

  return {
    get: () => value,
    set: (next: T) => {
      if (next === value) return;
      value = next;
      onChange?.(value);
      // 通知の途中で購読が増減しても崩れないよう、複製に対して回す。
      for (const listener of [...listeners]) listener();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};
