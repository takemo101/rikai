// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { topicKey } from '../../../src/web/api/queries';
import { queryClient } from '../../../src/web/api/queryClient';
import { markBlocks } from '../../../src/web/doc/render/blocks';
import { finishRegion, type RegionDeps, rasterRegion, UserError } from '../../../src/web/interact/region';
import { useUi } from '../../../src/web/store/ui';
import { meta, resetAll, topicState } from '../helpers';

const rects = new Map<Element, DOMRect>();
function place(el: Element, left: number, top: number, width: number, height: number): void {
  rects.set(el, new DOMRect(left, top, width, height));
}
const spy = vi.spyOn(Element.prototype, 'getBoundingClientRect');
let article: HTMLElement;

beforeEach(() => {
  resetAll();
  rects.clear();
  spy.mockImplementation(function (this: Element) {
    return rects.get(this) ?? new DOMRect(0, 0, 0, 0);
  });
  article = document.createElement('article');
  article.id = 'article';
  document.body.append(article);
  openLatest();
});
afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

/** 最新版（v1 のみ）を見ている */
function openLatest(): void {
  queryClient.setQueryData(topicKey('demo'), topicState());
  location.hash = '#/demo/root';
}
function body(html: string): HTMLElement[] {
  article.innerHTML = html;
  markBlocks(article);
  return [...article.querySelectorAll<HTMLElement>('[data-bid]')];
}
const png = (): File => new File([new Uint8Array([1, 2, 3])], 'region.png', { type: 'image/png' });
const ui = () => useUi.getState();
const deps = (over: Partial<RegionDeps> = {}): RegionDeps => ({
  attach: vi.fn(async () => ({ name: 'c-abc.png' })),
  raster: vi.fn(async () => png()),
  crop: vi.fn(async () => png()),
  ...over,
});
const toastMsg = () => ui().toast?.msg;

test('本文に重ならない範囲：トーストを出して、入力欄を開かない', () => {
  const [p] = body('<p>本文</p>');
  if (p) place(p, 0, 0, 100, 20);
  const d = deps();
  finishRegion({ left: 500, top: 500, width: 50, height: 50 }, d);
  expect(toastMsg()).toBe('そこには本文がありません。本文の上で、範囲を選んでください');
  expect(ui().composer).toBeNull();
  expect(d.raster).not.toHaveBeenCalled();
});

test('文・複数のブロックにまたがる範囲：左上のブロックが基準・比率・「範囲：」の名前・本文を画像にする', async () => {
  const [a, b] = body('<p>最初のブロックの文字</p><p>次のブロック</p>');
  if (!a || !b) throw new Error('ブロックがない');
  place(a, 100, 100, 400, 40);
  place(b, 100, 160, 400, 40);
  const d = deps();
  const vr = { left: 200, top: 110, width: 100, height: 70 };
  finishRegion(vr, d);
  const c = ui().composer;
  expect(c?.anchor).toMatchObject({
    blockId: 'b0',
    label: '範囲：最初のブロックの文字',
    rect: { x: 0.25, y: 0.25, w: 0.25, h: 1.75 },
  });
  expect(d.raster).toHaveBeenCalledWith(vr, article);
  expect(d.crop).not.toHaveBeenCalled();
  await vi.waitFor(() => expect(ui().composer?.regionImg).toBe('c-abc.png'));
  expect(d.attach).toHaveBeenCalledWith('demo', 'AQID'); // 画像の中身（base64）
  expect(ui().drafts.imgs.composer).toEqual(['c-abc.png']);
  expect(ui().uploading).toBe(0);
});

test('画像の中に収まる範囲：元の画像から切り出す。名前は「画像: alt の一部」。基準は画像', async () => {
  const [blk] = body('<p><img alt="構成図" src="x.png"></p>');
  const img = article.querySelector('img');
  if (!blk || !img) throw new Error('画像がない');
  Object.defineProperty(img, 'naturalWidth', { value: 800 });
  Object.defineProperty(img, 'complete', { value: true });
  place(blk, 100, 100, 600, 220);
  place(img, 100, 110, 400, 200);
  const d = deps();
  finishRegion({ left: 200, top: 160, width: 100, height: 50 }, d);
  expect(ui().composer?.anchor).toMatchObject({
    label: '画像: 構成図の一部',
    rect: { x: 0.25, y: 0.25, w: 0.25, h: 0.25 },
  });
  expect(d.crop).toHaveBeenCalledWith(img, { x: 0.25, y: 0.25, w: 0.25, h: 0.25 });
  expect(d.raster).not.toHaveBeenCalled();
  await vi.waitFor(() => expect(d.attach).toHaveBeenCalled());
});

