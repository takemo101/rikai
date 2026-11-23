// 本文・AI の返信の、画像・図を、押して、大きく出す（F37）。**本文の DOM には、何も足さない**：本文（`#article`）・返信の本体（`.msg .body.md`）への、
// イベントの委譲（クリック 1 つ。押した位置は、mousedown で控える）で受け、ここで、どの画像・図かを決めて、ライトボックスへ渡す。
// 対象：`img`（assets の画像・data: の画像）・Mermaid の図・インラインの `<svg>`。対象外：リンクの中・html-app の枠（iframe）・外部画像のブロック表示（`.img-blocked` は、img でない）。
import { isClickGesture } from '../lib/zoom';
import { cloneSvgForZoom } from '../lib/zoomSvg';
import { useUi } from '../store/ui';

let lastDown: { x: number; y: number } | null = null;

/** マウスを押した位置を控える（押す・ドラッグを区別するため：lib/zoom.ts の isClickGesture） */
export function noteMouseDown(e: { clientX: number; clientY: number }): void {
  lastDown = { x: e.clientX, y: e.clientY };
}

/** root の中で押された、拡大できる画像・図。なければ null */
export function zoomableAt(target: EventTarget | null, root: Element): HTMLImageElement | SVGSVGElement | null {
  if (!(target instanceof Element) || !root.contains(target)) return null;
  const img = target.closest('img');
  if (img instanceof HTMLImageElement) return root.contains(img) && !img.closest('a, button') ? img : null;
  let svg = target.closest('svg');
  if (!svg) return null;
  for (let up = svg.parentElement?.closest('svg'); up; up = svg.parentElement?.closest('svg')) svg = up; // 入れ子の svg は、いちばん外の図
  if (!root.contains(svg) || svg.closest('a, button, iframe, .htmlapp, .regionbox')) return null;
  return svg as SVGSVGElement;
}

/**
 * root の中の画像・図を押したとき、拡大を開く。開いたら true。開かないとき：左ボタン以外・修飾キー・文字を選んだあと・ドラッグ（押した位置から動いた）・範囲を選ぶ最中。
 * コメントを選ぶ操作（強調・範囲の枠・コメントの付いたブロックの押下）は、呼ぶ側が、先に受ける
 */
export function zoomOnClick(e: MouseEvent, root: Element): boolean {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false;
  const el = zoomableAt(e.target, root);
  if (!el) return false;
  if (useUi.getState().regMode === 'selecting') return false;
  if (!isClickGesture(lastDown, { x: e.clientX, y: e.clientY })) return false;
  const sel = getSelection();
  if (sel && !sel.isCollapsed) return false;
  openZoomOf(el);
  return true;
}

/** 画像・図を、ライトボックスで、大きく出す（図は、id を付け替えた複製） */
export function openZoomOf(el: HTMLImageElement | SVGSVGElement): void {
  if (el instanceof HTMLImageElement) {
    useUi
      .getState()
      .openZoom({ kind: 'img', src: el.currentSrc || el.src, alt: el.alt || '画像（大きく）', zoom: true });
    return;
  }
  const r = el.getBoundingClientRect();
  useUi
    .getState()
    .openZoom({ kind: 'svg', node: cloneSvgForZoom(el), alt: '図（大きく）', size: { w: r.width, h: r.height } });
}

/** ブロックの中の、（最初の）拡大できる画像・図。なければ null。入口のバーの「拡大」が使う（コメントの付いた画像・図は、押すとコメントを選ぶので、ここから開く） */
export function zoomTargetOfBlock(blk: Element): HTMLImageElement | SVGSVGElement | null {
  for (const el of [blk, ...blk.querySelectorAll('img, svg')]) {
    if (!el.matches('img, svg')) continue;
    const t = zoomableAt(el, blk);
    if (t) return t;
  }
  return null;
}
