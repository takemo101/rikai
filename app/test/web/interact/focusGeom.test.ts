// 拡大表示（F43）の座標の計算：ステージの座標 ↔ 元の画像の座標（ズーム・移動・フィット・窓の大きさ）。画面で選んだ範囲が、画像・図の同じ場所に、なること。
import { expect, test } from 'vitest';
import { dragSelection, stageBox } from '../../../src/web/interact/focusGeom';
import { boxAt, fromRatio, ratioOf } from '../../../src/web/lib/geom';
import { clampPan, fitPose, fitScale, zoomAt } from '../../../src/web/lib/zoom';

const NAT = { w: 1600, h: 600 }; // 元の画像の大きさ（画素）
const VIEW = { w: 1020, h: 800 }; // ステージの領域

test('全体に合わせる：中身は、窓の中心に、フィットの倍率で置かれる', () => {
  const fit = fitScale(NAT, VIEW, 'img');
  const b = stageBox(fitPose(fit), NAT, VIEW);
  expect(b).not.toBeNull();
  expect(b?.width).toBeCloseTo(NAT.w * fit);
  expect((b?.left ?? 0) + (b?.width ?? 0) / 2).toBeCloseTo(VIEW.w / 2); // 中心が、窓の中心
  expect((b?.top ?? 0) + (b?.height ?? 0) / 2).toBeCloseTo(VIEW.h / 2);
});

test('400% で選んだ小さな範囲が、元の画像の、正しい位置・大きさになる（移動した状態でも）', () => {
  // 400%・左へ 2000px 動かした状態。中身の箱は、左端が -4690px（窓の座標）
  const pose = { scale: 4, x: -2000, y: 0 };
  const box = stageBox(pose, NAT, VIEW);
  expect(box?.left).toBeCloseTo(510 - 2000 - 3200);
  expect(box?.top).toBeCloseTo(400 - 1200);
  if (!box) throw new Error('box');
  // 窓の (600, 300) から (680, 360) をドラッグ
  const sel = dragSelection({ x: 600, y: 300 }, { x: 680, y: 360 }, box);
  expect(sel).not.toBeNull();
  // 元の画像の画素：x = (600 + 4690) / 4 = 1322.5・幅 80 / 4 = 20・高さ 60 / 4 = 15
  expect((sel?.rect.x ?? 0) * NAT.w).toBeCloseTo(1322.5, 0);
  expect((sel?.rect.y ?? 0) * NAT.h).toBeCloseTo(275, 0);
  expect((sel?.rect.w ?? 0) * NAT.w).toBeCloseTo(20, 0);
  expect((sel?.rect.h ?? 0) * NAT.h).toBeCloseTo(15, 0);
});

test('同じ画像の同じ場所は、ズーム・移動・窓の大きさが変わっても、同じ比率になる', () => {
  const target = { x: 0.31, y: 0.62 }; // 画像の、左から 31%・上から 62% の点
  const sizes = [
    { pose: fitPose(fitScale(NAT, VIEW, 'img')), view: VIEW },
    { pose: { scale: 2, x: 150, y: -90 }, view: VIEW },
    { pose: { scale: 8, x: -1000, y: 300 }, view: VIEW },
    { pose: fitPose(fitScale(NAT, { w: 420, h: 300 }, 'img')), view: { w: 420, h: 300 } }, // 狭い窓（下のシート）
  ];
  for (const { pose, view } of sizes) {
    const box = stageBox(pose, NAT, view);
    if (!box) throw new Error('box');
    // 画像の点が、窓のどこにあるか → そこから、小さな範囲（40×40px）をドラッグ → 比率
    const px = box.left + target.x * box.width;
    const py = box.top + target.y * box.height;
    const sel = dragSelection(
      { x: px, y: py },
      { x: px + 40, y: py + 40 },
      boxAt(box.left, box.top, box.width, box.height),
    );
    expect(sel?.rect.x).toBeCloseTo(target.x, 3);
    expect(sel?.rect.y).toBeCloseTo(target.y, 3);
    // 範囲の大きさ（画素）は、画面の 40px を、倍率で割ったもの
    expect((sel?.rect.w ?? 0) * NAT.w).toBeCloseTo(40 / pose.scale, 0);
  }
});

test('ズーム（カーソルの下の点が動かない）の前後で、同じ画面の点は、同じ画像の点を指す', () => {
  const fit = fitScale(NAT, VIEW, 'img');
  const p0 = fitPose(fit);
  const cursor = { x: 120, y: -40 }; // 窓の中心からの位置
  const p1 = zoomAt(p0, NAT, VIEW, fit, 4, cursor);
  const at = (pose: typeof p0) => {
    const b = stageBox(pose, NAT, VIEW);
    if (!b) throw new Error('box');
    const sx = VIEW.w / 2 + cursor.x;
    const sy = VIEW.h / 2 + cursor.y;
    return { u: (sx - b.left) / b.width, v: (sy - b.top) / b.height };
  };
  expect(at(p1).u).toBeCloseTo(at(p0).u, 6);
  expect(at(p1).v).toBeCloseTo(at(p0).v, 6);
  // 移動の範囲（clampPan）に収めた姿勢でも、箱は有限で、比率は 0〜1 の中
  const panned = clampPan({ scale: 4, x: 99999, y: -99999 }, NAT, VIEW);
  const b = stageBox(panned, NAT, VIEW);
  expect(b && Number.isFinite(b.left) && Number.isFinite(b.top)).toBe(true);
});

