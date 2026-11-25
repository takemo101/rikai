// @vitest-environment jsdom
// 拡大表示の関連の線（F55）：ステージの範囲の枠と、ドックのカードを結ぶ線。端点（枠の右端の中央の外 4px・カードの左端・この対象全体は対象の右端の外 6px）・状態のクラス・オン／オフ・
// 追従（スクロール・ズームの style・カードの増減）・ドックが下のシートのときは引かない・アンマウントで何も残らない・枠にマウスを置くと光る。
// jsdom は、レイアウトを測れない：矩形は、テストが決める（実際の位置の一致・ズーム・ドラッグは、実ブラウザの e2e `focus-links.spec.ts`）。rAF・ResizeObserver・MutationObserver は、テストが動かす。
import { act, fireEvent, render } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Anchor, Thread } from '../../../src/shared/types';
import { FocusLinks, hoverBox } from '../../../src/web/focus/FocusLinks';
import type { FocusCtx, RegionMark } from '../../../src/web/focus/useFocusCtx';
import type { DocModel, ThreadLoc } from '../../../src/web/store/doc';
import { useUi } from '../../../src/web/store/ui';
import { resetAll, thread } from '../helpers';

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

// ---- 画面：#lightbox（1360×900）。ステージ（0,0 〜 1020,900）・ドック（1020,0 〜 1360,900。見出し 0〜48・本体 48〜900）。カード（x = 1034・y = 60・300・540） ----
interface World {
  root: HTMLElement;
  rects: Map<Element, R>;
  stage: HTMLElement;
  media: HTMLElement;
  dock: HTMLElement;
  body: HTMLElement;
  box: (tid: string) => HTMLElement;
  card: (tid: string) => HTMLElement;
}

function world(tids = ['t1', 't2']): World {
  const rects = new Map<Element, R>();
  const at = <T extends Element>(el: T, r: R): T => {
    rects.set(el, r);
    el.getBoundingClientRect = () => domRect(rects.get(el) as R);
    return el;
  };
  const div = (cls = '') => {
    const e = document.createElement('div');
    if (cls) e.className = cls;
    return e;
  };
  const root = at(div(), [0, 0, 1360, 900]);
  root.id = 'lightbox';
  const stage = at(div('lb-view'), [0, 0, 1020, 900]);
  const media = at(div('lb-stage img'), [100, 200, 800, 400]);
  const regions = div('fv-regions');
  const boxes = new Map<string, HTMLElement>();
  tids.forEach((tid, i) => {
    const b = at(div('fv-box'), [150 + i * 300, 250 + i * 150, 200, 100]); // 右端 350・650 / 中央 300・450（高さを変える：同じ高さの組は、始点を、ずらす）
    b.dataset.tid = tid;
    regions.append(b);
    boxes.set(tid, b);
  });
  stage.append(media, regions);
  const dock = at(div('fv-dock'), [1020, 0, 340, 900]);
  const body = at(div('fv-dock-body'), [1020, 48, 340, 852]);
  const cards = new Map<string, HTMLElement>();
  tids.forEach((tid, i) => {
    const card = at(div('thread'), [1034, 60 + i * 240, 312, 200]);
    card.dataset.tid = tid;
    const no = at(document.createElement('span'), [1046, 72 + i * 240, 18, 18]);
    no.className = 'no';
    card.append(no);
    body.append(card);
    cards.set(tid, card);
  });
  dock.append(body);
  root.append(stage, dock);
  document.body.replaceChildren(root);
  return {
    root,
    rects,
    stage,
    media,
    dock,
    body,
    box: (tid) => boxes.get(tid) as HTMLElement,
    card: (tid) => cards.get(tid) as HTMLElement,
  };
}

const marks = (tids: string[]): RegionMark[] =>
  tids.map((tid, i) => ({ tid, n: i + 1, rect: { x: 0, y: 0, w: 1, h: 1 }, resolved: false }));

