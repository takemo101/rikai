// @vitest-environment jsdom
// コメントの位置づけと強調：文（引用）・ブロック（同じ内容・近い内容・同じ位置）・見つからない。番号は本文の順。
import { expect, test } from 'vitest';
import type { Anchor, Thread } from '../../../src/shared/types';
import { blockAnchor, markBlocks, textIndex } from '../../../src/web/doc/render/blocks';
import { applyHighlights, clearPending, markPending } from '../../../src/web/doc/render/highlights';
import { mdToFragment } from '../../../src/web/doc/render/markdown';
import { thread } from '../helpers';

function article(md: string): HTMLElement {
  const art = document.createElement('article');
  const frag = mdToFragment(md, { slug: 'demo', kind: 'doc' });
  markBlocks(frag);
  art.append(frag);
  document.body.replaceChildren(art);
  return art;
}

const quoteAnchor = (quote: string, over: Partial<Anchor> = {}): Anchor => ({
  blockId: '',
  blockHash: '',
  blockTag: '',
  blockText: '',
  quote,
  prefix: '',
  suffix: '',
  label: '',
  ...over,
});
const on = (id: string, anchor: Anchor | null, over: Partial<Thread> = {}): Thread => thread({ id, anchor, ...over });
const MD = '# 見出し\n\n最初の段落です。\n\n二つ目の段落で、ここを選びます。\n\n三つ目の段落。\n';

test('文：引用が見つかると、mark.hl[data-tid] で包む。位置は text。番号は 1 から', () => {
  const art = article(MD);
  const t = on('t1', quoteAnchor('ここを選びます'));
  const r = applyHighlights(art, [t], 1);
  const marks = art.querySelectorAll<HTMLElement>('mark.hl[data-tid="t1"]');
  expect(marks).toHaveLength(1);
  expect(marks[0]?.textContent).toBe('ここを選びます');
  expect(marks[0]?.classList.contains('live')).toBe(true);
  expect(r.locs.get('t1')).toEqual({ kind: 'text', marks: [marks[0]] });
  expect(r.nums.get('t1')).toBe(1);
});

test('文：解決済みは resolved。段落をまたぐ引用は、段落ごとの mark（loc の marks は、全部）', () => {
  const art = article(MD);
  const t = on('t1', quoteAnchor('最初の段落です。\n二つ目の段落で'), { resolved: true });
  const r = applyHighlights(art, [t], 1);
  const loc = r.locs.get('t1');
  expect(loc?.kind).toBe('text');
  const marks = loc?.kind === 'text' ? loc.marks : [];
  expect(marks.length).toBeGreaterThan(1);
  expect(marks.every((m) => m.classList.contains('resolved'))).toBe(true);
  expect(marks.map((m) => m.textContent).join('')).toContain('最初の段落です。');
});

test('文：見つからない（修正で文が変わった）・anchor なし・本文より新しい版で作られたもの → none。番号を持たない', () => {
  const art = article(MD);
  const r = applyHighlights(
    art,
    [
      on('lost', quoteAnchor('どこにもない文')),
      on('free', null),
      on('future', quoteAnchor('ここを選びます'), { version: 3 }),
    ],
    2,
  );
  for (const id of ['lost', 'free', 'future']) expect(r.locs.get(id)).toEqual({ kind: 'none' });
  expect(r.nums.size).toBe(0);
  expect(art.querySelector('mark')).toBeNull();
});

test('ブロック：同じ内容（ハッシュ）のブロックに .blk-thread と data-tid。近似なし', () => {
  const art = article(MD);
  const blk = art.querySelectorAll<HTMLElement>('[data-bid]')[2] as HTMLElement;
  const r = applyHighlights(art, [on('t1', blockAnchor(blk))], 1);
  expect(blk.classList.contains('blk-thread')).toBe(true);
  expect(blk.dataset.tid).toBe('t1');
  expect(r.locs.get('t1')).toEqual({ kind: 'block', el: blk });
  expect(r.approx.size).toBe(0);
  expect(r.blocks.map((b) => [b.id, b.tag])).toEqual([
    ['b0', 'h1'],
    ['b1', 'p'],
    ['b2', 'p'],
    ['b3', 'p'],
  ]);
});

