<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import type { ClientMessage } from "../../common/types";
import { XTERM_THEMES } from "../theme";
import { createTerminalOptions } from "../terminalOptions";
import { SHIFT_ENTER_INPUT, isShiftEnter } from "../terminalKeys";
import { useTheme } from "../composables/useTheme";

const props = defineProps<{ sessionId: string; visible: boolean }>();

const { theme: currentTheme } = useTheme();

const host = ref<HTMLDivElement | null>(null);
let term: Terminal | null = null;
let fitAddon: FitAddon | null = null;
let socket: WebSocket | null = null;
let observer: ResizeObserver | null = null;

const send = (message: ClientMessage) => {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
};

/** 表示中のときだけ寸法が測れるので、可視化直後とリサイズ時に呼ぶ。 */
const fit = () => {
  if (!props.visible || !fitAddon || !term) return;
  try {
    fitAddon.fit();
  } catch {
    // 非表示のまま呼ばれた場合は寸法が取れないので何もしない。
    return;
  }
  send({ type: "resize", cols: term.cols, rows: term.rows });
};

onMounted(() => {
  term = new Terminal(createTerminalOptions(currentTheme.value));
  fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.loadAddon(new WebLinksAddon());
  term.open(host.value!);
  term.onData((data) => send({ type: "input", data }));
  // Shift+Enter だけは xterm の既定（CR 送出）を止めて自前で送る。claude の /terminal-setup が
  // iTerm2 などに設定するのと同じシーケンスなので、ローカルのターミナルと同じ操作感になる。
  term.attachCustomKeyEventHandler((event) => {
    if (!isShiftEnter(event)) return true;
    // このハンドラは keydown と keypress の両方で呼ばれるので、送信は keydown の一度だけにする。
    if (event.type === "keydown") send({ type: "input", data: SHIFT_ENTER_INPUT });
    return false;
  });

  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  socket = new WebSocket(`${protocol}//${location.host}/ws?session=${props.sessionId}`);
  // サーバは接続直後にスクロールバックを、その後は PTY の出力をそのまま送ってくる。
  socket.onmessage = (event) => term?.write(event.data as string);
  socket.onopen = () => fit();

  observer = new ResizeObserver(() => fit());
  observer.observe(host.value!);

  if (props.visible) fit();
});

/** 非表示中は寸法が 0 なので、表示に戻った直後に測り直してからフォーカスする。 */
const focus = () => {
  requestAnimationFrame(() => {
    fit();
    term?.focus();
  });
};

/** ユーザーがこのターミナルに入力中か。自動フォーカス切り替えでキー入力を奪わないための判定に使う。 */
const hasFocus = () => host.value?.contains(document.activeElement) ?? false;

watch(
  () => props.visible,
  (visible) => {
    if (visible) focus();
  },
);

// xterm は Canvas 描画で CSS 変数を追えないので、切り替えのたびに theme を差し替える。
watch(currentTheme, (theme) => {
  if (term) term.options.theme = XTERM_THEMES[theme];
});

defineExpose({ focus, hasFocus });

onBeforeUnmount(() => {
  observer?.disconnect();
  socket?.close();
  term?.dispose();
});
</script>

<template>
  <div v-show="props.visible" ref="host" class="terminal" />
</template>

<style scoped>
.terminal {
  width: 100%;
  height: 100%;
  padding: 6px;
  box-sizing: border-box;
  background: var(--bg-app);
}
</style>