function modelOf(kinds: Record<string, ThreadLoc['kind']>): DocModel {
  const el = document.createElement('div');
  const locs = new Map<string, ThreadLoc>();
  for (const [tid, kind] of Object.entries(kinds))
    locs.set(
      tid,
      kind === 'region'
        ? { kind, el, frame: el, rect: { x: 0, y: 0, w: 1, h: 1 } }
        : kind === 'block'
          ? { kind, el }
          : { kind: 'none' },
    );
  return {
    epoch: 1,
    key: 'demo/root/1',
    blocks: [],
    locs,
    nums: new Map(),
    approx: new Map(),
    pending: null,
    diff: null,
  };
}

const FOCUS = { id: 'b3', hash: 'h3', src: null, base: true };
function ctxOf(threads: Thread[], regions: RegionMark[], kinds: Record<string, ThreadLoc['kind']>): FocusCtx {
  return { view: null, model: modelOf(kinds), status: 'ok', block: null, threads, regions, canComment: true };
}
const T = [thread({ id: 't1' }), thread({ id: 't2', resolved: true })];

function mount(ctx: FocusCtx, strict = false) {
  const el = <FocusLinks focus={FOCUS} ctx={ctx} />;
  const r = render(strict ? <StrictMode>{el}</StrictMode> : el);
  flush();
  return r;
}

const paths = () => [...document.querySelectorAll<SVGPathElement>('svg.fv-links path[data-tid]')];
const tids = () => paths().map((p) => p.dataset.tid);
const group = (tid: string) => document.querySelector(`svg.fv-links g[data-tid="${tid}"]`);
const dAt = (tid: string) => document.querySelector(`svg.fv-links path[data-tid="${tid}"]`)?.getAttribute('d') ?? '';
const REGION = { t1: 'region', t2: 'region' } as const;

test('範囲の枠ごとに線を引く：<svg class="fv-links" aria-hidden>。端点は、枠の右端の中央の外 4px・カードは、番号の丸の高さの左端。丸・棒', () => {
  const w = world();
  mount(ctxOf(T, marks(['t1', 't2']), REGION));
  const svg = document.querySelector('svg.fv-links');
  expect(svg?.tagName.toLowerCase()).toBe('svg');
  expect(svg?.getAttribute('aria-hidden')).toBe('true');
  expect(w.root.contains(svg)).toBe(false); // FocusLinks が置くのは、描画だけ：置き場は、親（#lightbox の中）
  expect(tids().sort()).toEqual(['t1', 't2']);
  // t1：枠（150,250,200,100）→ 右端 350 + 4 = 354・中央 300。カード（1034,60）・丸の中央 81
  expect(dAt('t1').startsWith('M354 300H')).toBe(true);
  expect(dAt('t1').endsWith(' 1034 81')).toBe(true);
  // t2：枠（450,…）→ 右端 650 + 4。カードの丸の中央 321
  expect(dAt('t2').startsWith('M654 450H')).toBe(true);
  expect(dAt('t2').endsWith(' 1034 321')).toBe(true);
  expect(document.querySelectorAll('svg.fv-links circle.cn-dot')).toHaveLength(2);
  expect(document.querySelector('svg.fv-links circle.cn-dot')?.getAttribute('cx')).toBe('354');
  expect(document.querySelectorAll('svg.fv-links line.cn-bar')).toHaveLength(2);
  // 切り取り：ステージ・ドック・すきまの箱。ID は、本文の線（links-clip）と重ならない
  expect(document.querySelector('svg.fv-links clipPath')?.id).toBe('zoom-fv-links-clip'); // #lightbox の中の ID は、zoom- で始める
  expect(document.querySelector('svg.fv-links')?.id).toBe(''); // svg 自身は、ID を持たない
  expect(document.querySelector('svg.fv-links > g')?.getAttribute('clip-path')).toBe('url(#zoom-fv-links-clip)');
  const rect = document.querySelector('svg.fv-links clipPath rect');
  expect([rect?.getAttribute('x'), rect?.getAttribute('width'), rect?.getAttribute('height')]).toEqual([
    '0',
    '1360',
    '900',
  ]);
});

