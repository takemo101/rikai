// 「AI に送信」のダイアログ（`#submitdlg`）。未送信の件数と、全体へのメモ（任意）。「送信する」で POST /api/submit → 「第N回として送信しました」。
// キャンセルしても、メモは残す。送信できたら、メモを空にする。
import { Send } from 'lucide-react';
import { type SyntheticEvent, useRef, useState } from 'react';
import { useMutations } from '../api/mutations';
import { useUi } from '../store/ui';
import { useModal } from './useModal';

export interface SubmitDialogProps {
  slug: string | null;
  /** 未送信のコメント・回答などの数 */
  unsent: number;
}

export function SubmitDialog({ slug, unsent }: SubmitDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const open = useUi((s) => s.dialog === 'submit');
  const [note, setNote] = useState('');
  const { submit } = useMutations();
  useModal(ref, open);

  const onClose = async (e: SyntheticEvent<HTMLDialogElement>): Promise<void> => {
    const dlg = e.currentTarget;
    const ok = dlg.returnValue === 'ok';
    dlg.returnValue = '';
    useUi.getState().closeDialog();
    if (!ok || !slug) return;
    await submit(
      { topic: slug, note },
      {
        onOk: (r) => {
          setNote('');
          useUi.getState().showToast(`第${r.round}回として送信しました`);
        },
      },
    );
  };

  return (
    <dialog id="submitdlg" ref={ref} onClose={onClose}>
      <form method="dialog">
        <h3>
          <Send aria-hidden="true" focusable="false" />
          AI に送信
        </h3>
        <p id="submitdlg-summary">未送信のコメント・回答など {unsent} 件を AI に送ります。</p>
        <label className="note-label">
          全体へのメモ（任意）
          <textarea
            id="submitdlg-note"
            rows={3}
            placeholder="特定の箇所に紐づかない伝言があれば"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        <div className="dlg-actions">
          <button type="submit" value="cancel" className="ghost">
            キャンセル
          </button>
          <button type="submit" id="submitdlg-ok" value="ok" className="primary">
            <Send aria-hidden="true" focusable="false" />
            送信する
          </button>
        </div>
      </form>
    </dialog>
  );
}
