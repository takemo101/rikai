// 本文の拡張書式：アラート（注意書き）とタスクリスト。どちらも GitHub の記法で、**表示だけ**（チェックしても、何も保存しない・変えない）。
//
// ## アラート（`> [!NOTE]`・`[!TIP]`・`[!IMPORTANT]`・`[!WARNING]`・`[!CAUTION]`）
// - 認識するのは、**本文の最上位の引用**で、**最初の行が、マーカーだけ**のもの（大文字・小文字は問わない。GitHub と同じ）。
//   マーカーの行に、ほかの文字があるもの（`> [!NOTE] 本文`）・リストや引用の中に入れたもの・種類が違うものは、ふつうの引用のまま。
// - 認識した引用には、`data-alert="note"` を付け、**マーカーの行を、DOM から外す**（題・アイコンは、CSS の疑似要素で描く：app.css）。
//   題は、**表示だけの飾り**：`textContent` に入らないので、コメントの引用・`blockText`・`blockHash`・`textIndex` に入らない（`.htmlapp` の `.cap` と同じ考え方）。
// - 無害化の**あとで**付ける（資料の生の HTML が持つ `data-alert` は、ここで消す：偽の印を、見せない）。
//
// ## タスクリスト（`- [ ] 項目`・`- [x] 項目`）
// - marked は、`<input type=checkbox disabled>` を出すが、`input` は `PURIFY` が落とす（緩めない：N3）。そこで、marked の `checkbox` の出力を、**`input` でない印**（`span.task-box`。
//   `role=checkbox`・`aria-checked`・`aria-disabled`・`aria-label`）に置き換える。**フォームの部品は、作らない**（送信・操作の入口にならない）。
// - 印を持つ項目（`li`）に、`task-item`（完了は `task-done` も）を付ける。項目の先頭にない印は、消す。
import type { RendererObject } from 'marked';

/** アラートの種類 → 題（日本語）。表示は app.css（`blockquote[data-alert]`）。ここは、差分の説明・カードの見出しに使う */
export const ALERT_TITLES = {
  note: 'メモ',
  tip: 'ヒント',
  important: '重要',
  warning: '警告',
  caution: '注意',
} as const;
export type AlertType = keyof typeof ALERT_TITLES;

/** `[!NOTE]`（大文字・小文字は問わない）＋ 行末（空白は許す）。改行、または、テキストの終わりまで */
const MARKER = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*(?:\r?\n|$)/i;

/** marked の `checkbox`：`input` でなく、読み上げできる印にする（`input` は、無害化が落とす） */
export const taskRenderer: RendererObject = {
  checkbox({ checked }) {
    return `<span class="task-box" role="checkbox" aria-checked="${checked}" aria-disabled="true" aria-label="${checked ? '完了' : '未完了'}"></span> `;
  },
};

/** 引用の最初の行が、マーカーだけなら、その種類（そして、マーカーの行を外す）。そうでなければ null */
function takeMarker(bq: Element): AlertType | null {
  const p = bq.firstElementChild;
  const text = p?.firstChild;
  if (p?.tagName !== 'P' || text?.nodeType !== 3) return null;
  const m = MARKER.exec(text.nodeValue ?? '');
  if (!m) return null;
  const next = text.nextSibling;
  // マーカーのあとに、同じ行で続く文字（`[!NOTE] *強調*`）は、認識しない。続いてよいのは、改行（`<br>` は、行末の空白 2 つ・`\`）だけ
  const end = m[0].endsWith('\n') ? true : next === null || next.nodeName === 'BR';
  if (!end) return null;
  const rest = (text.nodeValue ?? '').slice(m[0].length);
  if (next?.nodeName === 'BR' && !rest) next.remove();
  if (rest) text.nodeValue = rest;
  else text.remove();
  if (!p.firstChild) p.remove();
  return (m[1] as string).toLowerCase() as AlertType;
}

/** 無害化したあとの断片に、アラート・タスクの印を付ける（`mdToFragment` が呼ぶ） */
export function decorateCallouts(root: ParentNode): void {
  for (const el of root.querySelectorAll('[data-alert]')) el.removeAttribute('data-alert');
  for (const el of root.children) {
    if (el.tagName !== 'BLOCKQUOTE') continue;
    const type = takeMarker(el);
    if (!type) continue;
    el.setAttribute('data-alert', type);
    el.setAttribute('role', 'note');
    el.setAttribute('aria-label', ALERT_TITLES[type]);
  }
  for (const box of root.querySelectorAll('.task-box')) {
    const parent = box.parentElement; // 段落が続く項目は、`<li><p><span>…`
    const item = parent?.tagName === 'P' ? parent.parentElement : parent;
    const lead =
      parent &&
      item?.tagName === 'LI' &&
      parent.firstChild === box &&
      (parent === item || item.firstElementChild === parent);
    if (!item || !lead) {
      box.remove();
      continue;
    }
    item.classList.add('task-item');
    if (box.getAttribute('aria-checked') === 'true') item.classList.add('task-done');
  }
}

/**
 * ブロックの印（版の差分で、文字が同じでも「変更」と分かるように、`sigTag` に足す。**ハッシュ・`blockText` には入れない**：以前の版で保存したコメントの位置づけを、変えない）。
 * アラートは、種類（`note`…）。項目（`li`）は、中にあるチェックの状態を、順に（`☐`・`☑`。入れ子も）。なければ ''
 */
export function blockMark(el: Element): string {
  const alert = el.getAttribute('data-alert');
  if (alert && alert in ALERT_TITLES) return alert;
  if (el.tagName !== 'LI') return '';
  let s = '';
  for (const b of el.querySelectorAll('.task-box')) s += b.getAttribute('aria-checked') === 'true' ? '☑' : '☐';
  return s;
}
