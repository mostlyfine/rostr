<script setup lang="ts">
import { computed } from "vue";
import type { Session } from "../../common/types";
import { groupByState } from "../sessionGroups";
import SessionItem from "./SessionItem.vue";

const props = defineProps<{ sessions: Session[]; selectedId: string | null }>();
const emit = defineEmits<{ select: [id: string]; close: [id: string]; create: [] }>();

const groups = computed(() => groupByState(props.sessions));
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

      <section v-for="group in groups" :key="group.state" class="group">
        <h2 class="group-label">
          <span data-test="group-label">{{ group.label }}</span>
          <span class="count">{{ group.sessions.length }}</span>
        </h2>
        <ul>
          <SessionItem
            v-for="session in group.sessions"
            :key="session.id"
            :session="session"
            :selected="session.id === props.selectedId"
            @select="emit('select', $event)"
            @close="emit('close', $event)"
          />
        </ul>
      </section>
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
.group + .group {
  margin-top: 14px;
}
.group-label {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 0 4px;
  padding: 0 4px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: #8b93a3;
}
.count {
  background: #262c38;
  color: #b9c0cd;
  border-radius: 8px;
  padding: 0 6px;
  font-size: 10px;
}
ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
</style>
