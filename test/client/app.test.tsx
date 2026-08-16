import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forwardRef } from "hono/jsx/dom";
import type { SessionView } from "../../common/types";
import { FONT_SCALE_KEY } from "../../src/fontScale";
import { useOptionalHandle } from "../../src/hooks/useOptionalHandle";
import { SOUND_ENABLED_KEY } from "../../src/soundSettings";
import { flush, mount, type Wrapper } from "./helpers";

const focusSpy = vi.fn();
const playNotificationSoundMock = vi.fn();
let hasFocusReturn = false;
let fetchMock: ReturnType<typeof vi.fn>;

// AudioContext は jsdom に無いので、実際に鳴らす副作用はモックへ差し替える。
vi.mock("../../src/sound.ts", () => ({ playNotificationSound: playNotificationSoundMock }));

// xterm.js は jsdom で動かないので、ターミナルは focus/hasFocus だけ持つスタブに差し替える。
vi.mock("../../src/components/TerminalView", () => ({
  TerminalView: forwardRef<
    { focus: () => void; hasFocus: () => boolean },
    { sessionId: string; visible: boolean; kind?: "agent" | "shell" }
  >(({ sessionId, visible, kind = "agent" }, ref) => {
    // シェルのペインは id を親と共有するので、フォーカス先の区別に kind を前置きする。
    const name = kind === "shell" ? `shell:${sessionId}` : sessionId;
    useOptionalHandle(ref, () => ({ focus: () => focusSpy(name), hasFocus: () => hasFocusReturn }));
    return (
      <div class="terminal-stub" data-test-kind={kind} data-test-visible={String(visible)} />
    );
  }),
}));

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();

  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }

  emit(sessions: SessionView[]) {
    this.onmessage?.({ data: JSON.stringify(sessions) });
  }
}

const session = (over: Partial<SessionView>): SessionView => ({
  id: "id",
  agent: "claude",
  cwd: "/tmp/proj",
  title: "proj",
  state: "idle",
  prompt: "",
  activity: "",
  summary: "",
  createdAt: 0,
  updatedAt: 0,
  shell: false,
  ...over,
});

const mounted: Wrapper[] = [];

const mountApp = async (sessions: SessionView[]) => {
  const { App } = await import("../../src/App");
  const wrapper = mount(<App />);
  mounted.push(wrapper);
  // EventSource が張られるのは useEffect の中なので、まず描画の完了を待つ。
  await flush();
  FakeEventSource.instances.at(-1)!.emit(sessions);
  await flush();
  return wrapper;
};

/** サーバから新しい一覧が届いた状況を作る。 */
const emit = async (sessions: SessionView[]) => {
  FakeEventSource.instances.at(-1)!.emit(sessions);
  await flush();
};

beforeEach(() => {
  focusSpy.mockClear();
  playNotificationSoundMock.mockClear();
  hasFocusReturn = false;
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
  vi.stubGlobal("fetch", fetchMock);
  localStorage.clear();
});

afterEach(() => {
  // 画面全体に張ったキー購読を残すと、次のテストの App と二重に効いてしまう。
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

describe("App のフォーカス制御", () => {
  it("サイドバーのセッションを選ぶとそのターミナルにフォーカスが移る", async () => {
    const wrapper = await mountApp([session({ id: "a" })]);

    await wrapper.click("[data-test=session-body]");

    expect(focusSpy).toHaveBeenCalledWith("a");
  });

  describe("新規セッション作成", () => {
    it("ダイアログのディレクトリとエージェントを作成リクエストへ渡す", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => session({ id: "codex", agent: "codex" }),
      });
      const wrapper = await mountApp([]);
      await wrapper.click("[data-test=new-session]");

      await wrapper.setValue("input", "/tmp/proj");
      await wrapper.select("[data-test=agent]", "codex");
      await wrapper.submit("form");

      expect(fetchMock).toHaveBeenCalledWith("/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cwd: "/tmp/proj", agent: "codex" }),
      });
    });
  });

  it("選択中のセッションを再クリックしてもフォーカスが移る", async () => {
    const wrapper = await mountApp([session({ id: "a" })]);

    await wrapper.click("[data-test=session-body]");
    focusSpy.mockClear();

    await wrapper.click("[data-test=session-body]");

    expect(focusSpy).toHaveBeenCalledWith("a");
  });

  it("別のセッションへ切り替えると切り替え先にフォーカスが移る", async () => {
    const wrapper = await mountApp([session({ id: "a" }), session({ id: "b", title: "other" })]);

    await wrapper.click("[data-test=session-body]");
    focusSpy.mockClear();

    await wrapper.click("[data-test=session-body]", 1);

    expect(focusSpy).toHaveBeenCalledWith("b");
    expect(focusSpy).not.toHaveBeenCalledWith("a");
  });

  it("x ボタンではフォーカスも選択も動かさない", async () => {
    const wrapper = await mountApp([session({ id: "a" }), session({ id: "b" })]);

    await wrapper.click("[data-test=session-close]", 1);

    expect(focusSpy).not.toHaveBeenCalled();
  });

  it("選択中のセッションが消えたら残ったセッションへフォーカスが移る", async () => {
    const wrapper = await mountApp([session({ id: "a" }), session({ id: "b" })]);

    await wrapper.click("[data-test=session-body]");
    focusSpy.mockClear();

    // サーバから a が消えた一覧が届く。
    await emit([session({ id: "b" })]);

    expect(focusSpy).toHaveBeenCalledWith("b");
  });
});

