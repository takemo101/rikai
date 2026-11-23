// @vitest-environment jsdom
// 関連の線：カードとして出ているスレッドの数だけ引く（DOM が事実）・端点の位置・状態のクラス・見える範囲の縁への寄せ・オン／オフ・アンマウントで、リスナー・監視が残らない。
// jsdom は、レイアウトを測れない：要素の矩形を、テストが決める（実際の見た目・位置は、実ブラウザの e2e で確かめる）。rAF・ResizeObserver・MutationObserver は、テストが動かす。
import { act, render } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Anchor } from '../../../src/shared/types';
import { buildView } from '../../../src/web/lib/view';
import { Connectors } from '../../../src/web/overlay/Connectors';
import { type DocModel, type ThreadLoc, useDoc } from '../../../src/web/store/doc';
import { useUi } from '../../../src/web/store/ui';
import { meta, resetAll, thread, topicState } from '../helpers';

type R = [left: number, top: number, width: number, height: number];
const domRect = ([left, top, width, height]: R): DOMRect => ({
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
  x: left,
  y: top,
  toJSON: () => ({}),
});

// ---- rAF・ResizeObserver・MutationObserver の代用（動かすのは、テスト） ----
let frames: (() => void)[] = [];
const flush = (): void => {
  const run = frames;
  frames = [];
  act(() => {
    for (const f of run) f();
  });
};
const ros: FakeObserver[] = [];
const mos: FakeObserver[] = [];
class FakeObserver {
  observed = new Set<Element>();
  disconnected = false;
  constructor(public cb: () => void) {}
  observe(e: Element) {
    this.observed.add(e);
  }
  unobserve(e: Element) {
    this.observed.delete(e);
  }
  disconnect() {
    this.disconnected = true;
    this.observed.clear();
  }
}
class FakeRO extends FakeObserver {
  constructor(cb: () => void) {
    super(cb);
    ros.push(this);
  }
}
class FakeMO extends FakeObserver {
  constructor(cb: () => void) {
    super(cb);
    mos.push(this);
  }
}

