<script setup lang="ts">
import type { Session } from "../../common/types";

const props = defineProps<{ session: Session; selected: boolean }>();
const emit = defineEmits<{ select: [id: string]; close: [id: string] }>();
</script>

<template>
  <li class="item" :class="{ selected: props.selected }">
    <div class="body" data-test="session-body" @click="emit('select', props.session.id)">
      <div class="title-row">
        <span class="dot" :class="props.session.state" />
        <span class="title">{{ props.session.title }}</span>
      </div>
      <p class="prompt" :class="{ empty: !props.session.prompt }">
        {{ props.session.prompt || "プロンプト未入力" }}
      </p>
      <p v-if="props.session.activity" class="activity">{{ props.session.activity }}</p>
    </div>
    <button
      class="close"
      data-test="session-close"
      title="このエージェントを終了する"
      @click.stop="emit('close', props.session.id)"
    >
      ×
    </button>
  </li>
</template>

<style scoped>
.item {
  display: flex;
  align-items: flex-start;
  gap: 4px;
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
}
.item:hover {
  background: #1f2430;
}
.item.selected {
  background: #2a3140;
}
.body {
  flex: 1;
  min-width: 0;
}
.title-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.title {
  font-size: 13px;
  font-weight: 600;
  color: #e6e9ef;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: none;
  background: #6b7280;
}
.dot.waiting {
  background: #f59e0b;
}
.dot.working {
  background: #3b82f6;
}
.dot.done {
  background: #22c55e;
}
.dot.exited {
  background: #4b5563;
}
.prompt {
  margin: 3px 0 0;
  font-size: 12px;
  color: #b9c0cd;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
}
.prompt.empty {
  color: #6b7280;
  font-style: italic;
}
.activity {
  margin: 3px 0 0;
  font-size: 11px;
  color: #8b93a3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.close {
  flex: none;
  border: none;
  background: transparent;
  color: #6b7280;
  font-size: 16px;
  line-height: 1;
  padding: 2px 5px;
  border-radius: 4px;
  cursor: pointer;
}
.close:hover {
  background: #3b3040;
  color: #f87171;
}
</style>
