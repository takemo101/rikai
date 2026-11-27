// 数式（KaTeX）の描画。KaTeX は、動的 import（別の chunk。数式のない資料では、読まない。Mermaid と同じ方式）。CSS（`katex.min.css`）とフォント（woff2 だけ）は、同梱して、数式のある資料でだけ読む（vite.config.ts）。
// 置き場は、`mathSyntax.ts` が出す：`div.math-block[data-math]`（別行）・`span.math-inline[data-math] > span.math-src`（文中。元の文字を持つ）。ソースは、`data-math` に、URI エンコードして持つ。
//
// ## 安全（N1・N3）
//   - `trust: false`（`\href`・`\url`・`\includegraphics`・`\htmlClass`・`\htmlId`・`\htmlStyle`・`\htmlData` は、無効＝失敗）・`strict: 'ignore'`・`maxSize`・`maxExpand`（再帰するマクロの爆発を止める）・ソースの長さの上限・出力の大きさの上限
//   - **出力は、必ず DOMPurify を通す**（本文の `PURIFY` とは別の、数式の専用の設定：KaTeX が出す HTML・MathML・SVG に要る、タグ・属性だけを許す〔許可リスト〕。`style` 属性は、KaTeX の組版に必要なので許すが、プロパティ・値を、検査する〔`isSafeStyle`〕。
//     リンク・画像・`foreignObject`・イベントハンドラは、許さない）。`innerHTML` に、文字を入れない（無害化した DocumentFragment を、そのまま付ける）
//   - 描けなかった（構文の誤り・上限）ときは、Mermaid の失敗と同じ見た目で、理由と元の TeX を、文字で出す
import DOMPurify, { type Config, type DOMPurify as Purifier } from 'dompurify';
import type KatexApi from 'katex';
import { $$, h } from '../../lib/dom';

type Katex = typeof KatexApi;

/** ソースの長さの上限（文字）。超えたら、描かずに、失敗として出す */
export const MATH_MAX_SOURCE = 20_000;
/** KaTeX の出力（HTML）の大きさの上限（文字）。超えたら、失敗として出す（無害化・DOM への追加で、止まらないように） */
export const MATH_MAX_OUTPUT = 1_500_000;
/** マクロの展開の上限（KaTeX の既定と同じ。再帰するマクロで、止まらないように） */
const MAX_EXPAND = 1000;
/** ユーザーが指定する大きさ（`\rule`・`\kern` など）の上限（em） */
const MAX_SIZE = 50;

let loading: Promise<Katex> | null = null;
function loadKatex(): Promise<Katex> {
  // CSS・フォントは、数式があるときだけ（この chunk の CSS。vite が、`<link>` で読む）。読み込みに失敗したら、次の描画で、もう一度試す
  loading ??= Promise.all([import('katex'), import('katex/dist/katex.min.css')]).then(([m]) => m.default);
  loading.catch(() => {
    loading = null;
  });
  return loading;
}

// ---- 無害化（許可リスト）。KaTeX が出すもの：span（class・style・aria-hidden）・svg・path・line（根号・括弧・矢印・取り消し線）・math と、MathML の要素 ----
const TAGS = [
  '#text',
  'span',
  'svg',
  'path',
  'line',
  'g',
  'math',
  'semantics',
  'annotation',
  'mrow',
  'mi',
  'mn',
  'mo',
  'ms',
  'mtext',
  'mspace',
  'mfrac',
  'msqrt',
  'mroot',
  'msub',
  'msup',
  'msubsup',
  'munder',
  'mover',
  'munderover',
  'mmultiscripts',
  'mtable',
  'mtr',
  'mtd',
  'mstyle',
  'mpadded',
  'mphantom',
  'menclose',
];
const ATTRS = [
  'class',
  'style',
  'aria-hidden',
  // svg
  'xmlns',
  'width',
  'height',
  'viewBox',
  'preserveAspectRatio',
  'd',
  'x1',
  'y1',
  'x2',
  'y2',
  'stroke',
  'stroke-width',
  'fill',
  // MathML
  'display',
  'displaystyle',
  'scriptlevel',
  'mathvariant',
  'mathsize',
  'mathcolor',
  'mathbackground',
  'encoding',
  'accent',
  'accentunder',
  'columnalign',
  'columnlines',
  'columnspacing',
  'rowalign',
  'rowlines',
  'rowspacing',
  'fence',
  'separator',
  'stretchy',
  'symmetric',
  'movablelimits',
  'largeop',
  'lspace',
  'rspace',
  'minsize',
  'maxsize',
  'linethickness',
  'notation',
  'voffset',
  'depth',
];

