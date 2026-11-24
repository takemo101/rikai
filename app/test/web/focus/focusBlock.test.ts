// @vitest-environment jsdom
// 拡大表示（F43）が、本文のブロックを指す・探し直す：本文は、更新のたびに描き直されて、要素が作り直される。内容の印で、探し直せること・消えたら見つからないこと。
import { afterEach, expect, test } from 'vitest';
import { blockEls, blockLabel, frameOf, markBlocks, mediaOf } from '../../../src/web/doc/render/blocks';
import { entryElementOf, focusRefOf, resolveFocusBlock, threadsInBlock } from '../../../src/web/focus/focusBlock';
import type { BlockRef, DocModel, ThreadLoc } from '../../../src/web/store/doc';
import { thread } from '../helpers';

afterEach(() => document.body.replaceChildren());

/** 本文を作る（ブロックの番号・ハッシュを付ける）。BlockRef の一覧も返す */
function article(html: string): { art: HTMLElement; blocks: BlockRef[] } {
  const art = document.createElement('article');
  art.id = 'article';
  art.innerHTML = html;
  document.body.append(art);
  markBlocks(art);
  const blocks = blockEls(art).map<BlockRef>((el) => ({
    id: el.dataset.bid ?? '',
    hash: el.dataset.bhash ?? '',
    tag: el.tagName.toLowerCase(),
    text: el.textContent ?? '',
    el,
  }));
  return { art, blocks };
}

test('印：画像は src で見分ける（画像のブロックは、内容の文字がなく、ハッシュが、どれも同じ）。更新で作り直されても、探し直せる', () => {
  const html = '<p>前</p><p><img src="assets/a.png" alt="A"></p><p><img src="assets/b.png" alt="B"></p><p>後</p>';
  const first = article(html);
  const imgB = first.art.querySelectorAll('img')[1] as HTMLImageElement;
  const ref = focusRefOf(imgB.closest('p') as HTMLElement, imgB);
  expect(ref).toMatchObject({ id: 'b2', src: 'assets/b.png', base: true });
  // 本文を描き直す（要素が、すべて、作り直される）。前に、画像が、1 枚、増えた
  document.body.replaceChildren();
  const second = article(`<p><img src="assets/z.png"></p>${html}`);
  if (!ref) throw new Error('ref');
  const found = resolveFocusBlock(second.blocks, ref);
  expect(found?.el.querySelector('img')?.getAttribute('src')).toBe('assets/b.png'); // 番号が変わっても、同じ画像
  expect(found?.id).toBe('b3');
});

test('消えた・内容が変わった・本文から外れた（描き直しの途中の古い要素）ブロックは、見つからない', () => {
  const a = article(
    '<p>前</p><div class="mermaid-block" data-mermaid="graph%20LR%0A%20A--%3EB"><svg viewBox="0 0 1 1"></svg></div>',
  );
  const mm = a.art.querySelector('.mermaid-block') as HTMLElement;
  const ref = focusRefOf(mm, mm.querySelector('svg'));
  if (!ref) throw new Error('ref');
  expect(resolveFocusBlock(a.blocks, ref)?.el).toBe(mm);
  // 図の内容が変わった（ソースが違う）：ハッシュが違う
  document.body.replaceChildren();
  const changed = article(
    '<p>前</p><div class="mermaid-block" data-mermaid="graph%20LR%0A%20A--%3EC"><svg viewBox="0 0 1 1"></svg></div>',
  );
  expect(resolveFocusBlock(changed.blocks, ref)).toBeNull();
  // 古い要素（本文から外れた）は、同じ内容でも、見つけない
  mm.remove();
  expect(resolveFocusBlock(a.blocks, ref)).toBeNull();
});

test('同じ内容のブロックが 2 つあるとき、同じ番号のほうを選ぶ。範囲の基準は、ブロックの最初の画像・図だけ（base）', () => {
  const dup = '<div class="mermaid-block" data-mermaid="x"><svg viewBox="0 0 1 1"></svg></div>';
  const a = article(`<p>前</p>${dup}${dup}`);
  const second = a.art.querySelectorAll('.mermaid-block')[1] as HTMLElement;
  const ref = focusRefOf(second, second.querySelector('svg'));
  if (!ref) throw new Error('ref');
  expect(resolveFocusBlock(a.blocks, ref)?.el).toBe(second);
  // 1 つのブロックに、画像が 2 つ：2 つ目は、基準ではない
  document.body.replaceChildren();
  const two = article('<p><img src="1.png"><img src="2.png"></p>');
  const [i1, i2] = [...two.art.querySelectorAll('img')] as HTMLImageElement[];
  const p = two.art.querySelector('p') as HTMLElement;
  expect(focusRefOf(p, i1 as HTMLImageElement)?.base).toBe(true);
  expect(focusRefOf(p, i2 as HTMLImageElement)?.base).toBe(false);
  // html-app の枠は、画像・図ではない：基準の問題がない
  expect(focusRefOf(p, null)?.base).toBe(true);
});

