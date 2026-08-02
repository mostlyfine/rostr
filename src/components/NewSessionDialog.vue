<script setup lang="ts">
import { onMounted, ref } from "vue";
import { AGENTS, AGENT_KINDS, type AgentKind } from "../../common/agents";
import { loadRecentDirs } from "../recentDirs";

const props = defineProps<{ error: string | null; busy: boolean }>();
const emit = defineEmits<{ submit: [cwd: string, agent: AgentKind]; cancel: [] }>();

const cwd = ref("");
const agent = ref<AgentKind>("claude");
const recentDirs = ref<string[]>(loadRecentDirs());
const input = ref<HTMLInputElement | null>(null);

onMounted(() => input.value?.focus());

const onSubmit = () => {
  const value = cwd.value.trim();
  if (value === "") return;
  emit("submit", value, agent.value);
};
</script>

<template>
  <div class="backdrop" @click.self="emit('cancel')">
    <form class="dialog" @submit.prevent="onSubmit">
      <h2>Launch New Agent</h2>

      <label>
        Agent
        <select v-model="agent" data-test="agent">
          <option v-for="kind in AGENT_KINDS" :key="kind" :value="kind">
            {{ AGENTS[kind].label }}
          </option>
        </select>
      </label>

      <label>
        Working Directory (absolute path)
        <input ref="input" v-model="cwd" type="text" placeholder="/Users/you/src/project" spellcheck="false" />
      </label>

      <div v-if="recentDirs.length > 0" class="recent">
        <span class="recent-label">Recent Directories</span>
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
        <button type="button" data-test="cancel" @click="emit('cancel')">Cancel</button>
        <button type="submit" class="primary" data-test="submit" :disabled="props.busy">
          {{ props.busy ? "Launching…" : "Launch" }}
        </button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  background: var(--bg-backdrop);
  display: flex;
  align-items: center;
  justify-content: center;
}
.dialog {
  /* 中の文字が倍率で伸びるので、箱も追従させないとパスが読めなくなる（Sidebar と同じ理由）。 */
  width: calc(480px * var(--font-scale));
  max-width: 90vw;
  background: var(--bg-surface);
  border: 1px solid var(--border-strong);
  border-radius: 10px;
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
h2 {
  margin: 0;
  font-size: var(--fs-lg);
  color: var(--text-strong);
}
label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: var(--fs-xs);
  color: var(--text-secondary);
}
input,
select {
  background: var(--bg-input);
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  padding: 8px 10px;
  color: var(--text-strong);
  font-size: var(--fs-sm);
  font-family: ui-monospace, SFMono-Regular, monospace;
}
input:focus,
select:focus {
  outline: none;
  border-color: var(--focus-ring);
}
.recent {
  display: flex;
  flex-direction: column;
  gap: 3px;
  /* 倍率に追従させて、拡大しても見える履歴の件数が変わらないようにする。 */
  max-height: calc(180px * var(--font-scale));
  overflow-y: auto;
}
.recent-label {
  font-size: var(--fs-2xs);
  color: var(--text-muted);
}
.recent-item {
  text-align: left;
  background: transparent;
  border: none;
  color: var(--text-link);
  font-size: var(--fs-xs);
  font-family: ui-monospace, SFMono-Regular, monospace;
  padding: 3px 6px;
  border-radius: 4px;
  cursor: pointer;
}
.recent-item:hover {
  background: var(--bg-control);
}
.error {
  margin: 0;
  font-size: var(--fs-xs);
  color: var(--text-danger);
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.actions button {
  border: 1px solid var(--border-control);
  background: var(--bg-control);
  color: var(--text);
  font-size: var(--fs-xs);
  padding: 6px 14px;
  border-radius: 6px;
  cursor: pointer;
}
.actions .primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--text-on-accent);
}
.actions button:disabled {
  opacity: 0.6;
  cursor: default;
}
</style>
