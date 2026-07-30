import { onBeforeUnmount, onMounted, ref } from "vue";
import { toFontScaleCommand } from "../fontScaleKeys";
import { useFontScale } from "./useFontScale";

/**
 * 倍率のショートカットを画面全体で受け、押された直後だけ倍率を表示するための状態を作る。
 * キーの読み取りは fontScaleKeys.ts、倍率そのものは useFontScale が持つので、ここは
 * その2つを繋ぐ副作用（document の購読と表示の寿命）だけを持つ。
 */
export const useFontScaleShortcut = () => {
  const { scale, increase, decrease, reset } = useFontScale();
  const commands = { increase, decrease, reset };

  /**
   * 押された回数。null の間は何も描かない。値が変わると要素が作り直されてフェードが
   * 頭から流れるので、上下限で頭打ちのときも同じ倍率がもう一度光って気付ける。
   */
  const shown = ref<number | null>(null);

  /**
   * capture 段階で受けるので、xterm が自分の textarea に張っているハンドラより先に届く。
   * ここで止めれば、ターミナルにもダイアログの入力欄にもこのキーは渡らない。
   */
  const onKeydown = (event: KeyboardEvent) => {
    const command = toFontScaleCommand(event);
    if (!command) return;
    event.preventDefault();
    event.stopPropagation();

    commands[command]();
    shown.value = (shown.value ?? 0) + 1;
  };

  onMounted(() => document.addEventListener("keydown", onKeydown, { capture: true }));
  onBeforeUnmount(() => document.removeEventListener("keydown", onKeydown, { capture: true }));

  return { scale, shown, dismiss: () => (shown.value = null) };
};
