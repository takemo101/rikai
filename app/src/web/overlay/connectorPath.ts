// 関連の線（F35）の、純粋な幾何：端点の箱への寄せ（クランプ）・同じ側の外の判定・線のパス・クリップの箱。DOM・React に触れない（測定は Connectors.tsx）。
// 座標は、すべて、画面（viewport）の座標。
import { type Box, bottom, clampToBox, fromEdges, type Pt, right } from '../lib/geom';

/** 箱の、縦の外：-1 は上・1 は下・0 は中 */
export type Side = -1 | 0 | 1;

/** 描く 1 本の線 */
export interface Link {
  tid: string;
  /** SVG のパス（本文側の端点 → カード側の端点） */
  d: string;
  /** 本文側の端点の丸の位置。見える範囲の縁に寄せたとき（端が、範囲の外）は null */
  doc: Pt | null;
  /** カード側の端点の位置。縁に寄せたときは null */
  card: Pt | null;
  /** どちらかの端を、縁に寄せた（選んでいる・光らせている・入力中の線だけ。より薄く描く） */
  edge: boolean;
  /** 水平の引き出し（と、その始めの小さな曲がり）を持つ。持つなら、`d` の最後の `C` から後が、S 字の部分 */
  lead: boolean;
}

/** 1 フレームに描くもの：クリップの箱・すべての引き出し線が、S 字に入る x（なければ null）・線（本文の順） */
export interface Frame {
  clip: Box;
  leadX: number | null;
  links: Link[];
}

/** 小数 1 桁（パスの文字列を、短く・同じ形なら同じ文字列に） */
const r1 = (n: number): number => Math.round(n * 10) / 10;

export function sideOf(y: number, box: Box): Side {
  if (y < box.top) return -1;
  if (y > bottom(box)) return 1;
  return 0;
}

/** 箱の右端の縦の中央 */
export const rightMiddle = (b: Box): Pt => ({ x: right(b), y: (b.top + bottom(b)) / 2 });

/** 点を、箱の中へ寄せる。動かしたか（edge）を添える */
export function clampTo(p: Pt, box: Box): { pt: Pt; edge: boolean } {
  const pt = clampToBox(p, box);
  return { pt, edge: pt.x !== p.x || pt.y !== p.y };
}

/** 縁へ寄せた端を、見える範囲の縁の、内側に止める距離（px）。縁そのものに止めると、線が、縁に沿って、水平に走る */
export const EDGE_INSET = 8;
/** 本文の外へ出た対象の線が、本文の右端から、内側へ出る長さ（px）。対象は見えないので、短い印だけを出す */
export const STUB = 10;

/** 最後の行（いちばん下の矩形と、同じ行の矩形）：右端・縦の中央・下端 */
function lastLineOf(rects: readonly Box[]): { right: number; y: number; bottom: number } | null {
  let last: Box | null = null;
  for (const r of rects)
    if (!last || bottom(r) > bottom(last) || (bottom(r) === bottom(last) && r.top > last.top)) last = r;
  if (!last) return null;
  const y = (last.top + bottom(last)) / 2;
  let rightMost = right(last);
  let lowest = bottom(last);
  for (const r of rects)
    if (r.top <= y && y <= bottom(r)) {
      rightMost = Math.max(rightMost, right(r));
      lowest = Math.max(lowest, bottom(r));
    }
  return { right: rightMost, y, bottom: lowest };
}

/**
 * 複数の矩形（強調の、行ごとの矩形）から、**最後の行の右端の縦の中央**。最後の行＝いちばん下の矩形（同じ行は、縦の中央が、その矩形の中にあるもの）。
 * 強調した文字そのものを、線が横切らない（線は、最後の文字の右から出る）。矩形がなければ null
 */
export function endOfLastLine(rects: readonly Box[]): Pt | null {
  const l = lastLineOf(rects);
  return l && { x: l.right, y: l.y };
}

/** 最後の行の下端（同じ行の、いちばん下）。矩形がなければ null */
export function lastLineBottom(rects: readonly Box[]): number | null {
  return lastLineOf(rects)?.bottom ?? null;
}

/**
 * 本文側の端点 `doc` から、カード側の端点 `card` への線。
 * - **両端が、見える範囲（`docBox`・`panelBox`）の中**：引く（丸・棒つき）。
 * - **どちらかが、範囲の外**：`emphasized`（選んでいる・光らせている・入力中の線）のときだけ、引く。それ以外は、引かない：
 *   本文だけをスクロールしたとき、縁へ寄せた線が、パネルの端に束になって、本文の上を横切らないように。
 * - 引くときは、外の端を、縁の内側（`EDGE_INSET`）に止める。本文側は、本文の右端から、短く（`STUB`）出す。丸・棒は出さない（`doc`・`card` が null）。
 * - 両方が、同じ側の外（ともに上・ともに下）なら、引かない。
 * - `leadX`：すべての線の、引き出し線の右端（`sharedLeadX`）。`hook`：引き出し線の始点（`doc` から、小さく曲がって、そこへ入る。1 件だけの行）。
 */