test('画像の外へ出る範囲は、画像の一部ではない：基準は画像のまま、本文を画像にする', () => {
  const [blk] = body('<p><img alt="構成図" src="x.png"></p>');
  const img = article.querySelector('img');
  if (!blk || !img) throw new Error('画像がない');
  Object.defineProperty(img, 'naturalWidth', { value: 800 });
  Object.defineProperty(img, 'complete', { value: true });
  place(blk, 100, 100, 600, 220);
  place(img, 100, 110, 400, 200);
  const d = deps();
  finishRegion({ left: 300, top: 160, width: 300, height: 50 }, d); // 右へ、画像からはみ出る
  expect(ui().composer?.anchor.label).toMatch(/^範囲：/);
  expect(ui().composer?.anchor.rect).toEqual({ x: 0.5, y: 0.25, w: 0.75, h: 0.25 });
  expect(d.raster).toHaveBeenCalled();
  expect(d.crop).not.toHaveBeenCalled();
});

test('壊れた画像（読み込みが終わって、大きさがない）は、ブロックが基準', () => {
  const [blk] = body('<p><img alt="壊れ" src="x.png"></p>');
  const img = article.querySelector('img');
  if (!blk || !img) throw new Error('画像がない');
  Object.defineProperty(img, 'complete', { value: true }); // naturalWidth は 0
  place(blk, 100, 100, 400, 100);
  place(img, 100, 100, 16, 16);
  const d = deps();
  finishRegion({ left: 200, top: 120, width: 100, height: 40 }, d);
  expect(ui().composer?.anchor.rect).toEqual({ x: 0.25, y: 0.2, w: 0.25, h: 0.4 });
  expect(d.crop).not.toHaveBeenCalled();
});

test('基準が小さすぎる（比率が 0.05% 未満）・基準に大きさがない：トーストを出して、開かない', () => {
  const [a] = body('<p>本文</p>');
  if (!a) throw new Error();
  place(a, 0, 0, 100000, 100);
  const d = deps();
  finishRegion({ left: 10, top: 10, width: 10, height: 10 }, d); // 幅 10/100000 = 0.01%
  expect(toastMsg()).toBe('範囲が小さすぎます。ドラッグで、範囲を選んでください');
  expect(ui().composer).toBeNull();
  expect(d.raster).not.toHaveBeenCalled();
});

test('画像にできなかった（ブラウザの都合）：トーストで知らせ、入力欄は開いたまま（位置だけで、コメントできる）', async () => {
  const [a] = body('<p>本文</p>');
  if (!a) throw new Error();
  place(a, 0, 0, 400, 100);
  const d = deps({ raster: vi.fn(async () => Promise.reject(new Error('foreignObject'))) });
  finishRegion({ left: 10, top: 10, width: 100, height: 40 }, d);
  expect(ui().composer).not.toBeNull();
  expect(ui().uploading).toBe(1); // 作っている間は、「アップロード中」
  await vi.waitFor(() => expect(toastMsg()).toMatch(/位置だけで、コメントできます/));
  expect(ui().toast?.err).toBe(true);
  expect(ui().composer).not.toBeNull();
  expect(ui().uploading).toBe(0);
  expect(d.attach).not.toHaveBeenCalled();
});

test('原因が分かる失敗（UserError）は、その文言をそのまま出す', async () => {
  const [a] = body('<p>本文</p>');
  if (!a) throw new Error();
  place(a, 0, 0, 400, 100);
  const d = deps({ raster: vi.fn(async () => Promise.reject(new UserError('大きすぎます'))) });
  finishRegion({ left: 10, top: 10, width: 100, height: 40 }, d);
  await vi.waitFor(() => expect(toastMsg()).toBe('大きすぎます'));
});

test('画像にしている間に、入力欄をやめたら、付けない（別の入力欄に出ない）', async () => {
  const [a] = body('<p>本文</p>');
  if (!a) throw new Error();
  place(a, 0, 0, 400, 100);
  let done: (f: File) => void = () => {};
  const d = deps({
    raster: vi.fn(
      () =>
        new Promise<File>((r) => {
          done = r;
        }),
    ),
  });
  finishRegion({ left: 10, top: 10, width: 100, height: 40 }, d);
  ui().closeComposer();
  done(png());
  await vi.waitFor(() => expect(ui().uploading).toBe(0));
  expect(d.attach).not.toHaveBeenCalled();
  expect(ui().drafts.imgs.composer ?? []).toEqual([]);
});

