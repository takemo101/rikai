// @vitest-environment jsdom
// 実行できる枠（html-app）の橋（画面の側）：知らせの検査（送り元の窓・形・数・上下限）・別の枠の高さを変えられない・固定の高さは無視・rAF でまとめる・
// 1 秒あたりの反映の上限・受け口の参照カウントと後始末（二重の効果でも漏れない）・外観（theme）の送信・幅・同じ版の中で覚える。
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { PickInfo } from '../../../src/shared/htmlapp-bridge';
import { MAX_HEIGHT } from '../../../src/shared/htmlapp-resize';
import { APPLY_LIMIT, registerFrame } from '../../../src/web/htmlapp/frameBridge';
import {
  type AppFrame,
  followPageTheme,
  latestStateOf,
  registeredFrames,
  releaseApps,
  requestFrameSnapshot,
} from '../../../src/web/htmlapp/frameRegistry';
import { frameScale, frameScrolls, initialFrameState, MIN_SCALE } from '../../../src/web/htmlapp/frameState';

const added = vi.spyOn(window, 'addEventListener');
const removed = vi.spyOn(window, 'removeEventListener');
const messageCalls = (spy: typeof added): number => spy.mock.calls.filter((c) => c[0] === 'message').length;

let host: HTMLElement;
// jsdom は、レイアウトをしない：本文の幅（枠の置き場の clientWidth）は、テストが決める。ResizeObserver は、通知を、テストが起こす
const roCallbacks: Array<() => void> = [];
/** `transform: scale(s)` の s（CSS は、小数を丸めて持つ） */
/** 縮小後の大きさを持つ箱（iframe の親） */
const inner = (a: { iframe: HTMLIFrameElement }): HTMLElement => a.iframe.parentElement as HTMLElement;
const scaleOf = (el: HTMLElement): number => Number(/scale\(([^)]+)\)/.exec(el.style.transform)?.[1]);
function setAvail(w: number): void {
  Object.defineProperty(host, 'clientWidth', { value: w, configurable: true });
}

let viewKey = '';
let seq = 0;
beforeEach(() => {
  viewKey = `v/p/${++seq}`; // 覚えている状態（モジュールの状態）が、テストの間で、混ざらないように、版の印を、テストごとに変える
  host = document.createElement('div');
  document.body.append(host);
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout', 'Date'] });
  added.mockClear();
  removed.mockClear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  roCallbacks.length = 0;
  Reflect.deleteProperty(host, 'clientWidth');
  releaseApps(document);
  host.remove();
  vi.useRealTimers();
  expect(registeredFrames()).toBe(0);
});

/** 枠を作って、橋に登録する（iframe は、画面に付ける：contentWindow が、できる） */
function addFrame(
  opts: {
    n?: number;
    auto?: boolean;
    key?: string;
    page?: 'light' | 'dark';
    follows?: boolean;
    onPick?: (pick: PickInfo, stateJson: string | null) => void;
    onEsc?: () => void;
  } = {},
) {
  // host（本文の幅の箱）> inner（縮小後の大きさを持つ箱）> iframe
  const iframe = document.createElement('iframe');
  iframe.setAttribute('height', '200');
  const inner = document.createElement('div');
  inner.append(iframe);
  host.append(inner);
  const frame = registerFrame(
    iframe,
    opts.n ?? 0,
    opts.auto ?? true,
    opts.follows ?? true,
    initialFrameState(opts.key ?? viewKey, opts.n ?? 0, opts.page ?? 'light', opts.follows ?? true),
    { onPick: opts.onPick, onEsc: opts.onEsc },
  );
  return { iframe, frame, win: iframe.contentWindow as Window };
}

/** 枠（source）から、画面へ、メッセージが届いたことにする */
function post(source: unknown, data: unknown): void {
  const e = new MessageEvent('message', { data });
  Object.defineProperty(e, 'source', { value: source });
  window.dispatchEvent(e);
}
const resize = (height: unknown) => ({ __rikai: 1, type: 'resize', height });
const frameTick = (): void => void vi.advanceTimersByTime(20); // rAF 1 回ぶん

test('自動の高さの枠：知らせた高さが、rAF のあとに、その枠の height に反映される', () => {
  const a = addFrame();
  post(a.win, resize(640));
  expect(a.iframe.getAttribute('height')).toBe('200'); // rAF まで、反映しない
  frameTick();
  expect(a.iframe.getAttribute('height')).toBe('640');
  post(a.win, resize(9999));
  frameTick();
  expect(a.iframe.getAttribute('height')).toBe(String(MAX_HEIGHT));
});

test('検査：知らない窓・送り元なし・形の違い・NaN・負・文字は、無視（高さは、変わらない）。固定の高さの枠は、正しい知らせも、無視', () => {
  const a = addFrame();
  const fixed = addFrame({ n: 1, auto: false });
  const stranger = document.createElement('iframe'); // 画面が置いたのではない iframe（添付画像のプレビューなど）
  document.body.append(stranger);
  post(stranger.contentWindow, resize(700));
  post(window, resize(700));
  post(null, resize(700));
  post(undefined, resize(700));
  post({}, resize(700));
  for (const bad of [
    resize(Number.NaN),
    resize(-5),
    resize('700'),
    resize(null),
    { type: 'resize', height: 700 },
    'x',
    null,
  ])
    post(a.win, bad);
  post(fixed.win, resize(700));
  frameTick();
  vi.advanceTimersByTime(2000);
  expect(a.iframe.getAttribute('height')).toBe('200');
  expect(fixed.iframe.getAttribute('height')).toBe('200');
  stranger.remove();
});

