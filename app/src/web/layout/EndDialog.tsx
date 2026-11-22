// 「レビューを終了します」のダイアログ（`#enddlg`）。「終了する」で POST /api/end → 取り直すと、終了の表示（`#ended`）が出る。
import { LogOut } from 'lucide-react';
import { type SyntheticEvent, useRef } from 'react';
import { useMutations } from '../api/mutations';
import { useUi } from '../store/ui';
import { useModal } from './useModal';

export function EndDialog({ slug }: { slug: string | null }) {
  const ref = useRef<HTMLDialogElement>(null);
  const open = useUi((s) => s.dialog === 'end');
  const { end } = useMutations();
  useModal(ref, open);

  const onClose = async (e: SyntheticEvent<HTMLDialogElement>): Promise<void> => {
    const dlg = e.currentTarget;
    const ok = dlg.returnValue === 'ok';
    dlg.returnValue = '';
    useUi.getState().closeDialog();
    if (ok && slug) await end({ topic: slug });
  };

  return (
    <dialog id="enddlg" ref={ref} onClose={onClose}>
      <form method="dialog">
        <h3>
          <LogOut aria-hidden="true" focusable="false" />
          レビューを終了します
        </h3>
        <p>未送信のコメントは残りますが、AI には届きません。</p>
        <div className="dlg-actions">
          <button type="submit" value="cancel" className="ghost">
            キャンセル
          </button>
          <button type="submit" id="enddlg-ok" value="ok" className="primary">
            終了する
          </button>
        </div>
      </form>
    </dialog>
  );
}
