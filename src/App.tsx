import { useEffect, useRef, useState } from "hono/jsx/dom";
import type { AgentKind } from "../common/agents";
import type { AgentState, Session } from "../common/types";
import { classes } from "./classes";
import { NewSessionDialog } from "./components/NewSessionDialog";
import { Sidebar } from "./components/Sidebar";
import { TerminalView, type TerminalHandle } from "./components/TerminalView";
import { useFontScaleShortcut } from "./hooks/useFontScaleShortcut";
import { useSessions } from "./hooks/useSessions";
import { useSoundSettings } from "./hooks/useSoundSettings";
import { detectNotableTransitions } from "./notableTransitions";
import { rememberRecentDir } from "./recentDirs";
import { NOTABLE_STATES } from "./sessionGroups";
import { playNotificationSound } from "./sound";
import "./App.css";

/** 子から受け取る操作口の置き場。useImperativeHandle はオブジェクト ref にしか書き込まない。 */
type HandleRef = { current: TerminalHandle | null };

const handleFor = (map: Map<string, HandleRef>, id: string): HandleRef => {
  const existing = map.get(id);
  if (existing) return existing;
  const created: HandleRef = { current: null };
  map.set(id, created);
  return created;
};

/**
 * 指定したターミナルへフォーカスを移す。子の useImperativeHandle は描画のあとの
 * effect で口を生やすので、開いたばかりのターミナルではまだ空のことがある。
 * 生えるまで数フレームだけ待ち、それでも現れなければ諦める。
 */
const focusTerminal = (map: Map<string, HandleRef>, id: string, attempts = 5) => {
  const handle = map.get(id)?.current;
  if (handle) {
    handle.focus();
    return;
  }
  if (attempts <= 0) return;
  requestAnimationFrame(() => focusTerminal(map, id, attempts - 1));
};

