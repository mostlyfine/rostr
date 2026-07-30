/**
 * localStorage の読み書き。プライベートモードや保存を切っている環境では例外が飛ぶが、
 * 設定が 1 つ効かないだけでその回の表示は続けられるので、ここで黙って握って既定に倒す。
 * 保存する設定が増えてもこのガードを書き写さずに済むよう、読み書きの口をここへ集める。
 */
export const readStored = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

export const writeStored = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // why not throw: 書けなくてもその回の表示は続けられる。
  }
};
