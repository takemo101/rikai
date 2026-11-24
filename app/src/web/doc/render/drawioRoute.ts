// draw.io の線の経路（純粋な幾何：DOM に触れない）。接続点（`exitX/exitY/entryX/entryY`・自動）・直交の簡易ルーティング（曲がり 1〜3 回。経由点があれば、通る）・
// 線の長さの上の点（ラベル）・矢印の形。他の図形を避ける経路探索はしない（始点・終点の辺の向きから決めるだけ）。
import type { Pt, Rect, ShapeKind } from './drawioModel';

export type Dir = 'N' | 'E' | 'S' | 'W';
export interface Port {
  p: Pt;
  /** 図形から外へ向かう向き（線は、この向きに出る・この向きの反対に入る） */
  dir: Dir;
}

const VEC: Record<Dir, Pt> = { N: { x: 0, y: -1 }, E: { x: 1, y: 0 }, S: { x: 0, y: 1 }, W: { x: -1, y: 0 } };
const isH = (d: Dir): boolean => d === 'E' || d === 'W';
/** 出入りの、まっすぐな足の長さ（迂回するとき） */
const STUB = 20;

export const centerOf = (r: Rect): Pt => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/** 点が、矩形の、どの辺に近いか */
function nearestSide(r: Rect, p: Pt): Dir {
  const d: [Dir, number][] = [
    ['W', Math.abs(p.x - r.x)],
    ['E', Math.abs(p.x - (r.x + r.w))],
    ['N', Math.abs(p.y - r.y)],
    ['S', Math.abs(p.y - (r.y + r.h))],
  ];
  return d.reduce((a, b) => (b[1] < a[1] ? b : a))[0];
}

/** `exitX/exitY`（0〜1）で指定された接続点。どちらかが未指定なら、null（自動） */
export function explicitPort(r: Rect, x: number | null, y: number | null, dx: number, dy: number): Port | null {
  if (x === null && y === null) return null;
  const fx = x ?? 0.5;
  const fy = y ?? 0.5;
  const p = { x: r.x + r.w * fx + dx, y: r.y + r.h * fy + dy };
  let dir: Dir;
  if (fx <= 0) dir = 'W';
  else if (fx >= 1) dir = 'E';
  else if (fy <= 0) dir = 'N';
  else if (fy >= 1) dir = 'S';
  else dir = nearestSide(r, p);
  return { p, dir };
}

/** 矩形 `r` から、点 `to` の向きに出る辺（自動）：縦と横の、どちらに、より離れているか */
export function autoDir(r: Rect, to: Pt, toSize: { w: number; h: number } = { w: 0, h: 0 }): Dir {
  const c = centerOf(r);
  const dx = to.x - c.x;
  const dy = to.y - c.y;
  if (Math.abs(dx) * (r.h + toSize.h) >= Math.abs(dy) * (r.w + toSize.w)) return dx >= 0 ? 'E' : 'W';
  return dy >= 0 ? 'S' : 'N';
}

/** 辺の中点の接続点 */
export function sidePort(r: Rect, dir: Dir): Port {
  const c = centerOf(r);
  const p =
    dir === 'N'
      ? { x: c.x, y: r.y }
      : dir === 'S'
        ? { x: c.x, y: r.y + r.h }
        : dir === 'W'
          ? { x: r.x, y: c.y }
          : { x: r.x + r.w, y: c.y };
  return { p, dir };
}

/** 図形の外周と、中心から `toward` へ向かう線の交点（まっすぐな線の端）。矩形・楕円・菱形。ほかは矩形 */
export function perimeterPoint(r: Rect, shape: ShapeKind, toward: Pt): Pt {
  const c = centerOf(r);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  const a = r.w / 2;
  const b = r.h / 2;
  if (!dx && !dy) return c;
  if (a <= 0 || b <= 0) return c;
  let t: number;
  if (shape === 'ellipse') t = 1 / Math.sqrt((dx / a) ** 2 + (dy / b) ** 2);
  else if (shape === 'rhombus') t = 1 / (Math.abs(dx) / a + Math.abs(dy) / b);
  else t = 1 / Math.max(Math.abs(dx) / a, Math.abs(dy) / b);
  return { x: c.x + dx * t, y: c.y + dy * t };
}

const same = (a: Pt, b: Pt): boolean => Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01;

/** 同じ点の連続・一直線上の途中の点を、除く */
export function simplify(pts: readonly Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && same(last, p)) continue;
    out.push(p);
  }
  for (let i = out.length - 2; i >= 1; i--) {
    const a = out[i - 1] as Pt;
    const b = out[i] as Pt;
    const c = out[i + 1] as Pt;
    if (
      (Math.abs(a.x - b.x) < 0.01 && Math.abs(b.x - c.x) < 0.01) ||
      (Math.abs(a.y - b.y) < 0.01 && Math.abs(b.y - c.y) < 0.01)
    )
      out.splice(i, 1);
  }
  return out;
}

