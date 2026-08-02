import type { HookEvent } from "../common/types";

export type HookProvider = "copilot" | "codex";

export const normalizeProviderEvent: (
  provider: HookProvider,
  payload: unknown,
  eventName?: string,
) => HookEvent | undefined;
