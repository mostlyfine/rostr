import type { NotableState } from "./notableTransitions";

/** ブラウザの自動再生制限を避けるため、実際に鳴らすまで生成しない。 */
let ctx: AudioContext | null = null;
const getContext = (): AudioContext => (ctx ??= new AudioContext());

const beep = (context: AudioContext, freq: number, start: number, duration: number): void => {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.frequency.value = freq;
  oscillator.connect(gain).connect(context.destination);
  const t0 = context.currentTime + start;
  gain.gain.setValueAtTime(0.2, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  oscillator.start(t0);
  oscillator.stop(t0 + duration);
};

/** waiting は短い一声、done は音程が上がる二声で聞き分けられるようにする。 */
export const playNotificationSound = (state: NotableState): void => {
  const context = getContext();
  if (context.state === "suspended") void context.resume();
  if (state === "waiting") {
    beep(context, 660, 0, 0.15);
  } else {
    beep(context, 660, 0, 0.12);
    beep(context, 880, 0.13, 0.16);
  }
};