test('1 つの枠が、別の枠の高さを変えられない：source に対応する枠だけが、変わる', () => {
  const a = addFrame({ n: 0 });
  const b = addFrame({ n: 1 });
  const c = addFrame({ n: 2 });
  post(b.win, resize(500));
  frameTick();
  expect([a, b, c].map((f) => f.iframe.getAttribute('height'))).toEqual(['200', '500', '200']);
  post(c.win, resize(321));
  post(a.win, resize(444));
  frameTick();
  expect([a, b, c].map((f) => f.iframe.getAttribute('height'))).toEqual(['444', '500', '321']);
});

test('rAF でまとめる：1 フレームに、いくつ来ても、反映は 1 回（最後の値）', () => {
  const a = addFrame();
  const set = vi.spyOn(a.iframe, 'setAttribute');
  for (const h of [300, 400, 500, 600]) post(a.win, resize(h));
  expect(set).not.toHaveBeenCalled();
  frameTick();
  expect(set).toHaveBeenCalledTimes(1);
  expect(set).toHaveBeenCalledWith('height', '600');
  post(a.win, resize(600)); // 同じ値は、反映しない
  frameTick();
  expect(set).toHaveBeenCalledTimes(1);
});

test('1 秒あたりの反映の上限：連打しても、反映は APPLY_LIMIT 回まで。残りは、窓が空いてから、最後の値だけ', () => {
  const a = addFrame();
  const set = vi.spyOn(a.iframe, 'setAttribute');
  for (let i = 0; i < 100; i++) {
    post(a.win, resize(300 + i));
    vi.advanceTimersByTime(10); // 約 1 秒に 100 回の連打（1 秒の窓の中は、1000ms）
  }
  const within = set.mock.calls.length;
  expect(within).toBeLessThanOrEqual(APPLY_LIMIT);
  expect(within).toBeGreaterThan(0);
  vi.advanceTimersByTime(3000);
  expect(set.mock.calls.at(-1)).toEqual(['height', '399']); // 最後の値は、落とさない
  expect(set.mock.calls.length).toBeLessThanOrEqual(APPLY_LIMIT + 1);
  // どの 1 秒の窓にも、APPLY_LIMIT 回を超えない（反映の時刻は、タイマーで見ていないので、回数の総量で確かめる：100 回の連打が、7 回以下になった）
  expect(set.mock.calls.length).toBeLessThan(10);
});

test('受け口：枠が 1 つ以上あるあいだだけ、message のリスナーが 1 つ付く（参照カウント）。0 になったら外れる', () => {
  expect(messageCalls(added)).toBe(0);
  addFrame({ n: 0 });
  const b = addFrame({ n: 1 });
  expect(messageCalls(added)).toBe(1);
  releaseApps(host); // host 全体を外す
  expect(registeredFrames()).toBe(0);
  expect(messageCalls(removed)).toBe(1);
  // 外したあとの知らせは、効かない
  post(b.win, resize(900));
  frameTick();
  expect(b.iframe.getAttribute('height')).toBe('200');
});

test('受け口：一部の枠だけ外しても、残りがあるあいだは、付いたまま。残りを外したら外れる。二重に外しても、害がない', () => {
  const left = document.createElement('section');
  const right = document.createElement('section');
  host.append(left, right);
  const mk = (parent: HTMLElement, n: number) => {
    const iframe = document.createElement('iframe');
    parent.append(iframe);
    return { iframe, frame: registerFrame(iframe, n, true, true, initialFrameState(viewKey, n, 'light', true)) };
  };
  const a = mk(left, 0);
  mk(right, 1);
  expect(messageCalls(added)).toBe(1);
  releaseApps(left);
  releaseApps(left); // 二重
  expect(registeredFrames()).toBe(1);
  expect(messageCalls(removed)).toBe(0);
  post(a.iframe.contentWindow, resize(700));
  frameTick();
  expect(a.iframe.getAttribute('height')).toBeNull(); // 外した枠には、効かない
  releaseApps(right);
  expect(messageCalls(removed)).toBe(1);
});

test('StrictMode のように、登録 → 後始末 → 登録 を繰り返しても、リスナーは、漏れない（常に、0 か 1）', () => {
  for (let i = 0; i < 5; i++) {
    const a = addFrame({ n: i });
    releaseApps(host);
    expect(a.iframe.isConnected).toBe(true);
  }
  expect(registeredFrames()).toBe(0);
  expect(messageCalls(added)).toBe(5);
  expect(messageCalls(removed)).toBe(5);
  const a = addFrame();
  expect(messageCalls(added) - messageCalls(removed)).toBe(1);
  releaseApps(host);
  expect(messageCalls(added) - messageCalls(removed)).toBe(0);
  expect(a.frame.get().width).toBe('auto');
});