const dot = (a: Pt, b: Pt): number => a.x * b.x + a.y * b.y;
const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Pt, v: Pt, k: number): Pt => ({ x: a.x + v.x * k, y: a.y + v.y * k });

/** 経由点がない直交の経路：始点・終点の、辺の向きから、曲がり 0〜4 回 */
function autoRoute(a: Port, b: Port): Pt[] {
  const da = VEC[a.dir];
  const db = VEC[b.dir];
  const ha = isH(a.dir);
  const hb = isH(b.dir);
  if (ha !== hb) {
    // 向きが直角：角が 1 つ（始点から出る向きの先・終点の外側に、角があるとき）
    const c = ha ? { x: b.p.x, y: a.p.y } : { x: a.p.x, y: b.p.y };
    if (dot(sub(c, a.p), da) >= 0 && dot(sub(c, b.p), db) >= 0) return [a.p, c, b.p];
    // 遠回り（曲がり 3 回）：始点の足 → 終点の足の高さ（幅）まで → 終点の足 → 終点
    const s = add(a.p, da, STUB);
    const e = add(b.p, db, STUB);
    const c2 = ha ? { x: s.x, y: e.y } : { x: e.x, y: s.y };
    return [a.p, s, c2, e, b.p];
  }
  if (a.dir !== b.dir) {
    // 向かい合う
    if (dot(sub(b.p, a.p), da) > 0) {
      // 相手が前にある：中間で折れる（Z 字）
      if (ha) {
        const mx = (a.p.x + b.p.x) / 2;
        return [a.p, { x: mx, y: a.p.y }, { x: mx, y: b.p.y }, b.p];
      }
      const my = (a.p.y + b.p.y) / 2;
      return [a.p, { x: a.p.x, y: my }, { x: b.p.x, y: my }, b.p];
    }
    // 相手が後ろにある：足を出して、回り込む
    const s = add(a.p, da, STUB);
    const e = add(b.p, db, STUB);
    if (ha) {
      const my = (a.p.y + b.p.y) / 2;
      return [a.p, s, { x: s.x, y: my }, { x: e.x, y: my }, e, b.p];
    }
    const mx = (a.p.x + b.p.x) / 2;
    return [a.p, s, { x: mx, y: s.y }, { x: mx, y: e.y }, e, b.p];
  }
  // 同じ向き：外側を回る（コの字）
  if (ha) {
    const x = da.x > 0 ? Math.max(a.p.x, b.p.x) + STUB : Math.min(a.p.x, b.p.x) - STUB;
    return [a.p, { x, y: a.p.y }, { x, y: b.p.y }, b.p];
  }
  const y = da.y > 0 ? Math.max(a.p.y, b.p.y) + STUB : Math.min(a.p.y, b.p.y) - STUB;
  return [a.p, { x: a.p.x, y }, { x: b.p.x, y }, b.p];
}

/**
 * 直交の経路。経由点があれば、そこを通る：始点から出る向きに進んで、経由点の座標で折れ、…、最後は、終点に入る向きの辺で入る。
 * 経由点がなければ、始点・終点の向きから、自動（`autoRoute`）
 */
export function routeOrthogonal(a: Port, b: Port, waypoints: readonly Pt[]): Pt[] {
  if (!waypoints.length) return simplify(autoRoute(a, b));
  const pts: Pt[] = [a.p];
  let cur = a.p;
  let horizontal = isH(a.dir); // 次の脚の向き
  for (const w of waypoints) {
    const corner = horizontal ? { x: w.x, y: cur.y } : { x: cur.x, y: w.y };
    pts.push(corner, w);
    // 最後の（長さのある）脚の向きに直角に、次を始める
    const lastLegH = same(corner, w) ? horizontal : !horizontal;
    horizontal = !lastLegH;
    cur = w;
  }
  // 終点：入る脚の向きは、終点の辺の向き（横の辺なら、横に入る）
  const corner = isH(b.dir) ? { x: cur.x, y: b.p.y } : { x: b.p.x, y: cur.y };
  pts.push(corner, b.p);
  return simplify(pts);
}

/** 経路の長さ */
export function pathLength(pts: readonly Pt[]): number {
  let n = 0;
  for (let i = 1; i < pts.length; i++)
    n += Math.hypot((pts[i] as Pt).x - (pts[i - 1] as Pt).x, (pts[i] as Pt).y - (pts[i - 1] as Pt).y);
  return n;
}

