import { useRef } from "hono/jsx/dom";
import type { Session } from "../../common/types";
import { classes } from "../classes";
import { useFlipMove } from "../hooks/useFlipMove";
import { useLeaveTransition } from "../hooks/useLeaveTransition";
import { useSoundSettings } from "../hooks/useSoundSettings";
import { useTheme } from "../hooks/useTheme";
import { toSidebarRows } from "../sessionGroups";
import { SessionItem } from "./SessionItem";
import "./Sidebar.css";

interface Props {
  sessions: Session[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onCreate: () => void;
}

export const Sidebar = ({ sessions, selectedId, onSelect, onClose, onCreate }: Props) => {
  // 消えた行を少しの間そのまま残し、フェードしてから畳む。
  const rows = useLeaveTransition(toSidebarRows(sessions), (row) => row.key);
  // 状態が変わってグループ間を動く行を、元の位置から滑らせる。
  // 退場中の行は流れの外に出してあるので動かさない。
  const rowList = useRef<HTMLUListElement | null>(null);
  useFlipMove(rowList, (row) => row.classList.contains("row-leaving"));
  const { label: themeLabel, toggle: toggleTheme } = useTheme();
  const { label: soundLabel, toggle: toggleSound } = useSoundSettings();

  return (
    <aside class="sidebar">
      <header class="sidebar-header">
        <h1 class="sidebar-title">rostr</h1>
        <div class="sidebar-actions">
          <button
            class="sidebar-sound"
            data-test="sound-toggle"
            title={soundLabel.title}
            onClick={toggleSound}
          >
            {soundLabel.icon}
          </button>
          <button
            class="sidebar-theme"
            data-test="theme-toggle"
            title={themeLabel.title}
            onClick={toggleTheme}
          >
            {themeLabel.icon}
          </button>
          <button class="sidebar-new" data-test="new-session" onClick={onCreate}>
            + New
          </button>
        </div>
      </header>

      <div class="sidebar-list">
        {sessions.length === 0 && (
          <p class="sidebar-empty">No agents. Click "+ New" to launch one.</p>
        )}

        <ul ref={rowList} class="rows">
          {rows.map(({ key, item, leaving }) =>
            item.kind === "header" ? (
              <li key={key} class={classes("group-label", item.state, leaving && "row-leaving")}>
                <span data-test="group-label">{item.label}</span>
                <span class="group-count">{item.count}</span>
              </li>
            ) : (
              <SessionItem
                key={key}
                session={item.session}
                selected={item.session.id === selectedId}
                leaving={leaving}
                onSelect={onSelect}
                onClose={onClose}
              />
            ),
          )}
        </ul>
      </div>
    </aside>
  );
};