test('外観：枠だけの切り替えは、theme を送る（形・送り先 *）。再読み込みしない（src は、変えない）。読み込みが終わったら、いまの外観を、もう一度送る', () => {
  const a = addFrame({ page: 'light' });
  const src = a.iframe.getAttribute('src');
  const send = vi.spyOn(a.win, 'postMessage');
  a.frame.setMode('dark');
  expect(send).toHaveBeenCalledWith({ __rikai: 1, type: 'theme', mode: 'dark', by: 'user' }, '*');
  expect(a.frame.get()).toEqual({ width: 'auto', mode: 'dark', forced: true, avail: 0, picking: false });
  a.frame.setMode('dark'); // 同じ値は、送らない
  expect(send).toHaveBeenCalledTimes(1);
  a.iframe.dispatchEvent(new Event('load'));
  expect(send).toHaveBeenCalledTimes(2);
  expect(send).toHaveBeenLastCalledWith({ __rikai: 1, type: 'theme', mode: 'dark', by: 'user' }, '*');
  expect(a.iframe.getAttribute('src')).toBe(src);
});

test('画面の外観が変わる（by: auto）：対応を示した枠に theme を送り、枠だけの外観は解く。すでに同じ外観の枠には、送らない', () => {
  const a = addFrame({ n: 0, page: 'light' });
  const b = addFrame({ n: 1, page: 'light' });
  b.frame.setMode('dark'); // 枠だけ、ダーク
  const sa = vi.spyOn(a.win, 'postMessage');
  const sb = vi.spyOn(b.win, 'postMessage');
  followPageTheme('dark');
  expect(sa).toHaveBeenCalledWith({ __rikai: 1, type: 'theme', mode: 'dark', by: 'auto' }, '*');
  expect(sb).not.toHaveBeenCalled(); // もう、ダーク
  expect(a.frame.get()).toMatchObject({ mode: 'dark', forced: false });
  expect(b.frame.get()).toMatchObject({ mode: 'dark', forced: false }); // 枠だけの指定は、解けた
  followPageTheme('light');
  expect(sb).toHaveBeenCalledWith({ __rikai: 1, type: 'theme', mode: 'light', by: 'auto' }, '*');
  expect(b.frame.get()).toMatchObject({ mode: 'light', forced: false });
});

test('対応を示さない従来の枠：最初は、画面がダークでも、ライト。画面の外観が変わっても、触らない（送らない・状態も変えない）。ツールバー（by: user）は、効く。読み込みの再送は、枠だけの外観のときだけ', () => {
  const legacy = addFrame({ n: 0, page: 'dark', follows: false });
  const follow = addFrame({ n: 1, page: 'dark', follows: true });
  expect(legacy.frame.get()).toMatchObject({ mode: 'light', forced: false });
  expect(follow.frame.get()).toMatchObject({ mode: 'dark', forced: false });
  const sl = vi.spyOn(legacy.win, 'postMessage');
  legacy.iframe.dispatchEvent(new Event('load'));
  expect(sl).not.toHaveBeenCalled(); // 画面の外観は、従来の枠には、関係ない
  followPageTheme('light');
  followPageTheme('dark');
  expect(sl).not.toHaveBeenCalled();
  expect(legacy.frame.get()).toMatchObject({ mode: 'light', forced: false });
  // 利用者の明示の操作は、従来の枠でも、効く。そのあとの画面の外観の変化では、戻らない
  legacy.frame.setMode('dark');
  expect(sl).toHaveBeenCalledWith({ __rikai: 1, type: 'theme', mode: 'dark', by: 'user' }, '*');
  followPageTheme('light');
  expect(legacy.frame.get()).toMatchObject({ mode: 'dark', forced: true });
  legacy.iframe.dispatchEvent(new Event('load'));
  expect(sl).toHaveBeenLastCalledWith({ __rikai: 1, type: 'theme', mode: 'dark', by: 'user' }, '*');
  // 覚えている状態：枠だけの外観を覚え、対応を示さない枠の、既定は、ライト
  releaseApps(host);
  expect(initialFrameState(viewKey, 0, 'light', false)).toMatchObject({ mode: 'dark', forced: true });
  expect(initialFrameState(viewKey, 5, 'dark', false)).toMatchObject({ mode: 'light', forced: false });
});

test('読み込みの再送：画面の外観に従う枠は by: auto（枠だけの外観のときは user）', () => {
  const a = addFrame({ page: 'dark' });
  const send = vi.spyOn(a.win, 'postMessage');
  a.iframe.dispatchEvent(new Event('load'));
  expect(send).toHaveBeenLastCalledWith({ __rikai: 1, type: 'theme', mode: 'dark', by: 'auto' }, '*');
  a.frame.setMode('light');
  a.iframe.dispatchEvent(new Event('load'));
  expect(send).toHaveBeenLastCalledWith({ __rikai: 1, type: 'theme', mode: 'light', by: 'user' }, '*');
});

