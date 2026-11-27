// 本文のブロックと、コメントの位置づけに使う文字。本文の島（`#article`）と、断片（無害化した DocumentFragment）の、どちらにも使える。
// `interact/`（選択・範囲）も、ここを import して使う：`frameOf`・`mediaOf`・`blockEls`・`blockText`・`blockLabel`・`blockAnchor`・`textIndex`・`boundaryOffset`・`elOf`。
import { EXCERPT } from '../../../shared/anchor';
import type { Anchor } from '../../../shared/types';
import { hash, trunc } from '../../lib/dom';
import type { BlockEl } from '../../store/doc';
import { ALERT_TITLES, type AlertType, blockMark } from './callouts';
import { labelOf } from './fmt';

/** AI が書いた HTML の属性が、不正なことがある（読めないものは、そのまま返す） */
export function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export type { BlockEl };

/**
 * 図のブロック（Mermaid・draw.io・数式）の選択子。図の扱い（ラベル・差分・文字の数え方・範囲・拡大表示の入口）は、どれも同じ。
 * 数式（`.math-block`：`$$…$$`・```math。F57）は、ラベルが「数式」。ソースは、`data-math`
 */
export const DIAGRAM_SEL = '.mermaid-block, .drawio-block, .math-block';

/** 図のブロックか（Mermaid・draw.io・数式） */
export const isDiagram = (el: Element): boolean => el.matches(DIAGRAM_SEL);

/** 図のブロックの名前（カードの見出し・AI に届く label・範囲の名前）：数式は「数式」・ほかは「図」 */
export const diagramLabel = (el: Element): string => (el.matches('.math-block') ? '数式' : '図');

/** 図のソース（URI エンコードのまま：ハッシュが、保存済みのものと合うように）。図でなければ undefined */
const diagramSource = (el: BlockEl): string | undefined =>
  el.dataset.mermaid ?? el.dataset.drawio ?? (el.classList.contains('math-block') ? el.dataset.math : undefined);

/**
 * 要素の文字（`textContent`）。**描いた数式（`.math-out`：KaTeX が出す HTML・MathML の文字）は、除く**：文中の数式は、元の文字（`.math-src`：`$x^2$`）が、本文の文字（描く前と後で、同じ。ハッシュ・差分・引用が、描画の前後でずれない）。
 * 入れ子の別行の数式（リストの項目の中など）は、ソースを、文字にする
 */
export function contentText(el: Element): string {
  if (!el.querySelector('.math-out, .math-block')) return el.textContent || '';
  let out = '';
  const walk = (n: Node): void => {
    for (const c of n.childNodes) {
      if (c.nodeType === 3) out += c.nodeValue ?? '';
      else if (c instanceof HTMLElement) {
        if (c.classList.contains('math-out')) continue;
        if (c.classList.contains('math-block')) out += ` ${safeDecode(c.dataset.math ?? '')} `;
        else walk(c);
      }
    }
  };
  walk(el);
  return out;
}

const isBlockEl = (el: Element): el is BlockEl => el instanceof HTMLElement || el instanceof SVGElement;

/**
 * ブロックの一覧（本文の順）。ul・ol は、li をブロックにする。
 * 差分の箱（.diffbox）は、ブロックではない（コメントの位置づけ・ブロックの番号に入れない）
 */
export function blockEls(root: ParentNode): BlockEl[] {
  const out: BlockEl[] = [];
  for (const el of root.children) {
    if (!isBlockEl(el) || el.classList.contains('diffbox')) continue;
    if (el.tagName === 'UL' || el.tagName === 'OL') {
      for (const li of el.children)
        if (li instanceof HTMLElement && li.tagName === 'LI' && !li.classList.contains('diffbox')) out.push(li);
    } else out.push(el);
  }
  return out;
}

/**
 * ブロックの文字（位置づけ・版の差分に使う）。図は、ソース（URI エンコードのまま：ハッシュが、保存済みのものと合うように）。
 * **実行できる枠は、ソース**（置き場の見出しの文字は、番号で決まるので、使わない：枠を足す・消すと、コメントが別の枠に付く）
 */
export function blockText(el: BlockEl): string {
  const src = diagramSource(el);
  if (src) return src;
  if (el.classList.contains('htmlapp')) return `html-app ${safeDecode(el.dataset.src || '')}`;
  return contentText(el).replace(/\s+/g, ' ').trim();
}

/**
 * 範囲を選べる要素：ブロックの中の、画像（img）と図（svg。Mermaid・AI が書いたインラインの SVG）。最初の 1 つ。数式のブロックは、描いた数式（`.katex`。HTML）。
 * **描いた数式の中の svg（根号など）は、図ではない**（文中の数式を持つ段落を、図のあるブロックにしない）。
 * **html-app の枠のブロックには、ない**（null）：見出しのツールバーの、アイコンの svg（15px）を、拾わない（範囲の基準が、アイコンになる不具合だった：F43 で直した）
 */
