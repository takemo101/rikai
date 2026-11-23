// 番号の層の位置の計算（純粋な関数）：番号の順・同じ高さの組・上の組に重ならない・範囲の枠・枠のドラッグ。
import { expect, test } from 'vitest';
import {
  BADGE_MAX,
  type BadgeGroup,
  type BadgeItem,
  badgeLeft,
  badgeTopIn,
  badgeWidth,
  clampRegionRect,
  foldBadges,
  groupBadges,
  regionBox,
  regionTopOf,
  stackGroups,
  stackWidth,
} from '../../../src/web/overlay/layout';
import {
  adjustEdges,
  type Edges,
  HANDLES,
  MIN_REGION,
  parseHandle,
  toViewportRect,
} from '../../../src/web/overlay/regionAdjust';

const item = (tid: string, top: number, n: number | '新' = 1, over: Partial<BadgeItem> = {}): BadgeItem => ({
  top,
  tid,
  n,
  ...over,
});

test('番号の順：上端の順。同じ高さは、番号の順。「新」は、同じ高さの、最後', () => {
  const g = groupBadges([item('c', 50, 3), item('new', 10, '新'), item('a', 10, 1), item('b', 10, 2)]);
  expect(g.map((x) => x.items.map((i) => i.tid))).toEqual([['a', 'b', 'new'], ['c']]);
});

test('同じ行（4px 未満の差）は、1 つの組。4px 以上は、別の組。組の基準は、組の先頭の印（つなげて、広がらない）', () => {
  const g = groupBadges([item('a', 100), item('b', 103.9, 2), item('c', 107, 3), item('d', 111, 4)]);
  expect(g.map((x) => [x.top, x.items.map((i) => i.tid)])).toEqual([
    [100, ['a', 'b']],
    [107, ['c']],
    [111, ['d']],
  ]);
  expect(groupBadges([])).toEqual([]);
});

test('丸の幅は、文字数で決まる（1 文字 18・2 文字 24・3 文字 31・4 文字 38）。重ねた幅は、重なり 2px を引く', () => {
  expect([1, 9, '新', 10, 99, 100, 999, 1000].map(badgeWidth)).toEqual([18, 18, 18, 24, 24, 31, 31, 38]);
  expect(stackWidth([18])).toBe(18);
  expect(stackWidth([18, 18, 18])).toBe(50);
  expect(stackWidth([24, 24, 31])).toBe(75);
  expect(stackWidth([])).toBe(0);
});

test('同じ行の丸：5 つまで・収まるなら、すべて並べる（5 件ちょうども、5 つ）。6 つ以上は、先頭から 4 つと、残りを「+N」に。収まらなければ、並べる数を減らす（桁数で、幅が違う）', () => {
  const nums = (from: number, n: number) => Array.from({ length: n }, (_, i) => from + i);
  const f = (items: number[], room = 200) => {
    const r = foldBadges(items, room, (n) => n);
    return [r.shown, r.folded];
  };
  expect(BADGE_MAX).toBe(5);
  expect(f(nums(1, 1))).toEqual([[1], []]);
  expect(f(nums(1, 5))).toEqual([nums(1, 5), []]); // 5 件ちょうどは、そのまま（「+1」にしない）
  expect(f(nums(1, 6))).toEqual([nums(1, 4), [5, 6]]);
  expect(f(nums(1, 9))).toEqual([nums(1, 4), nums(5, 5)]);
  // 幅：1 桁 5 つ = 82・2 桁 5 つ = 112（収まらなければ、「+N」の分も入れて、減らす）
  expect(f(nums(1, 5), 82)).toEqual([nums(1, 5), []]);
  expect(f(nums(1, 5), 81)).toEqual([nums(1, 3), [4, 5]]); // 3 つ（50）＋「+2」（24 − 2）= 72
  expect(f(nums(10, 5), 112)).toEqual([nums(10, 5), []]);
  expect(f(nums(10, 5), 102)).toEqual([nums(10, 3), [13, 14]]);
  expect(f(nums(10, 5), 90)).toEqual([nums(10, 3), [13, 14]]); // 24×3 − 4 + 22 = 90
  expect(f(nums(100, 3), 70)).toEqual([[100], [101, 102]]); // 3 桁：91（3 つ）・82（2 つ + 「+1」）は、収まらない → 1 つ（31 + 22 = 53）
  // 狭い：1 つも収まらなければ、「+N」だけ
  expect(f(nums(1, 3), 10)).toEqual([[], [1, 2, 3]]);
  expect(f(nums(1, 3), 40)).toEqual([[1], [2, 3]]); // 2 つ + 「+1」= 34 + 22 = 56 > 40 → 1 つ（18 + 24 − 2 = 40）

  expect(f(nums(1, 3), 60)).toEqual([nums(1, 3), []]);
});

