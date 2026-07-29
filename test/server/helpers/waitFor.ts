import { vi } from "vitest";

/**
 * 条件が満たされるまで待つ。PTY の起動や終了はプロセス次第で遅れるので、
 * vi.waitFor の既定（1 秒）より長めに待つ。
 */
export const waitFor = (predicate: () => boolean, timeout = 5_000): Promise<void> =>
  vi.waitFor(() => {
    if (!predicate()) throw new Error("waitFor: 条件が満たされていない");
  }, timeout);
