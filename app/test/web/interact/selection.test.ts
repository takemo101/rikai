// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test } from 'vitest';
import { markBlocks } from '../../../src/web/doc/render/blocks';
import { anchorFromSelection, regionLabel } from '../../../src/web/interact/selection';

let article: HTMLElement;

beforeEach(() => {
  article = document.createElement('article');
  article.id = 'article';
  document.body.append(article);
});
afterEach(() => {
  getSelection()?.removeAllRanges();
  document.body.replaceChildren();
});

/** 本文を、HTML で作り（ブロックに番号を付け）、選択を、(開始のノード・位置)〜(終了のノード・位置) にする */
function setup(html: string): void {
  article.innerHTML = html;
  markBlocks(article);
}
function select(startNode: Node, start: number, endNode: Node, end: number): Selection {
  const r = document.createRange();
  r.setStart(startNode, start);
  r.setEnd(endNode, end);
  const sel = getSelection();
  if (!sel) throw new Error('Selection がない');
  sel.removeAllRanges();
  sel.addRange(r);
  return sel;
}
const text = (selector: string): Text => {
  const n = article.querySelector(selector)?.firstChild;
  if (!(n instanceof Text)) throw new Error(`${selector} に文字がない`);
  return n;
};

test('文の選択：quote・前後 32 文字・ブロックの番号とハッシュ（ブロックの属性は持たない）', () => {
  const body = `${'あ'.repeat(40)}選んだ文です${'い'.repeat(40)}`;
  setup(`<p>先頭</p><p id="t">${body}</p>`);
  const n = text('#t');
  const sel = select(n, 40, n, 46);
  const a = anchorFromSelection(article, sel);
  expect(a).toMatchObject({
    blockId: 'b1',
    quote: '選んだ文です',
    prefix: 'あ'.repeat(32),
    suffix: 'い'.repeat(32),
    label: '',
    blockTag: '',
    blockText: '',
  });
  expect(a?.blockHash).toBe(article.querySelector<HTMLElement>('#t')?.dataset.bhash);
});

test('前後の空白は、引用から外す。空白だけの選択は、null', () => {
  setup('<p id="t">  こんにちは  </p>');
  const n = text('#t');
  expect(anchorFromSelection(article, select(n, 0, n, 9))?.quote).toBe('こんにちは');
  expect(anchorFromSelection(article, select(n, 0, n, 2))).toBeNull();
});

test('折りたたんだ選択・本文の外の選択・選択なしは、null', () => {
  setup('<p id="t">本文</p>');
  document.body.insertAdjacentHTML('beforeend', '<p id="out">外の文</p>');
  const n = text('#t');
  expect(anchorFromSelection(article, select(n, 1, n, 1))).toBeNull();
  const out = document.querySelector('#out')?.firstChild;
  if (!out) throw new Error('外の文がない');
  expect(anchorFromSelection(article, select(out, 0, out, 2))).toBeNull();
  expect(anchorFromSelection(article, null)).toBeNull();
});

test('引用は、2000 文字まで', () => {
  setup(`<p id="t">${'あ'.repeat(3000)}</p>`);
  const n = text('#t');
  expect(anchorFromSelection(article, select(n, 0, n, 3000))?.quote).toHaveLength(2000);
});

test('文字の数え方：実行できる枠・Mermaid・差分の箱の中の文字は、引用の位置に数えない（位置づけと同じ）', () => {
  setup(
    '<div class="htmlapp" data-src="x"><p>枠の見出し</p></div><div class="diffbox"><p>差分の文字</p></div><p id="t">前の文を選ぶ。後の文</p>',
  );
  const n = text('#t');
  const a = anchorFromSelection(article, select(n, 0, n, 5));
  expect(a?.quote).toBe('前の文を選');
  expect(a?.prefix).toBe(''); // 枠・差分の文字は、前の文脈に入らない
});

test('差分の箱の文字から選び始めたときは、断る。本文から選び始めて、終わりが差分の箱でも、受ける', () => {
  setup('<p id="t">本文の文</p><div class="diffbox"><p id="d">差分の文字</p></div>');
  const t = text('#t');
  const d = text('#d');
  expect(anchorFromSelection(article, select(d, 0, d, 3))).toBeNull();
  const a = anchorFromSelection(article, select(t, 0, d, 2));
  expect(a?.quote).toBe('本文の文');
});

test('Mermaid の図の中を選ぶと、その図のブロックへのコメント', () => {
  setup('<div class="mermaid-block" data-mermaid="graph%20TD"><svg><text id="m">ノード</text></svg></div>');
  const m = text('#m');
  const a = anchorFromSelection(article, select(m, 0, m, 2));
  expect(a).toMatchObject({ blockId: 'b0', quote: '', label: '図', blockTag: 'DIV', blockText: 'graph%20TD' });
});

test('regionLabel：画像（alt）・Mermaid の図・インライン svg（ブロックの文字）', () => {
  setup(
    '<p><img id="i" alt="構成図"></p><p><img id="j"></p><div class="mermaid-block" id="m"><svg id="ms"></svg></div><p id="s"><svg id="is"></svg>図の説明</p>',
  );
  const el = (id: string): Element => {
    const e = article.querySelector(`#${id}`);
    if (!e) throw new Error(id);
    return e;
  };
  expect(regionLabel(el('i').parentElement ?? el('i'), el('i'))).toBe('画像: 構成図');
  expect(regionLabel(el('j').parentElement ?? el('j'), el('j'))).toBe('画像');
  expect(regionLabel(el('m'), el('ms'))).toBe('図');
  expect(regionLabel(el('s'), el('is'))).toBe('図の説明');
});
