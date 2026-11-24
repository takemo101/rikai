// 拡大表示の計算（F37）：全体に合わせるの大きさ・ズームの範囲・カーソルを中心にしたズーム・移動の範囲・ダブルクリックの切り替え・ホイール・押す／ドラッグの区別
import { expect, test } from 'vitest';
import {
  CLICK_SLOP,
  clampPan,
  clampScale,
  fitPose,
  fitScale,
  isClickGesture,
  RASTER_FIT_CAP,
  toggleScale,
  wheelFactor,
  ZOOM_MAX,
  zoomAt,
} from '../../../src/web/lib/zoom';

const view = { w: 1000, h: 800 }; // 全体に合わせるの枠：920 × 720

test('全体に合わせる：窓の 92%・90% に収まる最大。大きい画像は縮める・小さいラスタ画像は 2 倍まで・SVG は、窓いっぱいまで', () => {
  expect(fitScale({ w: 2000, h: 1000 }, view, 'img')).toBeCloseTo(0.46); // 920 / 2000
  expect(fitScale({ w: 1000, h: 2000 }, view, 'img')).toBeCloseTo(0.36); // 720 / 2000
  expect(fitScale({ w: 100, h: 50 }, view, 'img')).toBe(RASTER_FIT_CAP); // 9.2 倍まで入るが、2 倍まで
  expect(fitScale({ w: 100, h: 50 }, view, 'svg')).toBeCloseTo(9.2); // SVG は、窓いっぱい
  expect(fitScale({ w: 0, h: 50 }, view, 'svg')).toBe(1); // 大きさが分からないときは、1
});

test('ズームの範囲：全体に合わせる〜800%。全体に合わせるが 800% を超える（小さい SVG）ときは、全体に合わせるが上限', () => {
  expect(clampScale(0.1, 0.5)).toBe(0.5);
  expect(clampScale(3, 0.5)).toBe(3);
  expect(clampScale(99, 0.5)).toBe(ZOOM_MAX);
  expect(clampScale(99, 9.2)).toBe(9.2);
  expect(clampScale(1, 9.2)).toBe(9.2);
});

test('移動の範囲：中身が窓より大きい方向だけ動かせる。縁が、窓の縁を越えない。収まる方向は、中央', () => {
  const nat = { w: 1000, h: 400 };
  // 2 倍：幅 2000（窓 1000 → 左右に 500 まで）・高さ 800（窓 800 → 動かない）
  expect(clampPan({ scale: 2, x: 900, y: 50 }, nat, view)).toEqual({ scale: 2, x: 500, y: 0 });
  expect(clampPan({ scale: 2, x: -900, y: -50 }, nat, view)).toEqual({ scale: 2, x: -500, y: 0 });
  expect(clampPan({ scale: 2, x: 100, y: 0 }, nat, view).x).toBe(100);
  expect(clampPan({ scale: 0.5, x: 100, y: 100 }, nat, view)).toEqual({ scale: 0.5, x: 0, y: 0 });
});

test('カーソルを中心にしたズーム：カーソルの下の点が、動かない（中身の座標 (p − t) / s が、同じ）', () => {
  const nat = { w: 2000, h: 1600 };
  const fit = 0.4;
  const p = { x: 200, y: -100 }; // 窓の中心から、右へ 200・上へ 100
  const before = { scale: 1, x: 120, y: 40 };
  const after = zoomAt(before, nat, view, fit, 2, p);
  expect(after.scale).toBe(2);
  expect((p.x - after.x) / after.scale).toBeCloseTo((p.x - before.x) / before.scale);
  expect((p.y - after.y) / after.scale).toBeCloseTo((p.y - before.y) / before.scale);
  // 窓の中心を指す（既定）：中心の点が、中心に残る
  const c = zoomAt(fitPose(1), { w: 600, h: 400 }, view, 1, 2, { x: 0, y: 0 });
  expect(c).toEqual({ scale: 2, x: 0, y: 0 });
});

test('ズームの範囲外：上限（800%）・下限（全体に合わせる）で止まる。下限では、全体に合わせるの姿勢（中央）に戻る', () => {
  const nat = { w: 2000, h: 1600 };
  const up = zoomAt({ scale: 4, x: 0, y: 0 }, nat, view, 0.4, 100, { x: 50, y: 50 });
  expect(up.scale).toBe(ZOOM_MAX);
  const down = zoomAt({ scale: 1, x: 300, y: 200 }, nat, view, 0.4, 0.01, { x: 50, y: 50 });
  expect(down).toEqual({ scale: 0.4, x: 0, y: 0 });
});

test('ダブルクリック：全体に合わせる → 等倍（全体に合わせるが 1 未満のとき）→ 全体に合わせる。全体に合わせるが 1 以上なら、2 倍 ↔ 全体に合わせる', () => {
  expect(toggleScale(0.4, 0.4)).toBe(1);
  expect(toggleScale(1, 0.4)).toBe(0.4);
  expect(toggleScale(2.5, 0.4)).toBe(0.4); // 途中の倍率からも、全体に合わせるへ
  expect(toggleScale(2, 2)).toBe(4);
  expect(toggleScale(4, 2)).toBe(2);
});

test('ホイール：上へ回す（deltaY < 0）で拡大・下へで縮小。1 回の変化は、制限する。行・ページの単位も、px に直す', () => {
  expect(wheelFactor(-100)).toBeGreaterThan(1);
  expect(wheelFactor(100)).toBeLessThan(1);
  expect(wheelFactor(-100) * wheelFactor(100)).toBeCloseTo(1);
  expect(wheelFactor(-100000)).toBe(wheelFactor(-300)); // 大きな 1 回でも、飛ばない
  expect(wheelFactor(-3, 1)).toBeCloseTo(wheelFactor(-48, 0)); // 行
  expect(wheelFactor(-1, 2)).toBeCloseTo(wheelFactor(-300, 0)); // ページ（上限で頭打ち）
});

test('押す／ドラッグの区別：押した位置から、4px 以内なら「押す」。それより動いたら、ドラッグ。押した位置が分からなければ、押す', () => {
  expect(CLICK_SLOP).toBe(4);
  expect(isClickGesture({ x: 10, y: 10 }, { x: 10, y: 10 })).toBe(true);
  expect(isClickGesture({ x: 10, y: 10 }, { x: 12, y: 12 })).toBe(true); // 距離 2.8
  expect(isClickGesture({ x: 10, y: 10 }, { x: 14, y: 10 })).toBe(true); // 距離 4（境）
  expect(isClickGesture({ x: 10, y: 10 }, { x: 15, y: 10 })).toBe(false); // 距離 5
  expect(isClickGesture({ x: 0, y: 0 }, { x: 40, y: 0 })).toBe(false);
  expect(isClickGesture(null, { x: 40, y: 0 })).toBe(true);
});
