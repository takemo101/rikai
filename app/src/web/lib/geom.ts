// 画面の幾何の、共通の型と小さな計算（DOM に触れない）。範囲選択（interact/）・関連の線（overlay/）・拡大表示（panel/）が、同じ道具を使う。
// 箱は `left/top/width/height` を正とし、右端・下端は `right()`・`bottom()` で導く（`getBoundingClientRect` の結果も、そのまま、箱として渡せる）。
// 数が有限でない（NaN・無限大）ときの扱い：比率への変換（`ratioOf`・`fromRatio`）は、null を返す。丸め・clamp は、NaN を、そのまま通す。
import type { Rect } from '../../shared/types';

export interface Pt {
  x: number;
  y: number;
}

export interface Size {
  w: number;
  h: number;
}

/** 座標の箱（`getBoundingClientRect` の、必要な 4 項目） */
export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** 4 つの辺の座標（`adjustEdges` など、辺で計算するところ） */
export interface Edges {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** 左上と大きさから、箱を作る */
export const boxAt = (left: number, top: number, width: number, height: number): Box => ({ left, top, width, height });

/** 4 つの辺から、箱を作る */
export const fromEdges = (e: Edges): Box => ({
  left: e.left,
  top: e.top,
  width: e.right - e.left,
  height: e.bottom - e.top,
});

export const right = (b: Box): number => b.left + b.width;
export const bottom = (b: Box): number => b.top + b.height;

/** 値を、範囲 lo〜hi に収める */
export const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);

/** 4 桁に丸める */
export const r4 = (v: number): number => Math.round(v * 10000) / 10000;

/** すべて有限の数か（NaN・無限大は false） */
export const finite = (...v: number[]): boolean => v.every((n) => Number.isFinite(n));

/** 箱の外へ出ない点（箱の縁に寄せる）。箱の幅・高さが負でも、左・上の縁に寄せる */
export const clampToBox = (p: Pt, box: Box): Pt => ({
  x: clamp(p.x, box.left, Math.max(box.left, right(box))),
  y: clamp(p.y, box.top, Math.max(box.top, bottom(box))),
});

/** 箱（inner）が、基準の箱（base）の大きさに対して、どこにあるか（比率。丸めない）。base が不正（有限でない・幅か高さが 0 以下）なら null */
export function ratioOf(inner: Box, base: Box): Rect | null {
  if (!finite(inner.left, inner.top, inner.width, inner.height, base.left, base.top, base.width, base.height))
    return null;
  if (base.width <= 0 || base.height <= 0) return null;
  return {
    x: (inner.left - base.left) / base.width,
    y: (inner.top - base.top) / base.height,
    w: inner.width / base.width,
    h: inner.height / base.height,
  };
}

/** 比率の範囲（rect）を、基準の箱（base）の座標にする（`ratioOf` の逆）。base が不正なら null */
export function fromRatio(rect: Rect, base: Box): Box | null {
  if (!finite(rect.x, rect.y, rect.w, rect.h, base.left, base.top, base.width, base.height)) return null;
  if (base.width <= 0 || base.height <= 0) return null;
  return boxAt(
    base.left + rect.x * base.width,
    base.top + rect.y * base.height,
    rect.w * base.width,
    rect.h * base.height,
  );
}

/** 比率の範囲を、4 桁に丸める（保存する形） */
export const roundRect = (r: Rect): Rect => ({ x: r4(r.x), y: r4(r.y), w: r4(r.w), h: r4(r.h) });