describe("ターミナルのスプリット", () => {
  it("セッションを選ぶまでスプリットボタンは出ない", async () => {
    const wrapper = await mountApp([session({ id: "a" })]);
    expect(wrapper.find("[data-test=split-toggle]")).toBeNull();
  });

  it("押すと選択中セッションのシェルを開く", async () => {
    const wrapper = await mountApp([session({ id: "a" })]);
    await wrapper.click("[data-test=session-body]");

    await wrapper.click("[data-test=split-toggle]");

    expect(fetchMock).toHaveBeenCalledWith("/api/sessions/a/shell", { method: "POST" });
  });

  it("シェルが開いているセッションではペインが 2 枚並ぶ", async () => {
    const wrapper = await mountApp([session({ id: "a", shell: true })]);
    await wrapper.click("[data-test=session-body]");

    const panes = wrapper.findAll(".terminal-stub");
    expect(panes.map((pane) => pane.dataset.testKind)).toEqual(["agent", "shell"]);
  });

  it("シェルが開いていなければペインは 1 枚", async () => {
    const wrapper = await mountApp([session({ id: "a" })]);
    await wrapper.click("[data-test=session-body]");
    expect(wrapper.findAll(".terminal-stub")).toHaveLength(1);
  });

  it("開いている状態で押すとシェルを閉じる", async () => {
    const wrapper = await mountApp([session({ id: "a", shell: true })]);
    await wrapper.click("[data-test=session-body]");

    await wrapper.click("[data-test=split-toggle]");

    expect(fetchMock).toHaveBeenCalledWith("/api/sessions/a/shell", { method: "DELETE" });
  });

  it("開いたシェルにフォーカスが移る", async () => {
    const wrapper = await mountApp([session({ id: "a" })]);
    await wrapper.click("[data-test=session-body]");
    focusSpy.mockClear();

    await wrapper.click("[data-test=split-toggle]");
    // シェルが現れるのはサーバが shell: true を配ってから。
    await emit([session({ id: "a", shell: true })]);

    expect(focusSpy).toHaveBeenCalledWith("shell:a");
  });

  it("閉じたら claude のターミナルへフォーカスが戻る", async () => {
    const wrapper = await mountApp([session({ id: "a", shell: true })]);
    await wrapper.click("[data-test=session-body]");
    focusSpy.mockClear();

    await wrapper.click("[data-test=split-toggle]");

    expect(focusSpy).toHaveBeenCalledWith("a");
  });
});

describe("waiting/done への自動フォーカス", () => {
  it("選択中でないセッションが waiting になり、選択中ターミナルにフォーカスが無ければ自動で切り替わる", async () => {
    const wrapper = await mountApp([
      session({ id: "a", state: "working" }),
      session({ id: "b", state: "working" }),
    ]);

    await wrapper.click("[data-test=session-body]");
    focusSpy.mockClear();
    hasFocusReturn = false;

    await emit([session({ id: "a", state: "working" }), session({ id: "b", state: "waiting" })]);

    expect(focusSpy).toHaveBeenCalledWith("b");
  });

  it("選択中ターミナルにフォーカスがある場合は自動切り替えしない", async () => {
    const wrapper = await mountApp([
      session({ id: "a", state: "working" }),
      session({ id: "b", state: "working" }),
    ]);

    await wrapper.click("[data-test=session-body]");
    focusSpy.mockClear();
    hasFocusReturn = true;

    await emit([session({ id: "a", state: "working" }), session({ id: "b", state: "waiting" })]);

    expect(focusSpy).not.toHaveBeenCalled();
  });

  it("選択中のセッション自身が waiting になっても自動切り替えは起きない", async () => {
    const wrapper = await mountApp([session({ id: "a", state: "working" })]);

    await wrapper.click("[data-test=session-body]");
    focusSpy.mockClear();

    await emit([session({ id: "a", state: "waiting" })]);

    expect(focusSpy).not.toHaveBeenCalled();
  });

  it("何も選択していない状態で他セッションが done になったら自動選択される", async () => {
    await mountApp([session({ id: "a", state: "idle" }), session({ id: "b", state: "working" })]);
    focusSpy.mockClear();

    await emit([session({ id: "a", state: "idle" }), session({ id: "b", state: "done" })]);

    expect(focusSpy).toHaveBeenCalledWith("b");
  });
});