/** 数式の無害化の設定：許可リストだけ（リンク・画像・フォーム・foreignObject・イベントハンドラは、タグにも属性にも、ない）。`style` 属性は、`isSafeStyle` を通ったものだけ */
export const MATH_PURIFY: Config = {
  ALLOWED_TAGS: TAGS,
  ALLOWED_ATTR: ATTRS,
  ALLOW_DATA_ATTR: false,
  ALLOW_ARIA_ATTR: false,
  KEEP_CONTENT: false,
  RETURN_DOM_FRAGMENT: true,
};

/** KaTeX が、`style` 属性に入れるプロパティ（KaTeX の `CssStyle`〔domTree.ts〕の全部：組版の寸法・色・罫線・`\pmb` の影・`\int` などの `position: relative`） */
const STYLE_PROPS: Record<string, true> = {
  'background-color': true,
  'border-bottom-width': true,
  'border-color': true,
  'border-right-style': true,
  'border-right-width': true,
  'border-top-width': true,
  'border-style': true,
  'border-width': true,
  bottom: true,
  color: true,
  height: true,
  left: true,
  margin: true,
  'margin-left': true,
  'margin-right': true,
  'margin-top': true,
  'min-width': true,
  'padding-left': true,
  position: true,
  'text-shadow': true,
  top: true,
  width: true,
  'vertical-align': true,
};
/** 値は、数・単位・色（#hex・名前）・空白・`,` `%` `.` `-` だけ。括弧（`url(`・`expression(`・`var(`）・`\`・`;`・引用符・`/`・`@` は、通さない。`position` は、`relative` だけ */
const STYLE_VALUE = /^[a-z0-9#%.,\- ]+$/i;

/** `style` 属性の値が、KaTeX の組版に使うものだけか（プロパティが許可リストにあり、値が、数・単位・色だけ） */
export function isSafeStyle(value: string): boolean {
  const decls = value.split(';').filter((d) => d.trim());
  if (!decls.length) return false;
  return decls.every((d) => {
    const i = d.indexOf(':');
    if (i < 0) return false;
    const prop = d.slice(0, i).trim().toLowerCase();
    const v = d.slice(i + 1).trim();
    return (
      STYLE_PROPS[prop] === true &&
      v.length > 0 &&
      v.length < 64 &&
      STYLE_VALUE.test(v) &&
      (prop !== 'position' || v === 'relative')
    );
  });
}

let purifier: Purifier | null = null;
/** 数式専用の DOMPurify（本文の `PURIFY` の、グローバルな設定・フックに、触れないよう、別のインスタンス） */
function mathPurifier(): Purifier {
  if (purifier) return purifier;
  const p = DOMPurify(window);
  p.addHook('uponSanitizeAttribute', (_node, data) => {
    if (data.attrName === 'style' && !isSafeStyle(data.attrValue)) data.keepAttr = false;
  });
  purifier = p;
  return p;
}

/** KaTeX の出力（HTML の文字列）を、無害化した DocumentFragment にする（許可リスト：`MATH_PURIFY`・`style` の検査：`isSafeStyle`） */
export function sanitizeMath(html: string): DocumentFragment {
  return mathPurifier().sanitize(html, MATH_PURIFY) as unknown as DocumentFragment;
}

/** 無害化した KaTeX の出力（DocumentFragment）の、キャッシュ（同じ式・同じ種類）。本文は、更新のたびに、描き直されるので、式ごとに、KaTeX と無害化を、やり直さない */
const cache = new Map<string, DocumentFragment>();
const CACHE_MAX = 500;

class MathError extends Error {}

/** TeX を、KaTeX で描いて、無害化した断片にする。失敗（構文・上限）は、MathError（利用者に見せる理由つき） */
async function renderTex(tex: string, display: boolean): Promise<DocumentFragment> {
  if (tex.length > MATH_MAX_SOURCE)
    throw new MathError(`数式が長すぎます（${MATH_MAX_SOURCE.toLocaleString('en-US')} 文字まで）`);
  const key = `${display ? 'D' : 'I'}\n${tex}`;
  const hit = cache.get(key);
  if (hit) return hit.cloneNode(true) as DocumentFragment;
  const katex = await loadKatex();
  let out: string;
  try {
    out = katex.renderToString(tex, {
      displayMode: display,
      throwOnError: true,
      trust: false,
      strict: 'ignore',
      output: 'htmlAndMathml',
      maxSize: MAX_SIZE,
      maxExpand: MAX_EXPAND,
    });
  } catch (e) {
    if (e instanceof katex.ParseError) throw new MathError(e.rawMessage ?? e.message);
    if (e instanceof RangeError) throw new MathError('数式が深く入れ子になりすぎています');
    throw new MathError('数式を描画できませんでした');
  }
  if (out.length > MATH_MAX_OUTPUT) throw new MathError('数式が大きすぎます');
  const frag = sanitizeMath(out);
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
  cache.set(key, frag);
  return frag.cloneNode(true) as DocumentFragment;
}

const decode = (s: string | undefined): string => {
  try {
    return decodeURIComponent(s ?? '');
  } catch {
    return s ?? '';
  }
};

/** 同じ要素を、同時に、2 回描かない（本文・返信・外観の変更が、同じ要素を、続けて渡す） */
const inflight = new WeakSet<Element>();

/** 失敗の表示：別行は、Mermaid の失敗と同じ見た目（`.mermaid-error`・`.mm-err`・`pre`）。文中は、元の文字のまま、理由を `title` に（赤い下線） */
function showError(el: HTMLElement, tex: string, reason: string): void {
  if (el.classList.contains('math-block')) {
    el.classList.add('math-error', 'mermaid-error');
    el.replaceChildren(
      h('div', { class: 'mm-err', text: `数式を描画できませんでした：${reason}` }),
      h('pre', { text: tex }),
    );
  } else {
    el.classList.add('math-error');
    el.title = reason;
  }
}

/** 数式を描く 1 つ。描いたあとの DOM：別行 `.math-block > .math-out`・文中 `.math-inline > .math-src + .math-out`（`.math-done`） */
async function fillOne(el: HTMLElement): Promise<boolean> {
  const tex = decode(el.dataset.math);
  const block = el.classList.contains('math-block');
  try {
    const frag = await renderTex(tex, block);
    const out = h('span', { class: 'math-out' });
    out.append(frag);
    if (block) el.replaceChildren(out);
    else {
      el.querySelector('.math-src')?.setAttribute('aria-hidden', 'true'); // 読み上げは、描いた式の MathML（元の文字は、読ませない）
      el.append(out);
    }
    el.classList.add('math-done');
    return true;
  } catch (e) {
    showError(el, tex, e instanceof MathError ? e.message : '数式を描画できませんでした');
    return false;
  }
}

/** 描く合間に、画面へ、制御を返す（長い文書・重い式で、画面を止めない） */
const SLICE_MS = 12;

function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

/** 描いたあと、フォントが読み込まれるまで待つ（式の幅・高さが、フォントの読み込みで変わる：描いたあとに測る位置づけ〔範囲の枠・番号〕が、ずれないように）。長くても 2 秒 */
async function fontsReady(container: ParentNode): Promise<void> {
  const fonts = document.fonts;
  if (!fonts) return;
  if (container instanceof HTMLElement) void container.offsetHeight; // レイアウトを起こして、使うフォントの読み込みを始めさせる
  await Promise.race([fonts.ready, sleep(2000)]);
}

/**
 * container の中の、まだ描いていない数式（`.math-block`・`.math-inline`）を、すべて描く。数式がなければ、KaTeX を読まない（何もしない）。
 * 失敗した式は、理由と元の TeX を、文字で出す。同じ要素を、2 回描かない（描いた・失敗した式は、触らない）
 */
export async function fillMath(container: ParentNode): Promise<void> {
  const todo = $$<HTMLElement>('.math-block, .math-inline', container).filter(
    (el) => !el.classList.contains('math-done') && !el.classList.contains('math-error') && !inflight.has(el),
  );
  if (!todo.length) return;
  for (const el of todo) inflight.add(el);
  let rendered = false;
  let t0 = performance.now();
  try {
    for (const el of todo) {
      if (await fillOne(el)) rendered = true;
      inflight.delete(el);
      if (performance.now() - t0 > SLICE_MS) {
        await sleep(0);
        t0 = performance.now();
      }
    }
  } finally {
    for (const el of todo) inflight.delete(el);
  }
  if (rendered) await fontsReady(container);
}
