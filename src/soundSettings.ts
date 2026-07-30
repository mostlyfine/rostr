export const SOUND_ENABLED_KEY = "rostr:sound-enabled";

/** 保存された設定を返す。未設定・未知の値はどちらも既定の true(オン)に倒す。 */
export const loadSoundEnabled = (): boolean => {
  try {
    return localStorage.getItem(SOUND_ENABLED_KEY) !== "false";
  } catch {
    return true;
  }
};

/** on/off の選択を保存する。 */
export const saveSoundEnabled = (enabled: boolean): void => {
  try {
    localStorage.setItem(SOUND_ENABLED_KEY, String(enabled));
  } catch {
    // プライベートモード等で書けなくても、その回の表示は続けられるので黙って諦める。
  }
};