test('返信の中の画像・図（data-bid がない）は、印を作らない', () => {
  const body = document.createElement('div');
  body.innerHTML = '<p><img src="x.png"></p>';
  document.body.append(body);
  const p = body.querySelector('p') as HTMLElement;
  expect(focusRefOf(p, p.querySelector('img'))).toBeNull();
});

test('このブロックのコメント：ブロックそのもの・範囲・ブロックの中の文。ほかのブロックのコメントは、入らない', () => {
  const a = article('<p>前の文</p><p><img src="a.png"></p><p>後の文</p>');
  const [p0, p1, p2] = a.blocks.map((b) => b.el);
  const mark = document.createElement('mark');
  (p0 as HTMLElement).append(mark);
  const model = {
    locs: new Map<string, ThreadLoc>([
      ['blk', { kind: 'block', el: p1 as HTMLElement }],
      [
        'reg',
        { kind: 'region', el: p1 as HTMLElement, frame: p1 as HTMLElement, rect: { x: 0, y: 0, w: 0.5, h: 0.5 } },
      ],
      ['txt', { kind: 'text', marks: [mark] }],
      ['other', { kind: 'block', el: p2 as HTMLElement }],
      ['none', { kind: 'none' }],
    ]),
  } as DocModel;
  const threads = ['blk', 'reg', 'txt', 'other', 'none'].map((id) => thread({ id }));
  expect(threadsInBlock(model, p1 as HTMLElement, threads).map((t) => t.id)).toEqual(['blk', 'reg']);
  expect(threadsInBlock(model, p0 as HTMLElement, threads).map((t) => t.id)).toEqual(['txt']);
});

test('閉じたときの、フォーカスの戻り先：本文の入口（フォーカスできる画像・図／html-app の「拡大表示」ボタン）', () => {
  const a = article(
    '<p><img src="a.png" data-focus-entry tabindex="0"></p><div class="htmlapp"><button data-focus-open></button></div><p>文</p>',
  );
  const [im, app, txt] = a.blocks.map((b) => b.el);
  expect(entryElementOf(im as HTMLElement)?.tagName).toBe('IMG');
  expect(entryElementOf(app as HTMLElement)?.hasAttribute('data-focus-open')).toBe(true);
  expect(entryElementOf(txt as HTMLElement)).toBeNull();
});

test('範囲の基準：html-app の枠のブロックは、枠の置き場（.appview）。見出しのツールバーのアイコン（svg）ではない。画像・図は、これまでどおり', () => {
  const a = article(
    '<div class="htmlapp"><div class="cap"><span class="apptools"><svg class="lucide"></svg></span></div><div class="appview"><div class="appscale"><iframe></iframe></div></div><details class="appsrc"></details></div>' +
      '<p><img src="a.png"></p><div class="mermaid-block"><svg viewBox="0 0 1 1"></svg></div>',
  );
  const [app, img, mm] = a.blocks.map((b) => b.el);
  expect(mediaOf(app as HTMLElement)).toBeNull();
  expect(frameOf(app as HTMLElement)).toBe(app?.querySelector('.appview'));
  expect(frameOf(img as HTMLElement)).toBe(img?.querySelector('img'));
  expect(frameOf(mm as HTMLElement)).toBe(mm?.querySelector('svg'));
  // 枠を配れない（古いサーバー：.appview がない）ときは、ブロックそのもの
  document.body.replaceChildren();
  const old = article('<div class="htmlapp"><div class="cap"><svg></svg></div><div class="mm-err">古い</div></div>');
  const el = old.blocks[0]?.el as HTMLElement;
  expect(frameOf(el)).toBe(el);
});

test('ブロックそのものが <img> のとき（資料の生の <img>）：印を作れ、探し直せる（F37 から後退しない）。ラベルにも alt が出る', () => {
  const html =
    '<p>前</p><img src="assets/a.png" width="800" height="600" alt="生の画像"><img src="assets/b.png" alt="B"><p>後</p>';
  const first = article(html);
  const imgs = [...first.art.querySelectorAll(':scope > img')] as HTMLImageElement[];
  const b = imgs[1] as HTMLImageElement;
  expect(b.classList.contains('blk')).toBe(true); // <img> そのものが、ブロック
  const ref = focusRefOf(b, b);
  expect(ref).toMatchObject({ src: 'assets/b.png', base: true });
  document.body.replaceChildren();
  const second = article(`<p>足した</p>${html}`);
  if (!ref) throw new Error('ref');
  const found = resolveFocusBlock(second.blocks, ref);
  expect((found?.el as HTMLImageElement | undefined)?.getAttribute('src')).toBe('assets/b.png'); // 同じ <img>
  // 画像が消えたら、見つからない
  document.body.replaceChildren();
  const third = article('<p>前</p><img src="assets/z.png"><p>後</p>');
  expect(resolveFocusBlock(third.blocks, ref)).toBeNull();
  // 入口（フォーカスの戻り先）・ラベル
  expect(entryElementOf(b)).toBeNull(); // 印が、まだない
  b.setAttribute('data-focus-entry', '');
  expect(entryElementOf(b)).toBe(b);
  expect(blockLabel(imgs[0] as HTMLImageElement)).toBe('画像: 生の画像');
});
