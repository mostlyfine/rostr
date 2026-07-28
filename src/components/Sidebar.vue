<script setup lang="ts">
import { computed } from "vue";
import type { Session } from "../../common/types";
import { toSidebarRows } from "../sessionGroups";
import SessionItem from "./SessionItem.vue";

const props = defineProps<{ sessions: Session[]; selectedId: string | null }>();
const emit = defineEmits<{ select: [id: string]; close: [id: string]; create: [] }>();

const rows = computed(() => toSidebarRows(props.sessions));
</script>

<template>
  <aside class="sidebar">
    <header class="header">
      <h1>multi-agent</h1>
      <button class="new" data-test="new-session" @click="emit('create')">+ 新規</button>
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
  background: #161a22;
  border-right: 1px solid #262c38;
}
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px;
  border-bottom: 1px solid #262c38;
}
h1 {
  margin: 0;
  font-size: 14px;
  color: #e6e9ef;
}
.new {
  border: 1px solid #3b4252;
  background: #232a36;
  color: #d8dee9;
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 5px;
  cursor: pointer;
}
.new:hover {
  background: #2d3644;
}
.list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}
.empty {
  color: #6b7280;
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
  color: #8b93a3;
}
.group-label:not(:first-child) {
  margin-top: 12px;
}
.count {
  background: #262c38;
  color: #b9c0cd;
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
