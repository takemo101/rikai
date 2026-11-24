import { expect, test } from 'vitest';
import {
  barPosition,
  blockBarSpot,
  dragRect,
  dragTooSmall,
  inBand,
  isInsideFrame,
  overlaps,
  pickBase,
  probeX,
  RASTER_MAX_ELEMENTS,
  rasterTooBig,
  ratioRect,
  toViewport,
} from '../../../src/web/interact/geometry';
import { boxAt } from '../../../src/web/lib/geom';

const box = boxAt;

test('overlaps：重なる・接するだけは重ならない・大きさのない要素は重ならない', () => {
  const vr = { left: 10, top: 10, width: 20, height: 20 };
  expect(overlaps(box(0, 0, 15, 15), vr)).toBe(true);
  expect(overlaps(box(30, 0, 10, 40), vr)).toBe(false); // 右の端が、ちょうど接する
  expect(overlaps(box(0, 0, 10, 40), vr)).toBe(false);
  expect(overlaps(box(15, 15, 0, 0), vr)).toBe(false);
});

test('pickBase：左上の点を含むブロックのうち、小さいほう。含むものがなければ、最初に重なるもの', () => {
  const big = { item: 'big', box: box(0, 0, 200, 200) };
  const small = { item: 'small', box: box(10, 10, 50, 50) };
  const other = { item: 'other', box: box(100, 100, 50, 50) };
  expect(pickBase([big, small, other], { left: 20, top: 20, width: 200, height: 200 })).toBe('small');
  expect(pickBase([big, small], { left: 150, top: 150, width: 20, height: 20 })).toBe('big');
  // 左上が、ブロックの間の余白：最初のもの
  expect(pickBase([small, other], { left: 70, top: 70, width: 100, height: 100 })).toBe('small');
  expect(pickBase([], { left: 0, top: 0, width: 5, height: 5 })).toBeNull();
});

test('ratioRect：基準の大きさに対する比率（4 桁）。基準の外へ出ると、負・1 超', () => {
  const fr = box(100, 200, 400, 100);
  expect(ratioRect({ left: 200, top: 225, width: 200, height: 50 }, fr)).toEqual({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 });
  expect(ratioRect({ left: 50, top: 150, width: 500, height: 200 }, fr)).toEqual({ x: -0.125, y: -0.5, w: 1.25, h: 2 });
  expect(ratioRect({ left: 100, top: 200, width: 1, height: 1 }, box(0, 0, 3, 3))).toEqual({
    x: 33.3333,
    y: 66.6667,
    w: 0.3333,
    h: 0.3333,
  });
});

test('ratioRect：基準に大きさがない・0.05% 未満は null', () => {
  expect(ratioRect({ left: 0, top: 0, width: 10, height: 10 }, box(0, 0, 0, 0))).toBeNull();
  expect(ratioRect({ left: 0, top: 0, width: 10, height: 10 }, box(0, 0, 100, 0))).toBeNull();
  // 幅 0.04%（4000px の基準に 1.6px）
  expect(ratioRect({ left: 0, top: 0, width: 1.6, height: 10 }, box(0, 0, 4000, 100))).toBeNull();
  expect(ratioRect({ left: 0, top: 0, width: 2.4, height: 10 }, box(0, 0, 4000, 100))).not.toBeNull();
});

test('ratioRect：数が有限でない（NaN・無限大）範囲・基準は、null（NaN の比率を、返さない）', () => {
  const fr = box(100, 200, 400, 100);
  expect(ratioRect({ left: Number.NaN, top: 0, width: 10, height: 10 }, fr)).toBeNull();
  expect(ratioRect({ left: 0, top: 0, width: 10, height: Number.POSITIVE_INFINITY }, fr)).toBeNull();
  expect(ratioRect({ left: 0, top: 0, width: 10, height: 10 }, box(0, 0, Number.NaN, 100))).toBeNull();
  expect(ratioRect({ left: 0, top: 0, width: 10, height: 10 }, box(0, 0, Number.POSITIVE_INFINITY, 100))).toBeNull();
});

test('isInsideFrame：画像・図の中に収まる（1px の誤差は許す）。基準が画像・図でない・読み込み前なら false', () => {
  const fr = box(100, 100, 200, 100);
  expect(isInsideFrame({ left: 120, top: 110, width: 50, height: 50 }, fr, true)).toBe(true);
  expect(isInsideFrame({ left: 99, top: 99, width: 202, height: 102 }, fr, true)).toBe(true);
  expect(isInsideFrame({ left: 98, top: 110, width: 50, height: 50 }, fr, true)).toBe(false);
  expect(isInsideFrame({ left: 120, top: 110, width: 200, height: 50 }, fr, true)).toBe(false);
  expect(isInsideFrame({ left: 120, top: 110, width: 50, height: 50 }, fr, false)).toBe(false);
});

