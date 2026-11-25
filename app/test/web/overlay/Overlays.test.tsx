// @vitest-environment jsdom
// 番号の層：番号の丸（同じ高さは組にして横に並べる）・範囲の枠・入力中の「新」・番号を押す・ホバー・枠のドラッグ（離したときの取り直しの依頼・Esc で戻す）。
// jsdom は、レイアウトを測れない：要素の矩形を、テストが決める（実際の見た目・位置は、ブラウザで確かめる）。
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Rect } from '../../../src/shared/types';
import { buildView } from '../../../src/web/lib/view';
import { Overlays } from '../../../src/web/overlay/Overlays';
import { type AdjustEvent, regionAdjustTarget } from '../../../src/web/overlay/regionAdjust';
import { type BlockRef, type DocModel, type ThreadLoc, useDoc } from '../../../src/web/store/doc';
import { useUi } from '../../../src/web/store/ui';
import { installPointerCapture, meta, resetAll, thread, topicState } from '../helpers';

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  };
}
const geometry = (el: Element, r: DOMRect) => {
  el.getBoundingClientRect = () => r;
};

beforeEach(() => {
  resetAll();
  installPointerCapture();
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  // 丸の組の高さ（折り返さなければ 22px）
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 22 });
});
afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(HTMLElement.prototype, 'offsetHeight');
});

interface World {
  scroller: HTMLElement;
  article: HTMLElement;
  blocks: HTMLElement[];
  mark: HTMLElement;
  img: HTMLElement;
}

/** #docscroll（左 100・上 50。本文の左 340）の中に、本文（3 ブロック・1 つ目に mark・3 つ目は画像）を作る */
function world(): World {
  const scroller = document.createElement('div');
  scroller.id = 'docscroll';
  geometry(scroller, rect(100, 50, 900, 600));
  Object.defineProperty(scroller, 'clientWidth', { configurable: true, value: 900 });
  const article = document.createElement('article');
  article.id = 'article';
  geometry(article, rect(340, 50, 600, 1000));
  const blocks = ['p', 'p', 'p'].map((tag, i) => {
    const el = document.createElement(tag);
    el.dataset.bid = `b${i}`;
    article.append(el);
    return el;
  });
  const mark = document.createElement('mark');
  mark.className = 'hl live';
  mark.dataset.tid = 't1';
  mark.getClientRects = () => [rect(360, 100, 80, 20)] as unknown as DOMRectList;
  (blocks[0] as HTMLElement).append(mark);
  geometry(blocks[0] as HTMLElement, rect(340, 90, 600, 40));
  geometry(blocks[1] as HTMLElement, rect(340, 102, 600, 40)); // 1 つ目の mark と、同じ行（4px 未満）
  geometry(blocks[2] as HTMLElement, rect(340, 300, 600, 400));
  const img = document.createElement('img');
  (blocks[2] as HTMLElement).append(img);
  Object.defineProperty(img, 'complete', { configurable: true, value: true });
  Object.defineProperty(img, 'naturalWidth', { configurable: true, value: 600 });
  geometry(img, rect(340, 300, 400, 200));
  document.body.replaceChildren(scroller);
  scroller.append(article);
  return { scroller, article, blocks, mark, img };
}

function modelOf(w: World, over: Partial<DocModel> = {}): DocModel {
  const b = w.blocks;
  const locs = new Map<string, ThreadLoc>([
    ['t1', { kind: 'text', marks: [w.mark] }],
    ['t2', { kind: 'block', el: b[1] as HTMLElement }],
    ['t3', { kind: 'region', el: b[2] as HTMLElement, frame: w.img, rect: { x: 0.25, y: 0.5, w: 0.5, h: 0.25 } }],
  ]);
  const blocks: BlockRef[] = b.map((el, i) => ({ id: `b${i}`, hash: `h${i}`, tag: 'p', text: '', el }));
  return {
    epoch: 1,
    key: 'demo/root/1',
    blocks,
    locs,
    nums: new Map([
      ['t1', 1],
      ['t2', 2],
      ['t3', 3],
    ]),
    approx: new Map(),
    pending: null,
    diff: null,
    ...over,
  };
}

