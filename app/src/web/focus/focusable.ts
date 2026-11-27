// 個別表示（F43）の、キーボードの入口：本文の画像・図を、Tab で届く（フォーカスできる）要素にする。Enter・Space で開く（`Article.tsx` が受ける）。
// 入口のバーの「拡大」は、マウスを置いたときだけ出るので、キーボードでは届かなかった（F37 の持ち越し）。
// 印は、描き終えたあとに付ける（`renderDoc`）。Mermaid は、図を描き直す（外観の変更）と、SVG が置き換わるので、**ブロック（`.mermaid-block`）**に付ける。
// 付けるのは、属性だけ（`tabindex`・`role`・`aria-label`・`data-focus-entry`）。本文の文字・ブロックの内容（ハッシュ・位置づけ）は、変わらない。
import { DIAGRAM_SEL } from '../doc/render/blocks';
import { type ZoomEl, zoomableAt } from './zoomOpen';

/** 入口の印（フォーカスできる要素に付ける） */
export const FOCUS_ENTRY = 'data-focus-entry';

/** 入口の要素の、中の、個別表示できる画像・図・数式（画像そのもの・Mermaid のブロックの中の SVG・インラインの SVG・別行の数式の、式〔`.katex`〕）。なければ null */
export function mediaOfEntry(entry: Element, root: Element): ZoomEl | null {
  const inner = entry.matches('img, svg')
    ? entry
    : entry.matches('.math-block')
      ? entry.querySelector('.katex')
      : entry.querySelector('svg');
  return inner ? zoomableAt(inner, root) : null;
}

function makeEntry(entry: Element, label: string): void {
  entry.setAttribute(FOCUS_ENTRY, '');
  entry.setAttribute('tabindex', '0');
  entry.setAttribute('role', 'button');
  entry.setAttribute('aria-haspopup', 'dialog');
  entry.setAttribute('aria-label', label);
}

/** 本文（`art`）の、個別表示できる画像・図を、キーボードで開ける入口にする（同じ要素に、何度付けても同じ） */
export function markFocusEntries(art: HTMLElement): void {
  for (const m of art.querySelectorAll('img, svg')) {
    const el = zoomableAt(m, art);
    if (!el || el !== m) continue; // 入れ子の svg・リンクの中・枠の中は、外側の図・対象外
    const entry = el.closest(DIAGRAM_SEL) ?? el;
    if (!art.contains(entry) || entry.hasAttribute(FOCUS_ENTRY)) continue;
    makeEntry(entry, el instanceof HTMLImageElement ? `${el.alt || '画像'}を、拡大表示で開く` : '図を、拡大表示で開く');
  }
  // 別行の数式：ブロックそのものが入口（式の中の svg は、上の繰り返しで、数式として扱われるので、飛ばされる）
  for (const block of art.querySelectorAll('.math-block')) {
    if (!block.hasAttribute(FOCUS_ENTRY) && mediaOfEntry(block, art)) makeEntry(block, '数式を、拡大表示で開く');
  }
}
