// 個別表示（F43）の座標の計算（DOM に触れない純粋関数）。測定は、呼ぶ側が行い、ここへ数を渡す。値は、有限の数として検査する（NaN・無限大・大きさのない箱は、null）。
//
// 座標の系：
//   - 窓（view）：ステージの領域。左上が原点・単位は px。
//   - 姿勢（Pose）：ズーム（scale）と移動（x・y：中身の中心が、窓の中心から、どれだけ離れているか。lib/zoom.ts）。
//   - 中身：画像・図。自然な大きさ（nat）が原点の単位。範囲は、**中身の大きさに対する比率** `{x,y,w,h}`（左上が原点。F25 と同じ形）。
// ズーム・移動・窓の大きさが、どう変わっても、比率は、中身の同じ場所を指す（画像の画素・図の座標に、そのまま対応する）。
import type { Rect } from '../../shared/types';
import { type Box, boxAt, clampToBox, finite, type Pt, ratioOf, roundRect, type Size } from '../lib/geom';
import type { Pose } from '../lib/zoom';
import { dragTooSmall, MIN_RATIO } from './geometry';

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
  if (!finite(a.x, a.y, b.x, b.y)) return null;
  const p = clampToBox(a, box);
  const q = clampToBox(b, box);
  const left = Math.min(p.x, q.x);
  const top = Math.min(p.y, q.y);
  const width = Math.abs(q.x - p.x);
  const height = Math.abs(q.y - p.y);
  if (dragTooSmall({ x: left, y: top, w: width, h: height })) return null;
  const sel = boxAt(left, top, width, height);
  const ratio = ratioOf(sel, box);
  if (!ratio) return null;
  const rect = roundRect(ratio);
  if (rect.w < MIN_RATIO || rect.h < MIN_RATIO) return null;
  return { box: sel, rect };
}