test('ブロック：内容が変わったら、近い内容（similar）→ 同じ位置（position）で、推定する。近似は、approx に入る', () => {
  const old = article('# 見出し\n\nこの段落には、コメントを付けた。長い文章である。\n\n別の段落。\n');
  const anchor = blockAnchor(old.querySelectorAll<HTMLElement>('[data-bid]')[1] as HTMLElement);
  // 近い内容
  const art = article('# 見出し\n\nこの段落には、コメントを付けた。長い文章である！\n\n別の段落。\n');
  const r = applyHighlights(art, [on('t1', anchor)], 2);
  expect(r.locs.get('t1')?.kind).toBe('block');
  expect(r.approx.get('t1')).toBe('similar');
  // 内容が全く違っても、同じ種類の、同じ位置
  const art2 = article('# 見出し\n\nまったく別のことを書いた。\n\n別の段落。\n');
  const r2 = applyHighlights(art2, [on('t1', anchor)], 2);
  expect(r2.locs.get('t1')?.kind).toBe('block');
  expect(r2.approx.get('t1')).toBe('position');
  // 同じ種類のブロックがなければ、位置なし
  const art3 = article('# 見出しだけ\n');
  expect(applyHighlights(art3, [on('t1', anchor)], 2).locs.get('t1')).toEqual({ kind: 'none' });
});

test('ブロック：1 つのブロックに複数のコメント：data-tid は最後の 1 つ。番号は、全部', () => {
  const art = article(MD);
  const blk = art.querySelectorAll<HTMLElement>('[data-bid]')[1] as HTMLElement;
  const a = blockAnchor(blk);
  const r = applyHighlights(art, [on('t1', a), on('t2', a)], 1);
  expect(blk.dataset.tid).toBe('t2');
  expect(r.locs.get('t1')).toEqual({ kind: 'block', el: blk });
  expect(r.locs.get('t2')).toEqual({ kind: 'block', el: blk });
  expect(
    [...r.nums.entries()]
      .sort((a, b) => a[1] - b[1])
      .map((e) => e[0])
      .sort(),
  ).toEqual(['t1', 't2']);
  expect(new Set(r.nums.values())).toEqual(new Set([1, 2]));
});

test('範囲：rect を持つブロックのコメントは region（基準の要素・比率）', () => {
  const art = article('![図](assets/a.png)\n\n段落\n');
  const blk = art.querySelector<HTMLElement>('[data-bid]') as HTMLElement;
  const rect = { x: 0.1, y: 0.2, w: 0.3, h: 0.4 };
  const r = applyHighlights(art, [on('t1', { ...blockAnchor(blk), rect })], 1);
  const loc = r.locs.get('t1');
  expect(loc?.kind).toBe('region');
  if (loc?.kind === 'region') {
    expect(loc.el).toBe(blk);
    expect(loc.rect).toEqual(rect);
    expect(loc.frame).toBe(blk.querySelector('img'));
  }
  expect(r.nums.get('t1')).toBe(1);
});

test('番号は、本文の順（スレッドの順ではない）。位置のないものを飛ばして、詰める', () => {
  const art = article(MD);
  const r = applyHighlights(
    art,
    [
      on('late', quoteAnchor('三つ目の段落')),
      on('none', quoteAnchor('どこにもない')),
      on('early', quoteAnchor('最初の段落')),
      on('mid', quoteAnchor('ここを選びます')),
    ],
    1,
  );
  expect(r.nums.get('early')).toBe(1);
  expect(r.nums.get('mid')).toBe(2);
  expect(r.nums.get('late')).toBe(3);
  expect(r.nums.has('none')).toBe(false);
});

test('位置づけに使う文字から、図・実行できる枠・差分の箱は除く（枠の見出しの文字は、コメントの対象にならない）', () => {
  const art = article('本文の段落。\n\n```mermaid\ngraph TD\nA-->B\n```\n\n```html-app\nconsole.log(1)\n```\n');
  art.append(Object.assign(document.createElement('details'), { className: 'diffbox', textContent: '差分の文字' }));
  const idx = textIndex(art);
  expect(idx.text).toBe('本文の段落。\n');
  // 枠の見出しは、引用として見つからない
  const r = applyHighlights(art, [on('t1', quoteAnchor('実行できる枠 1'))], 1);
  expect(r.locs.get('t1')).toEqual({ kind: 'none' });
  // ブロックの文字は、ソース（図・枠）
  expect(r.blocks.map((b) => b.tag)).toEqual(['p', 'div', 'div']);
  expect(r.blocks[2]?.text).toBe('html-app console.log(1)');
});

