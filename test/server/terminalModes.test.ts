import { describe, expect, it } from "vitest";
import { createModeTracker } from "../../server/terminalModes";

describe("createModeTracker", () => {
  it("何も食わせなければ再送するものは無い", () => {
    expect(createModeTracker().replay()).toBe("");
  });

  it("設定されたモードを再送できる", () => {
    const tracker = createModeTracker();
    tracker.feed("\x1b[?1049h");
    expect(tracker.replay()).toBe("\x1b[?1049h");
  });

  it("セミコロン区切りの複数パラメータを個別のモードとして覚える", () => {
    const tracker = createModeTracker();
    tracker.feed("\x1b[?1000;1002;1006h");
    expect(tracker.replay()).toBe("\x1b[?1000h\x1b[?1002h\x1b[?1006h");
  });

  it("後から来た設定で上書きする", () => {
    const tracker = createModeTracker();
    tracker.feed("\x1b[?1000h");
    tracker.feed("\x1b[?1000l");
    expect(tracker.replay()).toBe("\x1b[?1000l");
  });

  it("最初に現れた順序を保つ", () => {
    const tracker = createModeTracker();
    // 代替画面へ入ってからマウス報告を有効にする、という tmux の順序を崩さない。
    tracker.feed("\x1b[?1049h\x1b[?1006h\x1b[?1000h\x1b[?1002h");
    tracker.feed("\x1b[?1006l\x1b[?1006h");
    expect(tracker.replay()).toBe("\x1b[?1049h\x1b[?1006h\x1b[?1000h\x1b[?1002h");
  });

  it("チャンクの境目で切れたシーケンスも取りこぼさない", () => {
    const tracker = createModeTracker();
    // node-pty の onData は任意の位置で切れる。
    tracker.feed("\x1b[?10");
    expect(tracker.replay()).toBe("");
    tracker.feed("02h");
    expect(tracker.replay()).toBe("\x1b[?1002h");
  });

  it("ESC 一文字だけで切れても次のチャンクと繋げる", () => {
    const tracker = createModeTracker();
    tracker.feed("output\x1b");
    tracker.feed("[?2004h");
    expect(tracker.replay()).toBe("\x1b[?2004h");
  });

  it("プライベートモードでない CSI は無視する", () => {
    const tracker = createModeTracker();
    tracker.feed("\x1b[2J\x1b[1;30r\x1b[4h");
    expect(tracker.replay()).toBe("");
  });

  it("繰り越しが無限に伸びないよう、モードになり得ない文字が来たら捨てる", () => {
    const tracker = createModeTracker();
    // "\x1b[?" の後に数字でも h/l でもない文字が来た時点で候補ではなくなる。
    tracker.feed("\x1b[?1000$p");
    tracker.feed("\x1b[?1002h");
    expect(tracker.replay()).toBe("\x1b[?1002h");
  });

  it("通常の出力に紛れたモード設定だけを拾う", () => {
    const tracker = createModeTracker();
    tracker.feed("hello\x1b[?1049hworld\x1b[?25l!");
    expect(tracker.replay()).toBe("\x1b[?1049h\x1b[?25l");
  });
});
