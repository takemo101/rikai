// @vitest-environment jsdom
// 数式の拡大表示：描いた数式（HTML）の複製。本文を変えない・自然な大きさ（本文の式の箱）・開かないとき（箱を測れない）・store への開き方
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { fillDiagrams } from '../../../src/web/doc/render';
import { markBlocks } from '../../../src/web/doc/render/blocks';
import { mdToFragment } from '../../../src/web/doc/render/markdown';
import { cloneMathForZoom } from '../../../src/web/focus/zoomMath';
import { openZoomOf } from '../../../src/web/focus/zoomOpen';
import { useUi } from '../../../src/web/store/ui';
import { resetAll } from '../helpers';

async function page(md: string): Promise<HTMLElement> {
  const box = document.createElement('div');
  box.id = 'article';
  box.append(mdToFragment(md, { slug: 'demo', kind: 'doc' }));
  markBlocks(box);
  document.body.append(box);
  await fillDiagrams(box);
  return box;
}
const sized = (el: Element, w: number, h: number) =>
  vi
    .spyOn(el, 'getBoundingClientRect')
    .mockReturnValue({ width: w, height: h, x: 0, y: 0, top: 0, left: 0, right: w, bottom: h, toJSON: () => ({}) });

beforeEach(() => resetAll());
afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

test('式の複製：外側（.katex-display）ごと、深いコピー。本文の DOM は、変えない。大きさは、本文の式の箱', async () => {
  const art = await page('$$\\frac{a}{b}$$\n');
  const katex = art.querySelector<HTMLElement>('.math-block .katex');
  if (!katex) throw new Error('式がない');
  sized(katex, 120, 48);
  const before = art.innerHTML;
  const z = cloneMathForZoom(katex);
  expect(z?.size).toEqual({ w: 120, h: 48 });
  expect(z?.node.className).toBe('zoom-math');
  expect(z?.node.querySelector(':scope > .katex-display > .katex')).not.toBeNull();
  expect(z?.node.querySelector('.katex')).not.toBe(katex); // 複製
  expect(art.innerHTML).toBe(before);
  expect(z?.node.querySelector('[id]')).toBeNull(); // KaTeX は、id を出さない：付け替えは要らない
});

test('式の箱を測れない（隠れている）ときは、開かない', async () => {
  const art = await page('$$x$$\n');
  const katex = art.querySelector<HTMLElement>('.math-block .katex');
  if (!katex) throw new Error('式がない');
  expect(cloneMathForZoom(katex)).toBeNull(); // jsdom は、大きさがない
  openZoomOf(katex);
  expect(useUi.getState().lightbox).toBeNull();
});

test('本文の数式を開く：math の対象（複製・自然な大きさ・本文のブロックを指す印）。返信の数式は、印なし（ステージだけ）', async () => {
  const art = await page('前。\n\n$$\\sqrt{x}$$\n');
  const katex = art.querySelector<HTMLElement>('.math-block .katex');
  if (!katex) throw new Error('式がない');
  sized(katex, 90, 40);
  openZoomOf(katex);
  const t = useUi.getState().lightbox;
  expect(t?.kind).toBe('math');
  if (t?.kind !== 'math') throw new Error('math ではない');
  expect(t.size).toEqual({ w: 90, h: 40 });
  expect(t.focus).toMatchObject({ id: 'b1', src: null, base: true }); // 範囲を選べる（基準は、式そのもの）
  useUi.getState().closeLightbox();
  // 返信の本体（#article の外）
  const reply = document.createElement('div');
  reply.className = 'msg';
  reply.innerHTML = '<div class="body md"></div>';
  const body = reply.querySelector<HTMLElement>('.body');
  if (!body) throw new Error('本体がない');
  body.append(mdToFragment('$$y$$', { slug: 'demo', kind: 'reply' }));
  document.body.append(reply);
  await fillDiagrams(body);
  const rk = body.querySelector<HTMLElement>('.katex');
  if (!rk) throw new Error('式がない');
  sized(rk, 50, 30);
  openZoomOf(rk);
  const r = useUi.getState().lightbox;
  expect(r?.kind).toBe('math');
  expect(r?.focus).toBeUndefined();
});