const THREADS = [thread({ id: 't1' }), thread({ id: 't2' }), thread({ id: 't3', resolved: true })];
function viewOf(slug = 'demo') {
  const v = buildView({ slug, page: 'root', version: null }, topicState({ threads: THREADS, meta: meta({ slug }) }));
  if (!v) throw new Error('view');
  return v;
}

function mount(w: World, model: DocModel | null = modelOf(w), view = viewOf()) {
  useDoc.setState({ model });
  const ref = { current: w.scroller };
  const host = document.createElement('div');
  w.scroller.append(host);
  const r = render(<Overlays view={view} scrollRef={ref} />, { container: host });
  return { ...r, layer: () => document.getElementById('badges') as HTMLElement };
}
const texts = (layer: HTMLElement) =>
  [...layer.querySelectorAll('.bbadge')].map((b) => [...b.children].map((s) => s.textContent));

test('層：#badges（aria-hidden）。DocModel がなければ・別のページの古い DocModel なら、何も出さない', () => {
  const w = world();
  const { layer, rerender } = mount(w, null);
  expect(layer().getAttribute('aria-hidden')).toBe('true');
  expect(layer().children).toHaveLength(0);
  act(() => useDoc.setState({ model: modelOf(w, { key: 'demo/other/1' }) }));
  expect(layer().children).toHaveLength(0);
  rerender(<Overlays view={null} scrollRef={{ current: w.scroller }} />);
  expect(layer().children).toHaveLength(0);
});

test('番号の丸：文・ブロック・範囲を、同じ見た目（.bno）で。同じ高さ（4px 未満）は、1 つの組に横に並べる。位置は、記事の左の余白', () => {
  const w = world();
  const { layer } = mount(w);
  // t1（mark の上端 100）と t2（ブロックの上端 102）：同じ行。t3（範囲の上端：画像 300 + 0.5 × 200 = 400）
  expect(texts(layer())).toEqual([['1', '2'], ['3']]);
  const [g1, g2] = [...layer().querySelectorAll<HTMLElement>('.bbadge')];
  // 左：本文の左 340 − 領域の左 100 + scrollLeft 0 − 12 = 228
  expect(g1?.style.left).toBe('228px');
  expect(g1?.style.top).toBe(`${Math.round(100 - 50 + 0) + 2}px`);
  expect(g2?.style.top).toBe(`${Math.round(400 - 50) + 2}px`);
  const bnos = [...layer().querySelectorAll<HTMLElement>('.bno')];
  expect(bnos.map((b) => [b.dataset.tid, b.className])).toEqual([
    ['t1', 'bno'],
    ['t2', 'bno'],
    ['t3', 'bno resolved'],
  ]);
});

test('同じ行に 7 件：1 つの組に、4 つの丸（.bno）と「+3」（.bno-more）。まとめた 3 つ（.bno.fold）は、ポップオーバー（.bno-pop）の中。「+N」は、最初のカードを指す。まとめた分のどれかが光ると、「+N」も光る', () => {
  const w = world();
  const ids = ['t1', 't2', 't3', 't4', 't5', 't6', 't7'];
  const locs = new Map<string, ThreadLoc>(ids.map((id) => [id, { kind: 'block', el: w.blocks[0] as HTMLElement }]));
  const nums = new Map(ids.map((id, i) => [id, i + 1]));
  const { layer } = mount(w, modelOf(w, { locs, nums }));
  expect(layer().querySelectorAll('.bbadge')).toHaveLength(1);
  const box = layer().querySelector('.bbadge') as HTMLElement;
  const kids = [...box.children] as HTMLElement[];
  // 並べるのは 4 つと「+3」。まとめた 3 つは、ポップオーバー（.bno-pop）の中
  expect(kids.map((k) => k.className)).toEqual(['bno', 'bno', 'bno resolved', 'bno', 'bno-more d2', 'bno-pop']); // t3 は、解決済み
  expect(kids.slice(0, 5).map((k) => k.textContent)).toEqual(['1', '2', '3', '4', '+3']);
  const pop = kids[5] as HTMLElement;
  const folded = [...pop.children] as HTMLElement[];
  expect(folded.map((k) => [k.className, k.textContent, k.dataset.tid])).toEqual([
    ['bno fold', '5', 't5'],
    ['bno fold', '6', 't6'],
    ['bno fold', '7', 't7'],
  ]);
  const more = kids[4] as HTMLElement;
  expect(more.dataset.tid).toBe('t5');
  expect(more.dataset.tids).toBe('t5 t6 t7');
  expect(more.title).toContain('3 件');
  // ポップオーバーの左端は、本文の見える範囲の左 + 4px（組の左 228 → -224）
  expect(pop.style.left).toBe('-224px');
  act(() => useUi.getState().setLinked('t6'));
  expect(layer().querySelector('.bno-more')?.classList.contains('linked')).toBe(true);
  expect(layer().querySelector('.bno.fold[data-tid="t6"]')?.classList.contains('linked')).toBe(true);
  expect(layer().querySelector('.bno[data-tid="t1"]')?.classList.contains('linked')).toBe(false);
  act(() => useUi.getState().setLinked('t2'));
  expect(layer().querySelector('.bno-more')?.classList.contains('linked')).toBe(false);
});

