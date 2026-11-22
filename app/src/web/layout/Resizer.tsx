// 右のコメントの幅を変える取っ手（コメントの左端の線の上）。F23：ドラッグ・左右の矢印キー・ダブルクリック（もとの幅）。幅は localStorage に覚える。
import { useEffect, useState } from 'react';
import { PANEL_DEFAULT, PANEL_MIN } from '../lib/storage';
import { useUi } from '../store/ui';
import { KEY_STEP, panelMax, usePanelGeometry } from './geometry';

export function Resizer() {
  const { w, max } = usePanelGeometry();
  const [drag, setDrag] = useState(false);

  // ドラッグの間、全体を、選択できない・左右リサイズのカーソルにする（旧 body.resizing）
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
      aria-valuemin={PANEL_MIN}
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
        const limit = panelMax(useUi.getState().ui.sideOpen, window.innerWidth);
        useUi
          .getState()
          .setPanelW(Math.round(Math.min(Math.max(window.innerWidth - e.clientX, PANEL_MIN), limit)), { save: false });
      }}
      // ドラッグの終わり（離す・取り消し・取り込みを失う、のどれでも）。ここで、必ず、元に戻して、保存する
      onLostPointerCapture={() => {
        setDrag(false);
        useUi.getState().persistUi();
      }}
      onDoubleClick={() => useUi.getState().setPanelW(PANEL_DEFAULT)}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        useUi
          .getState()
          .setPanelW(Math.min(Math.max(w + (e.key === 'ArrowLeft' ? KEY_STEP : -KEY_STEP), PANEL_MIN), max));
      }}
    />
  );
}
