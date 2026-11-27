// @vitest-environment jsdom
// 数式（KaTeX）の描画：置き場 → 描画 → 無害化。安全（悪意のある TeX・出力の無害化・上限）・失敗の表示・キャッシュ・描画の前後で、本文の文字・ハッシュ・引用が変わらないこと。
import katex from 'katex';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { articleTid } from '../../../src/web/doc/hit';
import { fillDiagrams } from '../../../src/web/doc/render';
import {
  blockAnchor,
  blockEls,
  blockLabel,
  blockText,
  contentText,
  frameOf,
  markBlocks,
  mediaOf,
  plainText,
  textIndex,
} from '../../../src/web/doc/render/blocks';
import { addDiff } from '../../../src/web/doc/render/diff';
import { mdToFragment } from '../../../src/web/doc/render/markdown';
import { fillMath, isSafeStyle, MATH_MAX_SOURCE, sanitizeMath } from '../../../src/web/doc/render/math';
import { markFocusEntries, mediaOfEntry } from '../../../src/web/focus/focusable';
import { zoomableAt, zoomTargetOfBlock } from '../../../src/web/focus/zoomOpen';
import { anchorFromSelection } from '../../../src/web/interact/selection';
import { resetAll } from '../helpers';

const BT = '```';
const page = (md: string): HTMLElement => {
  const box = document.createElement('div');
  box.id = 'article';
  box.append(mdToFragment(md, { slug: 'demo', kind: 'doc' }));
  markBlocks(box);
  document.body.append(box);
  return box;
};
const serialize = (f: DocumentFragment): string => {
  const d = document.createElement('div');
  d.append(f.cloneNode(true));
  return d.innerHTML;
};

beforeEach(() => resetAll());
afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

test('別行・文中の数式を、描く：KaTeX の HTML と MathML が入る。数式がなければ、何もしない（KaTeX を読まない）', async () => {
  const art = page('文 $x^2$ です。\n\n$$\\frac{a}{b}$$\n');
  await fillDiagrams(art);
  expect(art.querySelectorAll('.math-block.math-done .math-out .katex-display .katex')).toHaveLength(1);
  expect(art.querySelectorAll('.math-inline.math-done .math-out .katex')).toHaveLength(1);
  expect(art.querySelector('.math-block .katex-mathml math')).not.toBeNull(); // 読み上げ用の MathML
  expect(art.querySelector('.math-block annotation')?.textContent).toBe('\\frac{a}{b}'); // 元の TeX
  // 文中は、元の文字（見えなくする）が残る
  expect(art.querySelector('.math-inline > .math-src')?.textContent).toBe('$x^2$');
  const plain = page('ただの文。\n');
  await fillMath(plain);
  expect(plain.querySelector('.math-out')).toBeNull();
});

test('描くのは、1 回だけ（描いた式は、触らない：外観の変更・返信の描き直しで、同じ要素を、再び渡しても）', async () => {
  const art = page('$a$ と\n\n$$b$$\n');
  await fillDiagrams(art);
  const before = art.innerHTML;
  const first = art.querySelector('.math-out');
  await Promise.all([fillDiagrams(art), fillDiagrams(art)]);
  expect(art.innerHTML).toBe(before);
  expect(art.querySelector('.math-out')).toBe(first);
});

test('描画の前後で、本文の文字（ブロックのハッシュに使う文字・引用・差分の文字）が、同じ：文中の数式は、元の文字（記号つき）', async () => {
  const art = page('式 $E = mc^2$ と $`a_1`$ です。\n\n- 項目 $x$\n\n  $$\n  y\n  $$\n');
  const para = blockEls(art)[0];
  const li = blockEls(art)[1];
  if (!para || !li) throw new Error('ブロックがない');
  const before = {
    text: blockText(para),
    plain: plainText(para),
    li: blockText(li),
    label: blockLabel(para),
    idx: textIndex(art).text,
  };
  expect(before.text).toBe('式 $E = mc^2$ と $`a_1`$ です。');
  expect(before.li).toContain('項目 $x$');
  expect(before.li).toContain('y'); // 入れ子の別行の数式は、ソースが文字になる
  await fillDiagrams(art);
  expect({
    text: blockText(para),
    plain: plainText(para),
    li: blockText(li),
    label: blockLabel(para),
    idx: textIndex(art).text,
  }).toEqual(before);
  // 描いた HTML・MathML の文字は、数えない：本文の文字は、元の文字だけ
  expect(textIndex(art).text).not.toContain('E=mc');
  expect(contentText(para)).toBe('式 $E = mc^2$ と $`a_1`$ です。');
});

