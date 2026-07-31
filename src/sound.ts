import type { NotableState } from "./notableTransitions";

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

/** ベルらしい響きを作るための1倍音。decayRate が大きいほど早く減衰する。 */
interface BellPartial {
  /** 基音に対する周波数倍率。整数から少しずらすとベルらしい唸りが出る。 */
  mul: number;
  /** 基音を1としたときの音量比。 */
  weight: number;
  decayRate: number;
}

interface BellNote {
  freq: number;
  start: number;
  duration: number;
  gain: number;
  partials: BellPartial[];
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

const playBellNote = (context: AudioContext, t0: number, note: BellNote): void => {
  const start = t0 + note.start;
  for (const partial of note.partials) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = note.freq * partial.mul;
    oscillator.connect(gain).connect(context.destination);
    const peak = note.gain * partial.weight;
    // exponentialRampToValueAtTime は2点を指数で結ぶだけなので、duration 秒後に
    // peak * exp(-decayRate * duration) へ落ちるよう逆算した値を目標に渡す。
    const floor = Math.max(peak * Math.exp(-partial.decayRate * note.duration), 0.0001);
    gain.gain.setValueAtTime(peak, start);
    gain.gain.exponentialRampToValueAtTime(floor, start + note.duration);
    oscillator.start(start);
    oscillator.stop(start + note.duration);
  }
};

/**
 * 以下2つが実際に鳴らす音の全設定。周波数・音量・タイミングを変えるだけで
 * 音を差し替えられるよう、鳴らす処理(上のplay*関数)とは分離してある。
 */

/** 完了(done)の「じゃじゃーん」。C5-E5-G5 と駆け上がり、最後に G5+C6 の和音を伸ばす。 */
const DONE_NOTES: SimpleNote[] = [
  { freq: 523.25, start: 0.0, duration: 0.1, gain: 0.45 }, // C5
  { freq: 659.25, start: 0.1, duration: 0.1, gain: 0.45 }, // E5
  { freq: 783.99, start: 0.2, duration: 0.1, gain: 0.45 }, // G5
  { freq: 783.99, start: 0.32, duration: 0.45, gain: 0.45 }, // G5(和音)
  { freq: 1046.5, start: 0.32, duration: 0.45, gain: 0.45 }, // C6(和音)
];

/** ベルの倍音構成。基音からわずかにずれた倍音を重ねて金属的な響きを作る。 */
const BELL_PARTIALS: BellPartial[] = [
  { mul: 1, weight: 1, decayRate: 3.2 },
  { mul: 2.01, weight: 0.28, decayRate: 5.5 },
  { mul: 2.76, weight: 0.12, decayRate: 7.5 },
];

/** 入力待ち(waiting)のコンビニ入店音風チャイム。G5 → C6 と少し重ねて鳴らし余韻を残す。 */
const WAITING_NOTES: BellNote[] = [
  { freq: 783.99, start: 0.0, duration: 0.6, gain: 0.4, partials: BELL_PARTIALS }, // G5
  { freq: 1046.5, start: 0.13, duration: 0.7, gain: 0.4, partials: BELL_PARTIALS }, // C6
];

export const playNotificationSound = (state: NotableState): void => {
  const context = getContext();
  if (context.state === "suspended") void context.resume();
  const t0 = context.currentTime;
  if (state === "waiting") {
    for (const note of WAITING_NOTES) playBellNote(context, t0, note);
  } else {
    for (const note of DONE_NOTES) playSimpleNote(context, t0, note);
  }
};