test('保存している間に、入力欄をやめた：付けない', async () => {
  const [a] = body('<p>本文</p>');
  if (!a) throw new Error();
  place(a, 0, 0, 400, 100);
  let saved: (r: { name: string }) => void = () => {};
  const attach = vi.fn(
    () =>
      new Promise<{ name: string }>((r) => {
        saved = r;
      }),
  );
  finishRegion({ left: 10, top: 10, width: 100, height: 40 }, deps({ attach }));
  await vi.waitFor(() => expect(attach).toHaveBeenCalled());
  ui().closeComposer();
  saved({ name: 'c-late.png' });
  await vi.waitFor(() => expect(ui().uploading).toBe(0));
  expect(ui().drafts.imgs.composer ?? []).toEqual([]);
});

test('保存している間に、範囲を選び直した（入力欄は、開いたまま。対象だけが変わった）：前の範囲の画像は、付けない', async () => {
  const [a] = body('<p>本文</p>');
  if (!a) throw new Error();
  place(a, 0, 0, 400, 100);
  let saveFirst: (r: { name: string }) => void = () => {};
  const first = vi.fn(
    () =>
      new Promise<{ name: string }>((r) => {
        saveFirst = r;
      }),
  );
  finishRegion({ left: 10, top: 10, width: 100, height: 40 }, deps({ attach: first }));
  await vi.waitFor(() => expect(first).toHaveBeenCalled());
  finishRegion(
    { left: 20, top: 20, width: 100, height: 40 },
    deps({ attach: vi.fn(async () => ({ name: 'c-2.png' })) }),
  );
  await vi.waitFor(() => expect(ui().composer?.regionImg).toBe('c-2.png'));
  saveFirst({ name: 'c-1.png' });
  await vi.waitFor(() => expect(ui().uploading).toBe(0));
  expect(ui().drafts.imgs.composer).toEqual(['c-2.png']);
});

test('画像が、すでに 4 枚：付けず、トーストで知らせる', async () => {
  const [a] = body('<p>本文</p>');
  if (!a) throw new Error();
  place(a, 0, 0, 400, 100);
  const d = deps();
  finishRegion({ left: 10, top: 10, width: 100, height: 40 }, d);
  for (const n of ['1', '2', '3', '4']) ui().addDraftImg('composer', n);
  await vi.waitFor(() => expect(toastMsg()).toBe('画像は 4 枚までです'));
  expect(d.attach).not.toHaveBeenCalled();
});

test('最新版でないとき：入力欄を開かず、画像を作る作業の失敗も、トーストに出ない', async () => {
  queryClient.setQueryData(
    topicKey('demo'),
    topicState({ meta: meta({ pages: { root: { title: 'T', parent: null, versions: 2, createdAt: '' } } }) }),
  );
  location.hash = '#/demo/root/v1';
  const [a] = body('<p>本文</p>');
  if (!a) throw new Error();
  place(a, 0, 0, 400, 100);
  const d = deps({ raster: vi.fn(async () => Promise.reject(new Error('x'))) });
  finishRegion({ left: 10, top: 10, width: 100, height: 40 }, d);
  expect(toastMsg()).toBe('コメントは最新版にだけ付けられます');
  expect(ui().composer).toBeNull();
  expect(ui().uploading).toBe(0);
  await Promise.resolve();
  expect(toastMsg()).toBe('コメントは最新版にだけ付けられます');
});

test('F31：枠を調整して、作り直す：前の範囲の画像は外れ、新しい画像が付く（書きかけの文字・自分で付けた画像は残る）', async () => {
  const [a] = body('<p>本文</p>');
  if (!a) throw new Error();
  place(a, 0, 0, 400, 100);
  let n = 0;
  const attach = vi.fn(async () => ({ name: `c-${++n}.png` }));
  finishRegion({ left: 10, top: 10, width: 100, height: 40 }, deps({ attach }));
  await vi.waitFor(() => expect(ui().composer?.regionImg).toBe('c-1.png'));
  ui().setComposerDraft('書きかけ');
  ui().addDraftImg('composer', 'mine.png');
  finishRegion({ left: 20, top: 20, width: 200, height: 40 }, deps({ attach }));
  await vi.waitFor(() => expect(ui().composer?.regionImg).toBe('c-2.png'));
  expect(ui().drafts.imgs.composer).toEqual(['mine.png', 'c-2.png']);
  expect(ui().drafts.composer).toBe('書きかけ');
});

test('範囲を画像にする：重なるブロックの要素が 3000 を超えると、理由つきで断る（巨大な表。1 行だけでも）', async () => {
  const rows = Array.from({ length: 1000 }, () => '<tr><td>a</td><td>b</td></tr>').join('');
  const [t] = body(`<table>${rows}</table>`);
  if (!t) throw new Error();
  place(t, 0, 0, 400, 20000);
  const vr = { left: 10, top: 10, width: 100, height: 20 }; // 表の 1 行だけ
  await expect(rasterRegion(vr, article)).rejects.toThrow(UserError);
  await expect(rasterRegion(vr, article)).rejects.toThrow(/3000/);
});