test('ポップオーバーは、開くとき（mouseenter）に置く：右端は「+N」の右端にそろえ（隣接）、左へは、見える範囲の左 +4px まで。下に入りきらなければ、行の上（上にも入らなければ、下）', () => {
  const w = world();
  const ids = ['t1', 't2', 't3', 't4', 't5', 't6', 't7'];
  const locs = new Map<string, ThreadLoc>(ids.map((id) => [id, { kind: 'block', el: w.blocks[0] as HTMLElement }]));
  const nums = new Map(ids.map((id, i) => [id, i + 1]));
  const { layer } = mount(w, modelOf(w, { locs, nums }));
  const box = layer().querySelector('.bbadge') as HTMLElement;
  const pop = box.querySelector('.bno-pop') as HTMLElement;
  geometry(w.scroller, rect(100, 50, 800, 600)); // 見える範囲：左 100・上 50・下 650
  const hover = (boxRect: DOMRect, popRect: DOMRect) => {
    geometry(box, boxRect);
    geometry(pop, popRect);
    box.dispatchEvent(new MouseEvent('mouseenter'));
  };
  // 広い：「+N」の右端（346）から、幅 120 の分だけ左へ（隣接）。下に入る
  hover(rect(300, 300, 46, 18), rect(0, 0, 120, 40));
  expect(pop.style.left).toBe(`${346 - 120 - 300}px`);
  expect(pop.classList.contains('up')).toBe(false);
  // 見える範囲の左（+4px）で止まる：幅 400 は、346 − 400 より、100 + 4 の方が、右
  hover(rect(300, 300, 46, 18), rect(0, 0, 400, 40));
  expect(pop.style.left).toBe(`${104 - 300}px`);
  // 本文の下端の行（下に入らない）：行の上に開く
  hover(rect(300, 618, 46, 18), rect(0, 0, 120, 40));
  expect(pop.classList.contains('up')).toBe(true);
  // 上にも入らない（見える範囲が低い）：下のまま
  hover(rect(300, 60, 46, 18), rect(0, 0, 120, 600));
  expect(pop.classList.contains('up')).toBe(false);
});

test('上の組に重ならない：組の高さ（実測）の 2px 下まで、次の組を下げる', () => {
  const w = world();
  geometry(w.blocks[1] as HTMLElement, rect(340, 108, 600, 40)); // t2 を、別の組（108）に。1 つ目の組の下端は 100+22+2 = 124
  const { layer } = mount(w);
  const tops = [...layer().querySelectorAll<HTMLElement>('.bbadge')].map((b) => b.style.top);
  expect(tops).toEqual([`${100 - 50 + 2}px`, `${124 - 50 + 2}px`, `${400 - 50 + 2}px`]);
});

test('範囲の枠：.regionbox（解決済みは .resolved）。基準の画像に対する比率の位置・大きさ。押せない（ハンドルなし）', () => {
  const w = world();
  const { layer } = mount(w);
  const boxes = layer().querySelectorAll<HTMLElement>('.regionbox');
  expect(boxes).toHaveLength(1);
  const b = boxes[0] as HTMLElement;
  expect(b.className).toBe('regionbox resolved');
  expect(b.dataset.tid).toBe('t3');
  // 画像：左 340 上 300 幅 400 高さ 200。層での位置：左 = 340 − 100 + 0.25 × 400 = 340・上 = 300 − 50 + 0.5 × 200 = 350・幅 200・高さ 50
  expect([b.style.left, b.style.top, b.style.width, b.style.height]).toEqual(['340px', '350px', '200px', '50px']);
  expect(b.querySelector('.rh')).toBeNull();
});