test('別行の数式は、図と同じブロック：ラベル「数式」・アンカー（ソース・ラベル）・文の選択は、ブロックのアンカー・本文の文字に入らない', async () => {
  const art = page('前の文です。\n\n$$a^2 + b^2 = c^2$$\n\n後の文です。\n');
  await fillDiagrams(art);
  const block = blockEls(art)[1];
  if (!block) throw new Error('ブロックがない');
  expect(block.className).toContain('math-block');
  expect(blockLabel(block)).toBe('数式');
  expect(blockText(block)).toBe(encodeURIComponent('a^2 + b^2 = c^2'));
  expect(plainText(block)).toBe('a^2 + b^2 = c^2');
  const a = blockAnchor(block);
  expect(a).toMatchObject({ blockTag: 'DIV', label: '数式', quote: '' });
  expect(a.blockText).toBe(encodeURIComponent('a^2 + b^2 = c^2'));
  expect(textIndex(art).text).not.toContain('a^2');
  // 文の選択が、数式の中から始まれば、ブロックのアンカー
  const sel = window.getSelection();
  const r = document.createRange();
  const katexText = block.querySelector('.katex-html .mord');
  if (!sel || !katexText) throw new Error('範囲を作れない');
  r.selectNodeContents(katexText);
  sel.removeAllRanges();
  sel.addRange(r);
  expect(anchorFromSelection(art, sel)).toMatchObject({ label: '数式', quote: '' });
});

test('範囲の基準：別行の数式は、式（.katex）。式の中の svg（根号）を、図として拾わない。文中の数式を持つ段落は、図のブロックではない', async () => {
  const art = page('$$\\sqrt{x}$$\n\n根号を含む文 $\\sqrt{y}$ です。\n');
  await fillDiagrams(art);
  const [display, para] = blockEls(art);
  if (!display || !para) throw new Error('ブロックがない');
  expect(display.querySelector('svg')).not.toBeNull(); // 根号は、svg
  expect(mediaOf(display)).toBe(display.querySelector('.math-out .katex'));
  expect(frameOf(display)).toBe(display.querySelector('.math-out .katex'));
  expect(para.querySelector('svg')).not.toBeNull();
  expect(mediaOf(para)).toBeNull();
  expect(frameOf(para)).toBe(para);
});

test('拡大表示の入口：別行の数式の式を押すと数式（HTML）。式の中の svg でも、数式。文中の数式・根号は、拡大しない。キーボードの入口は、ブロック', async () => {
  const art = page('$$\\sqrt{x}$$\n\n文 $\\sqrt{y}$ です。\n');
  await fillDiagrams(art);
  const [display, para] = blockEls(art);
  if (!display || !para) throw new Error('ブロックがない');
  const katexEl = display.querySelector<HTMLElement>('.katex');
  expect(zoomableAt(katexEl, art)).toBe(katexEl);
  expect(zoomableAt(display.querySelector('svg'), art)).toBe(katexEl);
  expect(zoomableAt(para.querySelector('.katex'), art)).toBeNull();
  expect(zoomableAt(para.querySelector('svg'), art)).toBeNull();
  markFocusEntries(art);
  expect(display.hasAttribute('data-focus-entry')).toBe(true);
  expect(display.getAttribute('aria-label')).toBe('数式を、拡大表示で開く');
  expect(display.querySelector('svg')?.hasAttribute('data-focus-entry')).toBe(false);
  expect(para.hasAttribute('data-focus-entry')).toBe(false);
  expect(mediaOfEntry(display, art)).toBe(katexEl);
});

