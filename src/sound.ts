import type { NotableState } from "./notableTransitions";
import blockedSoundUrl from "./assets/sounds/blocked.mp3";
import doneSoundUrl from "./assets/sounds/done.mp3";

const SOUND_URLS: Record<NotableState, string> = {
  waiting: blockedSoundUrl,
  done: doneSoundUrl,
};

export const playNotificationSound = (state: NotableState): void => {
  void new Audio(SOUND_URLS[state]).play();
};
