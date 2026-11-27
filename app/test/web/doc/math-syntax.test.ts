// @vitest-environment jsdom
// 数式の記法（GitHub と同じ 3 種類）：文中 `$…$`・`` $`…`$ ``・別行 `$$…$$`・```math。通貨・エスケープ・コードの中・複数行・空の式・上限を、境界で確かめる
import { expect, test } from 'vitest';
import { mdToFragment } from '../../../src/web/doc/render/markdown';
import { matchBlockMath, matchInlineMath } from '../../../src/web/doc/render/mathSyntax';

const BT = '```';
const html = (md: string): string => {
  const box = document.createElement('div');
  box.append(mdToFragment(md, { slug: 'demo', kind: 'doc' }));
  return box.innerHTML;
};
const texOf = (md: string, sel: string): string[] => {
  const box = document.createElement('div');
  box.append(mdToFragment(md, { slug: 'demo', kind: 'doc' }));
  return [...box.querySelectorAll<HTMLElement>(sel)].map((e) => decodeURIComponent(e.dataset.math ?? '').trim());
};
const inline = (md: string): string[] => texOf(md, '.math-inline');
const blocks = (md: string): string[] => texOf(md, '.math-block');

test('文中：$…$・$`…`$・$$…$$（文の途中）が数式。TeX のソースと、元の文字（記号つき）を持つ', () => {
  expect(inline('円の式は $x^2 + y^2 = z^2$ です')).toEqual(['x^2 + y^2 = z^2']);
  expect(inline('式 $`a_1 + a_2`$ と書く')).toEqual(['a_1 + a_2']);
  expect(inline('こうなる $$E = mc^2$$ のこと')).toEqual(['E = mc^2']);
  // 元の文字（本文の文字）：記号つき。差分・コメントの引用・コピーは、これを使う
  expect(html('a $x$ b')).toContain('<span class="math-src">$x$</span>');
  expect(html('a $`x`$ b')).toContain('<span class="math-src">$`x`$</span>');
});

test('バッククォートの形は、Markdown の記号（_ や *）を含んでも、そのままの TeX', () => {
  expect(inline('$`a_1 * b_2`$')).toEqual(['a_1 * b_2']);
  expect(inline('$`\\$4`$')).toEqual(['\\$4']);
  expect(html('$`a_1 * b_2`$')).not.toContain('<em>');
});

test('通貨：「$5 と $10」「$5,$10」「$20 と $30 と $x$」は、先頭を数式にしない（直前が空白・直後が数字の `$` では、閉じない）', () => {
  expect(inline('りんごは $5 と $10 です')).toEqual([]);
  expect(inline('値段は $5,$10 です')).toEqual([]);
  expect(inline('1 個 $5、2 個 $10。')).toEqual([]);
  expect(inline('$20 と $30 と $x$ で')).toEqual(['x']); // 先頭の `$20 と $` を、数式にしない
  expect(html('りんごは $5 です')).toContain('りんごは $5 です');
});

test('開く `$` の直後・閉じる `$` の直前が空白なら、数式にしない。直後が数字の閉じる `$` も、数式にしない', () => {
  expect(inline('a $ x$ b')).toEqual([]);
  expect(inline('a $x $ b')).toEqual([]);
  expect(inline('a $x$5 b')).toEqual([]);
  expect(inline('a $x$ 5 b')).toEqual(['x']);
  expect(inline('a $x$、$y$ b')).toEqual(['x', 'y']);
});

test('エスケープ：\\$ は、ふつうの `$`。数式の中の \\$ は、TeX の \\$', () => {
  expect(inline('値は \\$5 と \\$10')).toEqual([]);
  expect(html('値は \\$5 です')).toContain('値は $5 です');
  expect(inline('a $\\$4$ b')).toEqual(['\\$4']);
  expect(inline('\\$x$ と $y$')).toEqual(['y']); // 先頭は、エスケープされた `$`
});

test('コードスパン・コードブロックの中の `$` は、数式にしない（コードの外の `$` を、コードの中の `$` で閉じない）', () => {
  expect(inline('りんごは $5 と $10 です。コード `$x$`。')).toEqual([]);
  expect(inline('$a `$` b$ と `$c$`')).toEqual(['a `$` b']);
  expect(inline('$a ``$`` b$')).toEqual(['a ``$`` b']);
  expect(inline('$a ` b$')).toEqual(['a ` b']);
  expect(inline('`$x$` と `$$y$$`')).toEqual([]);
  expect(html('`$x$`')).toContain('<code>$x$</code>');
  expect(blocks(`${BT}js\n$$\nx\n$$\n${BT}`)).toEqual([]);
  expect(blocks(`    $$\n    x\n    $$\n`)).toEqual([]); // インデントのコード
  expect(html(`${BT}sh\necho $HOME $x$\n${BT}`)).toContain('echo $HOME $x$');
});

test('空の式・空白だけの式・空行をまたぐ式・閉じていない式は、数式にしない', () => {
  expect(inline('a $$$$ b')).toEqual([]);
  expect(inline('a $$ $$ b')).toEqual([]);
  expect(inline('a $` `$ b')).toEqual([]);
  expect(inline('a $x b')).toEqual([]);
  expect(inline('a $x\n\ny$ b')).toEqual([]);
  expect(blocks('$$\n$$')).toEqual([]);
  expect(blocks('$$ $$')).toEqual([]);
  expect(blocks('$$\nx = 1\n')).toEqual([]); // 閉じる行がない
  expect(blocks('$$\nx = 1\n\ny = 2\n$$')).toEqual([]); // 空行をまたがない
  expect(html('$$\nx = 1\n')).toContain('<p>$$\nx = 1</p>');
});

