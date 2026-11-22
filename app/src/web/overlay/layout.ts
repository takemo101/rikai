// 番号の層の、位置の計算（旧 app.js の `placeBadges` の、測定を含まない部分）。純粋な関数だけ：jsdom で試せる。
import type { Rect } from '../../shared/types';

/** 番号の丸：文・ブロック・範囲の、すべて、同じ見た目。入力中の対象は、「新」（オレンジ） */
export interface BadgeItem {
  /** ビューポートでの、対象の上端 */
  top: number;
  tid: string;
  n: number | '新';
  resolved?: boolean;
  pending?: boolean;
}

export interface BadgeGroup {
  top: number;
  items: BadgeItem[];
}

/** 同じ行とみなす、高さの差（px） */
export const SAME_ROW = 4;
/** 前の組の下端の、さらに下に空ける（px） */
export const STACK_GAP = 2;
/** 丸の組を、対象の上端から、下げる（px） */
export const BADGE_DROP = 2;
/** 丸の組を、記事の左端から、左へ出す（px） */
export const BADGE_OUTSET = 12;

const numOf = (b: BadgeItem): number => (typeof b.n === 'number' ? b.n : 1e9);

/** 高さ（上端）の順（同じ高さは、番号の順。「新」は、最後）に並べ、近い高さ（4px 未満。同じ行）の印を、1 つの組にする */
export function groupBadges(items: readonly BadgeItem[]): BadgeGroup[] {
  const sorted = [...items].sort((a, b) => a.top - b.top || numOf(a) - numOf(b));
  const groups: BadgeGroup[] = [];
  for (const it of sorted) {
    const g = groups[groups.length - 1];
    if (g && it.top - g.top < SAME_ROW) g.items.push(it);
    else groups.push({ top: it.top, items: [it] });
  }
  return groups;
}

/**
 * 組を、上から順に置く。組が、上の組に重ならないよう、前の組の下端の 2px 下より上には、出さない。
 * `place(組, 上端)` は、置いた組の高さ（実測。折り返して、背が高くなることがある）を返す
 */
export function stackGroups(groups: readonly BadgeGroup[], place: (group: BadgeGroup, top: number) => number): void {
  let floor = Number.NEGATIVE_INFINITY;
  for (const g of groups) {
    const top = Math.max(g.top, floor);
    floor = top + place(g, top) + STACK_GAP;
  }
}

export interface Pos {
  left: number;
  top: number;
}

/** 層（`#docscroll` の中の絶対位置）での、丸の組の左端 */
export const badgeLeft = (article: Pos, scroller: Pos, scrollLeft: number): number =>
  Math.round(article.left - scroller.left + scrollLeft) - BADGE_OUTSET;

/** 層での、丸の組の上端 */
export const badgeTopIn = (top: number, scroller: Pos, scrollTop: number): number =>
  Math.round(top - scroller.top + scrollTop) + BADGE_DROP;

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** 範囲の上端（ビューポート）：基準の要素 `m` の高さに対する比率 */
export const regionTopOf = (m: Pick<Box, 'top' | 'height'>, rect: Rect): number => m.top + rect.y * m.height;

/**
 * 範囲の枠の、層での位置。`m`：基準の要素（`frameOf`）のビューポートの矩形。
 * 範囲が、本文の領域の外（左右）へ出ても、領域の中に収める（枠のせいで、横にスクロールできるようにならない）。収まる幅がなければ null
 */
export function regionBox(m: Box, scroller: Pos, scrollPos: Pos, clientWidth: number, rect: Rect): Box | null {
  const x0 = Math.round(m.left - scroller.left + scrollPos.left + rect.x * m.width);
  const x1 = x0 + Math.round(rect.w * m.width);
  const left = Math.max(0, x0);
  const right = Math.min(clientWidth, x1);
  if (right <= left) return null;
  return {
    left,
    top: Math.round(m.top - scroller.top + scrollPos.top + rect.y * m.height),
    width: right - left,
    height: Math.round(rect.h * m.height),
  };
}