export function linkBetween(
  tid: string,
  doc: Pt,
  card: Pt,
  docBox: Box,
  panelBox: Box,
  emphasized: boolean,
  leadX?: number,
  hook?: Pt,
): Link | null {
  const sd = sideOf(doc.y, docBox);
  const sc = sideOf(card.y, panelBox);
  if (sd !== 0 && sd === sc) return null;
  const a = sd === 0 ? clampTo(doc, docBox) : { pt: stubEnd(docBox, sd), edge: true };
  const b = sc === 0 ? clampTo(card, panelBox) : { pt: insetEnd(card.x, panelBox, sc), edge: true };
  const edge = a.edge || b.edge;
  if (edge && !emphasized) return null;
  const lead = !a.edge && leadX !== undefined;
  const d = connectorPath(a.pt, b.pt, lead ? leadX : undefined, lead ? hook : undefined); // 引き出し線は、本文側が、範囲の中のときだけ
  return { tid, d, doc: a.edge ? null : a.pt, card: b.edge ? null : b.pt, edge, lead };
}

/** 範囲の上（-1）・下（1）の外へ出た対象：範囲の右端の近く、縁の内側 */
const stubEnd = (box: Box, side: Side): Pt => ({
  x: Math.max(box.left, right(box) - STUB),
  y: insetY(box, side),
});

const insetEnd = (x: number, box: Box, side: Side): Pt => ({ x, y: insetY(box, side) });

const insetY = (box: Box, side: Side): number =>
  side < 0 ? Math.min(box.top + EDGE_INSET, bottom(box)) : Math.max(bottom(box) - EDGE_INSET, box.top);

/**
 * 2 点を結ぶ、なめらかな曲線（cubic bezier）：両端は、水平に出入りし、中ほどで縦へ移る（S 字）。
 * 本文の順の端点は、上から下へ単調なので、制御点の x を中点にそろえると、線が交わりにくい。
 * `leadX`（`a.x` より右）：まず、そこまで水平に引き出して（`H`）から、S 字に入る。
 */
export function connectorPath(a: Pt, b: Pt, leadX: number = a.x, hook?: Pt): string {
  const from = hook ?? a;
  const x0 = Math.max(leadX, from.x);
  const xm = r1((x0 + b.x) / 2);
  const [ax, ay, bx, by, fx, fy] = [r1(a.x), r1(a.y), r1(b.x), r1(b.y), r1(from.x), r1(from.y)];
  const bend = hook ? `C${r1((ax + fx) / 2)} ${ay} ${r1((ax + fx) / 2)} ${fy} ${fx} ${fy}` : '';
  return `M${ax} ${ay}${bend}${x0 > from.x ? `H${r1(x0)}` : ''}C${xm} ${fy} ${xm} ${by} ${bx} ${by}`;
}

/** 同じ行とみなす、本文側の端点の高さの差（px）。番号の丸の「同じ行」（`SAME_ROW`）と同じ */
export const ROW_TOL = 4;
/** 引き出し線の、いちばん右の端点（と、記事の右端）からの余白（px） */
export const LEAD_GAP = 6;
/** S 字の、横の幅の下限（px）：引き出し線を、カードに近づけすぎて、縦の線にならないように */
export const MIN_CURVE = 24;
/** 引き出し線の高さ：強調の行の下端から、下へ（px）。行間に出す（文字の中を、通らない。`pre` でも） */
export const BELOW = 2;
/** 次の行の矩形の上に、残す余白（px）。同じ行の線を、ずらすとき、行間（下端から次の行まで）に、収める */
export const LINE_MARGIN = 2;
/** 同じ行の線の始点を、上から下へずらす間隔（px）の上限と、全体の幅の上限 */
export const FAN_STEP = 2;
export const FAN_SPREAD = 6;
/** 1 件だけの行：強調の右端の中央（点）から、引き出し線の高さへ、小さく曲がって下りる、その横の長さ（px） */
export const HOOK = 10;

/** 本文側の端点：右端と縦の中央（`p`）・その行の下端と、下の行までのすきま（行間。引き出し線の高さの基準）・対応するカード側の端点の高さ（線の順を決める） */
export interface DocEnd {
  tid: string;
  p: Pt;
  bottom: number;
  gap: number;
  cardY: number;
}