test('この対象全体へのコメント（範囲なし）は、対象（ステージの画像・図／html-app の枠）の右端の中央の外 6px。文など、引く先がないものは、引かない', () => {
  const w = world(['t1', 't2', 't3']);
  w.box('t3').remove(); // 範囲の枠は、t1・t2 だけ
  w.box('t2').remove();
  mount(ctxOf([...T, thread({ id: 't3' })], marks(['t1']), { t1: 'region', t2: 'block', t3: 'text' }));
  expect(tids().sort()).toEqual(['t1', 't2']);
  // 対象 `.lb-stage`（100,200,800,400）：右端 900 + 6・中央 400
  expect(dAt('t2').startsWith('M906 400H')).toBe(true);
  expect(dAt('t2').endsWith(' 1034 321')).toBe(true);
});

test('状態：active・linked は、クラス（強調）で手前に。解決済みは resolved。選びがあるとき svg に focus。入力中は pending', () => {
  world();
  mount(ctxOf(T, marks(['t1', 't2']), REGION));
  const svg = () => document.querySelector('svg.fv-links');
  expect(svg()?.classList.contains('focus')).toBe(false);
  expect(group('t2')?.classList.contains('resolved')).toBe(true);
  act(() => useUi.getState().setActive('t1'));
  flush();
  expect(group('t1')?.classList.contains('active')).toBe(true);
  expect(svg()?.classList.contains('focus')).toBe(true);
  act(() => useUi.getState().setLinked('t2'));
  flush();
  expect(group('t2')?.classList.contains('linked')).toBe(true);
  expect(tids().slice(-2).sort()).toEqual(['t1', 't2']);
});

test('入力中の範囲（.fv-box.pending）と、ドックの入力欄（.thread.composer）：pending の線。枠の右端 + 10。入力欄を閉じると消える', () => {
  const w = world(['t1', 'pending']);
  w.card('pending').remove();
  w.card('t1').dataset.tid = 't1';
  const composer = document.createElement('div');
  composer.className = 'thread composer';
  composer.getBoundingClientRect = () => domRect([1034, 300, 312, 220]);
  const no = document.createElement('span');
  no.className = 'no';
  no.getBoundingClientRect = () => domRect([1046, 312, 18, 18]);
  composer.append(no);
  w.body.append(composer);
  const anchor = {
    blockId: 'b3',
    blockHash: 'h3',
    blockTag: 'DIV',
    blockText: '',
    quote: '',
    prefix: '',
    suffix: '',
    label: '',
    rect: { x: 0, y: 0, w: 1, h: 1 },
  } as Anchor;
  useUi.setState({ composer: { id: 1, anchor } });
  mount(ctxOf([T[0] as Thread], marks(['t1', 'pending']), { t1: 'region' }));
  expect(tids().sort()).toEqual(['pending', 't1']);
  expect(group('pending')?.classList.contains('pending')).toBe(true);
  // 枠（450,250,200,100）の右端 650 + 10・中央 450。入力欄の丸の中央 321
  expect(dAt('pending').startsWith('M660 450H')).toBe(true);
  expect(dAt('pending').endsWith(' 1034 321')).toBe(true);
  act(() => useUi.setState({ composer: null }));
  w.box('pending').remove();
  composer.remove();
  act(() => (mos[0] as FakeObserver).cb());
  flush();
  expect(tids()).toEqual(['t1']);
});

test('入力中が、この対象全体（範囲なし）：対象の右端の外 6px へ。別の対象への入力欄には、引かない', () => {
  const w = world(['t1']);
  const composer = document.createElement('div');
  composer.className = 'thread composer';
  composer.getBoundingClientRect = () => domRect([1034, 300, 312, 220]);
  w.body.append(composer);
  const anchor = (id: string) =>
    ({
      blockId: id,
      blockHash: 'h3',
      blockTag: 'DIV',
      blockText: '',
      quote: '',
      prefix: '',
      suffix: '',
      label: '',
    }) as Anchor;
  useUi.setState({ composer: { id: 1, anchor: anchor('b3') } });
  const { rerender } = mount(ctxOf([T[0] as Thread], marks(['t1']), { t1: 'region' }));
  expect(tids().sort()).toEqual(['pending', 't1']);
  expect(dAt('pending').startsWith('M906 400H')).toBe(true);
  act(() => useUi.setState({ composer: { id: 2, anchor: anchor('other') } }));
  rerender(<FocusLinks focus={FOCUS} ctx={ctxOf([T[0] as Thread], marks(['t1']), { t1: 'region' })} />);
  flush();
  expect(tids()).toEqual(['t1']);
});

