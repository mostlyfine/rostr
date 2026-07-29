import type { AddressInfo } from "node:net";
import type { Express } from "express";

/** SSE のフレームを必要な数だけ待って、data の中身を古い順に返す。 */
export type ReadFrames = (count: number) => Promise<unknown[]>;

/**
 * /api/events を実際に開いた状態で body を動かす。
 * SSE は supertest では読めないので、その場でサーバを起こして fetch で繋ぐ。
 * 終わったら接続とサーバを畳む。
 */
export const withEventStream = async (
  app: Express,
  body: (readFrames: ReadFrames) => Promise<void>,
): Promise<void> => {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const port = (server.address() as AddressInfo).port;
  const controller = new AbortController();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/events`, { signal: controller.signal });
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    const readFrames: ReadFrames = async (count) => {
      while (buffer.split("\n\n").length - 1 < count) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
      }
      return buffer
        .split("\n\n")
        .filter((frame) => frame.startsWith("data: "))
        .map((frame) => JSON.parse(frame.slice("data: ".length)));
    };

    await body(readFrames);
  } finally {
    controller.abort();
    await new Promise((resolve) => server.close(resolve));
  }
};