// ---- 幅：選んだ幅で、レイアウトを計算して、本文の幅に収まるよう縮小して見せる ----
test('frameScale：選んだ幅が、本文の幅より広いときだけ、収める縮小率（下限 50%）。以下・自動・測れていない（0）は、1。frameScrolls：下限で止まって、まだ収まらないとき', () => {
  expect(frameScale(768, 634)).toBeCloseTo(634 / 768, 10);
  expect(frameScale(1280, 800)).toBeCloseTo(800 / 1280, 10); // 62.5%：下限より大きい（収まる）
  expect(frameScale(1280, 634)).toBe(MIN_SCALE); // 49.5% → 下限 50%
  expect(frameScale(1920, 634)).toBe(MIN_SCALE); // 33% → 下限 50%
  expect(frameScale(1920, 420)).toBe(MIN_SCALE);
  expect(MIN_SCALE).toBe(0.5);
  expect(frameScrolls(768, 634)).toBe(false); // 収まる
  expect(frameScrolls(1280, 800)).toBe(false);
  expect(frameScrolls(1280, 634)).toBe(true); // 640 > 634：わずかに、横にスクロール
  expect(frameScrolls(1920, 634)).toBe(true);
  expect(frameScrolls(1920, 960)).toBe(false); // ちょうど 50% で収まる
  expect(frameScrolls(375, 634)).toBe(false);
  expect(frameScrolls('auto', 634)).toBe(false);
  expect(frameScrolls(1920, 0)).toBe(false);
  expect(frameScale(375, 634)).toBe(1);
  expect(frameScale(768, 768)).toBe(1);
  expect(frameScale('auto', 634)).toBe(1);
  expect(frameScale(1280, 0)).toBe(1);
});

test('幅（本文 634px）：375 は、そのまま。768 は、本文の幅に縮小。1280・1920 は、下限 50% で止まり、置き場が横にスクロールする。ラッパーの高さ＝枠の高さ × 縮小率。自動で、すべて解く', () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(cb: () => void) {
        roCallbacks.push(cb);
      }
      observe(): void {}
      disconnect(): void {}
    },
  );
  setAvail(634);
  const a = addFrame();
  a.iframe.setAttribute('height', '300');
  expect(a.frame.get().avail).toBe(634);
  a.frame.setWidth(375);
  expect([a.iframe.style.width, a.iframe.style.transform, inner(a).style.height]).toEqual(['375px', '', '']);
  expect(inner(a).classList.contains('appscaled')).toBe(false);
  a.frame.setWidth(768);
  expect(scaleOf(a.iframe)).toBeCloseTo(634 / 768, 5);
  expect(host.classList.contains('appscroll')).toBe(false); // 収まる：横にスクロールしない
  a.frame.setWidth(1280);
  expect(a.iframe.style.width).toBe('1280px'); // 枠の中の innerWidth は、1280（@media・vw・100% が、その幅で効く）
  expect(scaleOf(a.iframe)).toBe(0.5); // 634/1280 = 49.5% → 下限 50%
  expect(inner(a).style.height).toBe(`${300 * 0.5}px`);
  expect(inner(a).style.width).toBe('640px'); // スクロールできる範囲は、縮小後の幅（iframe の縮小前の幅ではない）
  expect(inner(a).classList.contains('appscaled')).toBe(true);
  expect(host.classList.contains('appscroll')).toBe(true); // 640 > 634：横にスクロール
  a.frame.setWidth(1920);
  expect(scaleOf(a.iframe)).toBe(0.5);
  expect(host.classList.contains('appscroll')).toBe(true);
  // 高さの知らせ（自動）：縮小しているときは、ラッパーの高さも、×縮小率で、追従する
  post(a.win, resize(900));
  frameTick();
  expect(a.iframe.getAttribute('height')).toBe('900');
  expect(inner(a).style.height).toBe(`${900 * 0.5}px`);
  a.frame.setWidth('auto');
  expect([a.iframe.style.width, a.iframe.style.transform, inner(a).style.height, inner(a).style.width]).toEqual([
    '',
    '',
    '',
    '',
  ]);
  expect(inner(a).classList.contains('appscaled') || host.classList.contains('appscroll')).toBe(false);
});

test('幅：本文の幅が変わる（窓・パネル・一覧の開閉）と、縮小率を計算し直す（rAF）。状態（avail）が、購読者に届く。広がって、選んだ幅以下になれば、縮小をやめる', () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(cb: () => void) {
        roCallbacks.push(cb);
      }
      observe(): void {}
      disconnect(): void {}
    },
  );
  roCallbacks.length = 0;
  setAvail(634);
  const a = addFrame();
  a.iframe.setAttribute('height', '400');
  a.frame.setWidth(768);
  const cb = vi.fn();
  a.frame.subscribe(cb);
  setAvail(500);
  for (const f of roCallbacks) f();
  expect(scaleOf(a.iframe)).toBeCloseTo(634 / 768, 5); // rAF まで、そのまま
  frameTick();
  expect(scaleOf(a.iframe)).toBeCloseTo(500 / 768, 5);
  expect(parseFloat(inner(a).style.height)).toBeCloseTo(400 * (500 / 768), 3);
  expect(a.frame.get().avail).toBe(500);
  expect(host.classList.contains('appscroll')).toBe(false);
  // もっと狭くなった：下限 50% で止まり、横にスクロールする
  setAvail(300);
  for (const f of roCallbacks) f();
  frameTick();
  expect(scaleOf(a.iframe)).toBe(0.5);
  expect(host.classList.contains('appscroll')).toBe(true);
  setAvail(500);
  for (const f of roCallbacks) f();
  frameTick();
  expect(cb).toHaveBeenCalled();
  // 幅が変わっていない通知（高さだけの変化）は、何もしない
  const calls = cb.mock.calls.length;
  for (const f of roCallbacks) f();
  frameTick();
  expect(cb.mock.calls.length).toBe(calls);
  // 十分広くなった
  setAvail(1400);
  for (const f of roCallbacks) f();
  frameTick();
  expect([a.iframe.style.transform, inner(a).style.height]).toEqual(['', '']);
  expect(inner(a).classList.contains('appscaled') || host.classList.contains('appscroll')).toBe(false);
  expect(a.iframe.style.width).toBe('768px');
});

