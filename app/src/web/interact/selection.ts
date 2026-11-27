// 文の選択 → コメントの対象（アンカー）。範囲の名前（`regionLabel`）。
// 本文の文字の数え方は、位置づけ（`doc/render/highlights.ts` の `applyHighlights`）と同じ：`textIndex` が、`.diffbox`・Mermaid・html-app の中の文字を除く。
import type { Anchor } from '../../shared/types';
import {
  blockAnchor,
  boundaryOffset,
  contentText,
  DIAGRAM_SEL,
  diagramLabel,
  elOf,
  isDiagram,
  textIndex,
} from '../doc/render/blocks';
import { trunc } from '../lib/dom';

/** 引用の長さの上限（これを超える選択は、先頭からここまで） */
export const QUOTE_MAX = 2000;
/** 引用の前後の文脈の長さ */
export const CONTEXT = 32;

/**
 * いまの選択から、アンカー（文：quote・prefix・suffix。Mermaid の図の中：その図のブロック）を作る。作れなければ null。
 * - 本文（`article`）の外・空の選択・空白だけの選択・差分の箱から選び始めた選択は、null
 * - 差分の文字から選び始めたときだけ断る。終わりが、変更したブロックの直後の箱に入っても（三回クリックなど）、始まりが本文なら、受け付ける
 */
export function anchorFromSelection(article: HTMLElement, sel: Selection | null): Anchor | null {
  if (!sel?.rangeCount || sel.isCollapsed) return null;
  const r = sel.getRangeAt(0);
  if (!article.contains(r.commonAncestorContainer)) return null;
  const a = elOf(r.startContainer);
  const b = elOf(r.endContainer);
  if (!a || !b) return null;
  if (a.closest('.diffbox')) return null;
  const mb = a.closest<HTMLElement>(DIAGRAM_SEL) ?? b.closest<HTMLElement>(DIAGRAM_SEL);
  if (mb) return blockAnchor(mb);
  const idx = textIndex(article);
  let s = boundaryOffset(idx, r.startContainer, r.startOffset);
  let e = boundaryOffset(idx, r.endContainer, r.endOffset);
  while (s < e && /\s/.test(idx.text.charAt(s))) s++;
  while (e > s && /\s/.test(idx.text.charAt(e - 1))) e--;
  if (e - s > QUOTE_MAX) e = s + QUOTE_MAX;
  if (e <= s) return null;
  const blk = a.closest<HTMLElement>('[data-bid]');
  return {
    blockId: blk?.dataset.bid ?? '',
    blockHash: blk?.dataset.bhash ?? '',
    // blockTag・blockText は、文の選択では持たない（探し直しは、quote と前後の文脈）
    blockTag: '',
    blockText: '',
    quote: idx.text.slice(s, e),
    prefix: idx.text.slice(Math.max(0, s - CONTEXT), s),
    suffix: idx.text.slice(e, e + CONTEXT),
    label: '',
  };
}

/** 範囲の名前（カードの見出し・AI に届く label）。画像の alt・図（Mermaid・draw.io）・数式・インラインの svg の文字 */
export function regionLabel(blk: Element, media: Element): string {
  if (media instanceof HTMLImageElement) return `画像${media.alt ? `: ${media.alt}` : ''}`;
  return isDiagram(blk) ? diagramLabel(blk) : trunc(contentText(blk), 40) || '図';
}
