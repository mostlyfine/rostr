import type { Session, SessionView } from "../../common/types";

/*
 * クライアントとサーバの両方のテストから使うフィクスチャ。
 * 片方でしか要らないヘルパーは test/client/helpers か test/server/helpers に置く
 * （tsconfig のプロジェクトが分かれていて、node と dom の型を混ぜられないため）。
 */

/** テスト用の Session。common/types.ts に項目が増えたときに直す場所を 1 つにする。 */
export const session = (over: Partial<Session> = {}): Session => ({
  id: "id",
  cwd: "/tmp/proj",
  title: "proj",
  state: "idle",
  prompt: "",
  activity: "",
  summary: "",
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

/** クライアントへ配られる形。スプリットのシェルが開いているかが足される。 */
export const sessionView = (over: Partial<SessionView> = {}): SessionView => ({
  ...session(over),
  shell: false,
  ...over,
});