test('範囲の枠：F25 の範囲内の広い範囲（はみ出す比率）は、画像・図・文のブロックでは、切らずに描く。html-app の枠のブロックだけ、基準の周り（-1〜2 倍）に収める', () => {
  const wide = { x: 0, y: -0.5, w: 1, h: 3 }; // 縦に広い（横は、本文の領域で切れるので、はみ出させない。横の収め方は layout.test.ts）
  const drawn = (cls: string | null) => {
    const w = world();
    if (cls) (w.blocks[2] as HTMLElement).classList.add(cls);
    const model = modelOf(w);
    model.locs.set('t3', { kind: 'region', el: w.blocks[2] as HTMLElement, frame: w.img, rect: wide });
    const { layer } = mount(w, model);
    const b = layer().querySelector<HTMLElement>('.regionbox') as HTMLElement;
    return [b.style.left, b.style.top, b.style.width, b.style.height];
  };
  // 基準：左 340 上 300 幅 400 高さ 200（層での位置：左 340 − 100・上 300 − 50）。そのまま：左 240・上 250 − 100 = 150・幅 400・高さ 600
  const asIs = ['240px', '150px', '400px', '600px'];
  expect(drawn(null)).toEqual(asIs); // 段落（画像を含む）
  expect(drawn('mermaid-block')).toEqual(asIs); // 図
  // html-app：基準は、ブロックの箱（幅 600・高さ 400。`.appview` がないとき）。下端は 2 倍まで：上 -0.5 から 2.5 × 400 = 1000（収めなければ、1200）
  expect(drawn('htmlapp')).toEqual(['240px', '50px', '600px', '1000px']);
});

test('入力中：対象が範囲なら、アクセントの破線の枠（.regionbox.pending と 8 つのハンドル）と「新」。文・ブロックなら、「新」だけ', () => {
  const w = world();
  const pendingRect: Rect = { x: 0.1, y: 0.1, w: 0.5, h: 0.5 };
  const { layer } = mount(w, modelOf(w, { pending: w.blocks[2] as HTMLElement }));
  const anchor = {
    blockId: 'b2',
    blockHash: '',
    blockTag: 'P',
    blockText: '',
    quote: '',
    prefix: '',
    suffix: '',
    label: '',
  };
  act(() => useUi.setState({ composer: { id: 1, anchor: { ...anchor, rect: pendingRect } } }));
  const pb = layer().querySelector<HTMLElement>('.regionbox.pending');
  expect(pb?.dataset.tid).toBe('pending');
  expect([...(pb?.querySelectorAll('.rh') ?? [])].map((h) => (h as HTMLElement).dataset.h)).toEqual([
    'nw',
    'n',
    'ne',
    'e',
    'se',
    's',
    'sw',
    'w',
  ]);
  expect(
    [...(pb?.querySelectorAll('.rh') ?? [])].every((h) => h.classList.contains(`rh-${(h as HTMLElement).dataset.h}`)),
  ).toBe(true);
  const nu = layer().querySelector<HTMLElement>('.bno.pending');
  expect(nu?.textContent).toBe('新');
  expect(nu?.dataset.tid).toBe('pending');
  // 文の対象：枠なし・「新」だけ（mark の位置）
  act(() => useUi.setState({ composer: { id: 2, anchor } }));
  expect(layer().querySelector('.regionbox.pending')).toBeNull();
  act(() => useDoc.setState({ model: modelOf(w, { pending: w.mark }) }));
  expect(layer().querySelector('.bno.pending')?.textContent).toBe('新');
  act(() => useUi.setState({ composer: null }));
  expect(layer().querySelector('.pending')).toBeNull();
});

