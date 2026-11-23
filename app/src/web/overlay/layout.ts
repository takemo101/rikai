// 番号の層の、位置の計算（旧 app.js の `placeBadges` の、測定を含まない部分）。純粋な関数だけ：jsdom で試せる。
import type { Rect } from '../../shared/types';

/** 番号の丸：文・ブロック・範囲の、すべて、同じ見た目。入力中の対象は、「新」（濃いアクセント） */
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

/** 丸の高さ（px。`.bno` の高さ）・重ねたときの、隣との重なり（px）。重なっても、数字が、隠れないように、小さく */
export const BADGE_SIZE = 18;
export const BADGE_OVERLAP = 2;
/** 1 つの行に、並べる丸の数の上限（「+N」も 1 つに数える） */
export const BADGE_MAX = 5;

/**
 * 丸の幅（px）。文字数（桁数）で決まる：1 文字は 18px（丸）・2 文字 24px・3 文字 31px・4 文字 38px。
 * CSS（`.bno`・`.bno.d2`〜`.d4` の `width`）と、同じ値：実際の幅と、一致する（e2e で、実測と比べる）。「+N」は、`+` も 1 文字に数える
 */
export const badgeWidth = (text: string | number): number => {
  const n = Math.min(4, String(text).length);
  return n <= 1 ? BADGE_SIZE : 24 + (n - 2) * 7;
};

/** 丸を重ねて並べた幅（px） */
export const stackWidth = (widths: readonly number[]): number =>
  widths.reduce((a, b) => a + b, 0) - BADGE_OVERLAP * Math.max(0, widths.length - 1);

/**
 * 同じ行の丸を、重ねて（アバターのスタック）、1 つの行に収める。`room`：丸の組の右端から、左の見える端までの幅（px）。`textOf`：丸の文字（幅を決める）。
 * 5 つ（`BADGE_MAX`）まで・`room` に収まるなら、すべて並べる。収まらなければ、先頭から、収まる分（4 つまで。「+N」の丸が、1 つ分の幅を使う）だけを並べ、残りを `folded` にまとめる。1 つも収まらなければ、「+N」だけにする（丸が、見える範囲の左の外へ、はみ出さない）。
 * 5 件ちょうどは、収まれば、5 つ並べる（「+1」にしない）
 */
export function foldBadges<T>(
  items: readonly T[],
  room: number,
  textOf: (item: T) => string | number,
): { shown: T[]; folded: T[] } {
  const widths = items.map((i) => badgeWidth(textOf(i)));
  if (items.length <= BADGE_MAX && stackWidth(widths) <= room) return { shown: [...items], folded: [] };
  let n = Math.min(BADGE_MAX - 1, items.length - 1);
  while (n > 0 && stackWidth([...widths.slice(0, n), badgeWidth(`+${items.length - n}`)]) > room) n--;
  return { shown: items.slice(0, n), folded: items.slice(n) };
}

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

/** html-app の範囲の枠を、基準の箱の周りに収める限度（基準の箱の幅・高さの何倍まで、外へ出してよいか） */
export const APP_REGION_MARGIN = 1;

/**
 * html-app の範囲の枠の、描画用の比率：基準（枠の置き場）の箱を基準に、周り（`-APP_REGION_MARGIN`〜`1 + APP_REGION_MARGIN`）に、収める。収めた結果が空なら null（描かない）。
 * 0.24.0 より前に、見出しのアイコン（15px）を基準に保存された範囲は、新しい基準では、極端な値（幅 40・高さ 8 など）になる：描くと、本文の高さを伸ばす・巨大な枠になる。
 * 保存した値（`.rikai/`）は、書き換えない：描くときだけ、収める。画像・図・文の範囲には、使わない（広い範囲も、そのまま描く）
 */
export function clampRegionRect(rect: Rect): Rect | null {
  const lo = -APP_REGION_MARGIN;
  const hi = 1 + APP_REGION_MARGIN;
  const clamp = (v: number): number => Math.min(hi, Math.max(lo, v));
  const [x0, y0, x1, y1] = [clamp(rect.x), clamp(rect.y), clamp(rect.x + rect.w), clamp(rect.y + rect.h)];
  return x1 > x0 && y1 > y0 && [x0, y0, x1, y1].every(Number.isFinite)
    ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
    : null;
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
