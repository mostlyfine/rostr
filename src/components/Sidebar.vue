<script setup lang="ts">
import { computed } from "vue";
import type { Session } from "../../common/types";
import { toSidebarRows } from "../sessionGroups";
import { useTheme } from "../composables/useTheme";
import SessionItem from "./SessionItem.vue";

const props = defineProps<{ sessions: Session[]; selectedId: string | null }>();
const emit = defineEmits<{ select: [id: string]; close: [id: string]; create: [] }>();

const rows = computed(() => toSidebarRows(props.sessions));
const { label: themeLabel, toggle: toggleTheme } = useTheme();
</script>

<template>
  <aside class="sidebar">
    <header class="header">
      <h1>rostr</h1>
      <div class="actions">
        <button
          class="theme"
          data-test="theme-toggle"
          :title="themeLabel.title"
          @click="toggleTheme()"
        >
          {{ themeLabel.icon }}
        </button>
        <button class="new" data-test="new-session" @click="emit('create')">+ 新規</button>
      </div>
    </header>

    <div class="list">
      <p v-if="props.sessions.length === 0" class="empty">
        エージェントがありません。「+ 新規」から起動してください。
      </p>

      <TransitionGroup tag="ul" name="row" class="rows">
        <template v-for="row in rows" :key="row.key">
          <li v-if="row.kind === 'header'" class="group-label">
            <span data-test="group-label">{{ row.label }}</span>
            <span class="count">{{ row.count }}</span>
          </li>
          <SessionItem
            v-else
            :session="row.session"
            :selected="row.session.id === props.selectedId"
            @select="emit('select', $event)"
            @close="emit('close', $event)"
          />
        </template>
      </TransitionGroup>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  width: 280px;
  flex: none;
  display: flex;
  flex-direction: column;
  background: var(--bg-sidebar);
  border-right: 1px solid var(--border);
}
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px;
  border-bottom: 1px solid var(--border);
}
h1 {
  margin: 0;
  font-size: 14px;
  color: var(--text-strong);
}
.actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
.new,
.theme {
  border: 1px solid var(--border-control);
  background: var(--bg-control);
  color: var(--text);
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 5px;
  cursor: pointer;
}
.new:hover,
.theme:hover {
  background: var(--bg-control-hover);
}
/* 絵文字1文字なので、+ 新規 と高さを揃えつつ左右を詰める。 */
.theme {
  padding: 4px 7px;
  line-height: 1.35;
}
.list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}
.empty {
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.6;
  padding: 8px;
}
.group-label {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 4px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--text-tertiary);
}
.group-label:not(:first-child) {
  margin-top: 12px;
}
.count {
  background: var(--bg-badge);
  color: var(--text-secondary);
  border-radius: 8px;
  padding: 0 6px;
  font-size: 10px;
}
.rows {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  /* 抜けていく行を absolute で浮かせるので、その基準になる。 */
  position: relative;
}

/* 状態が変わった行が別のグループへ動く様子を追えるようにする。 */
.row-move {
  transition: transform 260ms ease;
}
.row-enter-active,
.row-leave-active {
  transition: opacity 160ms ease;
}
.row-enter-from,
.row-leave-to {
  opacity: 0;
}
/* 消えていく行を流れから外し、残った行がその場で詰まれるようにする。 */
.row-leave-active {
  position: absolute;
  left: 0;
  right: 0;
}
</style>
