// 右のコメントの幅を変える取っ手（コメントの左端の線の上）。F23：ドラッグ・左右の矢印キー・ダブルクリック（もとの幅）。幅は localStorage に覚える。
import { useEffect, useState } from 'react';
import { PANEL_DEFAULT } from '../lib/storage';
import { useUi } from '../store/ui';
import { defaultPanelWidth, isNarrow, KEY_STEP, panelMax, panelMin, sideShown, usePanelGeometry } from './geometry';

/** 取っ手で変えた幅：広い窓は、保存した幅（save: false は、ドラッグの途中）と、「利用者が決めた」印（幅が 380 でも、既定のままと見分ける）。狭い窓（〜900px）は、保存せず、その窓の間だけ（F23(3)：窓の大きさでは、保存した幅を、書き換えない） */
function setWidth(w: number, save = true): void {
  const ui = useUi.getState();
  if (isNarrow(window.innerWidth)) ui.setPanelWNarrow(w);
  else ui.setPanelW(w, { save });
}

/** もとの幅に戻す（ダブルクリック）：広い窓は、保存した幅を既定（380）に戻して、印を消す（1100px 以下では、細い既定の 280）。狭い窓（〜900px）は、その窓の間だけ、その窓の既定 */
function resetWidth(): void {
  const ui = useUi.getState();
  if (isNarrow(window.innerWidth)) ui.setPanelWNarrow(defaultPanelWidth(window.innerWidth));
  else ui.setPanelW(PANEL_DEFAULT, { user: false });
}

export function Resizer() {
  const { w, min, max } = usePanelGeometry();
  const [drag, setDrag] = useState(false);

  // ドラッグの間、全体を、選択できない・左右リサイズのカーソルにする（body.resizing）
  useEffect(() => {
    document.body.classList.toggle('resizing', drag);
    return () => document.body.classList.remove('resizing');
  }, [drag]);

  return (
    // biome-ignore lint/a11y/useSemanticElements: 縦の分割線（ARIA の separator）。<hr> は、フォーカスを受けられない
    <div
      id="panel-resizer"
      className={drag ? 'drag' : undefined}
      role="separator"
      aria-orientation="vertical"
      aria-label="コメントの幅（ドラッグ、または左右の矢印キーで変える。ダブルクリックでもとの幅）"
      title="ドラッグで、コメントの幅を変える（ダブルクリックで、もとの幅）"
      tabIndex={0}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={w}
      onPointerDown={(e) => {
        if (e.button !== 0) return; // 左ボタン（またはタッチ・ペン）だけ。右ボタンの、メニューの途中で、離しを失わないように
        e.currentTarget.setPointerCapture(e.pointerId);
        setDrag(true);
        e.currentTarget.focus({ preventScroll: true }); // 矢印キーで、続けて調整できるように
        e.preventDefault();
      }}
      onPointerMove={(e) => {
        if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
        const width = window.innerWidth;
        const limit = panelMax(sideShown(useUi.getState().ui.sideOpen, width), width);
        setWidth(Math.round(Math.min(Math.max(width - e.clientX, panelMin(width)), limit)), false);
      }}
      // ドラッグの終わり（離す・取り消し・取り込みを失う、のどれでも）。ここで、必ず、元に戻して、保存する
      onLostPointerCapture={() => {
        setDrag(false);
        if (!isNarrow(window.innerWidth)) useUi.getState().persistUi(); // 狭い窓の幅は、保存しない
      }}
      onDoubleClick={resetWidth}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        setWidth(Math.min(Math.max(w + (e.key === 'ArrowLeft' ? KEY_STEP : -KEY_STEP), min), max));
      }}
    />
  );
}
