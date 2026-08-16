import { createRoot } from "hono/jsx/dom/client";
import type { Child } from "hono/jsx";

/**
 * 描画の完了を待つ。hono/jsx/dom は状態更新をマイクロタスクに、useEffect を
 * requestAnimationFrame に載せるので、両方を 1 回ずつ空にする。effect の中で
 * さらに状態を変えることがあるので、都合 2 周する。
 */
export const flush = async () => {
  for (let i = 0; i < 2; i++) {
    await Promise.resolve();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await Promise.resolve();
  }
};

export interface Wrapper {
  /** 描画先。document.body に繋いであるので focus やイベントの伝播も本物と同じに動く。 */
  el: HTMLElement;
  find: (selector: string) => HTMLElement | null;
  findAll: (selector: string) => HTMLElement[];
  text: (selector: string) => string;
  /** クリックして描き直しを待つ。同じセレクタが複数あるときは index で選ぶ。 */
  click: (selector: string, index?: number) => Promise<void>;
  /** 入力欄に値を入れて input イベントを流す。 */
  setValue: (selector: string, value: string) => Promise<void>;
  /** select の値を変えて選択の変更を伝える。 */
  select: (selector: string, value: string) => Promise<void>;
  /** form に submit を投げる。ボタンの click では jsdom が送出しない。 */
  submit: (selector: string) => Promise<void>;
  /** 別の props で描き直す。親から渡す値が変わった場合の再現に使う。 */
  rerender: (node: Child) => Promise<void>;
  unmount: () => void;
}

const required = (el: HTMLElement | null, selector: string): HTMLElement => {
  if (!el) throw new Error(`要素が見つかりません: ${selector}`);
  return el;
};

/** jsdom の document.body へ実際にマウントする。後片付けは unmount() で。 */
export const mount = (node: Child): Wrapper => {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  root.render(node);

  const find = (selector: string) => el.querySelector<HTMLElement>(selector);
  const findAll = (selector: string) => [...el.querySelectorAll<HTMLElement>(selector)];

  return {
    el,
    find,
    findAll,
    text: (selector: string) => required(find(selector), selector).textContent ?? "",
    click: async (selector: string, index = 0) => {
      required(findAll(selector)[index] ?? null, `${selector}[${index}]`).dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
      await flush();
    },
    setValue: async (selector: string, value: string) => {
      const input = required(find(selector), selector) as HTMLInputElement;
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await flush();
    },
    select: async (selector: string, value: string) => {
      const el = required(find(selector), selector) as HTMLSelectElement;
      el.value = value;
      // hono/jsx/dom は onChange を input イベントに割り当てる（React と同じ）ので、
      // 実際のブラウザで両方が飛ぶうちの input の方を投げる。
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      await flush();
    },
    submit: async (selector: string) => {
      // hono の form は自前の submit ハンドラを張っており、信頼されないイベントでは
      // detail を読む。CustomEvent で投げて detail を持たせないと落ちる。
      required(find(selector), selector).dispatchEvent(
        new CustomEvent("submit", { bubbles: true, cancelable: true, detail: {} }),
      );
      await flush();
    },
    rerender: async (next: Child) => {
      root.render(next);
      await flush();
    },
    unmount: () => {
      root.unmount();
      el.remove();
    },
  };
};
