// 範囲の枠の調整（F31）：入力中の範囲の枠を、ドラッグで動かし・角と辺で大きさを変える。
// 枠の DOM（`.regionbox.pending` と `.rh`）と、ドラッグのロジックは、W1（overlay/）。離したときに、調整後の矩形を、`regionAdjustTarget` のイベントで、W3 へ渡す。
//
// W3 の使い方：
//   regionAdjustTarget.addEventListener('adjust', (e) => finishRegion((e as AdjustEvent).detail));
// `detail` は、ビューポートの座標（`getBoundingClientRect` と同じ系）の矩形。`finishRegion(vr)` と同じ形。
// 離したときだけ送る（Esc・pointercancel で、やめたときは、送らない）。

/** ビューポートの座標の矩形（`finishRegion` の引数と同じ形） */
export interface ViewportRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type AdjustEvent = CustomEvent<ViewportRect>;

/** 範囲の枠を、離したとき、調整後の矩形（`ViewportRect`）を、`'adjust'` イベントで受け取る場所 */
export const regionAdjustTarget = new EventTarget();

export const ADJUST_EVENT = 'adjust';

export function dispatchAdjust(vr: ViewportRect): void {
  regionAdjustTarget.dispatchEvent(new CustomEvent<ViewportRect>(ADJUST_EVENT, { detail: vr }));
}

/** つかむ所：本体（move）と、8 つのハンドル */
export type HandleMode = 'move' | 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export const HANDLES: readonly Exclude<HandleMode, 'move'>[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

export const parseHandle = (v: string | undefined): HandleMode =>
  (HANDLES as readonly string[]).includes(v ?? '') ? (v as HandleMode) : 'move';

export interface Edges {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** 枠の最小の大きさ（px） */
export const MIN_REGION = 12;

/**
 * 動かした分（dx・dy）から、枠の辺を決める。`bounds`（本文）の外へは、出さない。
 * 大きさを変えるとき、最小（MIN_REGION）より小さくならない。本体を動かすときは、大きさを変えず、本文の中に収める
 */
export function adjustEdges(mode: HandleMode, r0: Edges, dx: number, dy: number, bounds: Edges): Edges {
  let { left, top, right, bottom } = r0;
  if (mode === 'move') {
    left += dx;
    right += dx;
    top += dy;
    bottom += dy;
  } else {
    if (mode.includes('w')) left += dx;
    if (mode.includes('e')) right += dx;
    if (mode.includes('n')) top += dy;
    if (mode.includes('s')) bottom += dy;
    if (right - left < MIN_REGION) {
      if (mode.includes('w')) left = right - MIN_REGION;
      else right = left + MIN_REGION;
    }
    if (bottom - top < MIN_REGION) {
      if (mode.includes('n')) top = bottom - MIN_REGION;
      else bottom = top + MIN_REGION;
    }
  }
  const w = right - left;
  const h = bottom - top;
  if (mode === 'move') {
    left = Math.min(Math.max(left, bounds.left), bounds.right - w);
    top = Math.min(Math.max(top, bounds.top), bounds.bottom - h);
    right = left + w;
    bottom = top + h;
  } else {
    left = Math.max(left, bounds.left);
    right = Math.min(right, bounds.right);
    top = Math.max(top, bounds.top);
    bottom = Math.min(bottom, bounds.bottom);
  }
  return { left, top, right, bottom };
}

export const toViewportRect = (e: Edges): ViewportRect => ({
  left: e.left,
  top: e.top,
  width: e.right - e.left,
  height: e.bottom - e.top,
});
