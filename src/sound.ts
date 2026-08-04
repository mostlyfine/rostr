import type { NotableState } from "./notableTransitions";
import blockedSoundUrl from "./assets/sounds/blocked.mp3";

/** ブラウザの自動再生制限を避けるため、実際に鳴らすまで生成しない。 */
let ctx: AudioContext | null = null;
const getContext = (): AudioContext => (ctx ??= new AudioContext());

/** 基音だけの単純な音。gain から 0.0001 まで duration 秒かけて減衰する。 */
interface SimpleNote {
  /** Hz */
  freq: number;
  /** 鳴らし始めからの相対秒数。 */
  start: number;
  /** 秒数。 */
  duration: number;
  /** ピーク音量(0〜1)。 */
  gain: number;
}

const playSimpleNote = (context: AudioContext, t0: number, note: SimpleNote): void => {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.frequency.value = note.freq;
  oscillator.connect(gain).connect(context.destination);
  const start = t0 + note.start;
  gain.gain.setValueAtTime(note.gain, start);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + note.duration);
  oscillator.start(start);
  oscillator.stop(start + note.duration);
};

/** 完了(done)の「じゃじゃーん」。C5-E5-G5 と駆け上がり、最後に G5+C6 の和音を伸ばす。 */
const DONE_NOTES: SimpleNote[] = [
  { freq: 523.25, start: 0.0, duration: 0.1, gain: 0.45 }, // C5
  { freq: 659.25, start: 0.1, duration: 0.1, gain: 0.45 }, // E5
  { freq: 783.99, start: 0.2, duration: 0.1, gain: 0.45 }, // G5
  { freq: 783.99, start: 0.32, duration: 0.45, gain: 0.45 }, // G5(和音)
  { freq: 1046.5, start: 0.32, duration: 0.45, gain: 0.45 }, // C6(和音)
];

export const playNotificationSound = (state: NotableState): void => {
  if (state === "waiting") {
    void new Audio(blockedSoundUrl).play();
    return;
  }
  const context = getContext();
  if (context.state === "suspended") void context.resume();
  const t0 = context.currentTime;
  for (const note of DONE_NOTES) playSimpleNote(context, t0, note);
};
