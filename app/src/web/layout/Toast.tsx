// 画面の下のトースト（`#toast`）。通常は 2.8 秒・エラーは 6 秒で消える。出し直すと、消す時刻も、取り直す。押せない（CSS：pointer-events: none）。位置は 1 か所（下の中央。右下の「範囲を選ぶ」より上）。
// 読み上げ：トーストが出る前から、画面にある入れ物（`#toast-region`）が、読み上げの窓口：通常は `aria-live="polite"`（`status` の扱い）。エラーは、`#toast` 自身が `role="alert"`（すぐ読み上げる）：
// 入れ物は、そのとき `aria-live="off"`（同じ文を、2 度、読み上げない）。見えるトースト（`display: none` と、表示の切り替え）だけに `role` を付けても、出る前に窓口がなく、読み上げられないことがある。
import { CircleAlert, Info } from 'lucide-react';
import { useEffect } from 'react';
import { useUi } from '../store/ui';

export function Toast() {
  const toast = useUi((s) => s.toast);
  const id = toast?.id;
  const err = toast?.err;

  useEffect(() => {
    if (id === undefined) return;
    const timer = setTimeout(() => useUi.getState().clearToast(id), err ? 6000 : 2800);
    return () => clearTimeout(timer);
  }, [id, err]);

  return (
    <div id="toast-region" aria-live={err ? 'off' : 'polite'} aria-atomic="true">
      <div id="toast" className={err ? 'err' : ''} role={err ? 'alert' : undefined} hidden={!toast}>
        {toast ? (
          err ? (
            <CircleAlert aria-hidden="true" focusable="false" />
          ) : (
            <Info aria-hidden="true" focusable="false" />
          )
        ) : null}
        {toast?.msg}
      </div>
    </div>
  );
}