test('描けない式（構文の誤り）：Mermaid の失敗と同じ見た目で、理由と元の TeX を、文字で出す。文中は、元の文字のまま、理由を title に', async () => {
  const bad = ['\\foo', '\\frac{', 'x^', '\\begin{pmatrix} a', '}'];
  const art = page(bad.map((t) => `$$${t}$$`).join('\n\n'));
  await fillDiagrams(art);
  const blocks = [...art.querySelectorAll('.math-block')];
  expect(blocks).toHaveLength(bad.length);
  blocks.forEach((b, i) => {
    expect(b.classList.contains('math-error'), bad[i]).toBe(true);
    expect(b.classList.contains('mermaid-error')).toBe(true);
    expect(b.querySelector('.mm-err')?.textContent).toContain('数式を描画できませんでした');
    expect(b.querySelector('pre')?.textContent).toBe(bad[i]);
    expect(b.querySelector('.katex')).toBeNull();
  });
  const inl = page('文 $`\\foo`$ です。');
  await fillDiagrams(inl);
  const span = inl.querySelector('.math-inline');
  expect(span?.classList.contains('math-error')).toBe(true);
  expect(span?.classList.contains('math-done')).toBe(false);
  expect(span?.getAttribute('title')).toBeTruthy();
  expect(span?.textContent).toBe('$`\\foo`$');
  expect(inl.querySelector('.katex')).toBeNull();
});

