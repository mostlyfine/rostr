import { forwardRef, useEffect, useRef } from "hono/jsx/dom";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import type { ClientMessage } from "../../common/types";
import { classes } from "../classes";
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
import { useTheme } from "../hooks/useTheme";
import { useFontScale } from "../hooks/useFontScale";
import { useOnChange } from "../hooks/useOnChange";
import { useOptionalHandle } from "../hooks/useOptionalHandle";
import "./TerminalView.css";

/** 親から focus を渡すための口。App がセッションごとに1つずつ持つ。 */
export interface TerminalHandle {
  focus: () => void;
  hasFocus: () => boolean;
}

/** shell はスプリットで開くシェル。id は claude のセッションと共有し、繋ぐ先だけが違う。 */
interface Props {
  sessionId: string;
  visible: boolean;
  kind?: "agent" | "shell";
}

/** サーバ再起動やスリープ復帰で切れた WebSocket を張り直すまでの間隔。 */
const RECONNECT_MS = 1_000;

export const TerminalView = forwardRef<TerminalHandle, Props>(
  ({ sessionId, visible, kind = "agent" }, ref) => {
    const { theme: currentTheme } = useTheme();
    const { scale: fontScale } = useFontScale();

    const host = useRef<HTMLDivElement | null>(null);
    const term = useRef<Terminal | null>(null);
    const fitAddon = useRef<FitAddon | null>(null);
    const socket = useRef<WebSocket | null>(null);
    const observer = useRef<ResizeObserver | null>(null);
    /** 意図した切断（unmount）かどうか。true の間は close イベントが来ても張り直さない。 */
    const stopped = useRef(false);
    const reconnectTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    /** connect() のたびに作り直す。使い回すと 2 回目以降の再接続で DA 応答の抑制が働かない。 */
    const replayGate = useRef<ReturnType<typeof createReplayGate> | null>(null);
    /** 文字が描かれている領域。ホイールの位置をセル座標へ直すのに寸法が要る。 */
    const screen = useRef<HTMLElement | null>(null);
    /** 1 セルの大きさ。ホイールのたびに測るとレイアウトを叩くので、fit のときだけ測り直す。 */
    const cell = useRef<{ width: number; height: number } | null>(null);
    /** 最後にサーバへ伝えた大きさ。同じ値を送り直すと tmux が無駄に全画面を描き直す。 */
    const sent = useRef<{ cols: number; rows: number } | null>(null);
    /** 予約済みの再計測。倍率を変えると ResizeObserver と倍率の効果が同じフレームで来る。 */
    const pendingFit = useRef(0);
    /**
     * 表示中かどうか。xterm に渡したハンドラは最初の描画の closure を掴んだままなので、
     * 変わりうる値は ref 越しに読む。
     */
    const visibleRef = useRef(visible);
    visibleRef.current = visible;

    /** 送れたかを返す。接続前に捨てた分は、送れたことにして覚えてしまわないよう呼び手で見る。 */
    const send = (message: ClientMessage): boolean => {
      if (socket.current?.readyState !== WebSocket.OPEN) return false;
      socket.current.send(JSON.stringify(message));
      return true;
    };

    /** 表示中のときだけ寸法が測れるので、可視化直後とリサイズ時に呼ぶ。 */
    const fit = () => {
      if (!visibleRef.current || !fitAddon.current || !term.current) return;
      try {
        fitAddon.current.fit();
      } catch {
        // 非表示のまま呼ばれた場合は寸法が取れないので何もしない。
        return;
      }
      // 倍率を変えるとサイドバーの幅も変わるので、ResizeObserver と倍率の効果が同じフレームで
      // ここへ来る。大きさが変わったときだけ送れば、tmux の再描画は一度で済む。
      const size = { cols: term.current.cols, rows: term.current.rows };
      const changed = sent.current?.cols !== size.cols || sent.current.rows !== size.rows;
      if (changed && send({ type: "resize", ...size })) sent.current = size;
      // xterm はセル寸法を公開していないので、描かれている領域の実寸を列数・行数で割って求める。
      const rect = screen.current?.getBoundingClientRect();
      cell.current =
        rect && rect.width > 0 && rect.height > 0
          ? { width: rect.width / term.current.cols, height: rect.height / term.current.rows }
          : null;
    };

    /**
     * 再計測を1フレームに1回へ畳む。fit() は寸法を読んでレイアウトを強制するので、
     * 同じフレームで二度呼ぶ意味がない。非表示なら測れないので予約もしない。
     */
    const scheduleFit = () => {
      if (pendingFit.current || !visibleRef.current) return;
      pendingFit.current = requestAnimationFrame(() => {
        pendingFit.current = 0;
        fit();
      });
    };

    /**
     * WebSocket を張る。close イベントが来て意図した切断（unmount）でなければ張り直すので、
     * ノート PC のスリープ復帰やサーバ再起動の後もキー入力が黙って死んだままにならない。
     */
    const connect = () => {
      replayGate.current = createReplayGate(term.current!);
      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const query = kind === "shell" ? "&kind=shell" : "";
      const ws = new WebSocket(`${protocol}//${location.host}/ws?session=${sessionId}${query}`);
      socket.current = ws;
      // サーバは接続直後にスクロールバックを、その後は PTY の出力をそのまま送ってくる。
      ws.onmessage = (event) => void replayGate.current?.write(event.data as string);
      ws.onopen = () => fit();
      ws.onclose = () => {
        if (stopped.current) return;
        reconnectTimer.current = setTimeout(connect, RECONNECT_MS);
      };
    };

    /** 非表示中は寸法が 0 なので、表示に戻った直後に測り直してからフォーカスする。 */
    const focus = () => {
      requestAnimationFrame(() => {
        fit();
        term.current?.focus();
      });
    };

    /** ユーザーがこのターミナルに入力中か。自動フォーカス切り替えでキー入力を奪わないための判定に使う。 */
    const hasFocus = () => host.current?.contains(document.activeElement) ?? false;

    useOptionalHandle(ref, () => ({ focus, hasFocus }));

    useEffect(() => {
      const terminal = new Terminal(createTerminalOptions(currentTheme, fontScale));
      const addon = new FitAddon();
      term.current = terminal;
      fitAddon.current = addon;
      terminal.loadAddon(addon);
      terminal.loadAddon(new WebLinksAddon());
      terminal.open(host.current!);
      screen.current = terminal.element!.querySelector(".xterm-screen");
      // 再接続直後の replay（端末モード再現 + スクロールバック）には、tmux が attach 時に
      // 送った Device Attributes の問い合わせがそのまま含まれている。xterm はこれを書き込む
      // 際に自動応答を作ってしまうが、tmux はもう問い合わせを待っておらず、応答をただの
      // 入力としてシェルへ素通ししてしまう。replay の書き込み中だけその応答を捨てる。
      terminal.onData((data) => {
        if (replayGate.current?.shouldSuppress()) return;
        send({ type: "input", data });
      });
      // Shift+Enter だけは xterm の既定（CR 送出）を止めて自前で送る。claude の /terminal-setup が
      // iTerm2 などに設定するのと同じシーケンスなので、ローカルのターミナルと同じ操作感になる。
      terminal.attachCustomKeyEventHandler((event) => {
        if (!isShiftEnter(event)) return true;
        // このハンドラは keydown と keypress の両方で呼ばれるので、送信は keydown の一度だけにする。
        if (event.type === "keydown") send({ type: "input", data: SHIFT_ENTER_INPUT });
        return false;
      });

      // tmux が要求してくるマウス報告は xterm に渡さない。渡すと xterm が選択機能ごと切ってしまい
      // （SelectionService.disable）、ブラウザでの文字選択とコピーができなくなる。
      // 代わりにホイールだけを下のハンドラが自前で tmux へ送るので、履歴スクロールは残る。
      const isMouseReportWanted = installMouseReportFilter(terminal);

      // 報告を落とした以上、ホイールは xterm からは PTY へ流れない。tmux の copy-mode へ入る
      // 唯一の入口なので、SGR マウス報告の形に組み立てて送る。相手が報告を要求していないとき
      // （tmux 無しの構成）は何もせず、xterm 本来のスクロール動作に任せる。
      const accumulateWheel = createWheelAccumulator();
      terminal.attachCustomWheelEventHandler((event) => {
        if (!isMouseReportWanted()) return true;
        if (!screen.current || !cell.current) return false;

        const lines = accumulateWheel(event.deltaY, event.deltaMode, cell.current.height);
        event.preventDefault();
        // 1 セルに満たない動きは持ち越されている。座標を測るのは実際に送るときだけでよい。
        if (lines === 0) return false;

        const rect = screen.current.getBoundingClientRect();
        const col = toCell(event.clientX - rect.left, cell.current.width, terminal.cols);
        const row = toCell(event.clientY - rect.top, cell.current.height, terminal.rows);
        send({ type: "input", data: sgrWheelSequence(lines < 0, col, row).repeat(Math.abs(lines)) });
        return false;
      });

      connect();

      observer.current = new ResizeObserver(scheduleFit);
      observer.current.observe(host.current!);

      if (visibleRef.current) fit();

      return () => {
        stopped.current = true;
        clearTimeout(reconnectTimer.current);
        observer.current?.disconnect();
        // 予約が残っていると、破棄した端末に対して測り直しが走る。
        if (pendingFit.current) cancelAnimationFrame(pendingFit.current);
        socket.current?.close();
        term.current?.dispose();
        term.current = null;
      };
    }, []);

    /** 見えるようになった瞬間だけフォーカスを移す。開いた直後のフォーカスは App が持つ。 */
    useOnChange(visible, (shown) => {
      if (shown) focus();
    });

    // xterm は Canvas 描画で CSS 変数を追えないので、切り替えのたびに theme を差し替える。
    useOnChange(currentTheme, (theme) => {
      if (term.current) term.current.options.theme = XTERM_THEMES[theme];
    });

    // フォントサイズも同様に CSS では届かない。サイズが変わると列数・行数とセル寸法が
    // 変わるので、再描画されてから fit で測り直す（cell が古いとホイールの座標がずれる）。
    useOnChange(fontScale, (scale) => {
      if (!term.current) return;
      term.current.options.fontSize = terminalFontSize(scale);
      scheduleFit();
    });

    return (
      <div
        ref={host}
        class={classes("terminal-pane", kind === "shell" && "shell", !visible && "hidden")}
      />
    );
  },
);
