<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import Sidebar from "./components/Sidebar.vue";
import NewSessionDialog from "./components/NewSessionDialog.vue";
import TerminalView from "./components/TerminalView.vue";
import { useSessions } from "./composables/useSessions";
import { rememberRecentDir } from "./recentDirs";

const { sessions, create, close } = useSessions();

const selectedId = ref<string | null>(null);
const dialogOpen = ref(false);
const dialogError = ref<string | null>(null);
const busy = ref(false);

/** 一度でも表示したセッションはターミナルを保持し続け、切り替えを即座にする。 */
const openedIds = ref<string[]>([]);

const selectedSession = computed(() => sessions.value.find((s) => s.id === selectedId.value) ?? null);

/** 各ターミナルへフォーカスを渡すための参照。v-for なので id をキーに自分で持つ。 */
type TerminalHandle = { focus: () => void };
const terminals = new Map<string, TerminalHandle>();

const registerTerminal = (id: string) => (instance: unknown) => {
  if (instance) terminals.set(id, instance as TerminalHandle);
  else terminals.delete(id);
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

// 削除されたセッションのターミナルを片付け、選択を別のセッションへ移す。
watch(sessions, (list) => {
  const alive = new Set(list.map((session) => session.id));
  openedIds.value = openedIds.value.filter((id) => alive.has(id));
  if (selectedId.value && !alive.has(selectedId.value)) {
    selectedId.value = list[0]?.id ?? null;
    if (selectedId.value) select(selectedId.value);
  }
});

const openDialog = () => {
  dialogError.value = null;
  dialogOpen.value = true;
};

const onSubmit = async (cwd: string) => {
  busy.value = true;
  dialogError.value = null;
  try {
    const session = await create(cwd);
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
      </header>

      <div class="terminals">
        <TerminalView
          v-for="id in openedIds"
          :key="id"
          :ref="registerTerminal(id)"
          :session-id="id"
          :visible="id === selectedId"
        />
        <p v-if="!selectedId" class="placeholder">
          左のサイドバーからエージェントを選ぶか、「+ 新規」で起動してください。
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
  font-size: 13px;
  font-weight: 600;
  color: var(--text-strong);
}
.main-cwd {
  font-size: 11px;
  color: var(--text-muted);
  font-family: ui-monospace, SFMono-Regular, monospace;
}
.terminals {
  position: relative;
  flex: 1;
  min-height: 0;
}
.placeholder {
  color: var(--text-muted);
  font-size: 13px;
  padding: 24px;
}
</style>