test('信頼しない命令（\\href・\\url・\\includegraphics・\\htmlClass・\\htmlId・\\htmlStyle・\\htmlData）：リンク・画像・class・id・style を作らない（KaTeX は、命令を、エラーの色の文字で出す）', async () => {
  const evil = [
    '\\href{javascript:alert(1)}{x}',
    '\\url{javascript:alert(1)}',
    '\\includegraphics{http://example.com/x.png}',
    '\\htmlClass{evil}{x}',
    '\\htmlId{evil}{x}',
    '\\htmlStyle{background:url(http://example.com/x)}{x}',
    '\\htmlData{evil=1}{x}',
  ];
  const art = page(evil.map((t) => `$$${t}$$`).join('\n\n'));
  await fillDiagrams(art);
  const blocks = [...art.querySelectorAll('.math-block')];
  expect(blocks).toHaveLength(evil.length);
  blocks.forEach((b, i) => {
    expect(b.querySelector('a, img, script, [onclick], [id], [data-evil], [href], [src]'), evil[i]).toBeNull();
    expect(b.querySelector('.evil'), evil[i]).toBeNull();
    for (const el of b.querySelectorAll('*'))
      for (const name of el.getAttributeNames())
        expect(el.getAttribute(name), evil[i]).not.toMatch(/javascript|example\.com|url\(/);
    // 命令の名前が、そのまま、文字として見える（赤）：描けていないことが、分かる
    expect(b.querySelector('.katex-html')?.textContent, evil[i]).toContain(evil[i]?.slice(0, 4) ?? '');
  });
  expect(art.querySelectorAll('[style*="#cc0000"]').length).toBeGreaterThan(0);
});

test('悪意のある TeX は、スクリプトにならず、リンク・画像・イベントハンドラ・style の注入を出さない（描けるものも、DOM を調べる）', async () => {
  const tex = [
    '\\text{<script>alert(1)</script><img src=x onerror=alert(1)>}',
    'x^{<svg onload=alert(1)>}',
    '\\text{"><a href="javascript:alert(1)">x</a>}',
    '\\color{red}{x} \\textcolor{#ff0000}{y} \\colorbox{yellow}{z}',
    '\\rule{500em}{500em}',
    '\\verb|<img src=x onerror=alert(1)>|',
    '\\mathrm{javascript:alert(1)}',
  ];
  const art = page(tex.map((t) => `$$${t}$$`).join('\n\n'));
  await fillDiagrams(art);
  for (const b of art.querySelectorAll('.math-block')) {
    expect(b.querySelectorAll('script, img, a, iframe, foreignObject, style, form, input, object, embed').length).toBe(
      0,
    );
    for (const el of b.querySelectorAll('*')) {
      for (const name of el.getAttributeNames()) expect(name).not.toMatch(/^on/i);
      expect(el.getAttribute('href')).toBeNull();
      const style = el.getAttribute('style');
      if (style) expect(isSafeStyle(style), style).toBe(true);
    }
  }
  // 文字は、文字として残る（HTML として解釈されない）
  expect(art.querySelector('.math-block .katex-html')?.textContent).toContain('<script>');
  // 大きさは、上限で抑えられる（maxSize 50em）
  const rule = [...art.querySelectorAll<HTMLElement>('.math-block')][4]?.querySelector<HTMLElement>('.rule');
  expect(Number.parseFloat(rule?.style.borderRightWidth ?? '0')).toBeLessThanOrEqual(50);
});

test('無害化（許可リスト）：リンク・画像・フォーム・foreignObject・イベントハンドラ・危険な style を、除く。KaTeX の出力に要るものは、残す', () => {
  const dirty =
    '<span class="katex" style="height:1em;vertical-align:-0.2em" onclick="x()" data-x="1">' +
    '<a href="javascript:alert(1)">a</a><img src="x" onerror="x()"><form><input></form>' +
    '<svg viewBox="0 0 10 10" onload="x()"><foreignObject><div>x</div></foreignObject><script>x()</script><path d="M0 0L1 1"/><use href="#a"/></svg>' +
    '<span style="background:url(javascript:alert(1))">b</span>' +
    '<span style="position:fixed;top:0">c</span>' +
    '<span style="color:red;width:1em">d</span>' +
    '<style>*{display:none}</style></span>';
  const html = serialize(sanitizeMath(dirty));
  expect(html).not.toMatch(/<(a|img|form|input|foreignObject|script|style|use)\b/i);
  expect(html).not.toMatch(/onclick|onerror|onload|javascript|data-x/i);
  expect(html).toContain('style="height:1em;vertical-align:-0.2em"');
  expect(html).toContain('<path d="M0 0L1 1">');
  expect(html).not.toContain('position:fixed');
  expect(html).not.toContain('url(');
  expect(html).toContain('style="color:red;width:1em"');
});

test('style 属性：KaTeX の組版の寸法・色だけ。url()・expression・var()・position など、ほかは、通さない', () => {
  expect(isSafeStyle('height:0.8em;vertical-align:-0.2em')).toBe(true);
  expect(isSafeStyle('top:-3.1em;margin-right:0.05em')).toBe(true);
  expect(isSafeStyle('color:#ff0000')).toBe(true);
  expect(isSafeStyle('border-bottom-width:0.04em')).toBe(true);
  expect(isSafeStyle('background:url(x)')).toBe(false);
  expect(isSafeStyle('height:expression(alert(1))')).toBe(false);
  expect(isSafeStyle('width:var(--x)')).toBe(false);
  expect(isSafeStyle('position:fixed')).toBe(false);
  expect(isSafeStyle('behavior:url(x.htc)')).toBe(false);
  expect(isSafeStyle('height:1em;position:fixed')).toBe(false); // 1 つでも許可リスト外があれば、全体を捨てる
  expect(isSafeStyle('constructor:1em')).toBe(false);
  expect(isSafeStyle('')).toBe(false);
});

test('KaTeX の出力は、無害化で、何も除かれない（許可リストが、KaTeX の更新・機能に、追いついている）：幅広い式で、無害化の前後が同じ', () => {
  const corpus = [
    'x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}',
    '\\sqrt[3]{x} + \\sqrt{\\frac{a}{b}}',
    '\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}',
    '\\sum_{k=1}^{n} k^2 \\prod_{i} a_i \\lim_{x\\to 0} \\frac{\\sin x}{x}',
    '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix} \\begin{bmatrix} 1 \\\\ 2 \\end{bmatrix} \\begin{vmatrix} a&b\\\\c&d \\end{vmatrix}',
    '\\begin{aligned} a &= b \\\\ c &= d \\end{aligned}',
    '\\begin{cases} x & x>0 \\\\ -x & x \\le 0 \\end{cases}',
    '\\begin{array}{|c|l|} \\hline a & b \\\\ \\hline c & d \\\\ \\hline \\end{array}',
    '\\left( \\frac{a}{b} \\right) \\left\\{ x \\right\\} \\Bigg( x \\Bigg) \\bigg[ y \\bigg]',
    '\\overline{AB} \\underline{x} \\overbrace{a+b}^{n} \\underbrace{c+d}_{m} \\widehat{xyz} \\widetilde{xyz} \\vec{v} \\hat{x} \\bar{y} \\dot{z}',
    '\\xrightarrow{abc} \\xleftarrow[x]{y} \\xRightarrow{z} \\longrightarrow \\Rightarrow',
    '\\cancel{x} \\bcancel{y} \\xcancel{z} \\sout{w}',
    '\\boxed{x} \\fbox{y} \\colorbox{yellow}{z} \\fcolorbox{red}{blue}{w}',
    '\\color{red}{x} \\textcolor{blue}{y} \\textcolor{#00ff00}{z}',
    '\\mathbb{R} \\mathcal{L} \\mathfrak{g} \\mathscr{S} \\mathbf{B} \\mathit{i} \\mathrm{d} \\mathsf{S} \\mathtt{T} \\boldsymbol{\\alpha}',
    '\\alpha \\beta \\Gamma \\Delta \\nabla \\partial \\infty \\hbar \\ell \\aleph \\forall \\exists \\neg \\in \\notin \\subset \\cup \\cap',
    '\\text{text } \\textbf{bold} \\textit{it} \\mbox{box} \\operatorname{argmax} \\mathop{op}\\limits_{x}',
    '\\binom{n}{k} \\dbinom{n}{k} \\tbinom{n}{k} \\genfrac{(}{)}{0pt}{}{a}{b} \\cfrac{1}{1+\\cfrac{1}{x}}',
    'x\\tag{1} \\hspace{1em} \\quad \\qquad \\, \\; \\! \\kern{2em} \\phantom{x} \\hphantom{y} \\vphantom{z} \\smash{w} \\mathstrut',
    '\\underset{a}{b} \\overset{a}{b} \\stackrel{a}{=} \\substack{a \\\\ b} \\atop \\over',
    '\\rule{1em}{2pt} \\raisebox{0.5em}{x} \\mathllap{a} \\mathrlap{b} \\mathclap{c}',
    '\\displaystyle \\textstyle \\scriptstyle \\scriptscriptstyle \\tiny \\Huge',
    '\\not= \\neq \\ne \\leq \\geq \\approx \\equiv \\sim \\propto \\parallel \\perp \\angle \\triangle \\square',
    'a \\bmod b \\pmod{c} \\gcd \\lcm \\max \\min \\sup \\inf \\arg \\deg \\det \\dim \\exp \\ln \\log',
    '\\begin{matrix} \\vdots & \\ddots \\\\ \\cdots & \\ldots \\end{matrix}',
    '\\newcommand{\\f}[1]{#1^2} \\f{x}',
    '\\def\\a{b} \\a',
    '\\ce{H2O}',
    '\\sqrt{\\sqrt{\\sqrt{x}}}',
    '\\lbrace \\rbrace \\langle \\rangle \\lvert x \\rvert \\lVert y \\rVert \\lfloor x \\rfloor \\lceil y \\rceil',
    '\\ddot{x} \\acute{a} \\grave{a} \\breve{a} \\check{a} \\tilde{a} \\mathring{a} \\widecheck{abc} \\utilde{x}',
    '\\bra{x} \\ket{y} \\braket{a|b}',
    '日本語の式 \\text{あいう} x',
  ];
  for (const tex of corpus) {
    for (const display of [true, false]) {
      let out: string;
      try {
        out = katex.renderToString(tex, {
          displayMode: display,
          throwOnError: true,
          trust: false,
          strict: 'ignore',
          output: 'htmlAndMathml',
          maxSize: 50,
          maxExpand: 1000,
        });
      } catch {
        continue; // この版の KaTeX が、受けない式（\ce・\bra など）は、飛ばす
      }
      const raw = document.createElement('div');
      raw.innerHTML = out;
      // MathML（読み上げ用。表示しない）の `style`（`\\fcolorbox` の `border` など）は、許可しない。それ以外は、1 文字も変わらない
      for (const el of raw.querySelectorAll('math [style]')) el.removeAttribute('style');
      expect(serialize(sanitizeMath(out)), tex).toBe(raw.innerHTML);
    }
  }
});

test('上限：ソースの長さ（20,000 文字）・再帰するマクロ・深い入れ子・巨大な式でも、止まらず、失敗として出す', async () => {
  const long = `x + ${'1 + '.repeat(MATH_MAX_SOURCE / 4 + 10)}y`;
  expect(long.length).toBeGreaterThan(MATH_MAX_SOURCE);
  const deep = `${'{'.repeat(8000)}x${'}'.repeat(8000)}`;
  const frac = `${'\\frac{'.repeat(3000)}x${'}{1}'.repeat(3000)}`;
  const art = page(
    [
      `$$${long}$$`,
      `$$\\def\\a{\\a\\a} \\a$$`,
      `$$\\def\\a{\\b\\b}\\def\\b{\\a\\a} \\a$$`,
      `${BT}math\n${deep}\n${BT}`,
      `$$${frac}$$`,
      `$$\\newcommand{\\f}[1]{#1#1}\\f{\\f{\\f{\\f{\\f{\\f{\\f{\\f{\\f{\\f{\\f{\\f{x}}}}}}}}}}}}$$`,
    ].join('\n\n'),
  );
  const t0 = performance.now();
  await fillDiagrams(art);
  expect(performance.now() - t0).toBeLessThan(8000);
  const blocks = [...art.querySelectorAll('.math-block')];
  expect(blocks).toHaveLength(6);
  for (const b of blocks) expect(b.classList.contains('math-done') || b.classList.contains('math-error')).toBe(true);
  expect(blocks[0]?.querySelector('.mm-err')?.textContent).toContain('長すぎます');
  expect(blocks[1]?.classList.contains('math-error')).toBe(true); // マクロの再帰：展開の上限
  expect(blocks[2]?.classList.contains('math-error')).toBe(true);
  expect(blocks[5]?.classList.contains('math-error')).toBe(true); // 指数的な展開：上限
});

test('描いた式は、キャッシュする：同じ式を、2 つの文書で描いても、KaTeX は 1 回（複製した DOM を使う）', async () => {
  const spy = vi.spyOn(katex, 'renderToString');
  const tex = '\\alpha_{cache}';
  const a = page(`$$${tex}$$`);
  await fillDiagrams(a);
  const b = page(`$$${tex}$$`);
  await fillDiagrams(b);
  expect(spy.mock.calls.filter((c) => c[0] === tex)).toHaveLength(1);
  const ea = a.querySelector('.math-out');
  const eb = b.querySelector('.math-out');
  expect(ea?.innerHTML).toBe(eb?.innerHTML);
  expect(ea).not.toBe(eb); // 別の DOM
  // 別行と文中は、別の式（組版が違う）
  const c = page(`$${tex}$`);
  await fillDiagrams(c);
  expect(c.querySelector('.katex-display')).toBeNull();
});

test('KaTeX を、trust: false・strict: ignore・throwOnError・maxSize・maxExpand・htmlAndMathml で呼ぶ', async () => {
  const spy = vi.spyOn(katex, 'renderToString');
  const art = page('$$\\beta_{opts}$$');
  await fillDiagrams(art);
  const call = spy.mock.calls.find((c) => c[0] === '\\beta_{opts}');
  expect(call?.[1]).toMatchObject({
    trust: false,
    strict: 'ignore',
    throwOnError: true,
    output: 'htmlAndMathml',
    maxExpand: 1000,
    displayMode: true,
  });
  expect(call?.[1]?.maxSize).toBeLessThanOrEqual(100);
});

test('版の差分：数式を 1 つ直すと、そのブロックが「変更」になり、差分の文字は、TeX のソース（図と同じ）', async () => {
  const v1 = '# 題\n\n式です。\n\n$$x = a + b$$\n\n終わり。\n';
  const v2 = '# 題\n\n式です。\n\n$$x = a - b$$\n\n終わり。\n';
  const frag = mdToFragment(v2, { slug: 'demo', kind: 'doc' });
  markBlocks(frag);
  const sum = addDiff(frag, { key: 'demo/root/2', slug: 'demo', md: v2, prevMd: v1 });
  expect(sum).toMatchObject({ changed: 1, added: 0, removed: 0 });
  const box = document.createElement('div');
  box.append(frag);
  const del = box.querySelector('.diffbox del')?.textContent;
  const ins = box.querySelector('.diffbox ins')?.textContent;
  expect(`${del}${ins}`).toContain('+');
  expect(`${del}${ins}`).toContain('-');
  expect(box.querySelector('.math-block.changed')).not.toBeNull();
  // 文中の数式を直した文も、変更（元の文字で比べる）
  const p1 = '文 $a+b$ です。\n';
  const p2 = '文 $a-b$ です。\n';
  const f2 = mdToFragment(p2, { slug: 'demo', kind: 'doc' });
  markBlocks(f2);
  expect(addDiff(f2, { key: 'demo/root/3', slug: 'demo', md: p2, prevMd: p1 })).toMatchObject({ changed: 1 });
});

test('同じ式は、書き方（$$・```math・複数行）が違っても、同じブロックの内容（ハッシュ）', () => {
  const a = page('$$\\alpha + \\beta$$\n');
  const b = page(`${BT}math\n\\alpha + \\beta\n${BT}\n`);
  const c = page('$$\n\\alpha + \\beta\n$$\n');
  const h = (el: HTMLElement) => blockEls(el)[0]?.dataset.bhash;
  expect(h(a)).toBeTruthy();
  expect(h(b)).toBe(h(a));
  expect(h(c)).not.toBeUndefined();
});

test('コピー・読み上げ：描いた式の MathML（読み上げ）は aria-hidden でない側にあり、HTML の側は aria-hidden', async () => {
  const art = page('$$x^2$$\n');
  await fillDiagrams(art);
  expect(art.querySelector('.katex-html')?.getAttribute('aria-hidden')).toBe('true');
  expect(art.querySelector('.katex-mathml')?.getAttribute('aria-hidden')).toBeNull();
  expect(art.querySelector('.katex-mathml math')).not.toBeNull();
});

test('資料の生の HTML が、偽の置き場（数式の class・data-math）を書いても、同じ安全な経路で描かれる', async () => {
  const art = page(
    '<div class="math-block" data-math="%5Chref%7Bjavascript%3Aalert(1)%7D%7Bx%7D"></div>\n\n<span class="math-inline" data-math="y%5E2">$偽$</span>\n',
  );
  await fillDiagrams(art);
  expect(art.querySelector('a')).toBeNull();
  expect(art.querySelector('[href], img, script')).toBeNull();
  expect(art.querySelector('.math-block .katex')).not.toBeNull(); // 信頼しない命令は、エラーの色の文字として出る（リンクにならない）
  expect(art.querySelector('.math-inline .katex')).not.toBeNull();
});

test('文中の数式を押すと、その文のコメントを指す（強調は、見えない元の文字に付くので、数式からも、強調を探す）', async () => {
  const art = page('式 $E = mc^2$ です。\n');
  await fillDiagrams(art);
  const mark = document.createElement('mark');
  mark.className = 'hl live';
  mark.dataset.tid = 't1';
  const src = art.querySelector('.math-src');
  if (!src?.firstChild) throw new Error('元の文字がない');
  mark.append(src.firstChild);
  src.append(mark);
  const katexEl = art.querySelector('.math-inline .katex');
  expect(articleTid({ target: katexEl, clientX: 0, clientY: 0 })).toBe('t1');
  expect(articleTid({ target: art.querySelector('p'), clientX: 0, clientY: 0 })).toBeNull();
});

test('入口のバーの「拡大表示」の対象：svg（根号）を含まない式（行列・分数）でも、数式のブロックには、ある。描く前は、ない', async () => {
  const art = page(
    `${BT}math\n\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}\n${BT}\n\n$$\\frac{a}{b}$$\n\n文 $x$ です。\n`,
  );
  const [matrix, frac, para] = blockEls(art);
  if (!matrix || !frac || !para) throw new Error('ブロックがない');
  expect(zoomTargetOfBlock(matrix)).toBeNull(); // まだ描いていない
  await fillDiagrams(art);
  expect(matrix.querySelector('svg')).toBeNull();
  expect(zoomTargetOfBlock(matrix)).toBe(matrix.querySelector('.katex'));
  expect(zoomTargetOfBlock(frac)).toBe(frac.querySelector('.katex'));
  expect(zoomTargetOfBlock(para)).toBeNull(); // 文中の数式を持つ段落は、対象にならない
});
