// 「関連の線を出す」のオン・オフ（`ui.links`）のボタン。右のパネルの見出し（`#links-toggle`）と、拡大表示のドックの見出し（`.fv-links-toggle`。`#lightbox` の中は、ID を持たない）で共用：同じ状態を、どちらからでも切り替える。
import { Spline } from 'lucide-react';
import { useUi } from '../store/ui';

export function LinksToggle({ id, className }: { id?: string; className?: string }) {
  const links = useUi((s) => s.ui.links);
  return (
    <button
      id={id}
      type="button"
      className={className ? `iconbtn ${className}` : 'iconbtn'}
      title={`関連の線（いま：${links ? 'オン' : 'オフ'}）：コメントと、本文の対象を、線で結ぶ。押すと、${links ? '隠します' : '出します'}`}
      aria-label="関連の線"
      aria-pressed={links}
      onClick={() => useUi.getState().toggleLinks()}
    >
      <Spline aria-hidden="true" focusable="false" />
    </button>
  );
}