// 範囲の枠を隠す（`ui.regionBoxes`）：html-app の中の操作を、枠が邪魔しない。DOM に置かない（押せない・見えない）。番号の丸は、そのまま。入力中の枠だけは、押せない形で出す
// 設定の変化は、次のフレームに置き直す（`schedule`）
const nextFrame = () => act(() => new Promise<void>((r) => requestAnimationFrame(() => r())));
test('範囲の枠を隠す：保存済みの .regionbox は、DOM に置かない（番号の丸は、残り、高さも同じ）。出すと、元に戻る', async () => {
  const w = world();
  const { layer } = mount(w);
  const before = layer().querySelector<HTMLElement>('.regionbox')?.outerHTML;
  const badgeTops = [...layer().querySelectorAll<HTMLElement>('.bbadge')].map((b) => b.style.top);
  expect(before).toBeDefined();
  act(() => useUi.getState().toggleRegionBoxes());
  await nextFrame();
  expect(useUi.getState().ui.regionBoxes).toBe(false);
  expect(layer().querySelectorAll('.regionbox')).toHaveLength(0);
  expect([...layer().querySelectorAll('.bno')].map((b) => b.textContent)).toEqual(['1', '2', '3']); // 番号は、そのまま（カードを選べる）
  expect([...layer().querySelectorAll<HTMLElement>('.bbadge')].map((b) => b.style.top)).toEqual(badgeTops);
  act(() => useUi.getState().toggleRegionBoxes());
  await nextFrame();
  expect(layer().querySelector<HTMLElement>('.regionbox')?.outerHTML).toBe(before);
});

test('範囲の枠を隠す：入力中の枠（pending）だけは、対象を示す（.still：つかめない・ハンドルなし）。出すと、つかめる枠（ハンドルつき）に戻る', async () => {
  const w = world();
  const pendingRect: Rect = { x: 0.1, y: 0.1, w: 0.5, h: 0.5 };
  const anchor = {
    blockId: 'b2',
    blockHash: '',
    blockTag: 'P',
    blockText: '',
    quote: '',
    prefix: '',
    suffix: '',
    label: '',
    rect: pendingRect,
  };
  act(() => useUi.getState().toggleRegionBoxes());
  const { layer } = mount(w, modelOf(w, { pending: w.blocks[2] as HTMLElement }));
  act(() => useUi.setState({ composer: { id: 1, anchor } }));
  const boxes = layer().querySelectorAll<HTMLElement>('.regionbox');
  expect([...boxes].map((b) => b.dataset.tid)).toEqual(['pending']); // 保存済み（t3）は、置かない
  const pb = boxes[0] as HTMLElement;
  expect(pb.className).toBe('regionbox pending still');
  expect(pb.querySelectorAll('.rh')).toHaveLength(0);
  expect(layer().querySelector('.bno.pending')?.textContent).toBe('新');
  act(() => useUi.getState().toggleRegionBoxes());
  await nextFrame();
  const shown = layer().querySelector<HTMLElement>('.regionbox.pending');
  expect(shown?.classList.contains('still')).toBe(false);
  expect(shown?.querySelectorAll('.rh')).toHaveLength(8);
  expect(layer().querySelectorAll('.regionbox')).toHaveLength(2);
});

test('番号を押す：そのスレッドだけを見る（solo）・選ぶ（active）。入力中の「新」は、押しても、何もしない', () => {
  const w = world();
  const { layer } = mount(w);
  act(() => layer().querySelector<HTMLElement>('.bno[data-tid="t2"]')?.click());
  expect(useUi.getState().solo).toBe('t2');
  expect(useUi.getState().active).toBe('t2');
  act(() => useUi.getState().closeSolo());
  act(() => useUi.getState().setActive(null));
  // 解決済み：solo のとき、一覧の中で開く動き（tab・rowOpen）はしない（旧と同じ順：solo → focusThread）
  act(() => layer().querySelector<HTMLElement>('.bno[data-tid="t3"]')?.click());
  expect(useUi.getState().solo).toBe('t3');
  expect(useUi.getState().rowOpen.has('t3')).toBe(false);
  act(() => useUi.getState().closeSolo());
  act(() =>
    useUi.setState({
      composer: {
        id: 1,
        anchor: {
          blockId: '',
          blockHash: '',
          blockTag: '',
          blockText: '',
          quote: 'x',
          prefix: '',
          suffix: '',
          label: '',
        },
      },
    }),
  );
  act(() => useDoc.setState({ model: modelOf(w, { pending: w.mark }) }));
  act(() => layer().querySelector<HTMLElement>('.bno.pending')?.click());
  expect(useUi.getState().solo).toBeNull();
});