/** 引き出し線の始点（`x`・`y`）。`from`：1 件だけの行の、点の位置（強調の右端の中央。そこから、始点へ、小さく曲がって下りる） */
export interface Start extends Pt {
  from?: Pt;
}

/**
 * 引き出し線の始点：行の下端の少し下（`BELOW`。行間）。同じ行（`ROW_TOL` 未満の差）の端点が 2 つ以上あるときは、
 * **カードの高さの順**（上のカードほど上）に、行間の中で、ずらす（全体で `FAN_SPREAD` まで・行間が狭ければ、減らす）。x は、端点のまま。
 * 1 件だけの行は、点を、強調の右端の中央に置き（`from`）、始点は、そこから `HOOK` 右・引き出し線の高さにする。
 * 始点の高さの順と、カードの高さの順がそろうので、同じ x（`sharedLeadX`）から S 字に入れば、どの線も、交差しない。キーは tid
 */
export function fanOutSameRow(ends: readonly DocEnd[]): Map<string, Start> {
  const out = new Map<string, Start>();
  const sorted = [...ends].sort((a, b) => a.p.y - b.p.y || a.p.x - b.p.x);
  let i = 0;
  while (i < sorted.length) {
    const first = sorted[i] as DocEnd;
    let j = i + 1;
    while (j < sorted.length && (sorted[j] as DocEnd).p.y - first.p.y < ROW_TOL) j++;
    const row = sorted.slice(i, j);
    i = j;
    const gap = Math.min(...row.map((e) => e.gap));
    const below = Math.min(BELOW, gap / 2);
    const base = Math.max(...row.map((e) => e.bottom)) + below;
    const spread = Math.max(0, Math.min(FAN_SPREAD, gap - below - LINE_MARGIN));
    const step = row.length > 1 ? Math.min(FAN_STEP, spread / (row.length - 1)) : 0;
    const byCard = [...row].sort((a, b) => a.cardY - b.cardY || a.p.x - b.p.x);
    byCard.forEach((e, rank) => {
      const y = base + rank * step;
      // 1 件だけの行：点は、強調の右端の中央（これまでと同じ）。そこから、引き出し線の高さへ、小さく曲がって下りる
      out.set(e.tid, row.length === 1 && y - e.p.y >= 2 ? { x: e.p.x + HOOK, y, from: e.p } : { x: e.p.x, y });
    });
  }
  return out;
}

/**
 * すべての線が、水平に引き出して入る、共通の x：記事の右端 + `LEAD_GAP`（カードから `MIN_CURVE` 以上、離す）。いちばん右の端点（`maxEndX`）より、左にはしない。
 * すべての線が、同じ x から、同じカードの x まで、S 字に入る（S 字の x の範囲が、同じ）
 */
export function sharedLeadX(maxEndX: number, articleRight: number, cardX: number): number {
  return Math.max(maxEndX, Math.min(articleRight + LEAD_GAP, cardX - MIN_CURVE));
}

/**
 * 線を描いてよい箱：本文（`#docscroll`）・右のパネル（`#threads`）・そのすきま。左の一覧・上のバーには、はみ出さない。
 * 縦は、2 つの重なり（どちらも、上のバーの下の、同じ段）。
 */
export function clipBox(doc: Box, panel: Box): Box {
  return fromEdges({
    left: Math.min(doc.left, panel.left),
    right: Math.max(right(doc), right(panel)),
    top: Math.max(doc.top, panel.top),
    bottom: Math.min(bottom(doc), bottom(panel)),
  });
}

/** 2 つのフレームが、描くものとして同じか（同じなら、React の state を、入れ替えない） */
export function sameFrame(a: Frame | null, b: Frame): boolean {
  if (!a) return false;
  if (a.links.length !== b.links.length || a.leadX !== b.leadX) return false;
  const [c, d] = [a.clip, b.clip];
  if (c.left !== d.left || c.top !== d.top || c.width !== d.width || c.height !== d.height) return false;
  for (let i = 0; i < a.links.length; i++) {
    const [x, y] = [a.links[i], b.links[i]];
    if (!x || !y || x.tid !== y.tid || x.d !== y.d || x.edge !== y.edge || x.lead !== y.lead) return false;
    if (!samePt(x.doc, y.doc) || !samePt(x.card, y.card)) return false;
  }
  return true;
}

function samePt(a: Pt | null, b: Pt | null): boolean {
  return a === b || (!!a && !!b && a.x === b.x && a.y === b.y);
}
