// 数式の記法（GitHub と同じ 3 種類。GitHub のドキュメント「Writing mathematical expressions」に合わせる）。`marked` の拡張として、`markdown.ts` が使う。純粋な関数だけ（DOM に触れない）。
//   - 文中：`$x^2$`・`` $`x^2`$ ``（Markdown の記号と衝突するとき：バッククォートで囲む）。文中の `$$x$$` も、数式（文の一部）
//   - 別行：`$$` で始まる行から、`$$` で終わる行まで（`$$ x $$` を 1 行で書く形と、複数行の形）・```` ```math ````（`markdown.ts` の `code`）
// 判定は、GitHub の挙動（Pandoc の `tex_math_dollars` と同じ向き）に合わせる。**識別できないものは、数式にしない（ふつうの文字のまま）**：
//   - 開く `$` の直後は、空白でない／閉じる `$` の直前は、空白でなく、直後が、数字でない：「$5 と $10」「$5,$10」は、数式にならない（通貨）
//   - `\$` は、Markdown のエスケープ（数式の外では、ふつうの `$`。数式の中では、TeX の `\$`）
//   - コードスパン・コードブロックの中は、marked が先に取る（拡張は、そこに届かない）
//   - 最初に出会った閉じられない `$`（空白の直前・数字の直前）で、その位置からの数式は、あきらめる（`$20 と $30 と $x$` の、先頭から最後までを、1 つの数式にしない）
//   - 空の式・空白だけの式・空行をまたぐ式は、数式にしない。別行の `$$` は、閉じる行がなければ、数式にしない（段落のまま）
import type { Token, TokenizerAndRendererExtension, Tokens } from 'marked';
import { encSrc } from '../../lib/dom';

export interface InlineMath {
  /** Markdown の元の文字（`$` などの記号を含む。本文の文字として使う） */
  raw: string;
  /** TeX のソース（記号を除く） */
  tex: string;
}

const isSpace = (c: string | undefined): boolean => c !== undefined && /\s/.test(c);
const DIGIT = /^\d$/;
const hasBlankLine = (s: string): boolean => /\n[ \t]*\n/.test(s);

/** `i`（バッククォートの列の先頭）から始まるコードスパンの、終わりの次の位置。閉じる列（同じ長さのバッククォートの列）がなければ、列の次（バッククォートは、ふつうの文字） */
function codeSpanEnd(src: string, i: number): number {
  let n = 0;
  while (src[i + n] === '`') n++;
  for (let j = src.indexOf('`', i + n); j >= 0; ) {
    let m = 0;
    while (src[j + m] === '`') m++;
    if (m === n) return j + m;
    j = src.indexOf('`', j + m);
  }
  return i + n;
}

/**
 * `from` 以降で、最初の、エスケープされていない `needle` の位置。なければ -1。`\` の次の 1 文字は、読み飛ばす。
 * **コードスパン（`` `…` ``）の中は、読み飛ばす**：`$10 です。コード `$x$`` の、コードの中の `$` で、数式を閉じない（marked は、コードスパンを先に取る：GitHub・Pandoc と同じ）
 */
function findUnescaped(src: string, needle: string, from: number): number {
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (c === '\\') i++;
    else if (c === '`') i = codeSpanEnd(src, i) - 1;
    else if (c === needle[0] && src.startsWith(needle, i)) return i;
  }
  return -1;
}

/** `src` の先頭（`$`）から、文中の数式を読む。数式でなければ null */
export function matchInlineMath(src: string): InlineMath | null {
  if (src[0] !== '$') return null;
  // `$`…`$`：バッククォートで囲む（中の `$`・`\` は、そのまま TeX）
  if (src[1] === '`') {
    const end = src.indexOf('`$', 2);
    if (end < 0) return null;
    const tex = src.slice(2, end);
    if (!tex.trim() || hasBlankLine(tex)) return null;
    return { raw: src.slice(0, end + 2), tex };
  }
  // $$…$$（文の途中・行の途中）
  if (src[1] === '$') {
    const end = findUnescaped(src, '$$', 2);
    if (end < 0) return null;
    const tex = src.slice(2, end);
    if (!tex.trim() || hasBlankLine(tex)) return null;
    return { raw: src.slice(0, end + 2), tex };
  }
  // $…$
  if (src.length < 3 || isSpace(src[1])) return null;
  const end = findUnescaped(src, '$', 1);
  if (end < 0) return null;
  // 最初の `$` が、閉じる `$` として使えない（直前が空白・直後が数字）なら、この位置からの数式は、あきらめる
  if (isSpace(src[end - 1]) || DIGIT.test(src[end + 1] ?? '')) return null;
  const tex = src.slice(1, end);
  if (hasBlankLine(tex)) return null;
  return { raw: src.slice(0, end + 1), tex };
}

export interface BlockMath {
  /** 消費する文字（`$$` の行から、閉じる行の改行まで） */
  raw: string;
  tex: string;
}

/** 行の、後ろの空白（改行を除く）を除く */
const trimEnd = (s: string): string => s.replace(/[ \t\r]+$/, '');

/**
 * `src`（ブロックの先頭）から、別行の数式を読む：
 *   - 1 行：`$$ 式 $$`（式の中に `$$` を含まない。行の後ろは、空白だけ）
 *   - 複数行：`$$`（に、式が続いてもよい）の行から、`$$` で終わる行まで。**空行をまたがない**（TeX では、空行は、エラー）。閉じる行がなければ、数式にしない
 */