test('rasterTooBig：要素の合計が 3000 を超えると、画像にしない', () => {
  expect(rasterTooBig(RASTER_MAX_ELEMENTS)).toBe(false);
  expect(rasterTooBig(RASTER_MAX_ELEMENTS + 1)).toBe(true);
});

test('dragRect：枠の中の座標・枠からは、はみ出さない・向きによらず同じ矩形', () => {
  const frame = box(100, 50, 300, 200);
  const from = { x: 100, y: 100 };
  expect(dragRect(frame, from, 250, 200)).toEqual({ x: 100, y: 100, w: 50, h: 50 });
  expect(dragRect(frame, from, 150, 80)).toEqual({ x: 50, y: 30, w: 50, h: 70 });
  expect(dragRect(frame, from, 9999, 9999)).toEqual({ x: 100, y: 100, w: 200, h: 100 });
  expect(dragRect(frame, from, -50, -50)).toEqual({ x: 0, y: 0, w: 100, h: 100 });
});

test('dragTooSmall：8px 未満の幅・高さは断る。toViewport：枠の位置を足す', () => {
  expect(dragTooSmall({ x: 0, y: 0, w: 7.9, h: 50 })).toBe(true);
  expect(dragTooSmall({ x: 0, y: 0, w: 50, h: 7.9 })).toBe(true);
  expect(dragTooSmall({ x: 0, y: 0, w: 8, h: 8 })).toBe(false);
  expect(toViewport(box(100, 50, 300, 200), { x: 10, y: 20, w: 30, h: 40 })).toEqual({
    left: 110,
    top: 70,
    width: 30,
    height: 40,
  });
});

test('barPosition：右端をそろえ、窓の中（8px の余白）に収める', () => {
  expect(barPosition(300, 100, 80, 1000)).toEqual({ left: 220, top: 100 });
  expect(barPosition(10, 2, 80, 1000)).toEqual({ left: 8, top: 8 });
  expect(barPosition(2000, 100, 80, 1000)).toEqual({ left: 912, top: 100 });
});

test('inBand：ブロックの上下 4px・左 8px・本文の箱の右端 + 8px までの帯と、バーの上（まわり 6px）', () => {
  const blk = box(100, 200, 500, 60);
  const art = box(100, 0, 600, 2000);
  expect(inBand(blk, art, null, 300, 196)).toBe(true);
  expect(inBand(blk, art, null, 300, 195)).toBe(false);
  expect(inBand(blk, art, null, 300, 264)).toBe(true);
  expect(inBand(blk, art, null, 300, 265)).toBe(false);
  expect(inBand(blk, art, null, 92, 230)).toBe(true);
  expect(inBand(blk, art, null, 91, 230)).toBe(false);
  expect(inBand(blk, art, null, 708, 230)).toBe(true); // 本文の箱の右端（700）+ 8
  expect(inBand(blk, art, null, 709, 230)).toBe(false);
  // バー（ブロックの上に出ている）の上は、帯の外でも、同じブロック。バーがなければ、外
  const bar = box(600, 170, 80, 24);
  expect(inBand(blk, art, bar, 640, 166)).toBe(true);
  expect(inBand(blk, art, bar, 640, 163)).toBe(false);
  expect(inBand(blk, art, null, 640, 166)).toBe(false);
});

test('probeX：本文の箱の端から 48px 以内に収める（右の余白では、箱の右端のブロックを探す）', () => {
  const art = box(100, 0, 600, 100);
  expect(probeX(900, art)).toBe(652);
  expect(probeX(300, art)).toBe(300);
  expect(probeX(0, art)).toBe(148);
  expect(probeX(50, box(0, 0, 40, 10))).toBe(20); // 狭い箱は、中央
});

test('blockBarSpot：ブロックの上端の 30px 上・本文の箱の右端 −8px。本文の領域の上端には重ねない', () => {
  const art = box(100, 0, 600, 2000);
  expect(blockBarSpot(box(100, 300, 600, 40), art, 50)).toEqual({ right: 692, top: 270 });
  expect(blockBarSpot(box(100, 60, 600, 40), art, 50)).toEqual({ right: 692, top: 54 });
});