test('マウスを置く：カードと本文を、お互いに光らせる（linkedTid）。離すと外す。層の中の印にも .linked を付ける', () => {
  const w = world();
  const { layer } = mount(w);
  const card = document.createElement('div');
  card.className = 'thread';
  card.dataset.tid = 't2';
  card.scrollIntoView = vi.fn();
  document.body.append(card);
  const bno = layer().querySelector<HTMLElement>('.bno[data-tid="t2"]') as HTMLElement;
  act(() => {
    bno.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  });
  expect(useUi.getState().linkedTid).toBe('t2');
  expect(bno.classList.contains('linked')).toBe(true);
  expect(card.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
  act(() => {
    layer().dispatchEvent(new MouseEvent('mouseleave'));
  });
  expect(useUi.getState().linkedTid).toBeNull();
  expect(layer().querySelector('.linked')).toBeNull();
  // 入力欄を開いている間は、カードを動かさない
  (card.scrollIntoView as ReturnType<typeof vi.fn>).mockClear();
  act(() =>
    useUi.setState({
      composer: {
        id: 1,
        anchor: {
          blockId: '',
          blockHash: '',
          blockTag: '',
          blockText: '',
          quote: 'x',
          prefix: '',
          suffix: '',
          label: '',
        },
      },
    }),
  );
  act(() => {
    bno.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  });
  expect(card.scrollIntoView).not.toHaveBeenCalled();
});

/** 入力中の範囲の枠がある、層 */
function withPendingBox() {
  const w = world();
  const anchor = {
    blockId: 'b2',
    blockHash: '',
    blockTag: 'P',
    blockText: '',
    quote: '',
    prefix: '',
    suffix: '',
    label: '',
    rect: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 },
  };
  const m = mount(w, modelOf(w, { pending: w.blocks[2] as HTMLElement }));
  act(() => useUi.setState({ composer: { id: 1, anchor } }));
  const box = m.layer().querySelector<HTMLElement>('.regionbox.pending') as HTMLElement;
  geometry(box, rect(380, 320, 200, 100)); // つかむ前の位置（ビューポート）
  const adjusts: AdjustEvent[] = [];
  const on = (e: Event) => adjusts.push(e as AdjustEvent);
  regionAdjustTarget.addEventListener('adjust', on);
  return { ...m, w, box, adjusts, off: () => regionAdjustTarget.removeEventListener('adjust', on) };
}
const ptr = (type: string, x: number, y: number, target: Element | Document, init: MouseEventInit = {}) =>
  act(() => {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0, ...init }));
  });

test('枠のドラッグ（本体）：つかむと regDrag。動かすと、枠が動く（置き直さない）。離すと、調整後の矩形（ビューポートの座標）を、イベントで渡す', () => {
  const { box, adjusts, off, w } = withPendingBox();
  ptr('pointerdown', 400, 340, box);
  expect(useUi.getState().regDrag).toBe(true);
  ptr('pointermove', 430, 360, document); // +30, +20
  // 層での位置：ビューポートの (410, 340) − 領域の左上 (100, 50)
  expect([box.style.left, box.style.top, box.style.width, box.style.height]).toEqual([
    '310px',
    '290px',
    '200px',
    '100px',
  ]);
  // ドラッグ中は、置き直さない（つかんでいる枠が、消えない）
  act(() => useDoc.setState({ model: modelOf(w, { pending: w.blocks[2] as HTMLElement, epoch: 9 }) }));
  expect(document.contains(box)).toBe(true);
  ptr('pointerup', 430, 360, document);
  expect(useUi.getState().regDrag).toBe(false);
  expect(adjusts).toHaveLength(1);
  expect(adjusts[0]?.detail).toEqual({ left: 410, top: 340, width: 200, height: 100 });
  off();
});

