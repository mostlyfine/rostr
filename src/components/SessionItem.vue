<script setup lang="ts">
import { onUnmounted, ref, watch } from "vue";
import type { AgentState, Session } from "../../common/types";
import { BLINK_MS } from "../blink";

const props = defineProps<{ session: Session; selected: boolean }>();
const emit = defineEmits<{ select: [id: string]; close: [id: string] }>();

/** ユーザーの目を引きたい状態。どちらもこれ以上は勝手に進まず、人の操作を待っている。 */
const NOTABLE: AgentState[] = ["waiting", "done"];

const blink = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;

/**
 * 別のターミナルを見ている間に状態が変わっても気づけるよう、数回だけ点滅させる。
 * 監視するのは遷移であって状態そのものではないので、開いた時点で既に完了している行は点滅しない。
 */
watch(
  () => props.session.state,
  (state) => {
    if (!NOTABLE.includes(state)) return;
    clearTimeout(timer);
    blink.value = true;
    timer = setTimeout(() => (blink.value = false), BLINK_MS);
  },
);

onUnmounted(() => clearTimeout(timer));
</script>

<template>
  <li class="item" :class="[props.session.state, { selected: props.selected, blink }]">
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

/*
 * 状態ごとにアニメーション名を分けてある。色を合わせるためだけでなく、done から waiting へ
 * 続けて動いたときに名前が変わって点滅がやり直されるため。
 * 回数と長さは src/blink.ts の BLINK_MS（600ms × 3）と揃えること。
 */
.item.blink.waiting {
  animation: blink-waiting 600ms ease-in-out 3;
}
.item.blink.done {
  animation: blink-done 600ms ease-in-out 3;
}
.item.blink .dot {
  animation: blink-dot 600ms ease-in-out 3;
}
/* 背景ではなく内側の枠を光らせる。選択中の背景色と喧嘩しない。 */
@keyframes blink-waiting {
  50% {
    box-shadow: inset 0 0 0 1px #f59e0b;
  }
}
@keyframes blink-done {
  50% {
    box-shadow: inset 0 0 0 1px #22c55e;
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
