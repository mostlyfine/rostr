import { useEffect, useRef, useState } from "hono/jsx/dom";
import { AGENTS, AGENT_KINDS, type AgentKind } from "../../common/agents";
import { loadRecentDirs } from "../recentDirs";
import "./NewSessionDialog.css";

interface Props {
  error: string | null;
  busy: boolean;
  onSubmit: (cwd: string, agent: AgentKind) => void;
  onCancel: () => void;
}

export const NewSessionDialog = ({ error, busy, onSubmit, onCancel }: Props) => {
  const [cwd, setCwd] = useState("");
  const [agent, setAgent] = useState<AgentKind>("claude");
  // 履歴は開いた時点のものを見せる。開いている間に増えることはない。
  const [recentDirs] = useState<string[]>(() => loadRecentDirs());
  const input = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    input.current?.focus();
  }, []);

  const submit = (event: Event) => {
    event.preventDefault();
    const value = cwd.trim();
    if (value === "") return;
    onSubmit(value, agent);
  };

  return (
    <div
      class="backdrop"
      // 背景を押したときだけ閉じる。中のダイアログを押しても閉じない。
      onClick={(event: MouseEvent) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <form class="dialog" onSubmit={submit}>
        <h2 class="dialog-title">Launch New Agent</h2>

        <label class="dialog-field">
          Agent
          <select
            class="dialog-select"
            data-test="agent"
            value={agent}
            onChange={(event: Event) =>
              setAgent((event.target as HTMLSelectElement).value as AgentKind)
            }
          >
            {AGENT_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {AGENTS[kind].label}
              </option>
            ))}
          </select>
        </label>

        <label class="dialog-field">
          Working Directory (absolute path)
          <input
            ref={input}
            class="dialog-input"
            type="text"
            value={cwd}
            placeholder="/Users/you/src/project"
            spellcheck={false}
            onInput={(event: Event) => setCwd((event.target as HTMLInputElement).value)}
          />
        </label>

        {recentDirs.length > 0 && (
          <div class="recent">
            <span class="recent-label">Recent Directories</span>
            {recentDirs.map((dir) => (
              <button
                key={dir}
                type="button"
                class="recent-item"
                data-test="recent-dir"
                onClick={() => setCwd(dir)}
              >
                {dir}
              </button>
            ))}
          </div>
        )}

        {error && <p class="dialog-error">{error}</p>}

        <div class="dialog-actions">
          <button type="button" data-test="cancel" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" class="primary" data-test="submit" disabled={busy}>
            {busy ? "Launching…" : "Launch"}
          </button>
        </div>
      </form>
    </div>
  );
};
