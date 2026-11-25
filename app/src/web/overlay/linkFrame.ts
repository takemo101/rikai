// 関連の線（F35・F55）の、本文・拡大表示で共用する部品：端点の型・端点の寄せ（GAP）・カード側の端点・「測った端点から、1 フレームぶんの線を組み立てる」純粋な関数。
// 端点を**どう測るか**（本文＝強調・ブロック・範囲の枠／拡大表示＝ステージの範囲の枠）は、それぞれ（`Connectors.tsx`・`focus/FocusLinks.tsx`）。ここは、測った結果を受け取る。曲線の式は `connectorPath.ts`。
import { type Box, bottom, type Pt, right } from '../lib/geom';
import {
  BELOW,
  type DocEnd,
  type Frame,
  fanOutSameRow,
  type Link,
  linkBetween,
  rightMiddle,
  sharedLeadX,
} from './connectorPath';

/** 入力中の対象の印（`#badges` の `.regionbox.pending`・`.fv-box.pending` の `data-tid` と同じ） */
export const PENDING = 'pending';

export const visible = (r: DOMRect): boolean => r.width > 0 || r.height > 0;

/** 本文側の端点の、対象の箱からの距離（px）：版で変えたブロックの右端の緑の線（約 3px）・入力中の枠のハンドル（`.rh-e`。外へ 6px）に、点が重ならないように */
export const GAP = { block: 6, region: 4, pending: 10 } as const;

/** 本文側の端点（`p`）と、その行の下端（同じ行の線を、ずらすときの基準） */
export interface End {
  p: Pt;
  bottom: number;
  /** 下の行までのすきま（行間）。引き出し線を、同じ行でずらす幅の上限 */
  gap: number;
}

export const shiftX = (p: Pt, dx: number): Pt => ({ x: p.x + dx, y: p.y });
/** 中央を指す端点（ブロック・枠）は、引き出し線も、その高さ */
export const centered = (p: Pt): End => ({ p, bottom: p.y - BELOW, gap: 8 });

/** 箱（ブロック・範囲の枠）の、右端の縦の中央の、`dx` 外 */
export const sideEnd = (b: Box, dx: number): End => centered(shiftX(rightMiddle(b), dx));

/** カード側の端点：見出しの番号の丸の高さの、カードの左端（丸がなければ、見出し・カードの上） */
export function cardPoint(card: HTMLElement, r: DOMRect): Pt {
  const mark = card.querySelector('.no') ?? card.querySelector('.th-head');
  const m = mark?.getBoundingClientRect();
  return { x: r.left, y: m && visible(m) ? (m.top + m.bottom) / 2 : r.top + Math.min(18, r.height / 2) };
}

/** カードごとの、測った端点 */
export interface Row {
  tid: string;
  isComposer: boolean;
  end: End;
  card: Pt;
}

/** 2 つの箱を、ともに含む最小の箱 */
export function unionBox(a: Box, b: Box): Box {
  const left = Math.min(a.left, b.left);
  const top = Math.min(a.top, b.top);
  return { left, top, width: Math.max(right(a), right(b)) - left, height: Math.max(bottom(a), bottom(b)) - top };
}

/**
 * 測った端点（`rows`）から、1 フレームぶんの線を組み立てる。
 * - `docBox`・`panelBox`：両端が、見える範囲（本文・パネル／ステージ・ドック）。`clip`：線を切り取る箱。
 * - `anchorRight`：引き出し線の右端の基準（`sharedLeadX`）：本文は記事の右端・拡大表示はステージの右端。
 * - 選んでいる（`sel.active`）・光らせている（`sel.linked`）・入力中の線だけ、縁へ寄せて引く（それ以外は、端が範囲の外なら、引かない）。
 * 実際に引く線（本文側の端が、見える範囲の中）だけで、始点・引き出しを決める：引かれない線に、場所を取らない。
 */
export function composeFrame(
  rows: readonly Row[],
  clip: Box,
  docBox: Box,
  panelBox: Box,
  sel: { active: string | null; linked: string | null },
  anchorRight: number,
): Frame {
  const emphasizedOf = (r: Row): boolean => r.isComposer || r.tid === sel.active || r.tid === sel.linked; // 縁へ寄せた線は、これだけ引く
  const drawn = rows.filter((r) => linkBetween(r.tid, r.end.p, r.card, docBox, panelBox, emphasizedOf(r))?.doc);
  const starts = fanOutSameRow(
    drawn.map((e): DocEnd => ({ tid: e.tid, p: e.end.p, bottom: e.end.bottom, gap: e.end.gap, cardY: e.card.y })),
  );
  // すべての線が、共通の x まで水平に引き出して、同じ x の範囲で、S 字に入る（始点の順＝カードの順なら、交差しない）
  const first = drawn[0];
  const leadX = first ? sharedLeadX(Math.max(...drawn.map((e) => e.end.p.x)), anchorRight, first.card.x) : null;
  const links: Link[] = [];
  for (const r of rows) {
    const start = starts.get(r.tid);
    const link = linkBetween(
      r.tid,
      start?.from ?? start ?? r.end.p,
      r.card,
      docBox,
      panelBox,
      emphasizedOf(r),
      start && leadX !== null ? leadX : undefined,
      start?.from ? start : undefined,
    );
    if (link) links.push(link);
  }
  return { clip, leadX: links.some((l) => l.lead) ? leadX : null, links };
}
