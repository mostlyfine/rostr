import { afterEach, describe, expect, it, vi } from "vitest";
import { playNotificationSound } from "../../src/sound";

describe("playNotificationSound", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("waiting(Blocked) では blocked.mp3 を再生する", () => {
    const playSpy = vi.spyOn(window.HTMLMediaElement.prototype, "play").mockResolvedValue();

    playNotificationSound("waiting");

    expect(playSpy).toHaveBeenCalledTimes(1);
  });

  it("done では done.mp3 を再生する", () => {
    const playSpy = vi.spyOn(window.HTMLMediaElement.prototype, "play").mockResolvedValue();

    playNotificationSound("done");

    expect(playSpy).toHaveBeenCalledTimes(1);
  });
});