test('見える範囲：ステージの外（ズーム・移動で出た枠）の線は、選んでいなければ引かない。選んでいる・光らせているなら、縁の内側に止めて引く（丸なし）。ドックのスクロールで隠れたカードも同じ', () => {
  const w = world();
  mount(ctxOf(T, marks(['t1', 't2']), REGION));
  expect(tids().sort()).toEqual(['t1', 't2']);
  // 移動：t1 の枠が、ステージの下の外へ
  w.rects.set(w.box('t1'), [150, 1000, 200, 100]);
  act(() => w.stage.dispatchEvent(new Event('scroll')));
  flush();
  expect(tids()).toEqual(['t2']);
  act(() => useUi.getState().setActive('t1'));
  flush();
  expect(tids().sort()).toEqual(['t1', 't2']);
  expect(group('t1')?.classList.contains('edge')).toBe(true);
  expect(group('t1')?.querySelector('.cn-dot')).toBeNull();
  act(() => useUi.getState().setActive(null));
  flush();
  // ドックのスクロール：t2 のカードが、本体の上の外へ（見出しの下）。端点は、中：選んでいなければ、引かない
  w.rects.set(w.card('t2'), [1034, -100, 312, 200]);
  w.rects.set(w.card('t2').querySelector('.no') as Element, [1046, -88, 18, 18]);
  act(() => w.body.dispatchEvent(new Event('scroll')));
  flush();
  expect(tids()).toEqual([]);
});

test('ドックが、ステージの下のシート（窓が 760px 未満）：線は引かない（svg も出さない）。広げると、出る', () => {
  const w = world();
  w.rects.set(w.dock, [0, 500, 420, 400]); // ステージ（0,0,1020,900）の下端より下ではない：まず、横並び
  mount(ctxOf(T, marks(['t1', 't2']), REGION));
  w.rects.set(w.stage, [0, 0, 420, 480]);
  w.rects.set(w.dock, [0, 480, 420, 320]);
  w.rects.set(w.body, [0, 528, 420, 272]);
  act(() => window.dispatchEvent(new Event('resize')));
  flush();
  expect(document.querySelector('svg.fv-links')).toBeNull();
  w.rects.set(w.stage, [0, 0, 1020, 900]);
  w.rects.set(w.dock, [1020, 0, 340, 900]);
  w.rects.set(w.body, [1020, 48, 340, 852]);
  act(() => window.dispatchEvent(new Event('resize')));
  flush();
  expect(tids().sort()).toEqual(['t1', 't2']);
});

test('追従：ズーム・移動（枠の style の変化）・カードの増減（MutationObserver）・スクロール・窓で、測り直す。更新は、1 フレームに 1 回', () => {
  const w = world();
  mount(ctxOf(T, marks(['t1', 't2']), REGION));
  const d0 = dAt('t1');
  w.rects.set(w.box('t1'), [200, 300, 200, 100]); // 拡大・移動：右端 400・中央 350
  act(() => (mos[0] as FakeObserver).cb());
  flush();
  expect(dAt('t1')).not.toBe(d0);
  expect(dAt('t1').startsWith('M404 350H')).toBe(true);
  const before = frames.length;
  for (let i = 0; i < 5; i++) w.stage.dispatchEvent(new Event('scroll'));
  w.body.dispatchEvent(new Event('scroll'));
  window.dispatchEvent(new Event('resize'));
  expect(frames.length - before).toBe(1);
  flush();
  // カードを外すと、その線が消える（大きさの監視も、外す）
  const ro = ros[0] as FakeObserver;
  expect(ro.observed.has(w.card('t2'))).toBe(true);
  w.card('t2').remove();
  act(() => (mos[0] as FakeObserver).cb());
  flush();
  expect(tids()).toEqual(['t1']);
  expect(ro.observed.has(w.card('t2'))).toBe(false);
});