beforeEach(() => {
  resetAll();
  frames = [];
  ros.length = 0;
  mos.length = 0;
  vi.stubGlobal('ResizeObserver', FakeRO);
  vi.stubGlobal('MutationObserver', FakeMO);
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => frames.push(cb));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    frames[id - 1] = () => {};
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

// ---- 画面：#docscroll（230,44 〜 1000,844）・#threads（1010,44 〜 1400,844。固定の見出しは 100 まで）・カード（y = 110・250・390） ----
interface World {
  scroller: HTMLElement;
  panel: HTMLElement;
  /** 動かす矩形（要素 → 矩形） */
  rects: Map<Element, R>;
  mark: HTMLElement;
  blocks: HTMLElement[];
  regionbox: HTMLElement;
  card: (tid: string) => HTMLElement;
  num: (tid: string) => HTMLElement;
}

function world(): World {
  const rects = new Map<Element, R>();
  const at = <T extends Element>(el: T, r: R): T => {
    rects.set(el, r);
    el.getBoundingClientRect = () => domRect(rects.get(el) as R);
    return el;
  };
  const div = (cls = '', id = '') => {
    const e = document.createElement('div');
    if (cls) e.className = cls;
    if (id) e.id = id;
    return e;
  };
  const scroller = at(div('', 'docscroll'), [230, 44, 770, 800]);
  const article = at(document.createElement('article'), [330, 44, 600, 1500]);
  article.id = 'article';
  const blocks = [0, 1, 2].map((i) => {
    const p = document.createElement('p');
    p.dataset.bid = `b${i}`;
    article.append(p);
    return at(p, [330, 100 + i * 150, 600, 40]);
  });
  const mark = document.createElement('mark');
  mark.className = 'hl live';
  (blocks[0] as HTMLElement).append(mark);
  rects.set(mark, [360, 100, 80, 20]);
  mark.getClientRects = () => [domRect(rects.get(mark) as R)] as unknown as DOMRectList;
  const badges = div('', 'badges');
  const regionbox = at(div('regionbox'), [500, 300, 200, 100]);
  regionbox.dataset.tid = 't3';
  badges.append(regionbox);
  scroller.append(article, badges);

  const panel = at(div('', 'threads'), [1010, 44, 390, 800]);
  panel.append(at(div('panel-top'), [1010, 44, 390, 56]));
  const cards = new Map<string, HTMLElement>();
  const nums = new Map<string, HTMLElement>();
  ['t1', 't2', 't3'].forEach((tid, i) => {
    const card = at(div('thread'), [1024, 110 + i * 140, 360, 120]);
    card.dataset.tid = tid;
    const head = at(div('th-head'), [1024, 110 + i * 140, 360, 38]);
    const no = at(document.createElement('span'), [1034, 120 + i * 140, 18, 18]);
    no.className = 'no';
    head.append(no);
    card.append(head);
    panel.append(card);
    cards.set(tid, card);
    nums.set(tid, no);
  });
  document.body.replaceChildren(scroller, panel);
  return {
    scroller,
    panel,
    rects,
    mark,
    blocks,
    regionbox,
    card: (tid) => cards.get(tid) as HTMLElement,
    num: (tid) => nums.get(tid) as HTMLElement,
  };
}

function modelOf(w: World, over: Partial<DocModel> = {}): DocModel {
  const locs = new Map<string, ThreadLoc>([
    ['t1', { kind: 'text', marks: [w.mark] }],
    ['t2', { kind: 'block', el: w.blocks[1] as HTMLElement }],
    [
      't3',
      {
        kind: 'region',
        el: w.blocks[2] as HTMLElement,
        frame: w.blocks[2] as HTMLElement,
        rect: { x: 0, y: 0, w: 1, h: 1 },
      },
    ],
  ]);
  return {
    epoch: 1,
    key: 'demo/root/1',
    blocks: [],
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
function viewOf() {
  const v = buildView({ slug: 'demo', page: 'root', version: null }, topicState({ threads: THREADS, meta: meta() }));
  if (!v) throw new Error('view');
  return v;
}

function mount(w: World, opts: { model?: DocModel | null; strict?: boolean } = {}) {
  useDoc.setState({ model: opts.model === undefined ? modelOf(w) : opts.model });
  const ref = { current: w.scroller };
  const el = <Connectors view={viewOf()} scrollRef={ref} />;
  const r = render(opts.strict ? <StrictMode>{el}</StrictMode> : el);
  flush();
  return r;
}

const links = () => [...document.querySelectorAll<SVGPathElement>('#links path[data-tid]')];
const tids = () => links().map((p) => p.dataset.tid);
const group = (tid: string) => document.querySelector(`#links g[data-tid="${tid}"]`);
const dAt = (tid: string) => document.querySelector(`#links path[data-tid="${tid}"]`)?.getAttribute('d') ?? '';

test('スレッドの数だけ、線を引く：<svg id="links" aria-hidden>。端点は、本文は右端の中央（文は、最後の行）・カードは、番号の丸の高さの、左端', () => {
  const w = world();
  mount(w);
  const svg = document.getElementById('links');
  expect(svg?.tagName.toLowerCase()).toBe('svg');
  expect(svg?.getAttribute('aria-hidden')).toBe('true');
  expect(tids()).toEqual(['t1', 't2', 't3']);
  // 文：mark の右端 440・中央 110 → カード t1：左 1024（カードの左端）・番号の丸の中央 129
  expect(dAt('t1').startsWith('M440 110C445 110 445 122 450 122H936C')).toBe(true);
  expect(dAt('t1').endsWith(' 1024 129')).toBe(true);
  // ブロック（2 番目：上 250・高さ 40）：右端 930・中央 270 → カード t2：丸の中央 269
  expect(dAt('t2').startsWith('M936 270C')).toBe(true); // 右端 930 + 6（版で変えたブロックの、右端の緑の線に、重ならない）
  expect(dAt('t2').endsWith(' 1024 269')).toBe(true);
  // 範囲：#badges の枠（500,300,200,100）の右端 700・中央 350 → t3：丸の中央 409
  expect(dAt('t3').startsWith('M704 350H936C')).toBe(true); // 右端 700 + 4。すべての線が、共通の x（記事の右端 930 + 6）まで、水平に引き出す
  expect(dAt('t3').endsWith(' 1024 409')).toBe(true);
  // 丸（本文側・半径 3）と、棒（カード側）
  expect(document.querySelectorAll('#links circle.cn-dot')).toHaveLength(3);
  expect(document.querySelector('#links circle.cn-dot')?.getAttribute('r')).toBe('3');
  expect(document.querySelectorAll('#links line.cn-bar')).toHaveLength(3);
});

test('線は、切り取る：clipPath は、本文・パネル・すきまの箱（左の一覧・上のバーには、はみ出さない）', () => {
  const w = world();
  mount(w);
  const rect = document.querySelector('#links clipPath rect');
  expect(rect?.getAttribute('x')).toBe('230');
  expect(rect?.getAttribute('y')).toBe('44');
  expect(rect?.getAttribute('width')).toBe(String(1400 - 230));
  expect(rect?.getAttribute('height')).toBe('800');
  expect(document.querySelector('#links > g')?.getAttribute('clip-path')).toBe('url(#links-clip)');
});

test('カードとして出ているものだけ：タブ・1 枚だけ見る・解決済みの 1 行（.donerow）で、隠れたものには、引かない', () => {
  const w = world();
  mount(w);
  // 1 枚だけ見る（solo）／タブ：React が、カードを外す。MutationObserver が知らせる
  w.card('t2').remove();
  const row = document.createElement('button');
  row.className = 'donerow';
  row.dataset.tid = 't3';
  w.card('t3').replaceWith(row);
  act(() => (mos[0] as FakeObserver).cb());
  flush();
  expect(tids()).toEqual(['t1']);
  // 戻る
  w.panel.append(w.card('t2'));
  act(() => (mos[0] as FakeObserver).cb());
  flush();
  expect(tids().sort()).toEqual(['t1', 't2']);
});

test('位置のないスレッド（none）・DocModel がない・別のページの DocModel は、引かない', () => {
  const w = world();
  mount(w);
  expect(tids()).toHaveLength(3);
  act(() => {
    const m = modelOf(w);
    m.locs.set('t2', { kind: 'none' });
    useDoc.setState({ model: m });
  });
  flush();
  expect(tids()).toEqual(['t1', 't3']);
  act(() => useDoc.setState({ model: modelOf(w, { key: 'demo/other/1' }) }));
  flush();
  expect(tids()).toEqual([]);
  act(() => useDoc.setState({ model: null }));
  flush();
  expect(tids()).toEqual([]);
});

test('状態：active・linked は、クラス（強調）で、手前に描く。解決済みは resolved。選びがあるとき、svg に focus', () => {
  const w = world();
  mount(w);
  expect(document.getElementById('links')?.classList.contains('focus')).toBe(false);
  expect(group('t3')?.classList.contains('resolved')).toBe(true);
  expect(group('t1')?.classList.contains('resolved')).toBe(false);

  act(() => useUi.getState().setActive('t1'));
  expect(group('t1')?.classList.contains('active')).toBe(true);
  expect(group('t2')?.classList.contains('active')).toBe(false);
  expect(document.getElementById('links')?.classList.contains('focus')).toBe(true);

  act(() => useUi.getState().setLinked('t2'));
  expect(group('t2')?.classList.contains('linked')).toBe(true);
  // 強調する線は、あとに描く（手前）
  expect(tids().slice(-2).sort()).toEqual(['t1', 't2']);
  expect(tids()[0]).toBe('t3');

  act(() => {
    useUi.getState().setActive(null);
    useUi.getState().setLinked(null);
  });
  expect(document.getElementById('links')?.classList.contains('focus')).toBe(false);
  expect(tids()).toEqual(['t1', 't2', 't3']);
});

test('入力中の対象：入力欄（.thread.composer）にも、pending の線を引く。入力欄を閉じると、消える', () => {
  const w = world();
  const pending = document.createElement('mark');
  pending.className = 'hl pending';
  (w.blocks[2] as HTMLElement).append(pending);
  w.rects.set(pending, [360, 320, 60, 20]);
  pending.getClientRects = () => [domRect(w.rects.get(pending) as R)] as unknown as DOMRectList;
  const composer = document.createElement('div');
  composer.className = 'thread composer';
  composer.getBoundingClientRect = () => domRect([1024, 530, 360, 150]);
  const no = document.createElement('span');
  no.className = 'no pending';
  no.getBoundingClientRect = () => domRect([1034, 540, 18, 18]);
  composer.append(no);
  w.panel.append(composer);
  const anchor = {
    blockId: 'b2',
    blockHash: 'h',
    blockTag: 'p',
    blockText: '',
    quote: 'q',
    prefix: '',
    suffix: '',
    label: '',
  } as Anchor;
  useUi.setState({ composer: { id: 1, anchor } });
  mount(w, { model: modelOf(w, { pending }) });
  expect(tids()).toContain('pending');
  expect(group('pending')?.classList.contains('pending')).toBe(true);
  expect(dAt('pending').startsWith('M420 330C425 330 425 342 430 342H936C')).toBe(true);
  expect(dAt('pending').endsWith(' 1024 549')).toBe(true);

  act(() => useUi.setState({ composer: null }));
  flush();
  composer.remove();
  act(() => (mos[0] as FakeObserver).cb());
  flush();
  expect(tids()).not.toContain('pending');
});

test('見える範囲：縁へ寄せる線は、選んでいない（active でも linked でもない）なら、引かない。選んでいる・光らせているなら、縁の内側に短く止めて、引く', () => {
  const w = world();
  const scroll = (el: Element) => act(() => void el.dispatchEvent(new Event('scroll')));
  mount(w);
  // 本文を、下へ送った：t1 の文が、本文の上の外へ。選んでいないので、引かない（縁へ寄せた線が、束にならない）
  w.rects.set(w.mark, [360, -200, 80, 20]);
  scroll(w.scroller);
  flush();
  expect(tids()).toEqual(['t2', 't3']);
  expect(group('t2')?.classList.contains('edge')).toBe(false);
  // 選んだ（active）：本文の右端（1000）の近く（-10）・縁（44）の内側（+8）に、短く止める。丸なし・棒あり・edge
  act(() => useUi.getState().setActive('t1'));
  flush();
  expect(tids()).toEqual(['t2', 't3', 't1']);
  expect(dAt('t1').startsWith('M990 52C')).toBe(true);
  expect(dAt('t1').endsWith(' 1024 129')).toBe(true);
  expect(group('t1')?.classList.contains('edge')).toBe(true);
  expect(group('t1')?.querySelector('.cn-dot')).toBeNull();
  expect(group('t1')?.querySelector('.cn-bar')).not.toBeNull();
  // 光らせている（linked）でも、同じ。どちらもやめると、消える
  act(() => {
    useUi.getState().setActive(null);
    useUi.getState().setLinked('t1');
  });
  flush();
  expect(tids()).toContain('t1');
  act(() => useUi.getState().setLinked(null));
  flush();
  expect(tids()).toEqual(['t2', 't3']);
  // パネルも送った：t1 のカードが、見出しの下に隠れた（丸の中央 129 → 60）。両方が上の外：選んでいても、引かない
  act(() => useUi.getState().setActive('t1'));
  w.rects.set(w.num('t1'), [1034, 51, 18, 18]);
  scroll(w.panel);
  flush();
  expect(tids()).toEqual(['t2', 't3']);
  // 本文だけ、戻した：カードだけが外。選んでいない → 引かない。選んでいる → パネルの縁（見出しの下 100）の内側（+8）へ止める
  w.rects.set(w.mark, [360, 200, 80, 20]);
  scroll(w.scroller);
  flush();
  expect(dAt('t1').startsWith('M440 210C445 210 445 222 450 222H936C')).toBe(true);
  expect(dAt('t1').endsWith(' 1024 108')).toBe(true);
  expect(group('t1')?.querySelector('.cn-bar')).toBeNull();
  act(() => useUi.getState().setActive(null));
  flush();
  expect(tids()).toEqual(['t2', 't3']);
});

test('同じ行の 2 つの強調：始点を、カードの順に下へずらす。すべての線が、共通の x（記事の右端 + 6）まで引き出してから、S 字に入る', () => {
  const w = world();
  const mark2 = document.createElement('mark');
  mark2.className = 'hl live';
  w.blocks[0]?.append(mark2);
  w.rects.set(mark2, [500, 101, 60, 20]);
  mark2.getClientRects = () => [domRect(w.rects.get(mark2) as R)] as unknown as DOMRectList;
  const model = modelOf(w);
  model.locs.set('t2', { kind: 'text', marks: [mark2] });
  mount(w, { model });
  // t1：端点 (440, 110)・t2：端点 (560, 111)。行の下端は 121 → 基準 121 − 4 = 117。カードの順（t1 が上）：t1 が 117・t2 が 119。引き出しは、共通の x（936）まで
  expect(dAt('t1').startsWith('M440 123H936C')).toBe(true);
  expect(dAt('t2').startsWith('M560 123H936C')).toBe(true);
  expect(dAt('t1').endsWith(' 1024 129')).toBe(true);
  // t3（範囲）は、別の行：同じ共通の x まで
  expect(dAt('t3').startsWith('M704 350H936C')).toBe(true);
});

test('実際に引く線だけで、同じ行の組を作る：引かれないカード（パネルの見える範囲の外）は、場所を取らない', () => {
  const w = world();
  const mark2 = document.createElement('mark');
  mark2.className = 'hl live';
  w.blocks[0]?.append(mark2);
  w.rects.set(mark2, [500, 101, 60, 20]);
  mark2.getClientRects = () => [domRect(w.rects.get(mark2) as R)] as unknown as DOMRectList;
  const model = modelOf(w);
  model.locs.set('t2', { kind: 'text', marks: [mark2] });
  // t2 のカードは、パネルの固定の見出しの下に隠れている（丸の中央 60）：引かない。同じ行の t1 は、1 つだけの行と同じ（ずらさない・行の下端 120 − 4 = 116）
  w.rects.set(w.num('t2'), [1034, 51, 18, 18]);
  mount(w, { model });
  expect(tids()).not.toContain('t2');
  expect(dAt('t1').startsWith('M440 110C445 110 445 122 450 122H936C')).toBe(true);
});

test('入力中（pending）の線は、縁へ寄せても、引く（選んでいなくても）', () => {
  const w = world();
  mount(w);
  w.rects.set(w.mark, [360, 400, 80, 20]);
  const pend = document.createElement('mark');
  pend.className = 'hl pending';
  w.blocks[0]?.append(pend);
  w.rects.set(pend, [360, -300, 60, 20]);
  pend.getClientRects = () => [domRect(w.rects.get(pend) as R)] as unknown as DOMRectList;
  const composer = document.createElement('div');
  composer.className = 'thread composer';
  w.rects.set(composer, [1024, 600, 360, 160]);
  composer.getBoundingClientRect = () => domRect(w.rects.get(composer) as R);
  w.panel.append(composer);
  act(() => {
    useDoc.setState({ model: modelOf(w, { pending: pend, epoch: 2 }) });
    useUi.setState({ composer: { id: 1, anchor: { quote: 'x' } as Anchor } });
  });
  flush();
  expect(tids()).toContain('pending');
  expect(group('pending')?.classList.contains('edge')).toBe(true);
});

test('複数行の強調：本文側の端点は、最後の行の右端の中央（先頭の矩形ではない）', () => {
  const w = world();
  mount(w);
  const lines: R[] = [
    [360, 100, 560, 20], // 1 行目（いちばん右まで）
    [330, 120, 590, 20],
    [330, 140, 120, 20], // 最後の行：右端 450・中央 150
  ];
  w.mark.getClientRects = () => lines.map(domRect) as unknown as DOMRectList;
  act(() => void w.scroller.dispatchEvent(new Event('scroll')));
  flush();
  expect(dAt('t1').startsWith('M450 150C455 150 455 162 460 162H936C')).toBe(true);
  expect(document.querySelector('#links g[data-tid="t1"] circle')?.getAttribute('cx')).toBe('450');
  expect(document.querySelector('#links g[data-tid="t1"] circle')?.getAttribute('cy')).toBe('150');
});

test('横スクロールの箱（pre など）の中の強調：箱の外へ隠れているなら、引かない。箱の scroll（バブルしない）でも、測り直す', () => {
  const w = world();
  const pre = document.createElement('pre');
  w.blocks[0]?.append(pre);
  pre.append(w.mark);
  w.rects.set(pre, [330, 100, 300, 40]);
  pre.getBoundingClientRect = () => domRect(w.rects.get(pre) as R);
  Object.defineProperty(pre, 'scrollWidth', { value: 900 });
  Object.defineProperty(pre, 'clientWidth', { value: 300 });
  pre.style.overflowX = 'auto';
  mount(w);
  // 強調は、箱（330〜630）の中：引く
  w.rects.set(w.mark, [360, 100, 80, 20]);
  act(() => void w.scroller.dispatchEvent(new Event('scroll')));
  flush();
  expect(tids()).toContain('t1');
  // 箱を、横へスクロールした：強調が、箱の左の外（右端 100）へ。scroll は、箱から、バブルしない（capture で受ける）
  w.rects.set(w.mark, [20, 100, 80, 20]);
  const before = frames.length;
  act(() => void pre.dispatchEvent(new Event('scroll')));
  expect(frames.length - before).toBe(1);
  flush();
  expect(tids()).not.toContain('t1');
  // 箱の右の外（点が 700）も、同じ
  w.rects.set(w.mark, [650, 100, 80, 20]);
  act(() => void pre.dispatchEvent(new Event('scroll')));
  flush();
  expect(tids()).not.toContain('t1');
  // 戻した：引く
  w.rects.set(w.mark, [360, 100, 80, 20]);
  act(() => void pre.dispatchEvent(new Event('scroll')));
  flush();
  expect(tids()).toContain('t1');
});

test('更新は、1 フレームに 1 回にまとめる：スクロールを何度送っても、rAF は 1 つ', () => {
  const w = world();
  mount(w);
  const before = frames.length;
  for (let i = 0; i < 5; i++) w.scroller.dispatchEvent(new Event('scroll'));
  w.panel.dispatchEvent(new Event('scroll'));
  window.dispatchEvent(new Event('resize'));
  expect(frames.length - before).toBe(1);
});

test('links: false：線も svg も出さない・リスナー・監視も張らない。オンに戻すと出る・またオフにすると、外す', () => {
  const w = world();
  const adds = vi.spyOn(w.scroller, 'addEventListener');
  const addsWin = vi.spyOn(window, 'addEventListener');
  useUi.setState({ ui: { ...useUi.getState().ui, links: false } });
  mount(w);
  expect(document.getElementById('links')).toBeNull();
  expect(adds).not.toHaveBeenCalled();
  expect(addsWin.mock.calls.filter(([t]) => t === 'resize')).toHaveLength(0);
  expect(ros).toHaveLength(0);
  expect(mos).toHaveLength(0);
  expect(frames).toHaveLength(0);

  act(() => useUi.getState().toggleLinks());
  flush();
  expect(tids()).toEqual(['t1', 't2', 't3']);
  expect(ros).toHaveLength(1);

  act(() => useUi.getState().toggleLinks());
  expect(document.getElementById('links')).toBeNull();
  expect(ros.every((o) => o.disconnected)).toBe(true);
  expect(mos.every((o) => o.disconnected)).toBe(true);
});

test.each([false, true])(
  'アンマウント：scroll・resize のリスナー・ResizeObserver・MutationObserver・rAF が残らない（StrictMode: %s）',
  (strict) => {
    const w = world();
    const added: [EventTarget, string, EventListenerOrEventListenerObject][] = [];
    const removed: typeof added = [];
    for (const t of [w.scroller, w.panel, window] as EventTarget[]) {
      const [add, rem] = [t.addEventListener.bind(t), t.removeEventListener.bind(t)];
      vi.spyOn(t, 'addEventListener').mockImplementation((type, fn, o) => {
        added.push([t, type, fn as EventListenerOrEventListenerObject]);
        add(type, fn, o);
      });
      vi.spyOn(t, 'removeEventListener').mockImplementation((type, fn, o) => {
        removed.push([t, type, fn as EventListenerOrEventListenerObject]);
        rem(type, fn, o);
      });
    }
    const { unmount } = mount(w, { strict });
    const mine = added.filter(([, type]) => type === 'scroll' || type === 'resize');
    expect(mine.length).toBeGreaterThanOrEqual(3);
    // 張ったものは、いま、解けていないものがある（動いている）
    const live = () => mine.filter((a) => !removed.some((r) => r[0] === a[0] && r[1] === a[1] && r[2] === a[2]));
    expect(live().length).toBe(3);
    unmount();
    expect(live()).toHaveLength(0);
    expect(ros.every((o) => o.disconnected)).toBe(true);
    expect(mos.every((o) => o.disconnected)).toBe(true);
    // 保留の rAF が走っても、何も起きない（アンマウント済み）
    expect(() => flush()).not.toThrow();
    expect(document.getElementById('links')).toBeNull();
  },
);

test('カードの増減に合わせて、大きさの監視（ResizeObserver）も、付け外しする（消えたカードを、持ち続けない）', () => {
  const w = world();
  mount(w);
  const ro = ros[0] as FakeObserver;
  expect(ro.observed.has(w.card('t1'))).toBe(true);
  expect(ro.observed.has(w.scroller)).toBe(true);
  expect(ro.observed.has(w.panel)).toBe(true);
  w.card('t2').remove();
  act(() => (mos[0] as FakeObserver).cb());
  flush();
  expect(ro.observed.has(w.card('t2'))).toBe(false);
  expect(ro.observed.has(w.card('t1'))).toBe(true);
});
