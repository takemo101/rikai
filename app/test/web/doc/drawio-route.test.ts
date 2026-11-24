// draw.io の線の経路（純粋な幾何）：接続点・直交（曲がり 0〜3 回。経由点は通る）・ラベルの位置・矢印
import { expect, test } from 'vitest';
import {
  arrowKind,
  arrowShape,
  autoDir,
  explicitPort,
  labelPoint,
  pathData,
  pathLength,
  perimeterPoint,
  routeOrthogonal,
  sidePort,
} from '../../../src/web/doc/render/drawioRoute';

const R = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });
const axisAligned = (pts: { x: number; y: number }[]) =>
  pts.slice(1).every((p, i) => p.x === pts[i]?.x || p.y === pts[i]?.y);

test('接続点：exitX/exitY で辺の位置と向き・未指定は自動（向かう方の辺の中点）', () => {
  const r = R(100, 100, 100, 50);
  expect(explicitPort(r, 1, 0.5, 0, 0)).toEqual({ p: { x: 200, y: 125 }, dir: 'E' });
  expect(explicitPort(r, 0.5, 0, 0, 0)).toEqual({ p: { x: 150, y: 100 }, dir: 'N' });
  expect(explicitPort(r, null, null, 0, 0)).toBeNull();
  expect(autoDir(r, { x: 400, y: 120 })).toBe('E');
  expect(autoDir(r, { x: 140, y: 10 })).toBe('N');
  expect(sidePort(r, 'S')).toEqual({ p: { x: 150, y: 150 }, dir: 'S' });
});

test('直交：直角（1 回）・向かい合い（Z 字・並んでいれば直線）・同じ向き（コの字）・後ろ（回り込み）。すべて、軸に平行', () => {
  const a = sidePort(R(0, 0, 100, 50), 'E'); // (100,25) 右へ
  // 直角：相手の上に入る
  const l = routeOrthogonal(a, { p: { x: 300, y: 200 }, dir: 'N' }, []);
  expect(l).toEqual([
    { x: 100, y: 25 },
    { x: 300, y: 25 },
    { x: 300, y: 200 },
  ]);
  // 向かい合い：Z 字
  const z = routeOrthogonal(a, { p: { x: 300, y: 125 }, dir: 'W' }, []);
  expect(z).toEqual([
    { x: 100, y: 25 },
    { x: 200, y: 25 },
    { x: 200, y: 125 },
    { x: 300, y: 125 },
  ]);
  // 同じ高さなら、直線
  expect(routeOrthogonal(a, { p: { x: 300, y: 25 }, dir: 'W' }, [])).toEqual([
    { x: 100, y: 25 },
    { x: 300, y: 25 },
  ]);
  // 同じ向き（どちらも右）：外側を回る
  const u = routeOrthogonal(a, { p: { x: 300, y: 125 }, dir: 'E' }, []);
  expect(u).toEqual([
    { x: 100, y: 25 },
    { x: 320, y: 25 },
    { x: 320, y: 125 },
    { x: 300, y: 125 },
  ]);
  // 相手が後ろ：足を出して回り込む（曲がり 4 回まで）
  const back = routeOrthogonal(a, { p: { x: -100, y: 125 }, dir: 'E' }, []);
  expect(axisAligned(back)).toBe(true);
  // 直角で、角が相手の内側になるとき：遠回り（曲がり 3 回）
  const far = routeOrthogonal(sidePort(R(0, 0, 100, 50), 'E'), { p: { x: 50, y: 200 }, dir: 'S' }, []);
  expect(axisAligned(far)).toBe(true);
  expect(far.length).toBeLessThanOrEqual(5);
  expect(far[0]).toEqual({ x: 100, y: 25 });
  expect(far.at(-1)).toEqual({ x: 50, y: 200 });
});

test('直交：経由点があれば、そこを通る（見本の「ない」の線：左へ出て、縦に下り、右から入る）', () => {
  const a = { p: { x: 202, y: 527.5 }, dir: 'W' as const };
  const b = { p: { x: 211, y: 758 }, dir: 'W' as const };
  const pts = routeOrthogonal(a, b, [{ x: 175, y: 527.5 }]);
  expect(pts).toEqual([a.p, { x: 175, y: 527.5 }, { x: 175, y: 758 }, b.p]);
  // 経由点が、折れ目の外にあっても、軸に平行
  const off = routeOrthogonal(a, b, [{ x: 150, y: 600 }]);
  expect(axisAligned(off)).toBe(true);
  expect(off[0]).toEqual(a.p);
  expect(off.at(-1)).toEqual(b.p);
  expect(off).toEqual([a.p, { x: 150, y: 527.5 }, { x: 150, y: 758 }, b.p]); // 経由点（150,600）は、縦の脚の上：一直線なので、折れ点には残らない
});

test('外周の点：楕円・菱形・矩形（中心から、相手の向き）', () => {
  const r = R(0, 0, 100, 100);
  expect(perimeterPoint(r, 'rect', { x: 500, y: 50 })).toEqual({ x: 100, y: 50 });
  const e = perimeterPoint(r, 'ellipse', { x: 500, y: 500 });
  expect(Math.hypot(e.x - 50, e.y - 50)).toBeCloseTo(50, 5);
  const d = perimeterPoint(r, 'rhombus', { x: 500, y: 500 });
  expect(d.x).toBeCloseTo(75, 5);
  expect(d.y).toBeCloseTo(75, 5);
});

test('線の上のラベル：x（-1〜1）で位置・y で直交方向・offset を足す', () => {
  const pts = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
  ];
  expect(pathLength(pts)).toBe(200);
  expect(labelPoint(pts, 0, 0, { x: 0, y: 0 })).toEqual({ x: 100, y: 0 });
  expect(labelPoint(pts, -1, 0, { x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
  expect(labelPoint(pts, 1, 0, { x: 5, y: -5 })).toEqual({ x: 105, y: 95 });
  expect(labelPoint(pts, -0.5, 10, { x: 0, y: 0 })).toEqual({ x: 50, y: 10 });
});

test('矢印：名前 → 形（未知は classic）・none は描かない・線は矢印の分だけ縮める', () => {
  expect(arrowKind(undefined, 'classic')).toBe('classic');
  expect(arrowKind('block', 'none')).toBe('block');
  expect(arrowKind('weirdThing', 'none')).toBe('classic');
  expect(arrowShape('none', { x: 0, y: 0 }, { x: 1, y: 0 }, 6, 1)).toBeNull();
  const a = arrowShape('classic', { x: 100, y: 0 }, { x: 1, y: 0 }, 6, 1);
  expect(a?.points[0]).toEqual({ x: 100, y: 0 }); // 先端
  expect(a?.shorten).toBeGreaterThan(0);
  expect(arrowShape('open', { x: 0, y: 0 }, { x: 1, y: 0 }, 6, 1)?.filled).toBe(false);
});

test('パス：角を丸める（半径は、辺の半分まで）', () => {
  expect(
    pathData([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ]),
  ).toBe('M0 0L10 0');
  const d = pathData(
    [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ],
    10,
  );
  expect(d).toContain('Q100 0 100 10');
});