export function mediaOf(el: BlockEl): BlockEl | null {
  if (el.classList.contains('htmlapp')) return null;
  if (el.classList.contains('math-block')) return el.querySelector<BlockEl>('.math-out .katex');
  if (el.matches('img, svg')) return el;
  for (const m of el.querySelectorAll<BlockEl>('img, svg')) if (!m.closest('.math-out')) return m;
  return null;
}

/**
 * 範囲の基準：ブロックの最初の画像・図。なければ、ブロックそのもの。**壊れた画像**（読み込みが終わって、大きさがない）だけは、ブロックを基準にする。
 * 読み込み前の画像（遅延読み込み）は、画像のまま（大きさがないあいだは、枠を出さない。読み込まれたら、合わせ直す）。
 * **html-app の枠のブロックは、枠の置き場（`.appview`：F40 の、本文の幅の箱。縮小表示・横スクロールの、外側）**：見出し・ソースの欄を含まない、枠の見た目の領域。
 * （0.24.0 より前は、見出しのツールバーの、最初のアイコンだった。その基準で保存された範囲は、新しい基準では、ずれる：`.rikai/` は、書き換えない）
 * 範囲の枠を出すときも、同じ基準を使う（保存した比率は、この基準に対するもの）
 */
export function frameOf(el: BlockEl): BlockEl {
  if (el.classList.contains('htmlapp')) return el.querySelector<HTMLElement>(':scope > .appview') ?? el;
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
      if (!p || p.closest(`${DIAGRAM_SEL}, .math-out, .htmlapp, .diffbox, style, script`))
        return NodeFilter.FILTER_REJECT;
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
export function blockLabel(el: BlockEl): string {
  if (isDiagram(el)) return diagramLabel(el);
  if (el.classList.contains('htmlapp')) return '実行できる枠';
  if (el.dataset.fmt) return labelOf(el.dataset.fmt);
  const img = el instanceof HTMLImageElement ? el : el.querySelector('img'); // ブロックそのものが `<img>` のこともある
  const alert = el.dataset.alert as AlertType | undefined;
  if (alert && alert in ALERT_TITLES) return `${ALERT_TITLES[alert]}: ${trunc(el.textContent, 40)}`; // 題は、表示だけの飾り（文字に入れない）。カードの見出しには、種類を出す
  if (img) return `画像: ${img.alt || ''}`.trim();
  if (el.tagName === 'TABLE') return '表';
  if (el.tagName === 'PRE') return 'コード';
  return trunc(contentText(el), 40);
}

/** ブロックへのコメントの対象（アンカー） */
export function blockAnchor(el: BlockEl): Anchor {
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

/**
 * 版どうしの対応づけに使う、ブロックの種類（`BlockSig.tag`）。リストの項目は、並びの種類（ul・ol）も含める：箇条書き ⇄ 番号つきの並びも、「種類が変わった」変更になる。
 * アラート（種類）・タスクの項目（チェックの状態）は、`|` のあとに印を足す：文字が同じでも、種類・チェックが変わったら、「変更」になる（ハッシュ・`blockText` には、入れない：callouts.ts）。
 * 項目を、並びから取り出す前に、呼ぶ（親の並びを見る）
 */
export const sigTag = (el: BlockEl): string => {
  const base = el.tagName === 'LI' && el.parentElement ? `LI>${el.parentElement.tagName}` : el.tagName;
  const mark = blockMark(el);
  return mark ? `${base}|${mark}` : base;
};

/** `sigTag` の、人に見せる名前（差分の説明用） */
export function tagLabel(tag: string): string {
  const [base = '', mark = ''] = tag.split('|');
  if (mark in ALERT_TITLES) return `注意書き（${ALERT_TITLES[mark as AlertType]}）`;
  const name = base === 'LI>UL' ? '箇条書き' : base === 'LI>OL' ? '番号つきの並び' : base.toLowerCase();
  return mark ? `${name}・チェック ${mark}` : name;
}

/** 差分に使う、ブロックの文字（表は、セルを「 | 」で、行を改行でつなぐ。図は、ソース） */
export function plainText(el: BlockEl): string {
  if (isDiagram(el)) return safeDecode(diagramSource(el) || '');
  if (el.classList.contains('htmlapp')) return safeDecode(el.dataset.src || '');
  if (el instanceof HTMLTableElement)
    return [...el.rows].map((r) => [...r.cells].map((c) => contentText(c).trim()).join(' | ')).join('\n');
  if (el.tagName === 'PRE') return (el.textContent || '').replace(/\n$/, '');
  if (el.dataset.fmt) return (el.textContent || '').replace(/\n+$/, ''); // 形式の各行・各項目は、改行で終わる（fmt）。行を、つなげない
  return contentText(el).replace(/\s+/g, ' ').trim();
}