test('幅：後始末（releaseApps）で、ResizeObserver も外す', () => {
  const disconnect = vi.fn();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      disconnect = disconnect;
    },
  );
  addFrame();
  releaseApps(host);
  expect(disconnect).toHaveBeenCalledTimes(1);
});

test('幅：選んだ幅が、本文の幅以下なら、縮小しない。縮小するかしないかは、選んだ幅と本文の幅だけで決まる（枠が、自動の高さでも固定でも）', () => {
  setAvail(1000);
  const fixed = addFrame({ n: 1, auto: false });
  fixed.frame.setWidth(768);
  expect([fixed.iframe.style.width, fixed.iframe.style.transform]).toEqual(['768px', '']);
  fixed.frame.setWidth(1280);
  expect(scaleOf(fixed.iframe)).toBeCloseTo(1000 / 1280, 5);
});

test('幅：選んだ幅は、同じ版の中で、描き直しても、覚えている（縮小も、そのまま）', () => {
  setAvail(634);
  const a = addFrame({ n: 2 });
  a.frame.setWidth(768);
  releaseApps(host);
  const again = addFrame({ n: 2 });
  expect(again.frame.get().width).toBe(768);
  expect(scaleOf(again.iframe)).toBeCloseTo(634 / 768, 5);
});

test('幅：切り替えると、iframe の style.width（px）。auto で、解く', () => {
  const a = addFrame();
  expect(a.iframe.style.width).toBe('');
  a.frame.setWidth(375);
  expect(a.iframe.style.width).toBe('375px');
  a.frame.setWidth(1280);
  expect(a.iframe.style.width).toBe('1280px');
  a.frame.setWidth(1920);
  expect(a.iframe.style.width).toBe('1920px');
  a.frame.setWidth('auto');
  expect(a.iframe.style.width).toBe('');
});

test('購読：状態が変わると、通知される（ツールバーの表示）。外せる', () => {
  const a = addFrame();
  const cb = vi.fn();
  const off = a.frame.subscribe(cb);
  a.frame.setWidth(768);
  a.frame.setMode('dark');
  expect(cb).toHaveBeenCalledTimes(2);
  off();
  a.frame.setWidth('auto');
  expect(cb).toHaveBeenCalledTimes(2);
});

test('同じ版の中で、描き直しても（コメントの追加など）、枠の幅・枠だけの外観を覚える。版・ページが変わったら、捨てる。画面の外観に従っている枠は、画面の外観', () => {
  const a = addFrame({ n: 3, key: 'topic/root/2' });
  a.frame.setWidth(768);
  a.frame.setMode('dark');
  const other = addFrame({ n: 4, key: 'topic/root/2' }); // 触っていない枠
  other.frame.setWidth('auto');
  releaseApps(host);
  // 描き直し：同じ版
  expect(initialFrameState('topic/root/2', 3, 'light', true)).toEqual({
    width: 768,
    mode: 'dark',
    forced: true,
    avail: 0,
    picking: false,
  });
  expect(initialFrameState('topic/root/2', 4, 'light', true)).toEqual({
    width: 'auto',
    mode: 'light',
    forced: false,
    avail: 0,
    picking: false,
  });
  // 外観が変わったあと（followPageTheme）は、枠だけの指定を覚えていない
  const again = addFrame({ n: 3, key: 'topic/root/2' });
  followPageTheme('dark');
  releaseApps(host);
  expect(initialFrameState('topic/root/2', 3, 'dark', true)).toEqual({
    width: 768,
    mode: 'dark',
    forced: false,
    avail: 0,
    picking: false,
  });
  expect(again.frame.get().forced).toBe(false);
  // 別の版：捨てる
  expect(initialFrameState('topic/root/3', 3, 'light', true)).toEqual({
    width: 'auto',
    mode: 'light',
    forced: false,
    avail: 0,
    picking: false,
  });
  expect(initialFrameState('topic/root/2', 3, 'light', true)).toEqual({
    width: 'auto',
    mode: 'light',
    forced: false,
    avail: 0,
    picking: false,
  });
});

test('後始末：onRelease の関数が、外すときに、呼ばれる（1 回だけ）', () => {
  const a = addFrame();
  const fn = vi.fn();
  (a.frame as AppFrame).onRelease(fn);
  releaseApps(host);
  releaseApps(host);
  expect(fn).toHaveBeenCalledTimes(1);
});

