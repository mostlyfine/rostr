import { useSyncExternalStore } from "hono/jsx/dom";
import { loadSoundEnabled, saveSoundEnabled } from "../soundSettings";
import { createStore } from "../store";

/**
 * サイドバーのトグルと App.tsx の再生判定が同じ設定を見る必要があるので、
 * 状態はモジュールスコープに置いて useSoundSettings() の呼び出し間で共有する。
 */
const store = createStore<boolean>(loadSoundEnabled());

const LABELS: Record<"true" | "false", { icon: string; title: string }> = {
  true: { icon: "🔔", title: "Sound: On" },
  false: { icon: "🔕", title: "Sound: Off" },
};

export const toggleSound = () => {
  const next = !store.get();
  store.set(next);
  saveSoundEnabled(next);
};

export const useSoundSettings = () => {
  const enabled = useSyncExternalStore(store.subscribe, store.get);
  return { enabled, label: LABELS[enabled ? "true" : "false"], toggle: toggleSound };
};
