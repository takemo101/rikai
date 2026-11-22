// コメントの位置づけと、本文の強調（旧 app.js の `applyHighlights`・`markPending`）。
// 文：`findQuote` → `mark.hl[data-tid]`。ブロック：`locateBlock` → `.blk-thread[data-tid]`。近似は `approx`。
// 番号の印は、本文の中に入れない（コメントの位置づけに使う本文の文字を、変えない。`overlay/`）。
import { findQuote, locateBlock } from '../../../shared/anchor';
import type { Anchor, Thread } from '../../../shared/types';
import { $$, h } from '../../lib/dom';
import { type Approx, type BlockEl, type BlockRef, type DocModel, docOrder, type ThreadLoc } from '../../store/doc';
import { blockEls, blockText, frameOf, textIndex } from './blocks';

const statusClass = (t: Pick<Thread, 'resolved'>): string => (t.resolved ? 'resolved' : 'live');

/** 本文の [start, end) の文字を、`mark.hl` で包む（テキストノードごとに 1 つ。複数のノードにまたがる）。最初の mark を返す */
function wrapRange(art: ParentNode, start: number, end: number, tid: string, cls: string): HTMLElement | null {
  const idx = textIndex(art);
  let first: HTMLElement | null = null;
  for (const e of idx.nodes) {
    const len = (e.node.nodeValue ?? '').length;
    const s = Math.max(start, e.start) - e.start;
    const en = Math.min(end, e.start + len) - e.start;
    if (en <= s) continue;
    const r = document.createRange();
    r.setStart(e.node, s);
    r.setEnd(e.node, en);
    const mark = h('mark', { class: `hl ${cls}`, 'data-tid': tid });
    r.surroundContents(mark);
    if (!first) first = mark;
  }
  return first;
}

export type DocLayout = Pick<DocModel, 'blocks' | 'locs' | 'nums' | 'approx'>;

const blockRefs = (blocks: BlockEl[]): BlockRef[] =>
  blocks.map((b) => ({
    id: b.dataset.bid ?? '',
    hash: b.dataset.bhash ?? '',
    tag: b.tagName.toLowerCase(),
    text: blockText(b),
    el: b,
  }));

/**
 * 各スレッドの位置を決め、強調を付け、本文の順に番号を付ける。
 * @param threads このページのスレッド
 * @param version 見ている版（これより新しい版で作ったスレッドは、位置なし）
 */
export function applyHighlights(art: HTMLElement, threads: readonly Thread[], version: number): DocLayout {
  const locs = new Map<string, ThreadLoc>();
  const approx = new Map<string, Approx>();
  const els = blockEls(art);
  const blocks = blockRefs(els);
  const infos = blocks.map((b) => ({ id: b.id, hash: b.hash, tag: b.el.tagName, text: b.text }));
  // 位置を決める（文は、強調を付ける。ブロックは、`.blk-thread`）。要素は、あとで、強調の mark を数えて決める
  const kinds = new Map<string, { block: BlockEl } | { text: true } | null>();
  for (const t of threads) {
    const a = t.anchor;
    if (t.version > version || !a) {
      kinds.set(t.id, null);
      continue;
    }
    if (a.quote) {
      const hit = findQuote(textIndex(art).text, a);
      if (hit && wrapRange(art, hit.start, hit.end, t.id, statusClass(t))) kinds.set(t.id, { text: true });
      else kinds.set(t.id, null);
    } else {
      // 内容が変わったブロックも、近い内容・同じ位置のブロックを、推定として探す（推定は、パネルに印を出す）
      const found = locateBlock(infos, a);
      const el = found ? els[found.index] : undefined;
      if (found && el) {
        el.classList.add('blk-thread', statusClass(t));
        el.dataset.tid = t.id;
        if (found.approx) approx.set(t.id, found.approx);
        kinds.set(t.id, { block: el });
      } else kinds.set(t.id, null);
    }
  }
  for (const t of threads) {
    const k = kinds.get(t.id);
    if (!k) locs.set(t.id, { kind: 'none' });
    else if ('text' in k) {
      const marks = $$<HTMLElement>('mark.hl[data-tid]', art).filter((m) => m.dataset.tid === t.id);
      locs.set(t.id, marks.length ? { kind: 'text', marks } : { kind: 'none' });
    } else if (t.anchor?.rect) {
      // `frame` は、作った時点の基準（画像の読み込みで変わるので、測るときは、`frameOf` を呼び直す）
      locs.set(t.id, { kind: 'region', el: k.block, frame: frameOf(k.block), rect: t.anchor.rect });
    } else locs.set(t.id, { kind: 'block', el: k.block });
  }
  // 本文の順に番号をつける（右のパネルの、同じ番号のカードと対応する）。位置のないものには、付けない
  const model = { locs } as DocModel; // 並べ替えに必要なのは、locs だけ
  const nums = new Map<string, number>();
  threads
    .filter((t) => locs.get(t.id)?.kind !== 'none')
    .sort((a, b) => docOrder(model, a.id, b.id))
    .forEach((t, i) => {
      nums.set(t.id, i + 1);
    });
  return { blocks, locs, nums, approx };
}

/** 入力中の対象の強調（オレンジ）を、外す */
export function clearPending(art: HTMLElement): void {
  for (const m of $$('mark.hl.pending', art)) m.replaceWith(...m.childNodes);
  for (const e of $$('.blk-pending', art)) e.classList.remove('blk-pending');
  art.normalize();
}

/**
 * 入力中のコメントの対象を、本文で強調する（まだ送っていない。オレンジ）。入力欄を開いている間だけ。
 * 強調した要素（文は、最初の mark・ブロックは、そのブロック）を返す。なければ null。
 * @param prevPending 前に強調していた要素（何もなければ、本文に触らない）
 */
export function markPending(art: HTMLElement, anchor: Anchor | null, prevPending: BlockEl | null): BlockEl | null {
  if (!anchor && !prevPending && !art.querySelector('mark.hl.pending, .blk-pending')) return null; // 何もなければ、本文に触らない
  clearPending(art);
  if (!anchor) return null;
  if (anchor.quote) {
    const hit = findQuote(textIndex(art).text, anchor);
    return hit ? wrapRange(art, hit.start, hit.end, 'pending', 'pending') : null;
  }
  const els = blockEls(art);
  const found = locateBlock(
    els.map((b) => ({ id: b.dataset.bid ?? '', hash: b.dataset.bhash ?? '', tag: b.tagName, text: blockText(b) })),
    anchor,
  );
  const el = found ? els[found.index] : undefined;
  if (!el) return null;
  if (!anchor.rect) el.classList.add('blk-pending'); // 範囲は、範囲の枠だけ（ブロックの枠を重ねない）
  return el;
}