test('別行：`$$ … $$` を 1 行・`$$` の行で挟む複数行・```math が、同じ数式のブロック', () => {
  const tex = 'x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}';
  expect(blocks(`前\n\n$$${tex}$$\n\n後`)).toEqual([tex]);
  expect(blocks(`前\n\n$$ ${tex} $$\n\n後`)).toEqual([tex]);
  expect(blocks(`前\n\n$$\n${tex}\n$$\n\n後`)).toEqual([tex]);
  expect(blocks(`前\n\n${BT}math\n${tex}\n${BT}\n\n後`)).toEqual([tex]);
  expect(blocks('$$\na &= 1 \\\\\nb &= 2\n$$')).toEqual(['a &= 1 \\\\\nb &= 2']);
  expect(blocks('$$ a\n+ b $$')).toEqual(['a\n+ b']);
  expect(html(`${BT}math\nx\n${BT}`)).toContain('<div class="math-block"');
  // 1 行の中に、2 つ目の `$$` があるとき（`$$a$$ と $$b$$`）は、別行にしない。文中の数式が 2 つ
  expect(blocks('$$a$$ と $$b$$')).toEqual([]);
  expect(inline('$$a$$ と $$b$$')).toEqual(['a', 'b']);
});

test('別行の `$$` は、段落の直後（空行なし）でも、数式。GitHub の例：行末の `\\` は、文字として残さない', () => {
  const out = html('**The Cauchy-Schwarz Inequality**\\\n$$a^2 \\leq b$$');
  expect(out).toContain('<p><strong>The Cauchy-Schwarz Inequality</strong></p>');
  expect(out).toContain('<div class="math-block"');
  expect(out).not.toContain('\\');
  expect(blocks('文です。\n$$\nx\n$$\n続き')).toEqual(['x']);
  expect(html('文です。\n$$\nx\n$$\n続き')).toContain('<p>続き</p>');
  // 数式に読めない `$$` の行は、段落を割らない
  expect(html('価格は\n$$ ドル\nです')).toContain('<p>価格は\n$$ ドル\nです</p>');
  // `\\`（バックスラッシュの文字）で終わる段落は、その `\` を残す
  expect(html('a\\\\\n$$x$$')).toContain('a\\');
});

test('引用・リストの中・見出し・表のセルの中でも、数式になる', () => {
  expect(blocks('> 前\n>\n> $$\n> x^2\n> $$')).toEqual(['x^2']);
  expect(blocks('- 項目\n\n  $$\n  y\n  $$')).toEqual(['y']);
  expect(inline('# 題 $x$')).toEqual(['x']);
  expect(inline('| a | b |\n|---|---|\n| $x^2$ | $`y`$ |')).toEqual(['x^2', 'y']);
  expect(inline('- 式は $x$')).toEqual(['x']);
  expect(inline('[リンク $x$](https://example.com)')).toEqual(['x']);
});

test('Markdown の中の記号（_ * `）は、数式の中で、強調にならない', () => {
  expect(html('$a_1 + b_2$')).not.toContain('<em>');
  expect(inline('$a_1 + b_2$ と $c*d*e$')).toEqual(['a_1 + b_2', 'c*d*e']);
});

test('文字列の関数：文中は、元の文字と TeX を返す。数式でない文字列は null', () => {
  expect(matchInlineMath('$x$ と続く')).toEqual({ raw: '$x$', tex: 'x' });
  expect(matchInlineMath('$`x`$ と続く')).toEqual({ raw: '$`x`$', tex: 'x' });
  expect(matchInlineMath('$$x$$ と続く')).toEqual({ raw: '$$x$$', tex: 'x' });
  expect(matchInlineMath('x$')).toBeNull();
  expect(matchBlockMath('$$x$$\n続き')).toEqual({ raw: '$$x$$\n', tex: 'x' });
  expect(matchBlockMath('$$\nx\n$$\n続き')).toEqual({ raw: '$$\nx\n$$\n', tex: '\nx\n' });
  expect(matchBlockMath('文字')).toBeNull();
});

test('悪意のあるソースは、属性として、1 つの値にまとまる（HTML として解釈されない）', () => {
  const evil = 'x"><img src=x onerror=alert(1)>';
  const out = html(`$$\n${evil}\n$$`);
  expect(out).not.toContain('<img');
  const box = document.createElement('div');
  box.append(mdToFragment(`a $${'`'}${evil}${'`'}$ b`, { slug: 'demo', kind: 'doc' }));
  expect(box.querySelector('img')).toBeNull();
  expect(box.querySelector('.math-inline')?.getAttribute('data-math')).toBe(encodeURIComponent(evil));
  expect(box.querySelector('.math-src')?.textContent).toBe(`$\`${evil}\`$`);
});

test('長い文書で、`$` が多くても、止まらない（探索が、線形）', () => {
  const md = `${'値は $5 と $10 です。'.repeat(3000)}\n\n${'文章。\n\n'.repeat(3000)}$$x$$\n`;
  const t0 = performance.now();
  html(md);
  expect(performance.now() - t0).toBeLessThan(5000);
});
