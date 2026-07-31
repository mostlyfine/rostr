import { computed, ref } from "vue";
import { loadSoundEnabled, saveSoundEnabled } from "../soundSettings";

/**
 * サイドバーのトグルと App.vue の再生判定が同じ設定を見る必要があるので、
 * 状態はモジュールスコープに置いて useSoundSettings() の呼び出し間で共有する。
 */
const enabled = ref<boolean>(loadSoundEnabled());

const LABELS: Record<"true" | "false", { icon: string; title: string }> = {
  true: { icon: "🔔", title: "Sound: On" },
  false: { icon: "🔕", title: "Sound: Off" },
};

export const useSoundSettings = () => {
  const label = computed(() => LABELS[enabled.value ? "true" : "false"]);

  const toggle = () => {
    enabled.value = !enabled.value;
    saveSoundEnabled(enabled.value);
  };

  return { enabled, label, toggle };
};