// ---- 書き戻し（F42）：要素を選ぶ・状態 ----
const pickMsg = (over: Record<string, unknown> = {}) => ({
  __rikai: 1,
  type: 'pick',
  selector: 'button.primary',
  tag: 'button',
  text: 'ログイン',
  rect: { x: 24, y: 312, w: 320, h: 40 },
  styles: { display: 'block' },
  frame: { w: 634, h: 400 },
  ...over,
});
const stateMsg = (json: string) => ({ __rikai: 1, type: 'state', json });
const keydown = (key: string): void => void document.dispatchEvent(new KeyboardEvent('keydown', { key }));
const keyCalls = (spy: typeof added): number => spy.mock.calls.filter((c) => c[0] === 'keydown').length;
const docAdd = vi.spyOn(document, 'addEventListener');
const docDel = vi.spyOn(document, 'removeEventListener');

test('要素を選ぶ：押すと選択モード（pick-start を、その枠へだけ送る）。1 つ選ぶと、検査済みの情報と、その枠の最新の状態が渡って、終わる', () => {
  const onPick = vi.fn();
  const a = addFrame({ n: 0, onPick });
  const b = addFrame({ n: 1 });
  const sa = vi.spyOn(a.win, 'postMessage');
  const sb = vi.spyOn(b.win, 'postMessage');
  const cb = vi.fn();
  a.frame.subscribe(cb);
  post(a.win, stateMsg('{"step":2}'));
  a.frame.startPick();
  expect(a.frame.get().picking).toBe(true);
  expect(sa).toHaveBeenCalledWith({ __rikai: 1, type: 'pick-start' }, '*');
  expect(sb).not.toHaveBeenCalled();
  expect(cb).toHaveBeenCalled();
  post(a.win, pickMsg());
  expect(onPick).toHaveBeenCalledTimes(1);
  expect(onPick).toHaveBeenCalledWith(
    expect.objectContaining({
      selector: 'button.primary',
      tag: 'button',
      text: 'ログイン',
      rect: { x: 24, y: 312, w: 320, h: 40 },
    }),
    '{"step":2}',
  );
  expect(a.frame.get().picking).toBe(false);
});

test('要素を選ぶ：選択モードでない枠からの pick は、無視（枠のコードが、勝手に、下書きを作れない）。洪水でも、1 つ選ぶと終わるので、下書きは、1 つだけ', () => {
  const onPick = vi.fn();
  const a = addFrame({ onPick });
  for (let i = 0; i < 50; i++) post(a.win, pickMsg()); // ボタンを押していない
  expect(onPick).not.toHaveBeenCalled();
  a.frame.startPick();
  for (let i = 0; i < 1000; i++) post(a.win, pickMsg({ text: `洪水 ${i}` }));
  expect(onPick).toHaveBeenCalledTimes(1);
  expect(onPick.mock.calls[0]?.[0].text).toBe('洪水 0');
});

test('要素を選ぶ：不正な pick（型違い・巨大・NaN・余分なキー）は、捨てる。選択モードは、そのまま続く', () => {
  const onPick = vi.fn();
  const a = addFrame({ onPick });
  a.frame.startPick();
  for (const bad of [
    pickMsg({ rect: { x: Number.NaN, y: 0, w: 1, h: 1 } }),
    pickMsg({ text: 'x'.repeat(5000) }),
    pickMsg({ extra: 1 }),
    pickMsg({ styles: { 'background-image': 'url(x)' } }),
    pickMsg({ selector: 1 }),
    null,
    'pick',
  ])
    post(a.win, bad);
  expect(onPick).not.toHaveBeenCalled();
  expect(a.frame.get().picking).toBe(true);
});

test('兄弟の枠・ほかの窓からの pick・state・pick-cancel は、効かない（送り元の窓で、枠ごとに照合する）', () => {
  const onPickA = vi.fn();
  const onPickB = vi.fn();
  const a = addFrame({ n: 0, onPick: onPickA });
  const b = addFrame({ n: 1, onPick: onPickB });
  b.frame.startPick();
  post(a.win, pickMsg({ text: 'A がなりすまし' })); // B が選んでいるが、送ったのは A
  expect(onPickB).not.toHaveBeenCalled();
  expect(onPickA).not.toHaveBeenCalled();
  post(a.win, { __rikai: 1, type: 'pick-cancel' });
  expect(b.frame.get().picking).toBe(true);
  post(a.win, stateMsg('{"from":"A"}'));
  post(window, stateMsg('{"from":"window"}'));
  post(null, stateMsg('{"from":"null"}'));
  expect(a.frame.latestState()).toBe('{"from":"A"}'); // A 自身の状態になる
  expect(b.frame.latestState()).toBeNull(); // B には、入らない
  post(b.win, pickMsg());
  expect(onPickB).toHaveBeenCalledTimes(1);
});

test('要素を選ぶ：中止（枠の pick-cancel・もう一度ボタン・親の Esc）。同時に選べるのは 1 つの枠（あとから始めると、前の枠は、中止して、知らせる）', () => {
  const a = addFrame({ n: 0 });
  const b = addFrame({ n: 1 });
  const sa = vi.spyOn(a.win, 'postMessage');
  a.frame.startPick();
  post(a.win, { __rikai: 1, type: 'pick-cancel' }); // 枠の中の Esc
  expect(a.frame.get().picking).toBe(false);
  a.frame.startPick();
  b.frame.startPick();
  expect(a.frame.get().picking).toBe(false);
  expect(sa).toHaveBeenLastCalledWith({ __rikai: 1, type: 'pick-cancel' }, '*');
  expect(b.frame.get().picking).toBe(true);
  const sb = vi.spyOn(b.win, 'postMessage');
  keydown('Enter');
  expect(b.frame.get().picking).toBe(true);
  keydown('Escape'); // 親の Esc
  expect(b.frame.get().picking).toBe(false);
  expect(sb).toHaveBeenLastCalledWith({ __rikai: 1, type: 'pick-cancel' }, '*');
  b.frame.startPick();
  b.frame.cancelPick(); // もう一度ボタン
  expect(b.frame.get().picking).toBe(false);
});