test('上の組に重ならない：前の組の下端（実測）の 2px 下より上には、出さない。折り返して背が高くなった組の下に、次の組が来る', () => {
  const groups: BadgeGroup[] = [
    { top: 100, items: [] },
    { top: 110, items: [] },
    { top: 400, items: [] },
  ];
  const heights = [60, 20, 20];
  const placed: number[] = [];
  stackGroups(groups, (_g, top) => {
    placed.push(top);
    return heights[placed.length - 1] as number;
  });
  // 1 つ目：100。2 つ目：100+60+2=162（110 より下）。3 つ目：162+20+2=184 < 400 なので、400
  expect(placed).toEqual([100, 162, 400]);
});

test('層での位置：記事の左端から 12px 左・対象の上端から 2px 下。スクロールの分を足す', () => {
  expect(badgeLeft({ left: 300.4, top: 0 }, { left: 100, top: 0 }, 5)).toBe(205 - 12);
  expect(badgeTopIn(250.6, { left: 0, top: 50 }, 30)).toBe(Math.round(250.6 - 50 + 30) + 2);
});

test('範囲の枠：基準の要素に対する比率から、層での位置。上端も、同じ比率', () => {
  const m = { left: 200, top: 400, width: 300, height: 200 };
  expect(regionTopOf(m, { x: 0.1, y: 0.25, w: 0.5, h: 0.5 })).toBe(450);
  expect(regionBox(m, { left: 100, top: 50 }, { left: 0, top: 10 }, 1000, { x: 0.1, y: 0.25, w: 0.5, h: 0.5 })).toEqual(
    {
      left: 130,
      top: 410,
      width: 150,
      height: 100,
    },
  );
});

test('範囲の枠：領域の外（左右）へ出ても、領域の中に収める。収まる幅がなければ、出さない', () => {
  const m = { left: 100, top: 0, width: 200, height: 100 };
  const sc = { left: 100, top: 0 };
  const zero = { left: 0, top: 0 };
  // 左へはみ出す：x0 = -50
  expect(regionBox(m, sc, zero, 1000, { x: -0.25, y: 0, w: 0.75, h: 1 })).toEqual({
    left: 0,
    top: 0,
    width: 100,
    height: 100,
  });
  // 右へはみ出す（領域の幅 150）
  expect(regionBox(m, sc, zero, 150, { x: 0.5, y: 0, w: 1, h: 1 })).toEqual({
    left: 100,
    top: 0,
    width: 50,
    height: 100,
  });
  // 全部が、外
  expect(regionBox(m, sc, zero, 150, { x: 2, y: 0, w: 1, h: 1 })).toBeNull();
});

const r0: Edges = { left: 100, top: 100, right: 200, bottom: 160 };
const bounds: Edges = { left: 0, top: 0, right: 400, bottom: 300 };

test('枠のドラッグ：本体は、大きさを変えずに動く。本文の外へは、出ない', () => {
  expect(adjustEdges('move', r0, 30, 20, bounds)).toEqual({ left: 130, top: 120, right: 230, bottom: 180 });
  expect(adjustEdges('move', r0, 999, 999, bounds)).toEqual({ left: 300, top: 240, right: 400, bottom: 300 });
  expect(adjustEdges('move', r0, -999, -999, bounds)).toEqual({ left: 0, top: 0, right: 100, bottom: 60 });
});

