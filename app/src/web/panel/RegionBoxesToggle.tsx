// 「範囲の枠を隠す」のオン・オフ（`ui.regionBoxes`）のボタン。右のパネルの見出し（`#regions-toggle`）と、拡大表示のドックの見出し（`.fv-regions-toggle`。`#lightbox` の中は、ID を持たない）で共用：
// 同じ状態を、どちらからでも切り替える（`LinksToggle` と同じ置き場）。押している（`aria-pressed`）＝隠している。隠している間も、番号・コメントのカードは、そのまま使える。
import { Eye, EyeOff } from 'lucide-react';
import { useUi } from '../store/ui';

export function RegionBoxesToggle({ id, className }: { id?: string; className?: string }) {
  const shown = useUi((s) => s.ui.regionBoxes);
  const Icon = shown ? Eye : EyeOff;
  return (
    <button
      id={id}
      type="button"
      className={className ? `iconbtn ${className}` : 'iconbtn'}
      title={
        shown
          ? '範囲の枠（いま：表示）：押すと、枠と、枠への線を隠します（html-app の中の操作が、枠に邪魔されません）'
          : '範囲の枠（いま：非表示）：押すと、枠を出します'
      }
      aria-label="範囲の枠を隠す"
      aria-pressed={!shown}
      onClick={() => useUi.getState().toggleRegionBoxes()}
    >
      <Icon aria-hidden="true" focusable="false" />
    </button>
  );
}
