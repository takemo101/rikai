// 範囲選択・入口のバーの、純粋な計算（DOM に触れない）。測定は、呼ぶ側（region.ts・Interact.tsx）が行い、ここへ数を渡す。
import type { Rect } from '../../shared/types';
import { type Box, bottom, clamp, ratioOf, right, roundRect } from '../lib/geom';

/** 選択の枠の内側の座標（左上が原点）の矩形 */
export interface DragRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** ドラッグで選べる範囲の、最小の幅・高さ（これ未満は断る） */
export const MIN_DRAG = 8;
/** 範囲の比率の、最小（0.05%）。これ未満は無効（サーバーと同じ） */
export const MIN_RATIO = 0.0005;
/** 範囲の画像にする、本文のブロックの要素の合計の上限（子孫を含む） */
export const RASTER_MAX_ELEMENTS = 3000;

/** 要素の矩形が、範囲に、重なるか（大きさのない要素〔表示されていない〕は、重ならない） */
export function overlaps(r: Box, vr: Box): boolean {
  return (
    (r.width > 0 || r.height > 0) &&
    right(r) > vr.left &&
    r.left < right(vr) &&
    bottom(r) > vr.top &&
    r.top < bottom(vr)
  );
}

/**
 * 範囲の基準にするブロック：左上の点を含むもの（小さいほう）。左上が、ブロックの間の余白なら、最初に重なるもの。
 * hits は、範囲に重なるブロック（本文の順）。空なら null
 */
export function pickBase<T>(hits: readonly { item: T; box: Box }[], vr: Box): T | null {
  const first = hits[0];
  if (!first) return null;
  let best: { item: T; box: Box } | null = null;
  for (const h of hits) {
    const b = h.box;
    if (!(b.left <= vr.left && vr.left <= right(b) && b.top <= vr.top && vr.top <= bottom(b))) continue;
    if (!best || b.width * b.height < best.box.width * best.box.height) best = h;
  }
  return (best ?? first).item;
}

/** 基準（frame）の大きさに対する比率。基準に大きさがない・小さすぎる（幅か高さが 0.05% 未満）なら null */
export function ratioRect(vr: Box, frame: Box): Rect | null {
  const ratio = ratioOf(vr, frame);
  if (!ratio) return null;
  const rect = roundRect(ratio);
  return rect.w < MIN_RATIO || rect.h < MIN_RATIO ? null : rect;
}

/**
 * 範囲が、1 つの画像・図の中に収まるか（収まるなら、元の解像度から切り出す）。
 * mediaReady：基準が、画像・図で、（画像なら）読み込めている。1px の誤差は許す
 */
export function isInsideFrame(vr: Box, frame: Box, mediaReady: boolean): boolean {
  return (
    mediaReady &&
    vr.left >= frame.left - 1 &&
    vr.top >= frame.top - 1 &&
    right(vr) <= right(frame) + 1 &&
    bottom(vr) <= bottom(frame) + 1
  );
}

/** 範囲の画像にするとき、要素の数が、上限を超えるか */
export const rasterTooBig = (count: number): boolean => count > RASTER_MAX_ELEMENTS;

/** ドラッグ中の矩形（選択の枠の内側の座標。枠からは、はみ出さない） */
export function dragRect(frame: Box, from: { x: number; y: number }, clientX: number, clientY: number): DragRect {
  const x = clamp(clientX - frame.left, 0, frame.width);
  const y = clamp(clientY - frame.top, 0, frame.height);
  return { x: Math.min(from.x, x), y: Math.min(from.y, y), w: Math.abs(x - from.x), h: Math.abs(y - from.y) };
}

export const dragTooSmall = (q: DragRect): boolean => q.w < MIN_DRAG || q.h < MIN_DRAG;

/** 枠の内側の座標の矩形を、ビューポートの矩形にする */
export const toViewport = (frame: Box, q: DragRect): Box => ({
  left: frame.left + q.x,
  top: frame.top + q.y,
  width: q.w,
  height: q.h,
});

/** 入口のバーの位置：right（バーの右端）・top（上端）を、窓の中（8px の余白）に収める */
export function barPosition(
  right: number,
  top: number,
  barWidth: number,
  windowWidth: number,
): { left: number; top: number } {
  return { left: Math.max(8, Math.min(windowWidth - barWidth - 8, right - barWidth)), top: Math.max(8, top) };
}

/**
 * ブロックのホバーの帯：ポインターが、そのブロックの（上下 4px・左 8px・本文の箱の右端 + 8px までの）帯にいる間は、同じブロックのまま、バーを出し続ける。
 * bar：いま出しているバーの矩形（ブロックのバーを出しているときだけ。出していなければ null）。バーの上（と、そのまわり 6px）も、同じブロック。
 */
export function inBand(blk: Box, art: Box, bar: Box | null, x: number, y: number): boolean {
  if (y >= blk.top - 4 && y <= bottom(blk) + 4 && x >= blk.left - 8 && x <= right(art) + 8) return true;
  return bar !== null && x >= bar.left - 6 && x <= right(bar) + 6 && y >= bar.top - 6 && y <= bottom(bar) + 6;
}

/** ブロックを探す点：本文の箱の右の余白にいる間は、同じ高さの、箱の中（端から 48px 以内）のブロックを探す（左の余白は、探さない） */
export function probeX(x: number, art: Box): number {
  const m = Math.min(48, art.width / 2);
  return clamp(x, art.left + m, right(art) - m);
}

/** ブロックのバーを出す位置（バーの右端・上端）：ブロックの右上の少し上。本文の領域（`#docscroll`）の上端（上のバー）には、重ねない */
export function blockBarSpot(blk: Box, art: Box, scrollBoxTop: number): { right: number; top: number } {
  return { right: right(art) - 8, top: Math.max(blk.top - 30, scrollBoxTop + 4) };
}
