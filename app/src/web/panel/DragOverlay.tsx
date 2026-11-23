// 個別表示（F43）のステージの上で、範囲をドラッグで選ぶ透明な層（`.fv-sel`）：画像・図（ステージの全面）と、html-app の枠（枠の置き場の上。枠の iframe は、ポインターを取るので、層が上から受ける）。
// 点は、画面の座標（clientX・clientY）で受け、**選ぶ対象（`getBox`：画像・図・枠の、いまの見た目の箱。ズーム・移動・縮小表示の後）の中**に収める。
// 比率への換算は、`interact/focusGeom.ts`（純粋）。画面で 8px 未満・比率が小さすぎる範囲は、断る（F25 と同じ）。選び終えたら、道具は、やめる（`focusTool: 'idle'`）。
import { type PointerEvent, useRef, useState } from 'react';
import { clampToBox, type DragSelection, dragSelection, type Pt } from '../interact/focusGeom';
import type { Box } from '../interact/geometry';
import { toast, useUi } from '../store/ui';

interface Props {
  /** 選ぶ対象の、いまの箱（画面の座標）。測れなければ null */
  getBox: () => Box | null;
  /** 範囲を選び終えた（画面の座標の箱と、対象に対する比率） */
  onSelect: (sel: DragSelection) => void;
}

interface Drag {
  a: Pt;
  b: Pt;
}

export function DragOverlay({ getBox, onSelect }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const live = useRef<Drag | null>(null);

  const set = (d: Drag | null): void => {
    live.current = d;
    setDrag(d);
  };
  const point = (e: PointerEvent): Pt => ({ x: e.clientX, y: e.clientY });

  const onDown = (e: PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    e.stopPropagation(); // ステージの移動・背景を押して閉じる、に渡さない
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    set({ a: point(e), b: point(e) });
  };
  const onMove = (e: PointerEvent<HTMLDivElement>): void => {
    const d = live.current;
    if (d) set({ a: d.a, b: point(e) });
  };
  const onUp = (e: PointerEvent<HTMLDivElement>): void => {
    const d = live.current;
    if (!d) return;
    e.stopPropagation();
    set(null);
    useUi.getState().setFocusTool('idle');
    const box = getBox();
    const sel = box ? dragSelection(d.a, point(e), box) : null;
    if (!sel) {
      toast('範囲が小さすぎます。ドラッグで、範囲を選んでください', true);
      return;
    }
    onSelect(sel);
  };

  // 描くのは、対象の中に収めた、ドラッグの矩形（層の左上が原点）
  const box = drag ? getBox() : null;
  const origin = ref.current?.getBoundingClientRect();
  let shown: { left: number; top: number; width: number; height: number } | null = null;
  if (drag && box && origin) {
    const p = clampToBox(drag.a, box);
    const q = clampToBox(drag.b, box);
    shown = {
      left: Math.min(p.x, q.x) - origin.left,
      top: Math.min(p.y, q.y) - origin.top,
      width: Math.abs(q.x - p.x),
      height: Math.abs(q.y - p.y),
    };
  }

  return (
    <div
      ref={ref}
      className="fv-sel"
      aria-hidden="true"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={() => set(null)}
    >
      {shown ? <div className="box" style={shown} /> : null}
    </div>
  );
}
