// `<dialog>` を、状態（開いているか）に合わせて、開く・閉じる。**`confirm()` は使わない**（F34：組み込みのブラウザで、答えが返らず、押しても終わらないことがある）。
// 閉じたあと（ボタン・Esc・どちらでも）の処理は、`<dialog onClose>` で、`returnValue`（`<form method="dialog">` のボタンの value）を見る。
import { type RefObject, useEffect } from 'react';

export function useModal(ref: RefObject<HTMLDialogElement | null>, open: boolean): void {
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
  }, [ref, open]);
}