test('要素を選ぶ：Esc の受け口は、選んでいる枠があるあいだだけ。終われば外れる（枠が消えても）', () => {
  docAdd.mockClear();
  docDel.mockClear();
  const a = addFrame({ n: 0 });
  a.frame.startPick();
  expect(keyCalls(docAdd)).toBe(1);
  a.frame.cancelPick();
  expect(keyCalls(docDel)).toBe(1);
  a.frame.startPick();
  releaseApps(host); // 選んでいる最中に、枠が消えた
  expect(keyCalls(docAdd) - keyCalls(docDel)).toBe(0);
});

test('要素を選ぶ：選んでいる最中に、枠が読み込み直されたら（load）、pick-start を、もう一度送る', () => {
  const a = addFrame();
  a.frame.startPick();
  const send = vi.spyOn(a.win, 'postMessage');
  a.iframe.dispatchEvent(new Event('load'));
  expect(send).toHaveBeenCalledWith({ __rikai: 1, type: 'pick-start' }, '*');
});

test('状態：枠ごとに、最新の 1 つ（検査済みの、書き直した JSON）。不正（8KB 超・読めない・深すぎる）は、前の状態を残して、捨てる。latestStateOf で、枠の箱から引ける', () => {
  const a = addFrame({ n: 0 });
  const b = addFrame({ n: 1 });
  expect(a.frame.latestState()).toBeNull();
  post(a.win, stateMsg('{ "step": 1 }'));
  post(a.win, stateMsg('{ "step": 2 }'));
  expect(a.frame.latestState()).toBe('{"step":2}');
  for (const bad of ['{bad', JSON.stringify({ a: 'x'.repeat(9000) }), '['.repeat(20) + ']'.repeat(20), '5'])
    post(a.win, stateMsg(bad));
  expect(a.frame.latestState()).toBe('{"step":2}');
  expect(b.frame.latestState()).toBeNull();
  expect(latestStateOf(a.iframe.parentElement as HTMLElement)).toBe('{"step":2}');
  expect(latestStateOf(document.createElement('div'))).toBeNull();
});

test('状態：頻度の上限（1 秒に 8 回）。洪水でも、上限の分しか読まない（親は、固まらない）。窓が空くと、また受ける', () => {
  const a = addFrame();
  for (let i = 1; i <= 100; i++) post(a.win, stateMsg(`{"n":${i}}`));
  expect(a.frame.latestState()).toBe('{"n":8}');
  vi.advanceTimersByTime(1100);
  post(a.win, stateMsg('{"n":101}'));
  expect(a.frame.latestState()).toBe('{"n":101}');
});

test('状態：メモリだけ（枠を外すと、なくなる。描き直して作った枠には、引き継がない）', () => {
  const a = addFrame({ n: 0 });
  post(a.win, stateMsg('{"x":1}'));
  releaseApps(host);
  const again = addFrame({ n: 0 });
  expect(again.frame.latestState()).toBeNull();
});

// ---- 枠の画像（snapshot-req → snapshot） ----
const PNG = `data:image/png;base64,${'iVBORw0KGgo'.padEnd(40, 'A')}`;
/** 画像の読み込み：jsdom には、ない。大きさ・成否を、テストが決める */
function stubImage(size: { w: number; h: number } | 'error' = { w: 200, h: 100 }): void {
  vi.stubGlobal(
    'Image',
    class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = size === 'error' ? 0 : size.w;
      naturalHeight = size === 'error' ? 0 : size.h;
      set src(_v: string) {
        queueMicrotask(() => (size === 'error' ? this.onerror?.() : this.onload?.()));
      }
    },
  );
}
const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};
const reqId = (send: { mock: { calls: unknown[][] } }): string => {
  const m = send.mock.calls.find((c) => (c[0] as { type?: string }).type === 'snapshot-req')?.[0] as { id: string };
  return m.id;
};
const reply = (win: Window, id: string, over: Record<string, unknown> = {}) =>
  post(win, { __rikai: 1, type: 'snapshot', id, png: PNG, ...over });

test('枠の画像：頼む（snapshot-req と id）→ その枠の、その id の応答だけを受ける。読めて、大きさが上限の中なら、PNG の data URL が返る', async () => {
  stubImage();
  const a = addFrame();
  const send = vi.spyOn(a.win, 'postMessage');
  const p = a.frame.requestSnapshot();
  const id = reqId(send);
  expect(send).toHaveBeenCalledWith({ __rikai: 1, type: 'snapshot-req', id }, '*');
  expect(id).toMatch(/^s[0-9]+$/);
  reply(a.win, id);
  await expect(p).resolves.toBe(PNG);
});

