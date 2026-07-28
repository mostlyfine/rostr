<script setup lang="ts">
import { ref, watch } from "vue";
import type { Session } from "../../common/types";
import { NOTABLE_STATES } from "../sessionGroups";

const props = defineProps<{ session: Session; selected: boolean }>();
const emit = defineEmits<{ select: [id: string]; close: [id: string] }>();

const blink = ref(false);

/**
 * 別のターミナルを見ている間に状態が変わっても気づけるよう、クリックされるまで点滅させ続ける。
 * 監視するのは遷移であって状態そのものではないので、開いた時点で既に完了している行は点滅しない。
 */
watch(
  () => props.session.state,
  (state) => {
    if (!NOTABLE_STATES.includes(state)) return;
    blink.value = true;
  },
);

const select = () => {
  blink.value = false;
  emit("select", props.session.id);
};
</script>

<template>
  <li class="item" :class="[props.session.state, { selected: props.selected, blink }]">
    <div class="body" data-test="session-body" @click="select">
      <div class="title-row">
        <span class="dot" :class="props.session.state" />
        <span class="title">{{ props.session.title }}</span>
      </div>
      <p class="prompt" :class="{ empty: !props.session.prompt }">
        {{ props.session.prompt || "No prompt entered" }}
      </p>
      <p v-if="props.session.activity" class="activity">{{ props.session.activity }}</p>
    </div>
    <button
      class="close"
      data-test="session-close"
      title="Close this agent"
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
  background: var(--bg-hover);
}
.item.selected {
  background: var(--bg-selected);
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
  color: var(--text-strong);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: none;
  background: var(--text-muted);
}
.dot.waiting {
  background: var(--state-waiting);
}
.dot.working {
  background: var(--state-working);
}
.dot.done {
  background: var(--state-done);
}
.dot.exited {
  background: var(--state-exited);
}

/*
 * 状態ごとにアニメーション名を分けてある。色を合わせるためだけでなく、done から waiting へ
 * 続けて動いたときに名前が変わって点滅がやり直されるため。
 * クリックされるまで止まらないよう infinite にしてあり、select() 内で blink を false に戻す。
 */
.item.blink.waiting {
  animation: blink-waiting 600ms ease-in-out infinite;
}
.item.blink.done {
  animation: blink-done 600ms ease-in-out infinite;
}
.item.blink .dot {
  animation: blink-dot 600ms ease-in-out infinite;
}
/* 背景ではなく内側の枠を光らせる。選択中の背景色と喧嘩しない。 */
@keyframes blink-waiting {
  50% {
    box-shadow: inset 0 0 0 1px var(--state-waiting);
  }
}
@keyframes blink-done {
  50% {
    box-shadow: inset 0 0 0 1px var(--state-done);
  }
}
@keyframes blink-dot {
  50% {
    opacity: 0.2;
  }
}
.prompt {
  margin: 3px 0 0;
  font-size: 12px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
}
.prompt.empty {
  color: var(--text-muted);
  font-style: italic;
}
.activity {
  margin: 3px 0 0;
  font-size: 11px;
  color: var(--text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.close {
  flex: none;
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-size: 16px;
  line-height: 1;
  padding: 2px 5px;
  border-radius: 4px;
  cursor: pointer;
}
.close:hover {
  background: var(--bg-danger-hover);
  color: var(--text-danger);
}
</style>
