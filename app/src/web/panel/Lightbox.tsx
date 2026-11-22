// 添付の画像（サムネイル・送った画像）を、画面の中に、大きく出す（F31）。押す・Esc で閉じる。
// 範囲の枠をドラッグしている間の Esc は、枠を元に戻すほう（interact）が受ける：そのときは、閉じない。
import { X } from 'lucide-react';
import { useEffect } from 'react';
import { useUi } from '../store/ui';

export function Lightbox() {
  const src = useUi((s) => s.lightbox);
  const closeLightbox = useUi((s) => s.closeLightbox);

  useEffect(() => {
    if (src === null) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !useUi.getState().regDrag) closeLightbox();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [src, closeLightbox]);

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: 閉じるキーは Esc（上の keydown）。旧と同じ DOM（背景を押すと閉じる）
    // biome-ignore lint/a11y/noStaticElementInteractions: 同上（role を足さず、旧と同じ DOM）
    <div id="lightbox" hidden={src === null} onClick={closeLightbox}>
      <img alt="添付の画像（大きく）" src={src ?? undefined} />
      <span className="close">
        <X aria-hidden="true" focusable="false" />
      </span>
    </div>
  );
}
