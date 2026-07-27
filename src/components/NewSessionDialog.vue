<script setup lang="ts">
import { onMounted, ref } from "vue";
import { loadRecentDirs } from "../recentDirs";

const props = defineProps<{ error: string | null; busy: boolean }>();
const emit = defineEmits<{ submit: [cwd: string]; cancel: [] }>();

const cwd = ref("");
const recentDirs = ref<string[]>(loadRecentDirs());
const input = ref<HTMLInputElement | null>(null);

onMounted(() => input.value?.focus());

const onSubmit = () => {
  const value = cwd.value.trim();
  if (value === "") return;
  emit("submit", value);
};
</script>

<template>
  <div class="backdrop" @click.self="emit('cancel')">
    <form class="dialog" @submit.prevent="onSubmit">
      <h2>新しいエージェントを起動</h2>

      <label>
        作業ディレクトリ（絶対パス）
        <input ref="input" v-model="cwd" type="text" placeholder="/Users/you/src/project" spellcheck="false" />
      </label>

      <div v-if="recentDirs.length > 0" class="recent">
        <span class="recent-label">最近使ったディレクトリ</span>
        <button
          v-for="dir in recentDirs"
          :key="dir"
          type="button"
          class="recent-item"
          data-test="recent-dir"
          @click="cwd = dir"
        >
          {{ dir }}
        </button>
      </div>

      <p v-if="props.error" class="error">{{ props.error }}</p>

      <div class="actions">
        <button type="button" data-test="cancel" @click="emit('cancel')">キャンセル</button>
        <button type="submit" class="primary" data-test="submit" :disabled="props.busy">
          {{ props.busy ? "起動中…" : "起動" }}
        </button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
}
.dialog {
  width: 480px;
  max-width: 90vw;
  background: #1b202a;
  border: 1px solid #2f3746;
  border-radius: 10px;
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
h2 {
  margin: 0;
  font-size: 15px;
  color: #e6e9ef;
}
label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  color: #b9c0cd;
}
input {
  background: #11151c;
  border: 1px solid #2f3746;
  border-radius: 6px;
  padding: 8px 10px;
  color: #e6e9ef;
  font-size: 13px;
  font-family: ui-monospace, SFMono-Regular, monospace;
}
input:focus {
  outline: none;
  border-color: #3b82f6;
}
.recent {
  display: flex;
  flex-direction: column;
  gap: 3px;
  max-height: 180px;
  overflow-y: auto;
}
.recent-label {
  font-size: 11px;
  color: #6b7280;
}
.recent-item {
  text-align: left;
  background: transparent;
  border: none;
  color: #8fb3e0;
  font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, monospace;
  padding: 3px 6px;
  border-radius: 4px;
  cursor: pointer;
}
.recent-item:hover {
  background: #232a36;
}
.error {
  margin: 0;
  font-size: 12px;
  color: #f87171;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.actions button {
  border: 1px solid #3b4252;
  background: #232a36;
  color: #d8dee9;
  font-size: 12px;
  padding: 6px 14px;
  border-radius: 6px;
  cursor: pointer;
}
.actions .primary {
  background: #2563eb;
  border-color: #2563eb;
  color: #fff;
}
.actions button:disabled {
  opacity: 0.6;
  cursor: default;
}
</style>
