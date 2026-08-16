import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { useRef } from "hono/jsx/dom";
import { MOVE_MS, useFlipMove } from "../../src/hooks/useFlipMove";
import { flush, mount, type Wrapper } from "./helpers";

/**
 * jsdom はレイアウトを計算しないので offsetTop が常に 0 になる。行ごとの位置を
 * テストから決められるよう、本文をキーにした表を引く getter に差し替える。
 */
let tops: Record<string, number> = {};
let originalOffsetTop: PropertyDescriptor | undefined;

beforeAll(() => {
  originalOffsetTop = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetTop");
  Object.defineProperty(HTMLElement.prototype, "offsetTop", {
    configurable: true,
    get(this: HTMLElement) {
      return tops[this.textContent ?? ""] ?? 0;
    },
  });
});

afterAll(() => {
  if (originalOffsetTop) Object.defineProperty(HTMLElement.prototype, "offsetTop", originalOffsetTop);
});

afterEach(() => {
  tops = {};
});

/** leaving に挙げた項目は退場中の行として描く。Sidebar と同じ繋ぎ方をする。 */
const List = ({ items, leaving = [] }: { items: string[]; leaving?: string[] }) => {
  const rows = useRef<HTMLUListElement | null>(null);
  useFlipMove(rows, (row) => row.classList.contains("row-leaving"));
  return (
    <ul ref={rows}>
      {items.map((item) => (
        <li key={item} class={leaving.includes(item) ? "row-leaving" : ""}>
          {item}
        </li>
      ))}
    </ul>
  );
};

const mountList = async (items: string[], positions: Record<string, number>) => {
  tops = positions;
  const wrapper = mount(<List items={items} />);
  await flush();
  return wrapper;
};

const row = (wrapper: Wrapper, text: string): HTMLElement =>
  wrapper.findAll("li").find((el) => el.textContent === text)!;

/** 描き直しを始め、useLayoutEffect が走ったところで止める（外すための rAF はまだ）。 */
const renderAndStop = async (wrapper: Wrapper, node: Parameters<Wrapper["render"]>[0]) => {
  wrapper.render(node);
  await Promise.resolve();
  await Promise.resolve();
};

describe("useFlipMove", () => {
  it("動いた行を元の位置へ引き戻してから、次のフレームで滑らせる", async () => {
    const wrapper = await mountList(["a", "b"], { a: 0, b: 20 });

    tops = { a: 20, b: 0 };
    await renderAndStop(wrapper, <List items={["b", "a"]} />);

    // 上下が入れ替わったので、それぞれ差分ぶん逆向きに引き戻されている。
    expect(row(wrapper, "a").style.transform).toBe("translateY(-20px)");
    expect(row(wrapper, "b").style.transform).toBe("translateY(20px)");
    expect(row(wrapper, "a").style.transition).toBe("none");

    await flush();

    // 引き戻しが外れ、transition が付いて実際の位置へ動く。
    expect(row(wrapper, "a").style.transform).toBe("");
    expect(row(wrapper, "a").style.transition).toBe(`transform ${MOVE_MS}ms ease`);
    wrapper.unmount();
  });

  it("位置が変わらない行には触らない", async () => {
    const wrapper = await mountList(["a", "b"], { a: 0, b: 20 });

    await renderAndStop(wrapper, <List items={["a", "b"]} />);

    expect(row(wrapper, "a").style.transform).toBe("");
    expect(row(wrapper, "b").style.transform).toBe("");
    wrapper.unmount();
  });

  /** 新しい行は入場のフェードが担当する。位置を知らないので動かしようがない。 */
  it("新しく現れた行には触らない", async () => {
    const wrapper = await mountList(["a"], { a: 0 });

    tops = { a: 0, b: 20 };
    await renderAndStop(wrapper, <List items={["a", "b"]} />);

    expect(row(wrapper, "b").style.transform).toBe("");
    wrapper.unmount();
  });

  /** 退場中の行は position:absolute で流れの外に居るので、移動の対象にしない。 */
  it("退場中の行は動かさない", async () => {
    const wrapper = await mountList(["a", "b"], { a: 0, b: 20 });

    tops = { a: 0, b: 40 };
    await renderAndStop(wrapper, <List items={["a", "b"]} leaving={["b"]} />);

    expect(row(wrapper, "b").style.transform).toBe("");
    wrapper.unmount();
  });

  /**
   * 退場のフェードは CSS の transition が持つ。インラインの transition が残っていると
   * クラス側の指定を上書きして消えてしまうので、退場に入った行では剥がす。
   */
  it("移動中に退場へ移った行からはインラインの transition を剥がす", async () => {
    const wrapper = await mountList(["a", "b"], { a: 0, b: 20 });

    tops = { a: 20, b: 0 };
    await wrapper.rerender(<List items={["b", "a"]} />);
    expect(row(wrapper, "b").style.transition).toBe(`transform ${MOVE_MS}ms ease`);

    await renderAndStop(wrapper, <List items={["b", "a"]} leaving={["b"]} />);

    expect(row(wrapper, "b").style.transition).toBe("");
    expect(row(wrapper, "b").style.transform).toBe("");
    wrapper.unmount();
  });
});
