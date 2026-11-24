// 小道具：命令的な DOM（本文の島・番号の層）を作る道具（`$`・`$$`・`h`・`trunc`・`hash`・`encSrc`）。
// React の部品は、これを使わない（JSX で書く）。本文の島（`doc/`・`overlay/`・`interact/`）だけが使う。

export const $ = <T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T | null =>
  root.querySelector<T>(selector);
export const $$ = <T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T[] => [
  ...root.querySelectorAll<T>(selector),
];

export type AttrValue = string | number | boolean | null | undefined | ((e: Event) => void);
/** `class`：className・`text`：textContent・`value`：プロパティ・`on…`：イベント（`onclick` など）・`true`：空の属性・null/false：付けない */
export type Attrs = Record<string, AttrValue>;
export type Kid = Node | string | number | false | null | undefined | readonly Kid[];

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Attrs | null,
  ...kids: Kid[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k === 'text') el.textContent = String(v);
    else if (k === 'value') {
      if ('value' in el) el.value = String(v);
    } else if (typeof v === 'function') el.addEventListener(k.replace(/^on/, ''), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  const add = (kid: Kid): void => {
    if (kid == null || kid === false) return;
    if (Array.isArray(kid)) {
      for (const k of kid as readonly Kid[]) add(k);
    } else el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  };
  for (const kid of kids) add(kid);
  return el;
}

/** DOMPurify は、属性値に `-->` や `</style` を含むと、属性ごと消すので、図のソースは、URI エンコードして持つ */
export const encSrc = (s: string): string => encodeURIComponent(String(s));

/**
 * 空白をつぶして、n 文字（…を含む）に切り詰める。文字は、コードポイント単位（絵文字などのサロゲートペアを、半分に割らない）。
 * 見えない文字は、取り除く（通知・タイトルで、表示の向きを乱されない・見えない文を、読ませない）：制御文字（Cc）・書式の文字（Cf：ゼロ幅・方向の制御・タグ文字・BOM）・
 * Default_Ignorable_Code_Point（異体字セレクタ・結合書記素結合子・ハングルの空白に見える字など）・点字の空白（U+2800）。ただし、絵文字を作る U+200D（ZWJ）と U+FE0F（絵文字の表示形式）は、残す（除くと、絵文字が割れる）
 */
export function trunc(s: unknown, n: number): string {
  const chars = [
    ...String(s ?? '')
      .replace(/\s+/g, ' ')
      .replace(/(?![\u200d\ufe0f])[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}\u2800]/gu, '')
      .trim(),
  ];
  return chars.length > n ? `${chars.slice(0, n - 1).join('')}…` : chars.join('');
}

/** 文字列の短いハッシュ（djb2。ブロックの内容の目印） */
export function hash(s: string): string {
  let x = 5381;
  for (let i = 0; i < s.length; i++) x = ((x << 5) + x + s.charCodeAt(i)) | 0;
  return (x >>> 0).toString(36);
}