test('入力中の対象：文は mark.hl.pending（最初の mark を返す）・ブロックは .blk-pending・範囲は、枠だけ（ブロックの枠を付けない）。外すと、元に戻る', () => {
  const art = article(MD);
  const before = art.innerHTML;
  const el = markPending(art, quoteAnchor('ここを選びます'), null);
  expect(el?.matches('mark.hl.pending[data-tid="pending"]')).toBe(true);
  expect(markPending(art, null, el)).toBeNull();
  expect(art.innerHTML).toBe(before);

  const blk = art.querySelectorAll<HTMLElement>('[data-bid]')[1] as HTMLElement;
  const b = markPending(art, blockAnchor(blk), null);
  expect(b).toBe(blk);
  expect(blk.classList.contains('blk-pending')).toBe(true);
  const reg = markPending(art, { ...blockAnchor(blk), rect: { x: 0, y: 0, w: 1, h: 1 } }, b);
  expect(reg).toBe(blk);
  expect(blk.classList.contains('blk-pending')).toBe(false);
  clearPending(art);
  expect(markPending(art, quoteAnchor('どこにもない'), null)).toBeNull();
  // 何もなければ、本文に触らない
  const same = art.innerHTML;
  expect(markPending(art, null, null)).toBeNull();
  expect(art.innerHTML).toBe(same);
});

test('入力中の強調は、コメントの強調と、文字を変えない（本文の文字は、強調で、増えも減りもしない）', () => {
  const art = article(MD);
  const text = textIndex(art).text;
  applyHighlights(art, [on('t1', quoteAnchor('ここを選びます')), on('t2', quoteAnchor('選びます'))], 1);
  markPending(art, quoteAnchor('二つ目'), null);
  expect(textIndex(art).text).toBe(text);
});

// 開きタグだけの行から始まる HTML ブロック（marked は、1 行に収めた <svg> を、段落の中のインライン HTML にする）
const SVG =
  '<svg width="200" height="80" viewBox="0 0 200 80">\n<rect width="200" height="80" fill="#eee"/>\n<text x="10" y="40">図の文字</text>\n</svg>';

test('本文の直下の <svg>：ブロックとして位置づけられる（.blk-thread・block）。後ろのブロックの番号は、ずれない。範囲は、svg 自身が基準', () => {
  const art = article(`前の段落。\n\n${SVG}\n\n後ろの段落。\n`);
  const els = art.querySelectorAll<HTMLElement | SVGElement>('[data-bid]');
  expect([...els].map((e) => [e.tagName.toLowerCase(), e.dataset.bid])).toEqual([
    ['p', 'b0'],
    ['svg', 'b1'],
    ['p', 'b2'],
  ]);
  const svg = els[1] as SVGElement;
  const after = els[2] as HTMLElement;
  const rect = { x: 0.1, y: 0.1, w: 0.5, h: 0.5 };
  const r = applyHighlights(
    art,
    [on('t1', blockAnchor(after)), on('t2', blockAnchor(svg)), on('t3', { ...blockAnchor(svg), rect })],
    1,
  );
  expect(r.blocks.map((b) => [b.id, b.tag])).toEqual([
    ['b0', 'p'],
    ['b1', 'svg'],
    ['b2', 'p'],
  ]);
  expect(r.locs.get('t2')).toEqual({ kind: 'block', el: svg });
  const reg = r.locs.get('t3');
  expect(reg?.kind === 'region' && reg.frame === svg && reg.el === svg).toBe(true);
  expect(svg.classList.contains('blk-thread')).toBe(true);
  expect(svg.dataset.tid).toBe('t3'); // 同じブロックに複数：最後の 1 つ
  expect(after.dataset.tid).toBe('t1');
  expect([r.nums.get('t2'), r.nums.get('t3'), r.nums.get('t1')].sort()).toEqual([1, 2, 3]);
  expect(r.nums.get('t1')).toBe(3);
  // 入力中の対象にも、できる
  expect(markPending(art, blockAnchor(svg), null)).toBe(svg);
  expect(svg.classList.contains('blk-pending')).toBe(true);
});
