// 本文・AI の返信の、画像・図を、押して、大きく出す（F37）。個別表示（F43）：本文の画像・図・html-app の枠は、右にコメントのドックのある窓で開く。
// **開いても閉じても、本文の DOM は変わらない**：本文（`#article`）・返信の本体（`.msg .body.md`）への、
// イベントの委譲（クリック 1 つ。押した位置は、mousedown で控える）で受け、ここで、どの画像・図かを決めて、ライトボックスへ渡す。
// 対象：`img`（assets の画像・data: の画像）・Mermaid の図・インラインの `<svg>`。対象外：リンクの中・html-app の枠（iframe）・外部画像のブロック表示（`.img-blocked` は、img でない）。

import { getView } from '../lib/view';
import { isClickGesture } from '../lib/zoom';
import { cloneSvgForZoom } from '../lib/zoomSvg';
import { toast, useUi } from '../store/ui';
import { cancelAllPicks } from './appBridge';
import { focusRefOf } from './focusBlock';
import { appSpecOf } from './render/apps';
import type { BlockEl } from './render/blocks';

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

/**
 * 画像・図を、個別表示（ライトボックス）で、大きく出す（図は、id を付け替えた複製）。本文（`#article`）の画像・図なら、そのブロックを指す印（`focus`）を付ける
 * （右のドックに、そのブロックのコメントを出し、範囲を選んでコメントできる：F43）。返信の中の画像・図は、ステージだけ
 */
export function openZoomOf(el: HTMLImageElement | SVGSVGElement): void {
  const block = el.closest<BlockEl>('#article [data-bid]');
  const focus = block ? focusRefOf(block, el) : null;
  const ui = useUi.getState();
  ui.setRegMode('idle');
  cancelAllPicks();
  if (el instanceof HTMLImageElement) {
    ui.openZoom({
      kind: 'img',
      src: el.currentSrc || el.src,
      alt: el.alt || '画像（大きく）',
      zoom: true,
      ...(focus ? { focus } : {}),
    });
    return;
  }
  const r = el.getBoundingClientRect();
  ui.openZoom({
    kind: 'svg',
    node: cloneSvgForZoom(el),
    alt: '図（大きく）',
    size: { w: r.width, h: r.height },
    ...(focus ? { focus } : {}),
  });
}

/**
 * html-app の枠（`.htmlapp`）を、個別表示で、大きく出す（F43）。**新しい iframe を作る**（本文の枠を動かすと、再読み込みで状態が消え、本文の枠が壊れる）。
 * 本文の枠の状態（スライダーなど）は、引き継がない。枠を配れない古いサーバーでは、開かない
 */
export function openFocusApp(box: HTMLElement): void {
  const spec = appSpecOf(box);
  const focus = focusRefOf(box, null);
  if (!spec || !focus) return;
  if (getView()?.topic.appframe !== true) {
    toast(
      'この画面のサーバーが古いため、枠を動かせません。`rikai stop` のあと、`rikai open` で開き直してください。',
      true,
    );
    return;
  }
  const ui = useUi.getState();
  ui.setRegMode('idle');
  cancelAllPicks();
  ui.openZoom({
    kind: 'app',
    alt: `実行できる枠 ${spec.n + 1}（個別表示）`,
    focus,
    app: { n: spec.n, fixed: spec.fixed, follows: spec.follows },
  });
}

/** 個別表示を開く：画像・図なら複製して、html-app の枠なら新しい iframe で */
export function openFocusOf(el: HTMLImageElement | SVGSVGElement | HTMLElement): void {
  if (el instanceof HTMLImageElement || el instanceof SVGSVGElement) openZoomOf(el);
  else openFocusApp(el);
}

/**
 * ブロックの中の、（最初の）個別表示できる対象：拡大できる画像・図、または、ブロックそのものの html-app の枠。なければ null。
 * 入口のバーの「拡大」が使う（コメントの付いた画像・図は、押すとコメントを選ぶので、ここから開く）
 */
export function zoomTargetOfBlock(blk: Element): HTMLImageElement | SVGSVGElement | HTMLElement | null {
  if (blk instanceof HTMLElement && blk.classList.contains('htmlapp')) return blk;
  for (const el of [blk, ...blk.querySelectorAll('img, svg')]) {
    if (!el.matches('img, svg')) continue;
    const t = zoomableAt(el, blk);
    if (t) return t;
  }
  return null;
}
