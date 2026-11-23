// 個別表示（F43）の座標の計算（DOM に触れない純粋関数）。測定は、呼ぶ側が行い、ここへ数を渡す。値は、有限の数として検査する（NaN・無限大・大きさのない箱は、null）。
//
// 座標の系：
//   - 窓（view）：ステージの領域。左上が原点・単位は px。
//   - 姿勢（Pose）：ズーム（scale）と移動（x・y：中身の中心が、窓の中心から、どれだけ離れているか。lib/zoom.ts）。
//   - 中身：画像・図。自然な大きさ（nat）が原点の単位。範囲は、**中身の大きさに対する比率** `{x,y,w,h}`（左上が原点。F25 と同じ形）。
// ズーム・移動・窓の大きさが、どう変わっても、比率は、中身の同じ場所を指す（画像の画素・図の座標に、そのまま対応する）。
import type { Rect } from '../../shared/types';
import type { Pose, Size } from '../lib/zoom';
import { type Box, dragTooSmall, MIN_RATIO, r4 } from './geometry';

export interface Pt {
  x: number;
  y: number;
}

const finite = (...v: number[]): boolean => v.every((n) => Number.isFinite(n));

/** 左上と大きさから、箱を作る */
export const boxAt = (left: number, top: number, width: number, height: number): Box => ({
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
});

/**
 * 中身（自然な大きさ nat）を、姿勢（pose）で、窓（view）に置いたときの箱（窓の座標）。
 * 中心は、窓の中心 + 移動。大きさは、自然な大きさ × 倍率。数が不正（有限でない・大きさが 0 以下）なら null
 */
export function stageBox(pose: Pose, nat: Size, view: Size): Box | null {
  if (!finite(pose.scale, pose.x, pose.y, nat.w, nat.h, view.w, view.h)) return null;
  if (pose.scale <= 0 || nat.w <= 0 || nat.h <= 0 || view.w <= 0 || view.h <= 0) return null;
  const w = nat.w * pose.scale;
  const h = nat.h * pose.scale;
  return boxAt(view.w / 2 + pose.x - w / 2, view.h / 2 + pose.y - h / 2, w, h);
}

/** 箱の外へ出ない点（箱の縁に寄せる） */
export const clampToBox = (p: Pt, box: Box): Pt => ({
  x: Math.min(Math.max(p.x, box.left), box.right),
  y: Math.min(Math.max(p.y, box.top), box.bottom),
});

/** 2 点のドラッグが、選んだ範囲：箱（中身）の中に収めた箱と、中身に対する比率 */
export interface DragSelection {
  /** 箱と同じ座標の、選んだ範囲 */
  box: Box;
  /** 中身の大きさに対する比率（4 桁に丸める）。F25 の `anchor.rect` と同じ形 */
  rect: Rect;
}

/**
 * 2 点（a・b。箱と同じ座標）のドラッグから、範囲を決める。点は、箱の縁に収める（中身の外は、選べない）。
 * 画面で 8px 未満（`dragTooSmall`）・比率が 0.05% 未満・箱が不正・点が不正なら、null
 */
export function dragSelection(a: Pt, b: Pt, box: Box): DragSelection | null {
  if (!finite(a.x, a.y, b.x, b.y, box.left, box.top, box.width, box.height) || box.width <= 0 || box.height <= 0)
    return null;
  const p = clampToBox(a, box);
  const q = clampToBox(b, box);
  const left = Math.min(p.x, q.x);
  const top = Math.min(p.y, q.y);
  const width = Math.abs(q.x - p.x);
  const height = Math.abs(q.y - p.y);
  if (dragTooSmall({ x: left, y: top, w: width, h: height })) return null;
  const rect = {
    x: r4((left - box.left) / box.width),
    y: r4((top - box.top) / box.height),
    w: r4(width / box.width),
    h: r4(height / box.height),
  };
  if (rect.w < MIN_RATIO || rect.h < MIN_RATIO) return null;
  return { box: boxAt(left, top, width, height), rect };
}

/** 比率の範囲（rect）を、箱（base：中身の箱）の座標にする（ステージに重ねる枠の位置）。base が不正なら null */
export function ratioToBox(rect: Rect, base: Box): Box | null {
  if (!finite(rect.x, rect.y, rect.w, rect.h, base.left, base.top, base.width, base.height)) return null;
  if (base.width <= 0 || base.height <= 0) return null;
  return boxAt(
    base.left + rect.x * base.width,
    base.top + rect.y * base.height,
    rect.w * base.width,
    rect.h * base.height,
  );
}

/** 箱（inner）が、箱（frame）の大きさに対して、どこにあるか（比率。丸めない）。frame が不正なら null */
export function boxToRatio(inner: Box, frame: Box): Rect | null {
  if (!finite(inner.left, inner.top, inner.width, inner.height, frame.left, frame.top, frame.width, frame.height))
    return null;
  if (frame.width <= 0 || frame.height <= 0) return null;
  return {
    x: (inner.left - frame.left) / frame.width,
    y: (inner.top - frame.top) / frame.height,
    w: inner.width / frame.width,
    h: inner.height / frame.height,
  };
}
