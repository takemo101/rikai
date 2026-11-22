// @vitest-environment jsdom
// 番号の丸（#badges .bno）が、ちらつかない：コメントの追加・版の更新・ポーリング（view の作り直し）・描き直しの途中の再配置をまたいで、
// 内容が同じなら、要素は取り外されない。描き直しの途中（新しい DocModel が届く前）も、層を空にしない。
// （e2e の「番号：本文の順…」が、間欠的に落ちた：描き直しのあとの再配置が、同じ内容の丸を、作り直して、測っている最中の要素が、取り外された）
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Anchor, Thread } from '../../../src/shared/types';
import { Article } from '../../../src/web/doc/Article';
import { buildView } from '../../../src/web/lib/view';
import { Overlays } from '../../../src/web/overlay/Overlays';
import { useDoc } from '../../../src/web/store/doc';
import { meta, resetAll, thread, topicState } from '../helpers';

const mermaidRender = vi.fn<(id: string, code: string) => Promise<{ svg: string }>>();
vi.mock('mermaid', () => ({
  default: { initialize: () => {}, render: (id: string, code: string) => mermaidRender(id, code) },
}));

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  resetAll();
  mermaidRender.mockReset();
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  // 要素ごとに、大きさのある矩形（jsdom は、測れない）：本文の中の位置は、data-bid の順
  const rectOf = (el: Element): DOMRect => {
    const bid = Number(
      (el as HTMLElement).dataset?.bid?.slice(1) ??
        (el.closest('[data-bid]') as HTMLElement | null)?.dataset.bid?.slice(1) ??
        0,
    );
    const base =
      el.id === 'docscroll'
        ? { l: 100, t: 50, w: 900, h: 600 }
        : el.id === 'article'
          ? { l: 340, t: 50, w: 600, h: 1000 }
          : { l: 340, t: 100 + bid * 60, w: 600, h: 40 };
    return {
      left: base.l,
      top: base.t,
      width: base.w,
      height: base.h,
      right: base.l + base.w,
      bottom: base.t + base.h,
      x: base.l,
      y: base.t,
      toJSON: () => ({}),
    };
  };
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return rectOf(this);
  });
  vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(function (this: Element) {
    return [rectOf(this)] as unknown as DOMRectList;
  });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 900 });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 22 });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
  Reflect.deleteProperty(HTMLElement.prototype, 'offsetHeight');
});

const MD = '# 題\n\n最初の段落です。\n\n二つ目の段落で、ここを選びます。\n\n三つ目の段落。\n';
const anchor = (quote: string): Anchor => ({
  blockId: '',
  blockHash: '',
  blockTag: '',
  blockText: '',
  quote,
  prefix: '',
  suffix: '',
  label: '',
});
const on = (id: string, quote: string, over: Partial<Thread> = {}): Thread =>
  thread({ id, anchor: anchor(quote), ...over });

function viewOf(threads: Thread[]) {
  const v = buildView(
    { slug: 'demo', page: 'root', version: null },
    topicState({ threads, meta: meta({ pages: { root: { title: 'T', parent: null, versions: 1, createdAt: '' } } }) }),
  );
  if (!v) throw new Error('view');
  return v;
}

function mount(threads: Thread[], md = MD) {
  const scrollRef = { current: null as HTMLElement | null };
  const tree = (t: Thread[], m: string) => {
    const v = viewOf(t);
    return (
      <div
        id="docscroll"
        ref={(el) => {
          scrollRef.current = el;
        }}
      >
        <Article view={v} markdown={m} prevMarkdown={null} />
        <Overlays view={v} scrollRef={scrollRef} />
      </div>
    );
  };
  const r = render(tree(threads, md));
  return { again: (t: Thread[], m = md) => r.rerender(tree(t, m)) };
}

const settle = () => act(async () => {});
const layer = () => document.getElementById('badges') as HTMLElement;
const nums = () => [...layer().querySelectorAll('.bno')].map((e) => e.textContent);
const frame = () => act(() => new Promise<void>((r) => requestAnimationFrame(() => r())));

/** いま層にある、丸の組・枠。あとで、全部が、層に残っている（取り外されていない）ことを確かめる */
function snapshot() {
  const els = [...layer().children];
  return { els, kept: () => els.every((e) => e.parentElement === layer()) };
}

test('ポーリング（view が、同じ内容で、作り直される）・同じ内容の再配置・DocModel の作り直し：丸は、取り外されない', async () => {
  const t1 = on('t1', '最初の段落');
  const t2 = on('t2', 'ここを選びます');
  const { again } = mount([t1, t2]);
  await settle();
  expect(nums()).toEqual(['1', '2']);
  const w = snapshot();
  const first = layer().querySelector('.bno');
  again([{ ...t1, messages: [...t1.messages] }, { ...t2 }]); // 1.5 秒ごとの取得
  await settle();
  window.dispatchEvent(new Event('resize')); // 大きさの変化（ResizeObserver・窓）
  await frame();
  const m = useDoc.getState().model;
  act(() => useDoc.setState({ model: m ? { ...m, epoch: m.epoch + 1 } : m })); // 入力中の強調の付け外しなど
  await frame();
  expect(w.kept()).toBe(true);
  expect(layer().querySelector('.bno')).toBe(first);
  expect(nums()).toEqual(['1', '2']);
});

test('コメントの追加：新しい丸が足される。そのあと、同じ内容の再配置では、取り外されない', async () => {
  const t1 = on('t1', '最初の段落');
  const { again } = mount([t1]);
  await settle();
  expect(nums()).toEqual(['1']);
  again([t1, on('t2', 'ここを選びます')]); // 3 つ目のコメントを足した（スレッドが届く）
  await settle();
  expect(nums()).toEqual(['1', '2']);
  const w = snapshot();
  window.dispatchEvent(new Event('resize'));
  await frame();
  again([t1, on('t2', 'ここを選びます')]);
  await settle();
  await frame();
  expect(w.kept()).toBe(true);
});

test('本文を描き直している途中（新しい DocModel が届く前）：層を空にしない。届いたあと、同じ内容なら、取り外さない', async () => {
  // Mermaid の図がある本文：図の描画を待つあいだ、本文は新しく、DocModel は古い
  let release: (v: { svg: string }) => void = () => {};
  mermaidRender.mockImplementation(() => new Promise((res) => (release = res)));
  const md = `${MD}\n\`\`\`mermaid\ngraph LR\nQ-->R\n\`\`\`\n`;
  const t1 = on('t1', '最初の段落');
  const { again } = mount([t1], MD);
  await settle();
  expect(nums()).toEqual(['1']);
  const bno = layer().querySelector('.bno');
  const w = snapshot();
  // 描き直し（スレッドが増える）。図の描画が終わらない間
  again([t1, on('t2', 'ここを選びます')], md);
  await settle();
  expect(useDoc.getState().model?.blocks.length).toBe(4); // まだ、古い DocModel
  window.dispatchEvent(new Event('resize')); // この間の再配置
  await frame();
  expect(layer().querySelector('.bno')).toBe(bno); // 層は、そのまま
  expect(nums()).toEqual(['1']);
  expect(w.kept()).toBe(true);
  await act(async () => release({ svg: '<svg></svg>' }));
  await settle();
  expect(nums()).toEqual(['1', '2']);
});
