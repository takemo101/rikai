// 本文のブロックと、コメントの位置づけに使う文字（旧 app.js の「ブロックと本文テキスト」）。本文の島（`#article`）と、断片（無害化した DocumentFragment）の、どちらにも使える。
// W3（選択・範囲）も、ここを import して使う：`frameOf`・`mediaOf`・`blockEls`・`blockText`・`blockLabel`・`blockAnchor`・`textIndex`・`boundaryOffset`・`elOf`。
import { EXCERPT } from '../../../shared/anchor';
import type { Anchor } from '../../../shared/types';
import { hash, trunc } from '../../lib/dom';
import { labelOf } from './fmt';

/** AI が書いた HTML の属性が、不正なことがある（読めないものは、そのまま返す） */
export function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * ブロックの一覧（本文の順）。ul・ol は、li をブロックにする。
 * 差分の箱（.diffbox）は、ブロックではない（コメントの位置づけ・ブロックの番号に入れない）
 */
export function blockEls(root: ParentNode): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const el of root.children) {
    if (!(el instanceof HTMLElement) || el.classList.contains('diffbox')) continue;
    if (el.tagName === 'UL' || el.tagName === 'OL') {
      for (const li of el.children)
        if (li instanceof HTMLElement && li.tagName === 'LI' && !li.classList.contains('diffbox')) out.push(li);
    } else out.push(el);
  }
  return out;
}

/**
 * ブロックの文字（位置づけ・版の差分に使う）。図は、ソース（URI エンコードのまま：ハッシュが、旧と同じになるように）。
 * **実行できる枠は、ソース**（置き場の見出しの文字は、番号で決まるので、使わない：枠を足す・消すと、コメントが別の枠に付く）
 */
export function blockText(el: HTMLElement): string {
  if (el.dataset.mermaid) return el.dataset.mermaid;
  if (el.classList.contains('htmlapp')) return `html-app ${safeDecode(el.dataset.src || '')}`;
  return (el.textContent || '').replace(/\s+/g, ' ').trim();
}

/** 範囲を選べる要素：ブロックの中の、画像（img）と図（svg。Mermaid・AI が書いたインラインの SVG）。最初の 1 つ */
export const mediaOf = (el: HTMLElement): HTMLElement | SVGElement | null =>
  el.matches('img, svg') ? el : el.querySelector<HTMLElement | SVGElement>('img, svg');

/**
 * 範囲の基準：ブロックの最初の画像・図。なければ、ブロックそのもの。**壊れた画像**（読み込みが終わって、大きさがない）だけは、ブロックを基準にする。
 * 読み込み前の画像（遅延読み込み）は、画像のまま（大きさがないあいだは、枠を出さない。読み込まれたら、合わせ直す）。
 * 範囲の枠を出すときも、同じ基準を使う（保存した比率は、この基準に対するもの）
 */
export function frameOf(el: HTMLElement): HTMLElement | SVGElement {
  const m = mediaOf(el);
  if (!m) return el;
  return m instanceof HTMLImageElement && m.complete && !m.naturalWidth ? el : m;
}

/** ブロックに、番号（`data-bid`）・内容のハッシュ（`data-bhash`。`data-hash` ではない）・`blk` クラスを付ける */
export function markBlocks(root: ParentNode): void {
  blockEls(root).forEach((el, i) => {
    el.dataset.bid = `b${i}`;
    el.dataset.bhash = hash(blockText(el));
    el.classList.add('blk');
  });
}

export interface TextIndex {
  /** 本文の文字（コメントの位置づけに使う） */
  text: string;
  nodes: { node: Text; start: number }[];
}

/** 本文の文字と、各テキストノードの開始位置。実行できる枠・図・差分の箱の、見出し・ソース・文字は、コメントの対象の文字にしない */
export function textIndex(root: Node): TextIndex {
  const nodes: TextIndex['nodes'] = [];
  let text = '';
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      const p = n.parentElement;
      if (!p || p.closest('.mermaid-block, .htmlapp, .diffbox, style, script')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    nodes.push({ node: n as Text, start: text.length });
    text += n.nodeValue ?? '';
  }
  return { text, nodes };
}

/** DOM の境界（ノード・オフセット）が、`TextIndex.text` の何文字目か */
export function boundaryOffset(idx: TextIndex, node: Node, off: number): number {
  if (node.nodeType === 3) {
    const e = idx.nodes.find((x) => x.node === node);
    if (e) return e.start + off;
  }
  const probe = document.createRange();
  probe.setStart(node, off);
  probe.collapse(true);
  for (const e of idx.nodes) {
    const r = document.createRange();
    r.setStart(e.node, 0);
    r.collapse(true);
    if (probe.compareBoundaryPoints(Range.START_TO_START, r) <= 0) return e.start;
  }
  return idx.text.length;
}

export const elOf = (n: Node): Element | null => (n.nodeType === 1 ? (n as Element) : n.parentElement);

/** ブロックの名前（カードの見出し・AI に届く label） */
export function blockLabel(el: HTMLElement): string {
  if (el.classList.contains('mermaid-block')) return '図';
  if (el.classList.contains('htmlapp')) return '実行できる枠';
  if (el.dataset.fmt) return labelOf(el.dataset.fmt);
  const img = el.querySelector('img');
  if (img) return `画像: ${img.alt || ''}`.trim();
  if (el.tagName === 'TABLE') return '表';
  if (el.tagName === 'PRE') return 'コード';
  return trunc(el.textContent, 40);
}

/** ブロックへのコメントの対象（アンカー） */
export function blockAnchor(el: HTMLElement): Anchor {
  return {
    blockId: el.dataset.bid || '',
    blockHash: el.dataset.bhash || '',
    blockTag: el.tagName,
    blockText: blockText(el).slice(0, EXCERPT),
    quote: '',
    prefix: '',
    suffix: '',
    label: blockLabel(el),
  };
}

/** 差分に使う、ブロックの文字（表は、セルを「 | 」で、行を改行でつなぐ。図は、ソース） */
export function plainText(el: HTMLElement): string {
  if (el.classList.contains('mermaid-block')) return safeDecode(el.dataset.mermaid || '');
  if (el.classList.contains('htmlapp')) return safeDecode(el.dataset.src || '');
  if (el instanceof HTMLTableElement)
    return [...el.rows].map((r) => [...r.cells].map((c) => (c.textContent ?? '').trim()).join(' | ')).join('\n');
  if (el.tagName === 'PRE') return (el.textContent || '').replace(/\n$/, '');
  if (el.dataset.fmt) return (el.textContent || '').replace(/\n+$/, ''); // 形式の各行・各項目は、改行で終わる（fmt）。行を、つなげない
  return (el.textContent || '').replace(/\s+/g, ' ').trim();
}
