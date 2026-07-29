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
import {
  createWheelAccumulator,
  installMouseReportFilter,
  sgrWheelSequence,
  toCell,
} from "../terminalMouse";
import { createReplayGate } from "../terminalReplay";
import { terminalFontSize } from "../fontScale";
import { useTheme } from "../composables/useTheme";
import { useFontScale } from "../composables/useFontScale";

/** shell はスプリットで開くシェル。id は claude のセッションと共有し、繋ぐ先だけが違う。 */
const props = withDefaults(
  defineProps<{ sessionId: string; visible: boolean; kind?: "agent" | "shell" }>(),
  { kind: "agent" },
);

const { theme: currentTheme } = useTheme();
const { scale: fontScale } = useFontScale();

const host = ref<HTMLDivElement | null>(null);
let term: Terminal | null = null;
let fitAddon: FitAddon | null = null;
let socket: WebSocket | null = null;
let observer: ResizeObserver | null = null;
/** 文字が描かれている領域。ホイールの位置をセル座標へ直すのに寸法が要る。 */
let screen: HTMLElement | null = null;
/** 1 セルの大きさ。ホイールのたびに測るとレイアウトを叩くので、fit のときだけ測り直す。 */
let cell: { width: number; height: number } | null = null;

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
  // xterm はセル寸法を公開していないので、描かれている領域の実寸を列数・行数で割って求める。
  const rect = screen?.getBoundingClientRect();
  cell =
    rect && rect.width > 0 && rect.height > 0
      ? { width: rect.width / term.cols, height: rect.height / term.rows }
      : null;
};

onMounted(() => {
  term = new Terminal(createTerminalOptions(currentTheme.value, fontScale.value));
  fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.loadAddon(new WebLinksAddon());
  term.open(host.value!);
  screen = term.element!.querySelector(".xterm-screen");
  // 再接続直後の replay（端末モード再現 + スクロールバック）には、tmux が attach 時に
  // 送った Device Attributes の問い合わせがそのまま含まれている。xterm はこれを書き込む
  // 際に自動応答を作ってしまうが、tmux はもう問い合わせを待っておらず、応答をただの
  // 入力としてシェルへ素通ししてしまう。replay の書き込み中だけその応答を捨てる。
  const replayGate = createReplayGate(term);
  term.onData((data) => {
    if (replayGate.shouldSuppress()) return;
    send({ type: "input", data });
  });
  // Shift+Enter だけは xterm の既定（CR 送出）を止めて自前で送る。claude の /terminal-setup が
  // iTerm2 などに設定するのと同じシーケンスなので、ローカルのターミナルと同じ操作感になる。
  term.attachCustomKeyEventHandler((event) => {
    if (!isShiftEnter(event)) return true;
    // このハンドラは keydown と keypress の両方で呼ばれるので、送信は keydown の一度だけにする。
    if (event.type === "keydown") send({ type: "input", data: SHIFT_ENTER_INPUT });
    return false;
  });

  // tmux が要求してくるマウス報告は xterm に渡さない。渡すと xterm が選択機能ごと切ってしまい
  // （SelectionService.disable）、ブラウザでの文字選択とコピーができなくなる。
  // 代わりにホイールだけを下のハンドラが自前で tmux へ送るので、履歴スクロールは残る。
  const isMouseReportWanted = installMouseReportFilter(term);

  // 報告を落とした以上、ホイールは xterm からは PTY へ流れない。tmux の copy-mode へ入る
  // 唯一の入口なので、SGR マウス報告の形に組み立てて送る。相手が報告を要求していないとき
  // （tmux 無しの構成）は何もせず、xterm 本来のスクロール動作に任せる。
  const accumulateWheel = createWheelAccumulator();
  term.attachCustomWheelEventHandler((event) => {
    if (!isMouseReportWanted()) return true;
    if (!term || !screen || !cell) return false;

    const lines = accumulateWheel(event.deltaY, event.deltaMode, cell.height);
    event.preventDefault();
    // 1 セルに満たない動きは持ち越されている。座標を測るのは実際に送るときだけでよい。
    if (lines === 0) return false;

    const rect = screen.getBoundingClientRect();
    const col = toCell(event.clientX - rect.left, cell.width, term.cols);
    const row = toCell(event.clientY - rect.top, cell.height, term.rows);
    send({ type: "input", data: sgrWheelSequence(lines < 0, col, row).repeat(Math.abs(lines)) });
    return false;
  });

  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const kind = props.kind === "shell" ? "&kind=shell" : "";
  socket = new WebSocket(`${protocol}//${location.host}/ws?session=${props.sessionId}${kind}`);
  // サーバは接続直後にスクロールバックを、その後は PTY の出力をそのまま送ってくる。
  socket.onmessage = (event) => void replayGate.write(event.data as string);
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

// フォントサイズも同様に CSS では届かない。サイズが変わると列数・行数とセル寸法が
// 変わるので、再描画されてから fit で測り直す（cell が古いとホイールの座標がずれる）。
watch(fontScale, (scale) => {
  if (!term) return;
  term.options.fontSize = terminalFontSize(scale);
  requestAnimationFrame(() => fit());
});

defineExpose({ focus, hasFocus });

onBeforeUnmount(() => {
  observer?.disconnect();
  socket?.close();
  term?.dispose();
});
</script>

<template>
  <div v-show="props.visible" ref="host" class="terminal" :class="{ shell: props.kind === 'shell' }" />
</template>

<style scoped>
/* 親は flex 行。表示中のペインだけが並ぶので、等分するには伸縮の基準を 0 にしておく。 */
.terminal {
  flex: 1 1 0;
  min-width: 0;
  height: 100%;
  padding: 6px;
  box-sizing: border-box;
  background: var(--bg-app);
}
.shell {
  border-left: 1px solid var(--border);
}
</style>
