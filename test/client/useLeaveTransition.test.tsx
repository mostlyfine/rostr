import { describe, expect, it } from "vitest";
import { useLeaveTransition } from "../../src/hooks/useLeaveTransition";
import { flush, mount } from "./helpers";

/**
 * 実時間で待つ。描画の完了待ちが requestAnimationFrame を挟む都合でそれ自体に
 * 数十 ms かかるので、期限はそれより十分長く取る。
 */
const DURATION = 200;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const Rows = ({ items }: { items: string[] }) => {
  const rows = useLeaveTransition(items, (item) => item, DURATION);
  return (
    <ul>
      {rows.map((row) => (
        <li key={row.key} data-test="row" data-leaving={String(row.leaving)}>
          {row.item}
        </li>
      ))}
    </ul>
  );
};

/** 描かれている行を「本文:退場中か」の形で読む。 */
const readRows = (wrapper: ReturnType<typeof mount>) =>
  wrapper.findAll("[data-test=row]").map((el) => `${el.textContent}:${el.dataset.leaving}`);

describe("useLeaveTransition", () => {
  it("渡された項目をそのまま返す", async () => {
    const wrapper = mount(<Rows items={["a", "b"]} />);
    await flush();
    expect(readRows(wrapper)).toEqual(["a:false", "b:false"]);
    wrapper.unmount();
  });

  it("消えた項目を元の位置に退場中として残す", async () => {
    const wrapper = mount(<Rows items={["a", "b", "c"]} />);
    await flush();

    await wrapper.rerender(<Rows items={["a", "c"]} />);

    expect(readRows(wrapper)).toEqual(["a:false", "b:true", "c:false"]);
    wrapper.unmount();
  });

  it("指定した時間が過ぎると退場中の項目も消える", async () => {
    const wrapper = mount(<Rows items={["a", "b"]} />);
    await flush();

    await wrapper.rerender(<Rows items={["a"]} />);
    expect(readRows(wrapper)).toEqual(["a:false", "b:true"]);

    await wait(DURATION);
    await flush();
    expect(readRows(wrapper)).toEqual(["a:false"]);
    wrapper.unmount();
  });

  it("退場中に戻ってきた項目は退場を取り消す", async () => {
    const wrapper = mount(<Rows items={["a", "b"]} />);
    await flush();

    await wrapper.rerender(<Rows items={["a"]} />);
    await wrapper.rerender(<Rows items={["a", "b"]} />);
    expect(readRows(wrapper)).toEqual(["a:false", "b:false"]);

    // 取り消した後に元のタイマーが発火しても、戻ってきた行を消してしまわない。
    await wait(DURATION);
    await flush();
    expect(readRows(wrapper)).toEqual(["a:false", "b:false"]);
    wrapper.unmount();
  });

  it("退場中の項目にも最後に見えていた中身が残る", async () => {
    const Named = ({ items }: { items: { id: string; label: string }[] }) => {
      const rows = useLeaveTransition(items, (item) => item.id, DURATION);
      return (
        <ul>
          {rows.map((row) => (
            <li key={row.key} data-test="row" data-leaving={String(row.leaving)}>
              {row.item.label}
            </li>
          ))}
        </ul>
      );
    };

    const wrapper = mount(<Named items={[{ id: "a", label: "あ" }]} />);
    await flush();

    await wrapper.rerender(<Named items={[]} />);

    expect(readRows(wrapper)).toEqual(["あ:true"]);
    wrapper.unmount();
  });
});
