// 個別表示（F43）の、キーボードの入口：本文の画像・図を、Tab で届く（フォーカスできる）要素にする。Enter・Space で開く（`Article.tsx` が受ける）。
// 入口のバーの「拡大」は、マウスを置いたときだけ出るので、キーボードでは届かなかった（F37 の持ち越し）。
// 印は、描き終えたあとに付ける（`renderDoc`）。Mermaid は、図を描き直す（外観の変更）と、SVG が置き換わるので、**ブロック（`.mermaid-block`）**に付ける。
// 付けるのは、属性だけ（`tabindex`・`role`・`aria-label`・`data-focus-entry`）。本文の文字・ブロックの内容（ハッシュ・位置づけ）は、変わらない。
import { zoomableAt } from './zoomOpen';

/** 入口の印（フォーカスできる要素に付ける） */
export const FOCUS_ENTRY = 'data-focus-entry';

/** 入口の要素の、中の、個別表示できる画像・図（画像そのもの・Mermaid のブロックの中の SVG・インラインの SVG）。なければ null */
export function mediaOfEntry(entry: Element, root: Element): HTMLImageElement | SVGSVGElement | null {
  const inner = entry.matches('img, svg') ? entry : entry.querySelector('svg');
  return inner ? zoomableAt(inner, root) : null;
}

/** 本文（`art`）の、個別表示できる画像・図を、キーボードで開ける入口にする（同じ要素に、何度付けても同じ） */
export function markFocusEntries(art: HTMLElement): void {
  for (const m of art.querySelectorAll('img, svg')) {
    const el = zoomableAt(m, art);
    if (!el || el !== m) continue; // 入れ子の svg・リンクの中・枠の中は、外側の図・対象外
    const entry = el.closest('.mermaid-block') ?? el;
    if (!art.contains(entry) || entry.hasAttribute(FOCUS_ENTRY)) continue;
    entry.setAttribute(FOCUS_ENTRY, '');
    entry.setAttribute('tabindex', '0');
    entry.setAttribute('role', 'button');
    entry.setAttribute('aria-haspopup', 'dialog');
    entry.setAttribute(
      'aria-label',
      el instanceof HTMLImageElement ? `${el.alt || '画像'}を、拡大表示で開く` : '図を、拡大表示で開く',
    );
  }
}
