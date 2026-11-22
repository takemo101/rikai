// 画面の下のトースト（`#toast`）。通常は 2.8 秒・エラーは 6 秒で消える。出し直すと、消す時刻も、取り直す。押せない（CSS：pointer-events: none）
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
    <div id="toast" className={toast?.err ? 'err' : ''} hidden={!toast}>
      {toast?.msg}
    </div>
  );
}
