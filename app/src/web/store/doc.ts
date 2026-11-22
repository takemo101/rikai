// DocModel：本文（命令的な島）を描いたあとの、「どこに何があるか」。
// **書くのは Article（W1）だけ**。パネル（W2）・番号の層と範囲の枠（W1 の overlay）・入口のバー（W3）は、読むだけ。
// 本文の DOM は、React が差分更新しない島なので、要素への参照は、ここ経由で受け渡す（古いものは、epoch で見分ける）。
import { create } from 'zustand';
import type { Rect } from '../../shared/types';

/** ブロックの要素：本文の直下の、HTML の要素と、インラインの `<svg>`（AI が書く図） */
export type BlockEl = HTMLElement | SVGElement;

/** 本文のブロック（`data-bid`・`data-bhash` を持つ要素）の、本文の順の一覧の 1 件 */
export interface BlockRef {
  /** `data-bid` */
  id: string;
  /** `data-bhash`（内容のハッシュ。`data-hash` ではない） */
  hash: string;
  /** 小文字のタグ名（`p`・`h2`・`pre`・`table` など） */
  tag: string;
  /** コメントの位置づけに使う本文の文字（`.diffbox`・Mermaid・html-app の中は除く） */
  text: string;
  el: BlockEl;
}

/** スレッドが、本文のどこを指しているか */
export type ThreadLoc =
  /** 文：`mark.hl[data-tid]`（複数の要素にまたがることがある） */
  | { kind: 'text'; marks: HTMLElement[] }
  /** ブロック：`.blk-thread[data-tid]` */
  | { kind: 'block'; el: BlockEl }
  /** 画像・図の中の範囲：基準の要素 `el`（ブロック）・比率の基準 `frame`（`frameOf`）・比率 `rect` */
  | { kind: 'region'; el: BlockEl; frame: Element; rect: Rect }
  /** 見つからない（修正で文が変わった） */
  | { kind: 'none' };

export type Approx = 'similar' | 'position';

/** 前の版との差分の件数（v2 以降で、「前の版からの変更を表示」が入っているときだけ） */
export interface DiffSummary {
  changed: number;
  added: number;
  removed: number;
}

export interface DocModel {
  /** 描くたびに増える（読む側が、古いものを見分ける）。`nextEpoch()` で付ける */
  epoch: number;
  /** どの版の本文か：`<slug>/<page>/<version>`（`View.key`）。別のページの件数を、見せないための印 */
  key: string;
  /** 本文の順 */
  blocks: BlockRef[];
  /** スレッド ID → 位置（このページ・版の、すべてのスレッド。キーは、本文の順とは限らない） */
  locs: Map<string, ThreadLoc>;
  /** スレッド ID → 番号（本文の順。1 から）。locs が `none` のスレッドは、入らない */
  nums: Map<string, number>;
  /** 近い内容・同じ位置のブロックに表示した（本文の文字が変わった）スレッド */
  approx: Map<string, Approx>;
  /** 入力中の対象（`composer.anchor`）を、本文で強調した要素（旧 `S.pendingEl`）。ないときは null */
  pending: HTMLElement | SVGElement | null;
  /** 差分の件数。差分を出していなければ null */
  diff: DiffSummary | null;
}

interface DocStore {
  /** 描いていない（トピックなし・読み込み中）間は null */
  model: DocModel | null;
  setModel: (model: DocModel | null) => void;
}

export const useDoc = create<DocStore>()((set) => ({
  model: null,
  setModel: (model) => set({ model }),
}));

let epoch = 0;
/** DocModel.epoch に付ける、単調に増える数 */
export const nextEpoch = (): number => ++epoch;

/** 本文の順で、スレッドを並べる比較（旧 docOrder）。位置のあるものが先・位置が同じ（または、どちらもない）なら、順を変えない */
export function docOrder(model: DocModel | null, a: string, b: string): number {
  const ea = model ? locEl(model.locs.get(a)) : null;
  const eb = model ? locEl(model.locs.get(b)) : null;
  if (ea && eb) return ea.compareDocumentPosition(eb) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  if (ea) return -1;
  if (eb) return 1;
  return 0;
}

/** 位置の、先頭の要素（文は最初の mark）。見つからなければ null */
export function locEl(loc: ThreadLoc | undefined): HTMLElement | SVGElement | null {
  if (!loc) return null;
  switch (loc.kind) {
    case 'text':
      return loc.marks[0] ?? null;
    case 'block':
    case 'region':
      return loc.el;
    default:
      return null;
  }
}
