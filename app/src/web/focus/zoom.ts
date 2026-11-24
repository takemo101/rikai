// 拡大表示（ライトボックス）の計算：全体表示の大きさ・ズームの範囲・カーソルを中心にしたズーム・移動の範囲・ドラッグと押すの区別。DOM に触れない（純粋関数）。
// 座標：`Pose` の x・y は、中身の中心が、窓の中心から、どれだけ離れているか（px）。scale は、中身の大きさ（自然な大きさ＝等倍 1）に対する倍率。
import { clamp, type Size } from '../lib/geom';

export interface Pose {
  scale: number;
  x: number;
  y: number;
}
export type ZoomKind = 'img' | 'svg';

/** 全体表示で、窓に残す余白：窓の 92%・90% に収める */
export const FIT_W = 0.92;
export const FIT_H = 0.9;
/** ラスタ画像を、全体表示で、拡大してよい上限（小さい画像でも、2 倍まで）。SVG は、窓いっぱいまで */
export const RASTER_FIT_CAP = 2;
/** ズームの上限（等倍に対する倍率：800%）。全体表示が、これより大きいときは、全体表示が上限 */
export const ZOOM_MAX = 8;
/** ＋／−・キーの、1 回の倍率 */
export const ZOOM_STEP = 1.25;
/** 押す・ドラッグの境（px）：押した位置と離した位置の差が、これ以下なら「押す」 */
export const CLICK_SLOP = 4;

/** 全体表示の倍率：窓（view）に収まる最大。ラスタは、2 倍まで。SVG は、窓いっぱいまで */
export function fitScale(nat: Size, view: Size, kind: ZoomKind): number {
  if (nat.w <= 0 || nat.h <= 0 || view.w <= 0 || view.h <= 0) return 1;
  const fit = Math.min((view.w * FIT_W) / nat.w, (view.h * FIT_H) / nat.h);
  return kind === 'img' ? Math.min(fit, RASTER_FIT_CAP) : fit;
}

/** ズームの範囲：全体表示（fit）〜 800%（fit が、それより大きければ fit） */
export function clampScale(scale: number, fit: number): number {
  return clamp(scale, fit, Math.max(ZOOM_MAX, fit));
}

/** 移動の範囲：中身が窓より大きい方向だけ動かせて、縁が窓の縁を越えない。窓に収まる方向は、中央 */
export function clampPan(pose: Pose, nat: Size, view: Size): Pose {
  const lim = (content: number, port: number): number => Math.max(0, (content * pose.scale - port) / 2);
  const mx = lim(nat.w, view.w);
  const my = lim(nat.h, view.h);
  return { scale: pose.scale, x: clamp(pose.x, -mx, mx) + 0, y: clamp(pose.y, -my, my) + 0 }; // + 0 は、-0 を 0 にする
}

/** 全体表示の姿勢（中央・fit） */
export const fitPose = (fit: number): Pose => ({ scale: fit, x: 0, y: 0 });

/** カーソル（窓の中心からの位置）の下の点が動かないように、倍率を変える。範囲を超えない */
export function zoomAt(
  pose: Pose,
  nat: Size,
  view: Size,
  fit: number,
  next: number,
  cursor: { x: number; y: number },
): Pose {
  const scale = clampScale(next, fit);
  const k = scale / pose.scale;
  // 中身の中心 t は、カーソルの下の点 c = (p − t) / s が、動かないように：t' = p − (p − t) × (s' / s)
  const moved = { scale, x: cursor.x - (cursor.x - pose.x) * k, y: cursor.y - (cursor.y - pose.y) * k };
  return scale <= fit ? fitPose(fit) : clampPan(moved, nat, view);
}

/** ダブルクリック：全体表示 ↔ 等倍。全体表示が等倍以上（小さい図を、窓いっぱいに出している）なら、2 倍の拡大 ↔ 全体表示 */
export function toggleScale(current: number, fit: number): number {
  const atFit = Math.abs(current - fit) < 1e-6;
  if (!atFit) return fit;
  return fit < 1 ? 1 : fit * 2;
}

/** ホイールの 1 回分の倍率（上へ回すと拡大）。deltaMode：0 = px・1 = 行・2 = ページ */
export function wheelFactor(deltaY: number, deltaMode = 0): number {
  const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  return Math.exp(-Math.max(-300, Math.min(300, px)) * 0.0015);
}

/** 押した位置（down）と離した位置（up）の差が小さいとき、「押す」（ドラッグ・文字を選ぶ動きは、含めない）。down が分からなければ、押すとみなす */
export function isClickGesture(
  down: { x: number; y: number } | null,
  up: { x: number; y: number },
  slop = CLICK_SLOP,
): boolean {
  if (!down) return true;
  return Math.hypot(up.x - down.x, up.y - down.y) <= slop;
}
