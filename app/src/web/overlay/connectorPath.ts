// 関連の線（F35）の、純粋な幾何：端点の箱への寄せ（クランプ）・同じ側の外の判定・線のパス・クリップの箱。DOM・React に触れない（測定は Connectors.tsx）。
// 座標は、すべて、画面（viewport）の座標。

export interface Pt {
  x: number;
  y: number;
}

/** 画面の座標の箱（`getBoundingClientRect` の left・top・right・bottom） */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

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
}

/** 1 フレームに描くもの：クリップの箱と、線（本文の順） */
export interface Frame {
  clip: Box;
  links: Link[];
}

/** 小数 1 桁（パスの文字列を、短く・同じ形なら同じ文字列に） */
const r1 = (n: number): number => Math.round(n * 10) / 10;

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);

export function sideOf(y: number, box: Box): Side {
  if (y < box.top) return -1;
  if (y > box.bottom) return 1;
  return 0;
}

/** 箱の右端の縦の中央 */
export const rightMiddle = (b: Box): Pt => ({ x: b.right, y: (b.top + b.bottom) / 2 });

/** 点を、箱の中へ寄せる。動かしたか（edge）を添える */
export function clampTo(p: Pt, box: Box): { pt: Pt; edge: boolean } {
  const x = clamp(p.x, box.left, Math.max(box.left, box.right));
  const y = clamp(p.y, box.top, Math.max(box.top, box.bottom));
  return { pt: { x, y }, edge: x !== p.x || y !== p.y };
}

/** 縁へ寄せた端を、見える範囲の縁の、内側に止める距離（px）。縁そのものに止めると、線が、縁に沿って、水平に走る */
export const EDGE_INSET = 8;
/** 本文の外へ出た対象の線が、本文の右端から、内側へ出る長さ（px）。対象は見えないので、短い印だけを出す */
export const STUB = 10;

/**
 * 複数の矩形（強調の、行ごとの矩形）から、**最後の行の右端の縦の中央**。最後の行＝いちばん下の矩形（同じ行は、縦の中央が、その矩形の中にあるもの）。
 * 強調した文字そのものを、線が横切らない（線は、最後の文字の右から出る）。矩形がなければ null
 */
export function endOfLastLine(rects: readonly Box[]): Pt | null {
  let last: Box | null = null;
  for (const r of rects)
    if (!last || r.bottom > last.bottom || (r.bottom === last.bottom && r.top > last.top)) last = r;
  if (!last) return null;
  const y = (last.top + last.bottom) / 2;
  let right = last.right;
  for (const r of rects) if (r.top <= y && y <= r.bottom) right = Math.max(right, r.right);
  return { x: right, y };
}

/**
 * 本文側の端点 `doc` から、カード側の端点 `card` への線。
 * - **両端が、見える範囲（`docBox`・`panelBox`）の中**：引く（丸・棒つき）。
 * - **どちらかが、範囲の外**：`emphasized`（選んでいる・光らせている・入力中の線）のときだけ、引く。それ以外は、引かない：
 *   本文だけをスクロールしたとき、縁へ寄せた線が、パネルの端に束になって、本文の上を横切らないように。
 * - 引くときは、外の端を、縁の内側（`EDGE_INSET`）に止める。本文側は、本文の右端から、短く（`STUB`）出す。丸・棒は出さない（`doc`・`card` が null）。
 * - 両方が、同じ側の外（ともに上・ともに下）なら、引かない。
 */
export function linkBetween(
  tid: string,
  doc: Pt,
  card: Pt,
  docBox: Box,
  panelBox: Box,
  emphasized: boolean,
): Link | null {
  const sd = sideOf(doc.y, docBox);
  const sc = sideOf(card.y, panelBox);
  if (sd !== 0 && sd === sc) return null;
  const a = sd === 0 ? clampTo(doc, docBox) : { pt: stubEnd(docBox, sd), edge: true };
  const b = sc === 0 ? clampTo(card, panelBox) : { pt: insetEnd(card.x, panelBox, sc), edge: true };
  const edge = a.edge || b.edge;
  if (edge && !emphasized) return null;
  return { tid, d: connectorPath(a.pt, b.pt), doc: a.edge ? null : a.pt, card: b.edge ? null : b.pt, edge };
}

/** 範囲の上（-1）・下（1）の外へ出た対象：範囲の右端の近く、縁の内側 */
const stubEnd = (box: Box, side: Side): Pt => ({
  x: Math.max(box.left, box.right - STUB),
  y: side < 0 ? Math.min(box.top + EDGE_INSET, box.bottom) : Math.max(box.bottom - EDGE_INSET, box.top),
});

const insetEnd = (x: number, box: Box, side: Side): Pt => ({
  x,
  y: side < 0 ? Math.min(box.top + EDGE_INSET, box.bottom) : Math.max(box.bottom - EDGE_INSET, box.top),
});

/**
 * 2 点を結ぶ、なめらかな曲線（cubic bezier）：両端は、水平に出入りし、中ほどで縦へ移る（S 字）。
 * 本文の順の端点は、上から下へ単調なので、制御点の x を中点にそろえると、線が交わりにくい。
 */
export function connectorPath(a: Pt, b: Pt): string {
  const xm = r1((a.x + b.x) / 2);
  const [ax, ay, bx, by] = [r1(a.x), r1(a.y), r1(b.x), r1(b.y)];
  return `M${ax} ${ay}C${xm} ${ay} ${xm} ${by} ${bx} ${by}`;
}

/**
 * 線を描いてよい箱：本文（`#docscroll`）・右のパネル（`#threads`）・そのすきま。左の一覧・上のバーには、はみ出さない。
 * 縦は、2 つの重なり（どちらも、上のバーの下の、同じ段）。
 */
export function clipBox(doc: Box, panel: Box): Box {
  return {
    left: Math.min(doc.left, panel.left),
    right: Math.max(doc.right, panel.right),
    top: Math.max(doc.top, panel.top),
    bottom: Math.min(doc.bottom, panel.bottom),
  };
}

/** 2 つのフレームが、描くものとして同じか（同じなら、React の state を、入れ替えない） */
export function sameFrame(a: Frame | null, b: Frame): boolean {
  if (!a) return false;
  if (a.links.length !== b.links.length) return false;
  const [c, d] = [a.clip, b.clip];
  if (c.left !== d.left || c.top !== d.top || c.right !== d.right || c.bottom !== d.bottom) return false;
  for (let i = 0; i < a.links.length; i++) {
    const [x, y] = [a.links[i], b.links[i]];
    if (!x || !y || x.tid !== y.tid || x.d !== y.d || x.edge !== y.edge) return false;
    if (!samePt(x.doc, y.doc) || !samePt(x.card, y.card)) return false;
  }
  return true;
}

function samePt(a: Pt | null, b: Pt | null): boolean {
  return a === b || (!!a && !!b && a.x === b.x && a.y === b.y);
}
