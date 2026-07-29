import { afterEach } from "vitest";
import { SessionManager } from "../../../server/sessions";
import type { Summarizer } from "../../../server/summary";

const managers: SessionManager[] = [];

// import しただけで後始末が付くようにしておく。取り残すと PTY が残り続ける。
afterEach(() => {
  for (const manager of managers.splice(0)) manager.disposeAll();
});

/** 自前で組み立てた SessionManager も後始末の対象に加える。tmux 経路のテスト用。 */
export const trackManager = <T extends SessionManager>(manager: T): T => {
  managers.push(manager);
  return manager;
};

/**
 * テスト用の SessionManager。エージェントの代わりに /bin/sh を起こす。
 * 本番の tmux サーバへセッションを残さないよう、tmux は挟まない。
 */
export const newManager = (
  opts: {
    buildArgs?: (id: string) => string[];
    scrollbackChars?: number;
    summarizer?: Summarizer;
  } = {},
): SessionManager => {
  return trackManager(
    new SessionManager({
      agentBin: "/bin/sh",
      buildArgs: opts.buildArgs ?? (() => []),
      port: 0,
      scrollbackChars: opts.scrollbackChars ?? 64,
      summarizer: opts.summarizer,
      tmux: false,
    }),
  );
};
