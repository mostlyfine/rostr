/**
 * 状態が変わった行を点滅させる長さ。
 * SessionItem.vue の `animation: <name> 600ms ... 3`（600ms × 3回）と一致させること。
 * CSS 側から時間を読み出す手段が無いので、ここと向こうで二重に持つ。
 */
export const BLINK_MS = 1800;
