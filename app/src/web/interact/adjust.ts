// 範囲の枠の調整（F31）：枠の DOM とドラッグは、W1 の overlay が持つ。離したとき、W1 は、`EventTarget`（`overlay/regionAdjust.ts` の `regionAdjustTarget`）に、
// イベント `adjust`（`detail`：ビューポートの矩形 `{ left, top, width, height }`）を出す。ここで購読して、範囲で、対象・見出し・切り出しの画像を、作り直す（`finishRegion`）。
import { ADJUST_EVENT } from '../overlay/regionAdjust';
import type { ViewportRect } from './geometry';

const isRect = (v: unknown): v is ViewportRect =>
  typeof v === 'object' &&
  v !== null &&
  'left' in v &&
  'top' in v &&
  'width' in v &&
  'height' in v &&
  [v.left, v.top, v.width, v.height].every((n) => typeof n === 'number' && Number.isFinite(n));

/** `adjust` を購読する。解除の関数を返す。形の違う detail は、捨てる */
export function subscribeRegionAdjust(target: EventTarget, onAdjust: (vr: ViewportRect) => void): () => void {
  const listener = (e: Event): void => {
    if (e instanceof CustomEvent && isRect(e.detail)) onAdjust(e.detail);
  };
  target.addEventListener(ADJUST_EVENT, listener);
  return () => target.removeEventListener(ADJUST_EVENT, listener);
}