test('範囲は、画像の外へは出ない（縁に収める）。画面で 8px 未満・比率が小さすぎる・不正な数は、null', () => {
  const box = boxAt(100, 100, 400, 200);
  // 左上の外から、中へ
  const s = dragSelection({ x: 20, y: 30 }, { x: 160, y: 140 }, box);
  expect(s?.rect).toEqual({ x: 0, y: 0, w: 0.15, h: 0.2 });
  // 右下の外まで
  const e = dragSelection({ x: 400, y: 250 }, { x: 9999, y: 9999 }, box);
  expect(e?.rect).toEqual({ x: 0.75, y: 0.75, w: 0.25, h: 0.25 });
  // 逆向きのドラッグも、同じ
  expect(dragSelection({ x: 160, y: 140 }, { x: 20, y: 30 }, box)?.rect).toEqual(s?.rect);
  expect(dragSelection({ x: 150, y: 150 }, { x: 157, y: 190 }, box)).toBeNull(); // 幅 7px
  expect(dragSelection({ x: 150, y: 150 }, { x: 190, y: 157 }, box)).toBeNull(); // 高さ 7px
  // 数として検査する：NaN・無限大・大きさのない箱
  expect(dragSelection({ x: Number.NaN, y: 0 }, { x: 10, y: 10 }, box)).toBeNull();
  expect(dragSelection({ x: 120, y: 120 }, { x: 300, y: Number.POSITIVE_INFINITY }, box)).toBeNull();
  expect(dragSelection({ x: 0, y: 0 }, { x: 99, y: 99 }, boxAt(0, 0, 0, 100))).toBeNull();
  expect(stageBox({ scale: Number.NaN, x: 0, y: 0 }, NAT, VIEW)).toBeNull();
  expect(stageBox({ scale: 1, x: 0, y: 0 }, { w: 0, h: 10 }, VIEW)).toBeNull();
  expect(stageBox({ scale: 1, x: 0, y: 0 }, NAT, { w: Number.POSITIVE_INFINITY, h: 10 })).toBeNull();
  expect(fromRatio({ x: Number.NaN, y: 0, w: 1, h: 1 }, box)).toBeNull();
  expect(ratioOf(box, boxAt(0, 0, 0, 0))).toBeNull();
});

test('枠の重ね：保存した比率 → ステージの箱 → 比率（往復で同じ）。ズーム・移動に追従する', () => {
  const rect = { x: 0.4, y: 0.1, w: 0.2, h: 0.5 };
  for (const pose of [
    { scale: 0.5, x: 0, y: 0 },
    { scale: 3, x: -300, y: 120 },
    { scale: 8, x: 0, y: 0 },
  ]) {
    const base = stageBox(pose, NAT, VIEW);
    if (!base) throw new Error('base');
    const b = fromRatio(rect, base);
    expect(b?.width).toBeCloseTo(rect.w * NAT.w * pose.scale);
    expect(b?.left).toBeCloseTo(base.left + rect.x * base.width);
    const back = ratioOf(b ?? boxAt(0, 0, 0, 0), base);
    expect(back?.x).toBeCloseTo(rect.x);
    expect(back?.h).toBeCloseTo(rect.h);
  }
});

test('html-app：拡大表示の枠の相対位置を、本文の枠の箱へ写し（同じ割合）、本文の基準に対する比率にする。縮小表示（枠の見た目の箱）でも、同じ', () => {
  const focusFrame = boxAt(40, 70, 960, 600); // 拡大表示の枠の見た目（縮小後）
  const sel = boxAt(40 + 480, 70 + 150, 96, 60); // 選んだ範囲：枠の (50%, 25%)・幅 10%・高さ 10%
  const frac = ratioOf(sel, focusFrame);
  expect(frac).toEqual({ x: 0.5, y: 0.25, w: 0.1, h: 0.1 });
  const home = boxAt(300, 500, 600, 300); // 本文の枠の見た目
  const virtual = fromRatio(frac ?? { x: 0, y: 0, w: 0, h: 0 }, home);
  expect(virtual).toMatchObject({ left: 600, top: 575, width: 60, height: 30 });
  // 本文の基準が、本文の枠そのものなら、同じ割合に戻る
  expect(ratioOf(virtual ?? home, home)).toEqual(frac);
});