test('枠の画像：偽・古い・二重・兄弟の枠の応答は、捨てる（id の結びつけ・送り元の窓）', async () => {
  stubImage();
  const a = addFrame({ n: 0 });
  const b = addFrame({ n: 1 });
  const sa = vi.spyOn(a.win, 'postMessage');
  const p = a.frame.requestSnapshot();
  const id = reqId(sa);
  reply(b.win, id, { png: `${PNG}ZZZZ` }); // 兄弟の枠が、同じ id で、偽の画像を送る
  reply(a.win, 's999999'); // 頼んでいない id
  reply(window as unknown as Window, id); // 枠でない窓
  await flush();
  let settled = false;
  void p.then(() => {
    settled = true;
  });
  await flush();
  expect(settled).toBe(false); // まだ、本物を待っている
  reply(a.win, id); // 本物
  await expect(p).resolves.toBe(PNG);
  reply(a.win, id, { png: `${PNG}ZZZZ` }); // 二重の応答
  const again = a.frame.requestSnapshot();
  reply(a.win, id); // 前の id を、新しい要求に使い回す
  vi.advanceTimersByTime(2100);
  await expect(again).resolves.toBeNull();
});

test('枠の画像：不正（形・id・PNG でない・巨大・読めない・大きさが上限超え）と、枠の失敗（png: null）は、null。時間切れ（2 秒）も null', async () => {
  const a = addFrame();
  const send = vi.spyOn(a.win, 'postMessage');
  const ask = async (replyWith: (id: string) => void, size?: Parameters<typeof stubImage>[0]) => {
    stubImage(size);
    send.mockClear();
    const p = a.frame.requestSnapshot();
    replyWith(reqId(send));
    await flush();
    vi.advanceTimersByTime(2100);
    return p;
  };
  expect(await ask((id) => reply(a.win, id, { png: null }))).toBeNull();
  expect(await ask((id) => reply(a.win, id, { png: 'data:image/jpeg;base64,AAAA' }))).toBeNull();
  expect(await ask((id) => reply(a.win, id, { png: `data:image/png;base64,${'A'.repeat(2_000_000)}` }))).toBeNull(); // 巨大
  expect(await ask((id) => reply(a.win, id, { extra: 1 }))).toBeNull();
  expect(await ask((id) => reply(a.win, id), 'error')).toBeNull(); // PNG として読めない
  expect(await ask((id) => reply(a.win, id), { w: 5000, h: 100 })).toBeNull(); // 大きさが上限超え
  expect(await ask((id) => reply(a.win, id), { w: 0, h: 0 })).toBeNull();
  expect(await ask(() => {})).toBeNull(); // 応答しない：時間切れ
});

test('枠の画像：時間切れは 2 秒。待っている間に枠が消えたら（release）、すぐ null（箱に戻る）。登録していない iframe は null', async () => {
  const a = addFrame();
  let result: string | null | undefined;
  void a.frame.requestSnapshot().then((r) => {
    result = r;
  });
  vi.advanceTimersByTime(1900);
  await flush();
  expect(result).toBeUndefined();
  vi.advanceTimersByTime(200);
  await flush();
  expect(result).toBeNull();
  let result2: string | null | undefined;
  void a.frame.requestSnapshot().then((r) => {
    result2 = r;
  });
  releaseApps(host);
  await flush();
  expect(result2).toBeNull();
  await expect(requestFrameSnapshot(document.createElement('iframe'))).resolves.toBeNull();
});

test('枠の中の Esc（esc）：拡大表示の枠（onEsc を渡した枠）だけが、受ける。送り元の窓・形・頻度（1 秒に 6 回まで）を検査する。本文の枠・兄弟の枠の esc は、何もしない', () => {
  const onEsc = vi.fn();
  const focus = addFrame({ n: 0, onEsc });
  const body = addFrame({ n: 1 }); // 本文の枠：onEsc がない
  const esc = { __rikai: 1, type: 'esc' };
  post(body.win, esc); // 兄弟・本文の枠：拡大表示の枠の onEsc は、呼ばれない
  post(window, esc);
  post(null, esc);
  expect(onEsc).not.toHaveBeenCalled();
  post(focus.win, { ...esc, extra: 1 }); // 形の不正
  post(focus.win, { __rikai: 1, type: 'esc', key: 'Escape' });
  post(focus.win, { __rikai: 2, type: 'esc' });
  expect(onEsc).not.toHaveBeenCalled();
  post(focus.win, esc);
  expect(onEsc).toHaveBeenCalledTimes(1);
  for (let i = 0; i < 20; i++) post(focus.win, esc); // 洪水：1 秒に 6 回まで
  expect(onEsc).toHaveBeenCalledTimes(6);
  vi.advanceTimersByTime(1100);
  post(focus.win, esc);
  expect(onEsc).toHaveBeenCalledTimes(7);
  // 外した枠からは、受けない
  releaseApps(focus.iframe.parentElement as HTMLElement);
  post(focus.win, esc);
  expect(onEsc).toHaveBeenCalledTimes(7);
});

test('選択モードの、親での Esc：変換中（isComposing・keyCode 229）は、中止しない', () => {
  const a = addFrame({ n: 0 });
  a.frame.startPick();
  expect(a.frame.get().picking).toBe(true);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true }));
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 229 }));
  expect(a.frame.get().picking).toBe(true);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  expect(a.frame.get().picking).toBe(false);
});