test('links: false：線も svg も出さない・リスナー・監視も張らない。オンに戻すと出る・またオフにすると、外す（本文の線と同じ ui.links）', () => {
  const w = world();
  const addsWin = vi.spyOn(window, 'addEventListener');
  const adds = vi.spyOn(w.root, 'addEventListener');
  useUi.setState({ ui: { ...useUi.getState().ui, links: false } });
  mount(ctxOf(T, marks(['t1', 't2']), REGION));
  expect(document.querySelector('svg.fv-links')).toBeNull();
  expect(adds).not.toHaveBeenCalled();
  expect(addsWin.mock.calls.filter(([t]) => t === 'resize')).toHaveLength(0);
  expect(ros).toHaveLength(0);
  expect(mos).toHaveLength(0);
  expect(frames).toHaveLength(0);
  act(() => useUi.getState().toggleLinks());
  flush();
  expect(tids().sort()).toEqual(['t1', 't2']);
  act(() => useUi.getState().toggleLinks());
  expect(document.querySelector('svg.fv-links')).toBeNull();
  expect(ros.every((o) => o.disconnected)).toBe(true);
  expect(mos.every((o) => o.disconnected)).toBe(true);
});

test.each([false, true])(
  'アンマウント：scroll・resize のリスナー・監視・rAF が残らない（StrictMode: %s）',
  (strict) => {
    const w = world();
    const added: [EventTarget, string, EventListenerOrEventListenerObject][] = [];
    const removed: typeof added = [];
    for (const t of [w.root, window] as EventTarget[]) {
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
    const { unmount } = mount(ctxOf(T, marks(['t1', 't2']), REGION), strict);
    const mine = added.filter(([, type]) => type === 'scroll' || type === 'resize');
    const live = () => mine.filter((a) => !removed.some((r) => r[0] === a[0] && r[1] === a[1] && r[2] === a[2]));
    expect(live().length).toBe(2);
    unmount();
    expect(live()).toHaveLength(0);
    expect(ros.every((o) => o.disconnected)).toBe(true);
    expect(mos.every((o) => o.disconnected)).toBe(true);
    expect(() => flush()).not.toThrow();
    expect(document.querySelector('svg.fv-links')).toBeNull();
  },
);

test('枠にマウスを置くと、そのスレッドを光らせる（linkedTid）。離すと消す。入力中の枠は、対象外', () => {
  const h = hoverBox('t1');
  act(() => h.onMouseEnter?.());
  expect(useUi.getState().linkedTid).toBe('t1');
  // ほかのカードへ移っていたら、離しても、消さない
  act(() => useUi.getState().setLinked('t2'));
  act(() => h.onMouseLeave?.());
  expect(useUi.getState().linkedTid).toBe('t2');
  act(() => useUi.getState().setLinked('t1'));
  act(() => h.onMouseLeave?.());
  expect(useUi.getState().linkedTid).toBeNull();
  expect(hoverBox('pending')).toEqual({});
  fireEvent.mouseEnter(document.body);
});

test('枠に置いたまま閉じる（FocusLinks が外れる）：その光りだけ外す。ほかの経路で付いた光りは、消さない。置いて離したあとは、何もしない', () => {
  world();
  const h = hoverBox('t1');
  const { unmount } = mount(ctxOf(T, marks(['t1', 't2']), REGION));
  act(() => h.onMouseEnter?.());
  expect(useUi.getState().linkedTid).toBe('t1');
  unmount();
  expect(useUi.getState().linkedTid).toBeNull();
  // 別の経路（カードにマウス）で付いた光り：枠は、置いていない
  act(() => useUi.getState().setLinked('t2'));
  const again = mount(ctxOf(T, marks(['t1', 't2']), REGION));
  again.unmount();
  expect(useUi.getState().linkedTid).toBe('t2');
  // 枠から、カードへ移った（枠の光りを、カードが、別のものに）：閉じても、カードの光りを消さない
  const h2 = hoverBox('t1');
  const third = mount(ctxOf(T, marks(['t1', 't2']), REGION));
  act(() => h2.onMouseEnter?.());
  act(() => useUi.getState().setLinked('t2'));
  third.unmount();
  expect(useUi.getState().linkedTid).toBe('t2');
});