export const App = () => {
  const { sessions, create, close, openShell, closeShell } = useSessions();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** 一度でも表示したセッションはターミナルを保持し続け、切り替えを即座にする。 */
  const [openedIds, setOpenedIds] = useState<string[]>([]);

  const selectedSession = sessions.find((session) => session.id === selectedId) ?? null;

  /** 各ターミナルへフォーカスを渡すための口。一覧で描くので id をキーに自分で持つ。 */
  const terminals = useRef(new Map<string, HandleRef>());
  /** スプリットで開いたシェル。id は claude 側と同じなので別の Map に分ける。 */
  const shellTerminals = useRef(new Map<string, HandleRef>());

  /** スプリットの開閉はサーバが持つシェルの有無が正。ブラウザ側では覚えない。 */
  const shellOpenIds = new Set(
    sessions.filter((session) => session.shell).map((session) => session.id),
  );
  const splitOpen = selectedSession?.shell ?? false;

  /** 開いたシェルが実際に現れるのは SSE が届いてからなので、フォーカス先を覚えて待つ。 */
  const pendingShellFocus = useRef<string | null>(null);
  /**
   * 選択の直後に移すフォーカス。描画が終わってから effect で消化する。
   * 同じセッションを選び直すと他の状態は変わらず描き直しも起きないので、
   * 要求のたびに新しいオブジェクトを入れて effect を必ず走らせる。
   */
  const [focusRequest, setFocusRequest] = useState<{ id: string } | null>(null);

  /** 直前に見たセッション状態。waiting/done への「遷移」を検知するための基準値。 */
  const prevStates = useRef(new Map<string, AgentState>());

  const { enabled: soundEnabled } = useSoundSettings();

  /**
   * サイドバーから選ぶと、そのままキー入力できるようメイン画面へフォーカスを移す。
   * 初回に開いた場合はここで初めてターミナルが生成されるので、描画を待ってから渡す。
   */
  const select = (id: string) => {
    setSelectedId(id);
    setOpenedIds((ids) => (ids.includes(id) ? ids : [...ids, id]));
    setFocusRequest({ id });
  };

  /**
   * 選択中セッションの脇にシェルを開く / 閉じる。
   * 開閉の結果は SSE の一覧に載って戻ってくるので、ここでは表示状態を触らない。
   */
  const toggleSplit = async () => {
    const id = selectedId;
    if (!id) return;
    if (splitOpen) {
      await closeShell(id);
      terminals.current.get(id)?.current?.focus();
      return;
    }
    pendingShellFocus.current = id;
    await openShell(id);
  };

  /**
   * waiting/done に新しく遷移したセッションを見つけ、いま操作中でなければそこへフォーカスを移す。
   * 選択中のターミナルに実際に入力中（hasFocus）の場合は奪わず、点滅による通知だけに任せる。
   */
  const focusNewlyNotable = (list: Session[]) => {
    const newlyNotable = list.find((session) => {
      const prev = prevStates.current.get(session.id);
      return (
        prev !== undefined &&
        !NOTABLE_STATES.includes(prev) &&
        NOTABLE_STATES.includes(session.state) &&
        session.id !== selectedId
      );
    });
    if (!newlyNotable) return;
    const selectedIsBusy =
      !!selectedId && (terminals.current.get(selectedId)?.current?.hasFocus() ?? false);
    if (!selectedIsBusy) select(newlyNotable.id);
  };

  /** waiting/done に新しく遷移した全セッション分、状態に応じた音を鳴らす。 */
  const playNotableSounds = (list: Session[]) => {
    if (!soundEnabled) return;
    for (const state of detectNotableTransitions(list, prevStates.current)) {
      playNotificationSound(state);
    }
  };

  /** 押した直後に開いたシェルへフォーカスを移す。描画されるのはこの一覧が届いた後。 */
  const focusOpenedShell = (list: Session[]) => {
    const id = pendingShellFocus.current;
    if (!id || !shellOpenIds.has(id)) return;
    pendingShellFocus.current = null;
    // 一覧から消えたセッションのシェルは開かない。
    if (!list.some((session) => session.id === id)) return;
    focusTerminal(shellTerminals.current, id);
  };

  // 削除されたセッションのターミナルを片付け、選択を別のセッションへ移す。
  useEffect(() => {
    focusOpenedShell(sessions);
    focusNewlyNotable(sessions);
    playNotableSounds(sessions);
    prevStates.current.clear();
    for (const session of sessions) prevStates.current.set(session.id, session.state);

    const alive = new Set(sessions.map((session) => session.id));
    setOpenedIds((ids) => {
      const kept = ids.filter((id) => alive.has(id));
      return kept.length === ids.length ? ids : kept;
    });
    for (const id of [...terminals.current.keys()]) {
      if (!alive.has(id)) terminals.current.delete(id);
    }
    for (const id of [...shellTerminals.current.keys()]) {
      if (!alive.has(id)) shellTerminals.current.delete(id);
    }
    if (selectedId && !alive.has(selectedId)) {
      const next = sessions[0]?.id ?? null;
      if (next) select(next);
      else setSelectedId(null);
    }
  }, [sessions]);

  // 選択の直後、描画が終わってからフォーカスを移す。開いたばかりのターミナルもこの時点で居る。
  useEffect(() => {
    if (focusRequest) focusTerminal(terminals.current, focusRequest.id);
  }, [focusRequest]);

  const { scale: fontScale, shown: shownScale, dismiss: dismissScale } = useFontScaleShortcut();

  const openDialog = () => {
    setDialogError(null);
    setDialogOpen(true);
  };

  const onSubmit = async (cwd: string, agent: AgentKind) => {
    setBusy(true);
    setDialogError(null);
    try {
      const session = await create(cwd, agent);
      rememberRecentDir(session.cwd);
      setDialogOpen(false);
      select(session.id);
    } catch (error) {
      setDialogError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="layout">
      <Sidebar
        sessions={sessions}
        selectedId={selectedId}
        onSelect={select}
        onClose={close}
        onCreate={openDialog}
      />

      <main class="main">
        {selectedSession && (
          <header class="main-header">
            <span class="main-title">{selectedSession.title}</span>
            <span class="main-cwd">{selectedSession.cwd}</span>
            <button
              class={classes("split", splitOpen && "active")}
              data-test="split-toggle"
              title={splitOpen ? "Close the shell" : "Open a shell in this directory"}
              onClick={toggleSplit}
            >
              ◫
            </button>
          </header>
        )}

        <div class="terminals">
          {openedIds.map((id) => (
            <>
              <TerminalView
                key={id}
                ref={handleFor(terminals.current, id)}
                sessionId={id}
                visible={id === selectedId}
              />
              {shellOpenIds.has(id) && (
                <TerminalView
                  key={`shell:${id}`}
                  ref={handleFor(shellTerminals.current, id)}
                  sessionId={id}
                  kind="shell"
                  visible={id === selectedId}
                />
              )}
            </>
          ))}
          {!selectedId && (
            <p class="placeholder">
              Select an agent from the sidebar, or launch one with "+ New".
            </p>
          )}
        </div>
      </main>

      {dialogOpen && (
        <NewSessionDialog
          error={dialogError}
          busy={busy}
          onSubmit={onSubmit}
          onCancel={() => setDialogOpen(false)}
        />
      )}

      {/* 消えるまでの時間は CSS のアニメーションが持つ。終わりを受けて要素を落とす。 */}
      {shownScale !== null && (
        <div
          key={shownScale}
          class="scale-toast"
          data-test="font-scale-toast"
          onAnimationEnd={dismissScale}
        >
          {fontScale}%
        </div>
      )}
    </div>
  );
};
