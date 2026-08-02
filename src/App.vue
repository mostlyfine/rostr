<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import Sidebar from "./components/Sidebar.vue";
import NewSessionDialog from "./components/NewSessionDialog.vue";
import TerminalView from "./components/TerminalView.vue";
import { useSessions } from "./composables/useSessions";
import { useFontScaleShortcut } from "./composables/useFontScaleShortcut";
import { useSoundSettings } from "./composables/useSoundSettings";
import { rememberRecentDir } from "./recentDirs";
import { NOTABLE_STATES } from "./sessionGroups";
import { detectNotableTransitions } from "./notableTransitions";
import { playNotificationSound } from "./sound";
import type { AgentKind } from "../common/agents";
import type { AgentState, Session } from "../common/types";

const { sessions, create, close, openShell, closeShell } = useSessions();

const selectedId = ref<string | null>(null);
const dialogOpen = ref(false);
const dialogError = ref<string | null>(null);
const busy = ref(false);

/** 一度でも表示したセッションはターミナルを保持し続け、切り替えを即座にする。 */
const openedIds = ref<string[]>([]);

const selectedSession = computed(() => sessions.value.find((s) => s.id === selectedId.value) ?? null);

/** 各ターミナルへフォーカスを渡すための参照。v-for なので id をキーに自分で持つ。 */
type TerminalHandle = { focus: () => void; hasFocus: () => boolean };
const terminals = new Map<string, TerminalHandle>();
/** スプリットで開いたシェル。id は claude 側と同じなので別の Map に分ける。 */
const shellTerminals = new Map<string, TerminalHandle>();

/** スプリットの開閉はサーバが持つシェルの有無が正。ブラウザ側では覚えない。 */
const shellOpenIds = computed(
  () => new Set(sessions.value.filter((session) => session.shell).map((session) => session.id)),
);
const splitOpen = computed(() => selectedSession.value?.shell ?? false);

/** 開いたシェルが実際に現れるのは SSE が届いてからなので、フォーカス先を覚えて待つ。 */
const pendingShellFocus = ref<string | null>(null);

/** 直前に見たセッション状態。waiting/done への「遷移」を検知するための基準値。 */
const prevStates = new Map<string, AgentState>();

const { enabled: soundEnabled } = useSoundSettings();

const registerTerminal = (id: string) => (instance: unknown) => {
  if (instance) terminals.set(id, instance as TerminalHandle);
  else terminals.delete(id);
};

const registerShell = (id: string) => (instance: unknown) => {
  if (instance) shellTerminals.set(id, instance as TerminalHandle);
  else shellTerminals.delete(id);
};

/**
 * 選択中セッションの脇にシェルを開く / 閉じる。
 * 開閉の結果は SSE の一覧に載って戻ってくるので、ここでは表示状態を触らない。
 */
const toggleSplit = async () => {
  const id = selectedId.value;
  if (!id) return;
  if (splitOpen.value) {
    await closeShell(id);
    terminals.get(id)?.focus();
    return;
  }
  pendingShellFocus.value = id;
  await openShell(id);
};

/**
 * サイドバーから選ぶと、そのままキー入力できるようメイン画面へフォーカスを移す。
 * 初回に開いた場合はここで初めてターミナルが生成されるので、描画を待ってから呼ぶ。
 */
const select = async (id: string) => {
  selectedId.value = id;
  if (!openedIds.value.includes(id)) openedIds.value.push(id);
  await nextTick();
  terminals.get(id)?.focus();
};

/**
 * waiting/done に新しく遷移したセッションを見つけ、いま操作中でなければそこへフォーカスを移す。
 * 選択中のターミナルに実際に入力中（hasFocus）の場合は奪わず、点滅による通知だけに任せる。
 */
const focusNewlyNotable = (list: Session[]) => {
  const newlyNotable = list.find((session) => {
    const prev = prevStates.get(session.id);
    return (
      prev !== undefined &&
      !NOTABLE_STATES.includes(prev) &&
      NOTABLE_STATES.includes(session.state) &&
      session.id !== selectedId.value
    );
  });
  if (!newlyNotable) return;
  const selectedIsBusy = !!selectedId.value && (terminals.get(selectedId.value)?.hasFocus() ?? false);
  if (!selectedIsBusy) select(newlyNotable.id);
};

/** waiting/done に新しく遷移した全セッション分、状態に応じた音を鳴らす。 */
const playNotableSounds = (list: Session[]) => {
  if (!soundEnabled.value) return;
  for (const state of detectNotableTransitions(list, prevStates)) playNotificationSound(state);
};

/** 押した直後に開いたシェルへフォーカスを移す。描画されるのはこの一覧が届いた後。 */
const focusOpenedShell = async (list: Session[]) => {
  const id = pendingShellFocus.value;
  if (!id || !shellOpenIds.value.has(id)) return;
  pendingShellFocus.value = null;
  // 一覧から消えたセッションのシェルは開かない。
  if (!list.some((session) => session.id === id)) return;
  await nextTick();
  shellTerminals.get(id)?.focus();
};