export function matchBlockMath(src: string): BlockMath | null {
  const open = /^ {0,3}\$\$/.exec(src);
  if (!open) return null;
  const nl = src.indexOf('\n');
  const firstEnd = nl < 0 ? src.length : nl;
  const first = trimEnd(src.slice(open[0].length, firstEnd));
  // 1 行：`$$ … $$`
  if (first.endsWith('$$') && first.length >= 2) {
    const tex = first.slice(0, -2);
    if (tex.trim() && findUnescaped(tex, '$$', 0) < 0) {
      return { raw: src.slice(0, nl < 0 ? src.length : nl + 1), tex };
    }
    return null;
  }
  // 複数行
  const parts: string[] = [first];
  let pos = nl < 0 ? src.length : nl + 1;
  while (pos < src.length) {
    const e = src.indexOf('\n', pos);
    const lineEnd = e < 0 ? src.length : e;
    const line = trimEnd(src.slice(pos, lineEnd));
    const next = e < 0 ? src.length : e + 1;
    if (!line.trim()) return null; // 空行をまたがない
    if (line.endsWith('$$')) {
      parts.push(line.slice(0, -2));
      const tex = parts.join('\n');
      if (!tex.trim()) return null;
      return { raw: src.slice(0, next), tex };
    }
    parts.push(line);
    pos = next;
  }
  return null;
}

const HTML_ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

/** 別行の数式の置き場（ソースは URI エンコードして、`data-math` に持つ：DOMPurify が、属性を落とさないように。図と同じ）。描くのは、`math.ts` の `fillMath` */
export const mathBlockHtml = (tex: string): string => `<div class="math-block" data-math="${encSrc(tex)}"></div>\n`;

/**
 * 文中の数式の置き場：**元の文字（`$…$`）を、本文の文字として持つ**（`.math-src`。描いたあとは、見えなくする。コメントの引用・ブロックの内容のハッシュ・差分・コピーが、元のソースで動く）。
 * 描いた結果は、`fillMath` が、`.math-out` に入れる
 */
export const mathInlineHtml = (m: InlineMath): string =>
  `<span class="math-inline" data-math="${encSrc(m.tex)}"><span class="math-src">${m.raw.replace(/[&<>"]/g, (c) => HTML_ESC[c] ?? c)}</span></span>`;

interface MathBlockToken extends Tokens.Generic {
  type: 'mathBlock';
  text: string;
}
interface MathInlineToken extends Tokens.Generic {
  type: 'mathInline';
  text: string;
}

/** この文書に、`$$` があるか：なければ、段落の割り込みの探索（`start`）は、何もしない（長い文書で、段落ごとに、残り全部を調べない）。`preprocess` で、そのつど決める */
let docHasDisplay = false;
export const noteSource = (md: string): string => {
  docHasDisplay = md.includes('$$');
  return md;
};

const blockExt: TokenizerAndRendererExtension = {
  name: 'mathBlock',
  level: 'block',
  // 段落の途中の行が `$$` で始まるとき、段落を、そこで切る（GitHub の例：`**題**\` の直後の行の `$$ … $$`）。数式として読めるときだけ
  start(src: string) {
    if (!docHasDisplay) return undefined;
    for (let i = src.indexOf('\n'); i >= 0; i = src.indexOf('\n', i + 1)) {
      if (/^ {0,3}\$\$/.test(src.slice(i + 1, i + 6)) && matchBlockMath(src.slice(i + 1))) return i;
    }
    return undefined;
  },
  tokenizer(src: string): MathBlockToken | undefined {
    const m = matchBlockMath(src);
    return m ? { type: 'mathBlock', raw: m.raw, text: m.tex } : undefined;
  },
  renderer(token: Tokens.Generic): string {
    return mathBlockHtml((token as MathBlockToken).text);
  },
};

const inlineExt: TokenizerAndRendererExtension = {
  name: 'mathInline',
  level: 'inline',
  start(src: string) {
    const i = src.indexOf('$');
    return i < 0 ? undefined : i;
  },
  tokenizer(src: string): MathInlineToken | undefined {
    const m = matchInlineMath(src);
    return m ? { type: 'mathInline', raw: m.raw, text: m.tex } : undefined;
  },
  renderer(token: Tokens.Generic): string {
    const t = token as MathInlineToken;
    return mathInlineHtml({ raw: t.raw, tex: t.text });
  },
};

export const mathExtensions: TokenizerAndRendererExtension[] = [blockExt, inlineExt];

/**
 * 段落の最後の行が `\` で終わり、すぐ後ろが別行の数式のとき、その `\` を除く（GitHub の例：`**題**\` の次の行に `$$ … $$`。
 * 段落を数式で切るので、行末の `\`（改行の指定）が、文字として残らないように）。入れ子（引用・リストの項目）も
 */
export function dropBackslashBeforeMath(tokens: Token[]): void {
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i] as Token;
    if (t.type === 'blockquote') dropBackslashBeforeMath((t as Tokens.Blockquote).tokens);
    else if (t.type === 'list') for (const item of (t as Tokens.List).items) dropBackslashBeforeMath(item.tokens);
    if (t.type !== 'paragraph' || tokens[i + 1]?.type !== 'mathBlock') continue;
    const p = t as Tokens.Paragraph;
    const last = p.tokens.at(-1) as (Tokens.Text & { text: string }) | undefined;
    if (last?.type === 'text' && (/\\+$/.exec(last.text)?.[0].length ?? 0) % 2 === 1) {
      last.text = last.text.slice(0, -1);
      last.raw = last.raw.slice(0, -1);
      p.text = p.text.slice(0, -1);
    }
  }
}
