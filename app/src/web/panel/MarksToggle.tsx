// 「コメントの印を隠す」のオン・オフ（`ui.marks`）のボタン。右のパネルの見出し（`#marks-toggle`）と、拡大表示のドックの見出し（`.fv-marks-toggle`。`#lightbox` の中は、ID を持たない）で共用：
// 同じ状態を、どちらからでも切り替える（`LinksToggle` と同じ置き場）。押している（`aria-pressed`）＝隠している。
// 隠すのは、本文・拡大表示の、コメントの印すべて（文の強調・ブロックの外枠・範囲の枠・番号の丸・関連の線）。入力中の対象の印だけは、残る。右のパネル・ドックのカードは、そのまま使える。
import { Eye, EyeOff } from 'lucide-react';
import { useUi } from '../store/ui';

export function MarksToggle({ id, className }: { id?: string; className?: string }) {
  const shown = useUi((s) => s.ui.marks);
  const Icon = shown ? Eye : EyeOff;
  return (
    <button
      id={id}
      type="button"
      className={className ? `iconbtn ${className}` : 'iconbtn'}
      title={
        shown
          ? 'コメントの印（いま：表示）：押すと、本文・拡大表示の、コメントの印（強調・枠・番号・線）を、すべて隠します。右のカードは、そのまま使えます（html-app の中の操作が、印に邪魔されません）'
          : 'コメントの印（いま：非表示）：押すと、印を出します'
      }
      aria-label="コメントの印を隠す"
      aria-pressed={!shown}
      onClick={() => useUi.getState().toggleMarks()}
    >
      <Icon aria-hidden="true" focusable="false" />
    </button>
  );
}