test('枠のドラッグ：8 つのハンドルは、動かした辺だけが動く。最小の大きさ（12px）を下回らない。本文の外へは、出ない', () => {
  expect(adjustEdges('se', r0, 10, 20, bounds)).toEqual({ left: 100, top: 100, right: 210, bottom: 180 });
  expect(adjustEdges('nw', r0, -10, -20, bounds)).toEqual({ left: 90, top: 80, right: 200, bottom: 160 });
  expect(adjustEdges('n', r0, 999, -10, bounds)).toEqual({ left: 100, top: 90, right: 200, bottom: 160 });
  expect(adjustEdges('e', r0, 10, 999, bounds)).toEqual({ left: 100, top: 100, right: 210, bottom: 160 });
  expect(adjustEdges('s', r0, 999, 10, bounds)).toEqual({ left: 100, top: 100, right: 200, bottom: 170 });
  expect(adjustEdges('w', r0, -10, 999, bounds)).toEqual({ left: 90, top: 100, right: 200, bottom: 160 });
  expect(adjustEdges('ne', r0, 10, -10, bounds)).toEqual({ left: 100, top: 90, right: 210, bottom: 160 });
  expect(adjustEdges('sw', r0, -10, 10, bounds)).toEqual({ left: 90, top: 100, right: 200, bottom: 170 });
  // 最小
  expect(adjustEdges('e', r0, -500, 0, bounds)).toEqual({ left: 100, top: 100, right: 100 + MIN_REGION, bottom: 160 });
  expect(adjustEdges('w', r0, 500, 0, bounds)).toEqual({ left: 200 - MIN_REGION, top: 100, right: 200, bottom: 160 });
  expect(adjustEdges('s', r0, 0, -500, bounds)).toEqual({ left: 100, top: 100, right: 200, bottom: 100 + MIN_REGION });
  expect(adjustEdges('n', r0, 0, 500, bounds)).toEqual({ left: 100, top: 160 - MIN_REGION, right: 200, bottom: 160 });
  // 本文の外
  expect(adjustEdges('se', r0, 999, 999, bounds)).toEqual({ left: 100, top: 100, right: 400, bottom: 300 });
  expect(adjustEdges('nw', r0, -999, -999, bounds)).toEqual({ left: 0, top: 0, right: 200, bottom: 160 });
});

test('ハンドルの名前：8 つ。知らない名前・なしは、本体（move）。ビューポートの矩形に直す', () => {
  expect(HANDLES).toEqual(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']);
  expect(parseHandle('se')).toBe('se');
  for (const v of [undefined, '', 'move', 'x', 'NW']) expect(parseHandle(v)).toBe('move');
  expect(toViewportRect({ left: 10, top: 20, right: 40, bottom: 80 })).toEqual({
    left: 10,
    top: 20,
    width: 30,
    height: 60,
  });
});

test('clampRegionRect：html-app の範囲の枠は、基準の箱の周り（-1〜2 倍）に収める。古い基準の極端な値でも、枠が巨大にならない。収めた結果が空なら描かない', () => {
  // 正当な範囲は、そのまま（基準の外へ出てもよい。限度の中）
  const ok = clampRegionRect({ x: 0.1, y: 0.2, w: 0.5, h: 0.4 });
  expect([ok?.x, ok?.y]).toEqual([0.1, 0.2]);
  expect(ok?.w).toBeCloseTo(0.5);
  expect(ok?.h).toBeCloseTo(0.4);
  expect(clampRegionRect({ x: -0.5, y: 0, w: 2, h: 1.5 })).toEqual({ x: -0.5, y: 0, w: 2, h: 1.5 });
  // 古い基準（15px のアイコン）の値：幅 40・高さ 8 → 限度で、切る
  expect(clampRegionRect({ x: 0.5, y: 0.5, w: 40, h: 8 })).toEqual({ x: 0.5, y: 0.5, w: 1.5, h: 1.5 });
  expect(clampRegionRect({ x: -60, y: -3, w: 100, h: 100 })).toEqual({ x: -1, y: -1, w: 3, h: 3 });
  // 外へ出きっている：描かない
  expect(clampRegionRect({ x: 2.5, y: 0, w: 1, h: 1 })).toBeNull();
  expect(clampRegionRect({ x: 0, y: 26, w: 13, h: 7 })).toBeNull();
  expect(clampRegionRect({ x: 0, y: 0, w: 0, h: 1 })).toBeNull();
  expect(clampRegionRect({ x: Number.NaN, y: 0, w: 1, h: 1 })).toBeNull();
});