test('枠のドラッグ（ハンドル）：se で大きさを変える。本文の外へは、出ない。最小の大きさを下回らない', () => {
  const { box, adjusts, off } = withPendingBox();
  const se = box.querySelector('.rh-se') as HTMLElement;
  ptr('pointerdown', 580, 420, se);
  ptr('pointermove', 600, 440, document);
  ptr('pointerup', 600, 440, document);
  expect(adjusts[0]?.detail).toEqual({ left: 380, top: 320, width: 220, height: 120 });
  ptr('pointerdown', 580, 420, se);
  ptr('pointermove', 99999, 99999, document); // 本文（左 340・右 940・上 50・下 1050）の外
  ptr('pointerup', 99999, 99999, document);
  expect(adjusts[1]?.detail).toEqual({ left: 380, top: 320, width: 560, height: 730 });
  ptr('pointerdown', 580, 420, se);
  ptr('pointermove', -99999, -99999, document);
  ptr('pointerup', -99999, -99999, document);
  expect(adjusts[2]?.detail).toEqual({ left: 380, top: 320, width: 12, height: 12 });
  off();
});

test('枠のドラッグ：Esc で、元に戻す（イベントは、渡さない。regDrag を外す。Esc は、ほかの処理〔ライトボックスなど〕に渡さない）。動かさずに離したときは、渡さない', () => {
  const { box, adjusts, off } = withPendingBox();
  const other = vi.fn();
  document.addEventListener('keydown', other);
  ptr('pointerdown', 400, 340, box);
  ptr('pointermove', 450, 380, document);
  act(() => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  expect(useUi.getState().regDrag).toBe(false);
  expect(adjusts).toHaveLength(0);
  expect(other).not.toHaveBeenCalled();
  ptr('pointerup', 450, 380, document);
  expect(adjusts).toHaveLength(0);
  // 元の位置へ戻る（置き直し。次の描画の枠）
  // つかんでいないときの Esc は、そのまま、ほかの処理へ渡る
  act(() => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  expect(other).toHaveBeenCalledTimes(1);
  // 動かさずに離す：矩形がない → 渡さない
  ptr('pointerdown', 400, 340, box);
  ptr('pointerup', 400, 340, document);
  expect(adjusts).toHaveLength(0);
  document.removeEventListener('keydown', other);
  off();
});

test('枠のドラッグ：左ボタン以外・入力欄がないとき・確定した（入力中でない）枠は、つかめない', () => {
  const { box, layer, off } = withPendingBox();
  ptr('pointerdown', 400, 340, box, { button: 2 });
  expect(useUi.getState().regDrag).toBe(false);
  const fixed = layer().querySelector<HTMLElement>('.regionbox:not(.pending)');
  expect(fixed).not.toBeNull();
  ptr('pointerdown', 400, 340, fixed as HTMLElement);
  expect(useUi.getState().regDrag).toBe(false);
  off();
});

/** 画面に反映された solo を、控える */
const probed: { solo: string | null } = { solo: null };
function Probe() {
  probed.solo = useUi((s) => s.solo);
  return null;
}

test('番号を押す：solo を決めて、描き直してから、選ぶ（旧と同じ順）。選ぶ時点で、solo が、画面に反映されている', () => {
  const w = world();
  const { layer } = mount(w);
  probed.solo = null;
  render(<Probe />);
  let seenAtFocus: string | null | undefined;
  const unsub = useUi.subscribe((s, prev) => {
    if (s.active !== prev.active) seenAtFocus = probed.solo;
  });
  act(() => layer().querySelector<HTMLElement>('.bno[data-tid="t2"]')?.click());
  unsub();
  expect(seenAtFocus).toBe('t2');
});

test('枠のドラッグを Esc でやめる：枠は、入力欄の対象の位置へ戻る（同じ内容の再配置で、要素を残す工夫が、ドラッグで書き換えた位置を、残さない）', async () => {
  const { box, layer, off } = withPendingBox();
  const at = () => {
    const e = layer().querySelector<HTMLElement>('.regionbox.pending') as HTMLElement;
    return [e.style.left, e.style.top, e.style.width, e.style.height];
  };
  const original = at();
  ptr('pointerdown', 400, 340, box);
  ptr('pointermove', 460, 380, document);
  expect(at()).not.toEqual(original);
  act(() => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  await act(() => new Promise<void>((r) => requestAnimationFrame(() => r())));
  expect(at()).toEqual(original);
  off();
});