/** 経路の、始点から `dist` の位置の点と、そこでの向き（単位ベクトル） */
export function pointAlong(pts: readonly Pt[], dist: number): { p: Pt; dir: Pt } {
  const first = pts[0] ?? { x: 0, y: 0 };
  let left = Math.max(0, dist);
  let dir: Pt = { x: 1, y: 0 };
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1] as Pt;
    const b = pts[i] as Pt;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len > 0) dir = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    if (left <= len || i === pts.length - 1) {
      const t = len > 0 ? Math.min(1, left / len) : 0;
      return { p: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, dir };
    }
    left -= len;
  }
  return { p: first, dir };
}

/**
 * 線の上のラベルの位置：`x`（-1＝始点・1＝終点）・`y`（線に直交するずれ px）・`offset`。draw.io の、相対ジオメトリと同じ
 */
export function labelPoint(pts: readonly Pt[], x: number, y: number, offset: Pt): Pt {
  const len = pathLength(pts);
  const { p, dir } = pointAlong(pts, ((Math.min(1, Math.max(-1, x)) + 1) / 2) * len);
  return { x: p.x - dir.y * y + offset.x, y: p.y + dir.x * y + offset.y };
}

/** 角を丸める（半径 r）：`M … L … Q …` の `d` */
export function pathData(pts: readonly Pt[], radius = 0): string {
  const f = (n: number): string => String(Math.round(n * 100) / 100);
  const first = pts[0];
  if (!first) return '';
  let d = `M${f(first.x)} ${f(first.y)}`;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i] as Pt;
    const prev = pts[i - 1] as Pt;
    const next = pts[i + 1];
    if (radius > 0 && next) {
      const l1 = Math.hypot(p.x - prev.x, p.y - prev.y);
      const l2 = Math.hypot(next.x - p.x, next.y - p.y);
      const r = Math.min(radius, l1 / 2, l2 / 2);
      if (r > 0) {
        const a = { x: p.x - ((p.x - prev.x) / l1) * r, y: p.y - ((p.y - prev.y) / l1) * r };
        const b = { x: p.x + ((next.x - p.x) / l2) * r, y: p.y + ((next.y - p.y) / l2) * r };
        d += `L${f(a.x)} ${f(a.y)}Q${f(p.x)} ${f(p.y)} ${f(b.x)} ${f(b.y)}`;
        continue;
      }
    }
    d += `L${f(p.x)} ${f(p.y)}`;
  }
  return d;
}

export type ArrowKind = 'classic' | 'block' | 'open' | 'oval' | 'diamond' | 'none';

/** 矢印の種類（draw.io の名前 → 描ける形。未知の名前は classic） */
export function arrowKind(name: string | undefined, def: ArrowKind): ArrowKind {
  if (name === undefined) return def;
  switch (name) {
    case 'none':
      return 'none';
    case 'classic':
    case 'classicThin':
      return 'classic';
    case 'block':
    case 'blockThin':
      return 'block';
    case 'open':
    case 'openThin':
      return 'open';
    case 'oval':
      return 'oval';
    case 'diamond':
    case 'diamondThin':
      return 'diamond';
    default:
      return 'classic';
  }
}

export interface ArrowShape {
  /** 多角形・折れ線の頂点（先端が `tip`） */
  points: Pt[];
  /** 塗るか（open は、塗らない） */
  filled: boolean;
  /** 丸（oval）：中心と半径 */
  circle: { c: Pt; r: number } | null;
  /** 矢印の分、線を縮める長さ（先端の手前で、線を止める） */
  shorten: number;
}

/** 矢印の形：先端 `tip`・線の進む向き `dir`（単位ベクトル）・大きさ（draw.io の `endSize`＝既定 6）・線の太さ */
export function arrowShape(kind: ArrowKind, tip: Pt, dir: Pt, size: number, strokeWidth: number): ArrowShape | null {
  if (kind === 'none') return null;
  const s = size * Math.max(1, strokeWidth);
  const len = s * 1.5;
  const half = s * 0.55;
  const nx = -dir.y;
  const ny = dir.x;
  const at = (back: number, side: number): Pt => ({
    x: tip.x - dir.x * back + nx * side,
    y: tip.y - dir.y * back + ny * side,
  });
  switch (kind) {
    case 'block':
      return { points: [tip, at(len, half), at(len, -half)], filled: true, circle: null, shorten: len * 0.9 };
    case 'classic':
      return {
        points: [tip, at(len, half), at(len * 0.78, 0), at(len, -half)],
        filled: true,
        circle: null,
        shorten: len * 0.7,
      };
    case 'open':
      return { points: [at(len, half), tip, at(len, -half)], filled: false, circle: null, shorten: 0 };
    case 'diamond':
      return {
        points: [tip, at(len * 0.5, half), at(len, 0), at(len * 0.5, -half)],
        filled: true,
        circle: null,
        shorten: len * 0.9,
      };
    case 'oval':
      return { points: [], filled: true, circle: { c: at(len * 0.4, 0), r: len * 0.4 }, shorten: len * 0.8 };
  }
}
