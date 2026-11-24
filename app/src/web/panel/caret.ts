// 入力欄の、カーソルの位置：作ったときは、文字の、最後（React は、`value` を入れても、先頭になる）。
// 関数の参照が変わらない（モジュールの定数）ので、`ref` に渡しても、描き直すたびには、呼ばれない（入力中の位置を、動かさない）。
export function caretAtEnd(el: HTMLInputElement | HTMLTextAreaElement | null): void {
  if (!el) return;
  const n = el.value.length;
  el.setSelectionRange(n, n);
}