// 削除されたセッションのターミナルを片付け、選択を別のセッションへ移す。
watch(sessions, (list) => {
  focusOpenedShell(list);
  focusNewlyNotable(list);
  playNotableSounds(list);
  prevStates.clear();
  for (const session of list) prevStates.set(session.id, session.state);

  const alive = new Set(list.map((session) => session.id));
  openedIds.value = openedIds.value.filter((id) => alive.has(id));
  if (selectedId.value && !alive.has(selectedId.value)) {
    selectedId.value = list[0]?.id ?? null;
    if (selectedId.value) select(selectedId.value);
  }
});

const { scale: fontScale, shown: shownScale, dismiss: dismissScale } = useFontScaleShortcut();

const openDialog = () => {
  dialogError.value = null;
  dialogOpen.value = true;
};

const onSubmit = async (cwd: string, agent: AgentKind) => {
  busy.value = true;
  dialogError.value = null;
  try {
    const session = await create(cwd, agent);
    rememberRecentDir(session.cwd);
    dialogOpen.value = false;
    select(session.id);
  } catch (error) {
    dialogError.value = error instanceof Error ? error.message : String(error);
  } finally {
    busy.value = false;
  }
};
</script>

<template>
  <div class="layout">
    <Sidebar
      :sessions="sessions"
      :selected-id="selectedId"
      @select="select"
      @close="close"
      @create="openDialog"
    />

    <main class="main">
      <header v-if="selectedSession" class="main-header">
        <span class="main-title">{{ selectedSession.title }}</span>
        <span class="main-cwd">{{ selectedSession.cwd }}</span>
        <button
          class="split"
          data-test="split-toggle"
          :class="{ active: splitOpen }"
          :title="splitOpen ? 'Close the shell' : 'Open a shell in this directory'"
          @click="toggleSplit()"
        >
          ◫
        </button>
      </header>

      <div class="terminals">
        <template v-for="id in openedIds" :key="id">
          <TerminalView
            :ref="registerTerminal(id)"
            :session-id="id"
            :visible="id === selectedId"
          />
          <TerminalView
            v-if="shellOpenIds.has(id)"
            :ref="registerShell(id)"
            :session-id="id"
            kind="shell"
            :visible="id === selectedId"
          />
        </template>
        <p v-if="!selectedId" class="placeholder">
          Select an agent from the sidebar, or launch one with "+ New".
        </p>
      </div>
    </main>

    <NewSessionDialog
      v-if="dialogOpen"
      :error="dialogError"
      :busy="busy"
      @submit="onSubmit"
      @cancel="dialogOpen = false"
    />

    <!-- 消えるまでの時間は CSS のアニメーションが持つ。終わりを受けて要素を落とす。 -->
    <div
      v-if="shownScale !== null"
      :key="shownScale"
      class="scale-toast"
      data-test="font-scale-toast"
      @animationend="dismissScale()"
    >
      {{ fontScale }}%
    </div>
  </div>
</template>

<style scoped>
.layout {
  display: flex;
  height: 100vh;
  overflow: hidden;
}
.main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-app);
}
.main-header {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
}
.main-title {
  font-size: var(--fs-sm);
  font-weight: 600;
  color: var(--text-strong);
}
.main-cwd {
  font-size: var(--fs-2xs);
  color: var(--text-muted);
  font-family: ui-monospace, SFMono-Regular, monospace;
}
.split {
  margin-left: auto;
  border: 1px solid var(--border-control);
  background: var(--bg-control);
  color: var(--text);
  font-size: var(--fs-xs);
  padding: 2px 8px;
  border-radius: 5px;
  cursor: pointer;
  line-height: 1.35;
}
.split:hover {
  background: var(--bg-control-hover);
}
/* 開いている間は押した状態に見せる。 */
.split.active {
  background: var(--bg-control-hover);
  color: var(--text-strong);
}
/* 表示中のペインだけが並ぶ行。非表示のターミナルは display:none なので場所を取らない。 */
.terminals {
  display: flex;
  flex: 1;
  min-height: 0;
}
.placeholder {
  color: var(--text-muted);
  font-size: var(--fs-sm);
  padding: 24px;
}
/* 倍率を変えた直後だけ画面の下に浮かせる。下のターミナルを触れなくしないよう当たり判定は外す。 */
.scale-toast {
  position: fixed;
  left: 50%;
  bottom: 48px;
  transform: translateX(-50%);
  padding: 6px 16px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  background: var(--bg-surface);
  color: var(--text-strong);
  font-size: var(--fs-sm);
  font-variant-numeric: tabular-nums;
  pointer-events: none;
  animation: scale-toast-fade 1s ease forwards;
}
/* 消える直前まで読める濃さを保ち、最後だけ薄くする。 */
@keyframes scale-toast-fade {
  0%,
  70% {
    opacity: 1;
  }
  100% {
    opacity: 0;
  }
}
</style>
