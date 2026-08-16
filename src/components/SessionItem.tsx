import { useState } from "hono/jsx/dom";
import { AGENTS } from "../../common/agents";
import type { Session } from "../../common/types";
import { classes } from "../classes";
import { useOnChange } from "../hooks/useOnChange";
import { NOTABLE_STATES } from "../sessionGroups";
import "./SessionItem.css";

interface Props {
  session: Session;
  selected: boolean;
  /** 一覧から消えた後、フェードのために残されている行。Sidebar の退場アニメーションが使う。 */
  leaving?: boolean;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
}

export const SessionItem = ({ session, selected, leaving, onSelect, onClose }: Props) => {
  const [blink, setBlink] = useState(false);

  /**
   * 別のターミナルを見ている間に状態が変わっても気づけるよう、クリックされるまで点滅させ続ける。
   * 見ているのは遷移であって状態そのものではないので、開いた時点で既に完了している行は点滅しない。
   */
  useOnChange(session.state, (state) => {
    if (NOTABLE_STATES.includes(state)) setBlink(true);
  });

  const select = () => {
    setBlink(false);
    onSelect(session.id);
  };

  return (
    <li
      class={classes(
        "item",
        session.state,
        selected && "selected",
        blink && "blink",
        leaving && "row-leaving",
      )}
    >
      <div class="item-body" data-test="session-body" onClick={select}>
        <div class="item-title-row">
          <span class={classes("item-dot", session.state)} />
          <span class="item-title">{session.title}</span>
          <span class="item-agent">{AGENTS[session.agent].label}</span>
        </div>
        {session.summary && (
          <p class="item-summary" data-test="session-summary" title={session.summary}>
            {session.summary}
          </p>
        )}
        <p class={classes("item-prompt", !session.prompt && "empty")}>
          {session.prompt || "No prompt entered"}
        </p>
        {session.activity && <p class="item-activity">{session.activity}</p>}
      </div>
      <button
        class="item-close"
        data-test="session-close"
        title="Close this agent"
        onClick={(event: MouseEvent) => {
          event.stopPropagation();
          onClose(session.id);
        }}
      >
        ×
      </button>
    </li>
  );
};
