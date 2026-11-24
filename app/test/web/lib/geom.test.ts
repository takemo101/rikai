// 幾何の共通部品：箱の導出（右端・下端）・clamp・比率 ↔ 箱の変換・有限でない数・大きさのない箱。
import { expect, test } from 'vitest';
import {
  type Box,
  bottom,
  boxAt,
  clamp,
  clampToBox,
  finite,
  fromEdges,
  fromRatio,
  r4,
  ratioOf,
  right,
  roundRect,
} from '../../../src/web/lib/geom';

const NAN = Number.NaN;
const INF = Number.POSITIVE_INFINITY;

test('r4：4 桁に丸める', () => {
  expect(r4(0.123456)).toBe(0.1235);
  expect(r4(-1.00004)).toBe(-1);
  expect(r4(NAN)).toBeNaN();
});

test('箱：右端・下端は、左上と大きさから導く。辺からも作れる（幅・高さは差）', () => {
  const b = boxAt(10, 20, 30, 40);
  expect([right(b), bottom(b)]).toEqual([40, 60]);
  expect(fromEdges({ left: 10, top: 20, right: 40, bottom: 60 })).toEqual(b);
  // `getBoundingClientRect` のような、余分な項目を持つ値も、そのまま箱として読める
  const rectLike = { left: 1, top: 2, width: 3, height: 4, x: 1, y: 2 };
  const asBox: Box = rectLike;
  expect(right(asBox)).toBe(4);
  // 大きさ 0 の箱は、左上の点
  expect([right(boxAt(5, 6, 0, 0)), bottom(boxAt(5, 6, 0, 0))]).toEqual([5, 6]);
});

test('clamp：範囲の中はそのまま・外は縁・境界は含む。NaN は、そのまま通る（収めない）', () => {
  expect([clamp(5, 0, 10), clamp(-1, 0, 10), clamp(11, 0, 10), clamp(0, 0, 10), clamp(10, 0, 10)]).toEqual([
    5, 0, 10, 0, 10,
  ]);
  expect(clamp(NAN, 0, 10)).toBeNaN();
  // 下限が上限を超えるときは、上限が勝つ（`min(max(v, lo), hi)`）
  expect(clamp(5, 10, 0)).toBe(0);
});

test('finite：すべて有限なら true。NaN・無限大が 1 つでもあれば false', () => {
  expect(finite(0, -1, 1e9)).toBe(true);
  expect(finite()).toBe(true);
  expect(finite(1, NAN)).toBe(false);
  expect(finite(INF, 1)).toBe(false);
  expect(finite(1, -INF)).toBe(false);
});

test('clampToBox：箱の中はそのまま・外は縁・縁は含む。大きさ 0 の箱は、その点。負の幅は、左上の縁', () => {
  const box = boxAt(100, 100, 400, 200);
  expect(clampToBox({ x: 300, y: 150 }, box)).toEqual({ x: 300, y: 150 });
  expect(clampToBox({ x: 0, y: 1000 }, box)).toEqual({ x: 100, y: 300 });
  expect(clampToBox({ x: 500, y: 100 }, box)).toEqual({ x: 500, y: 100 });
  expect(clampToBox({ x: 7, y: 9 }, boxAt(10, 20, 0, 0))).toEqual({ x: 10, y: 20 });
  expect(clampToBox({ x: 50, y: 50 }, boxAt(10, 20, -5, -5))).toEqual({ x: 10, y: 20 });
  // NaN の点は、NaN のまま（呼ぶ側が、`finite` で先に弾く）
  expect(clampToBox({ x: NAN, y: 150 }, box).x).toBeNaN();
});

test('ratioOf：基準に対する比率（丸めない）。基準が不正（0 幅・0 高さ・負・NaN・無限大）なら null。内側が不正でも null', () => {
  const base = boxAt(100, 200, 400, 100);
  expect(ratioOf(boxAt(200, 225, 40, 10), base)).toEqual({ x: 0.25, y: 0.25, w: 0.1, h: 0.1 });
  expect(ratioOf(boxAt(100, 200, 1, 1), base)).toEqual({ x: 0, y: 0, w: 1 / 400, h: 0.01 }); // 丸めない
  expect(ratioOf(base, base)).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  expect(ratioOf(base, boxAt(0, 0, 0, 100))).toBeNull();
  expect(ratioOf(base, boxAt(0, 0, 100, 0))).toBeNull();
  expect(ratioOf(base, boxAt(0, 0, -10, 100))).toBeNull();
  expect(ratioOf(base, boxAt(NAN, 0, 100, 100))).toBeNull();
  expect(ratioOf(base, boxAt(0, 0, INF, 100))).toBeNull();
  expect(ratioOf(boxAt(NAN, 0, 1, 1), base)).toBeNull();
  expect(ratioOf(boxAt(0, 0, 1, INF), base)).toBeNull();
  // 内側が大きさ 0 でも、基準が正常なら、比率は出る（0 幅の範囲は、呼ぶ側が、小さすぎるとして断る）
  expect(ratioOf(boxAt(100, 200, 0, 0), base)).toEqual({ x: 0, y: 0, w: 0, h: 0 });
});

test('fromRatio：比率 → 基準の座標の箱（ratioOf の逆）。基準・比率が不正なら null', () => {
  const base = boxAt(100, 200, 400, 100);
  expect(fromRatio({ x: 0.25, y: 0.25, w: 0.1, h: 0.1 }, base)).toEqual(boxAt(200, 225, 40, 10));
  const rect = { x: 0.4, y: 0.1, w: 0.2, h: 0.5 };
  const b = fromRatio(rect, base);
  expect(b && ratioOf(b, base)).toEqual({ x: 0.4, y: 0.1, w: 0.2, h: 0.5 });
  expect(fromRatio(rect, boxAt(0, 0, 0, 100))).toBeNull();
  expect(fromRatio(rect, boxAt(0, 0, 100, -1))).toBeNull();
  expect(fromRatio({ x: NAN, y: 0, w: 1, h: 1 }, base)).toBeNull();
  expect(fromRatio({ x: 0, y: 0, w: INF, h: 1 }, base)).toBeNull();
  expect(fromRatio(rect, boxAt(0, NAN, 10, 10))).toBeNull();
});

test('roundRect：4 つの値を、4 桁に丸める', () => {
  expect(roundRect({ x: 1 / 3, y: 2 / 3, w: 0.00004, h: 0.12345 })).toEqual({ x: 0.3333, y: 0.6667, w: 0, h: 0.1235 });
});