describe("waiting/done のサウンド通知", () => {
  beforeEach(() => {
    // useSoundSettings はモジュールスコープに設定を持つので、テストごとに作り直す。
    vi.resetModules();
  });

  it("working から waiting になったら waiting の音を鳴らす", async () => {
    await mountApp([session({ id: "a", state: "working" })]);
    playNotificationSoundMock.mockClear();

    await emit([session({ id: "a", state: "waiting" })]);

    expect(playNotificationSoundMock).toHaveBeenCalledWith("waiting");
  });

  it("working から done になったら done の音を鳴らす", async () => {
    await mountApp([session({ id: "a", state: "working" })]);
    playNotificationSoundMock.mockClear();

    await emit([session({ id: "a", state: "done" })]);

    expect(playNotificationSoundMock).toHaveBeenCalledWith("done");
  });

  it("working のままなら鳴らさない", async () => {
    await mountApp([session({ id: "a", state: "idle" })]);
    playNotificationSoundMock.mockClear();

    await emit([session({ id: "a", state: "working" })]);

    expect(playNotificationSoundMock).not.toHaveBeenCalled();
  });

  it("オフに設定していれば鳴らさない", async () => {
    localStorage.setItem(SOUND_ENABLED_KEY, "false");
    await mountApp([session({ id: "a", state: "working" })]);
    playNotificationSoundMock.mockClear();

    await emit([session({ id: "a", state: "done" })]);

    expect(playNotificationSoundMock).not.toHaveBeenCalled();
  });
});

describe("フォントサイズのショートカット", () => {
  /** 画面の中から押された状況を作る。capture で拾えていれば xterm へ届く前に止まる。 */
  const press = (over: Partial<KeyboardEventInit>) => {
    const event = new KeyboardEvent("keydown", {
      metaKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
      ...over,
    });
    document.body.dispatchEvent(event);
    return event;
  };

  beforeEach(() => {
    // useFontScale はモジュールスコープに倍率を持つので、テストごとに作り直す。
    vi.resetModules();
  });

  afterEach(() => {
    document.documentElement.style.removeProperty("--font-scale");
  });

  /**
   * キーの読み分けは fontScaleKeys の、倍率の保存は useFontScale のテストが見ている。
   * ここで確かめるのは、capture で拾った操作が倍率へ繋がっていることだけ。
   */
  it("押されたショートカットを倍率に繋ぐ", async () => {
    await mountApp([session({ id: "a" })]);

    press({ key: "+", code: "Equal" });
    await flush();

    expect(document.documentElement.style.getPropertyValue("--font-scale")).toBe("1.1");
  });

  /** xterm へ渡すとシェルに文字が入ってしまうので、受けたキーはここで止める。 */
  it("受け取ったキーだけを止め、ブラウザのズームは通す", async () => {
    await mountApp([session({ id: "a" })]);

    expect(press({ key: "+", code: "Equal" }).defaultPrevented).toBe(true);
    expect(press({ key: "=", code: "Equal", shiftKey: false }).defaultPrevented).toBe(false);
  });

  it("倍率を表示し、フェードが終わったら消す", async () => {
    const wrapper = await mountApp([session({ id: "a" })]);

    press({ key: "+", code: "Equal" });
    await flush();
    expect(wrapper.text("[data-test=font-scale-toast]")).toBe("110%");

    // jsdom は CSS アニメーションを走らせないので、終了を自分で伝える。
    wrapper
      .find("[data-test=font-scale-toast]")!
      .dispatchEvent(new Event("animationend", { bubbles: true }));
    await flush();
    expect(wrapper.find("[data-test=font-scale-toast]")).toBeNull();
  });

  /** 上下限で頭打ちになったことは、同じ値がもう一度光ることで分かる。 */
  it("上限に達していても倍率を表示する", async () => {
    localStorage.setItem(FONT_SCALE_KEY, "160");
    const wrapper = await mountApp([session({ id: "a" })]);

    press({ key: "+", code: "Equal" });
    await flush();

    expect(wrapper.text("[data-test=font-scale-toast]")).toBe("160%");
  });
});
