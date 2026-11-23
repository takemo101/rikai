// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, screen } from '@testing-library/react';
import { type RefObject, useRef } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { topicKey } from '../../../src/web/api/queries';
import { queryClient } from '../../../src/web/api/queryClient';
import { markBlocks } from '../../../src/web/doc/render/blocks';
import { handleEscape, Interact } from '../../../src/web/interact/Interact';
import * as region from '../../../src/web/interact/region';
import { parseHash } from '../../../src/web/lib/route';
import { buildView, type View } from '../../../src/web/lib/view';
import { dispatchAdjust } from '../../../src/web/overlay/regionAdjust';
import { useUi } from '../../../src/web/store/ui';
import { installPointerCapture, meta, renderWithClient, resetAll, topicState } from '../helpers';

vi.mock('../../../src/web/interact/region', async (orig) => ({
  ...(await orig<typeof region>()),
  finishRegion: vi.fn(),
}));

const ui = () => useUi.getState();
const rects = new Map<Element, DOMRect>();
const place = (el: Element, l: number, t: number, w: number, h: number): void => {
  rects.set(el, new DOMRect(l, t, w, h));
};
const q = <T extends Element>(sel: string): T => {
  const e = document.querySelector<T>(sel);
  if (!e) throw new Error(sel);
  return e;
};

function viewOf(versions: number, shown?: number): View {
  const t = topicState({ meta: meta({ pages: { root: { title: 'T', parent: null, versions, createdAt: '' } } }) });
  queryClient.setQueryData(topicKey('demo'), t);
  const v = buildView(parseHash(`#/demo/root${shown ? `/v${shown}` : ''}`), t);
  if (!v) throw new Error('view');
  location.hash = `#/demo/root${shown ? `/v${shown}` : ''}`;
  return v;
}

function Harness({ view }: { view: View | null }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <>
      <div id="docscroll" ref={ref}>
        <article id="article">
          <p id="p1">最初の段落の文</p>
          <p id="p2">二つ目の段落</p>
        </article>
      </div>
      <Interact view={view} scrollRef={ref as RefObject<HTMLElement | null>} />
    </>
  );
}

beforeEach(() => {
  resetAll();
  rects.clear();
  installPointerCapture();
  vi.mocked(region.finishRegion).mockClear();
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return rects.get(this) ?? new DOMRect(0, 0, 0, 0);
  });
  // jsdom にない API
  Range.prototype.getBoundingClientRect = () => new DOMRect(200, 300, 120, 18);
  document.elementFromPoint = vi.fn(() => null);
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const wrap = (view: View | null) => (
  <QueryClientProvider client={queryClient}>
    <Harness view={view} />
  </QueryClientProvider>
);

function mountDoc(view: View | null) {
  const r = renderWithClient(<Harness view={view} />);
  markBlocks(q('#article'));
  place(q('#docscroll'), 0, 50, 900, 600);
  place(q('#article'), 100, 80, 600, 400);
  place(q('#p1'), 100, 100, 600, 40);
  place(q('#p2'), 100, 160, 600, 40);
  return r;
}

test('殻の ID・hidden：#actbar（#act-comment）・#regbtn・#regsel（#docscroll の中）', () => {
  mountDoc(viewOf(1));
  expect(q('#actbar').hasAttribute('hidden')).toBe(true);
  expect(q('#act-comment').textContent).toBe('コメント');
  expect(q('#regbtn .lbl').textContent).toBe('範囲を選ぶ');
  expect(q('#regsel').hasAttribute('hidden')).toBe(true);
  expect(q('#docscroll').contains(q('#regsel'))).toBe(true);
});

test('「範囲を選ぶ」：最新版を開いているときだけ出る', () => {
  const { rerender } = mountDoc(null);
  expect(q('#regbtn').hasAttribute('hidden')).toBe(true);
  rerender(wrap(viewOf(2, 1)));
  expect(q('#regbtn').hasAttribute('hidden')).toBe(true);
  rerender(wrap(viewOf(2)));
  expect(q('#regbtn').hasAttribute('hidden')).toBe(false);
});

test('「範囲を選ぶ」を押す：選ぶ状態・枠が本文に重なる・ボタンは「やめる」。もう一度押すと、戻る', () => {
  mountDoc(viewOf(1));
  fireEvent.click(q('#regbtn'));
  expect(ui().regMode).toBe('selecting');
  expect(q('#regbtn').classList.contains('on')).toBe(true);
  expect(q('#regbtn .lbl').textContent).toBe('やめる');
  expect(q('#regsel').hasAttribute('hidden')).toBe(false);
  expect(q('#regsel .hint').textContent).toContain('ドラッグして、範囲を選びます');
  expect(q<HTMLElement>('#regsel').style.left).toBe('100px'); // 本文の箱（100）− 本文の領域（0）
  expect(q<HTMLElement>('#regsel').style.top).toBe('30px');
  fireEvent.click(q('#regbtn'));
  expect(ui().regMode).toBe('idle');
  expect(q('#regbtn .lbl').textContent).toBe('範囲を選ぶ');
  expect(q('#regsel').hasAttribute('hidden')).toBe(true);
});

test('本文のブロックがないとき、選ぶ状態にならない', () => {
  mountDoc(viewOf(1));
  q('#article').replaceChildren();
  fireEvent.click(q('#regbtn'));
  expect(ui().regMode).toBe('idle');
  expect(ui().toast?.msg).toBe('範囲を選べる本文がありません');
});

function drag(from: [number, number], to: [number, number]): void {
  place(q('#regsel'), 100, 80, 600, 400);
  const el = q('#regsel');
  fireEvent.pointerDown(el, { clientX: from[0], clientY: from[1], button: 0, pointerId: 1 });
  fireEvent.pointerMove(el, { clientX: to[0], clientY: to[1], pointerId: 1 });
  fireEvent.pointerUp(el, { clientX: to[0], clientY: to[1], pointerId: 1 });
}

test('ドラッグで範囲を選ぶ：ビューポートの矩形で finishRegion。選ぶ状態は終わる', () => {
  mountDoc(viewOf(1));
  fireEvent.click(q('#regbtn'));
  drag([150, 120], [400, 220]);
  expect(region.finishRegion).toHaveBeenCalledTimes(1);
  expect(vi.mocked(region.finishRegion).mock.calls[0]?.[0]).toEqual({ left: 150, top: 120, width: 250, height: 100 });
  expect(ui().regMode).toBe('idle');
});

test('向きによらない（右下から左上へ）。枠の外へは、はみ出さない', () => {
  mountDoc(viewOf(1));
  fireEvent.click(q('#regbtn'));
  drag([400, 220], [10, 10]);
  expect(vi.mocked(region.finishRegion).mock.calls[0]?.[0]).toEqual({ left: 100, top: 80, width: 300, height: 140 });
});

test('8px 未満の範囲は、断る（トースト）。finishRegion は呼ばない', () => {
  mountDoc(viewOf(1));
  fireEvent.click(q('#regbtn'));
  drag([150, 120], [155, 220]);
  expect(region.finishRegion).not.toHaveBeenCalled();
  expect(ui().toast?.msg).toBe('範囲が小さすぎます。ドラッグで、範囲を選んでください');
  expect(ui().regMode).toBe('idle');
});

test('枠の外を押す・窓の大きさが変わる・Esc：やめる', () => {
  mountDoc(viewOf(1));
  fireEvent.click(q('#regbtn'));
  fireEvent.pointerDown(q('#p1'));
  expect(ui().regMode).toBe('idle');
  fireEvent.click(q('#regbtn'));
  act(() => {
    window.dispatchEvent(new Event('resize'));
  });
  expect(ui().regMode).toBe('idle');
  fireEvent.click(q('#regbtn'));
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(ui().regMode).toBe('idle');
  // 枠の中を押しても、やめない
  fireEvent.click(q('#regbtn'));
  fireEvent.pointerDown(q('#regsel'), { button: 0, clientX: 150, clientY: 120, pointerId: 1 });
  expect(ui().regMode).toBe('selecting');
});

test('Esc の順：範囲選択 → ドラッグ中（W1 に任せる）→ ライトボックス', () => {
  mountDoc(viewOf(1));
  ui().openLightbox('/asset/x.png');
  ui().setRegMode('selecting');
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(ui().regMode).toBe('idle');
  expect(ui().lightbox).toMatchObject({ kind: 'img', src: '/asset/x.png' }); // 同じ Esc で、ライトボックスまでは、閉じない
  ui().setRegDrag(true);
  expect(handleEscape()).toBe(true);
  expect(ui().lightbox).toMatchObject({ kind: 'img', src: '/asset/x.png' });
  ui().setRegDrag(false);
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(ui().lightbox).toBeNull();
  expect(handleEscape()).toBe(false);
});

test('枠の調整（F31）：W1 の adjust イベントで finishRegion（調整後の矩形）', () => {
  mountDoc(viewOf(1));
  dispatchAdjust({ left: 120, top: 100, width: 200, height: 60 });
  expect(vi.mocked(region.finishRegion).mock.calls[0]?.[0]).toEqual({ left: 120, top: 100, width: 200, height: 60 });
});

test('枠の調整：アンマウントのあとは、購読しない', () => {
  const r = mountDoc(viewOf(1));
  r.unmount();
  dispatchAdjust({ left: 1, top: 1, width: 9, height: 9 });
  expect(region.finishRegion).not.toHaveBeenCalled();
});

// ---- 入口のバー ----
function selectText(): void {
  const t = q('#p1').firstChild;
  if (!t) throw new Error();
  const r = document.createRange();
  r.setStart(t, 0);
  r.setEnd(t, 5);
  getSelection()?.removeAllRanges();
  getSelection()?.addRange(r);
}
const bar = () => q<HTMLElement>('#actbar');

test('文を選ぶ：選んだ文の上に、バーが出る。「コメント」で、入力欄が開き、バーは消え、選択も外れる', async () => {
  vi.useFakeTimers();
  mountDoc(viewOf(1));
  selectText();
  fireEvent.mouseUp(q('#p1'));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5);
  });
  expect(bar().hasAttribute('hidden')).toBe(false);
  // 右端は、文の右 + 24（320 + 24 = 344）・上端は、文の上 − 38（300 − 38 = 262）。幅 0（jsdom）なので、左は 344
  expect(bar().style.left).toBe('344px');
  expect(bar().style.top).toBe('262px');
  fireEvent.click(q('#act-comment'));
  expect(ui().composer?.anchor).toMatchObject({ quote: '最初の段落', blockId: 'b0' });
  expect(bar().hasAttribute('hidden')).toBe(true);
  expect(getSelection()?.isCollapsed).toBe(true);
});

test('選択を外す・本文の外を押すと、バーは消える。最新版でないときは、出ない', async () => {
  vi.useFakeTimers();
  const r = mountDoc(viewOf(1));
  selectText();
  fireEvent.mouseUp(q('#p1'));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5);
  });
  expect(bar().hasAttribute('hidden')).toBe(false);
  fireEvent.mouseDown(document.body);
  expect(bar().hasAttribute('hidden')).toBe(true);

  r.rerender(wrap(viewOf(2, 1)));
  selectText();
  fireEvent.mouseUp(q('#p1'));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5);
  });
  expect(bar().hasAttribute('hidden')).toBe(true);
});

test('バーは、押しても、文の選択を外さない（mousedown を止める）', () => {
  mountDoc(viewOf(1));
  const e = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
  q('#act-comment').dispatchEvent(e);
  expect(e.defaultPrevented).toBe(true);
});

/** ポインターの下にあるブロックを決めて、本文の領域の上で動かす */
function hover(target: Element | null, x: number, y: number): void {
  vi.mocked(document.elementFromPoint).mockReturnValue(target);
  fireEvent.mouseMove(q('#docscroll'), { clientX: x, clientY: y });
}

test('ブロックにマウスを置く：そのブロックの右上（上端の 30px 上・本文の右端 − 8）にバー。帯を出てから 350ms で消える', async () => {
  vi.useFakeTimers();
  mountDoc(viewOf(1));
  hover(q('#p2'), 300, 180);
  expect(bar().hasAttribute('hidden')).toBe(false);
  expect(bar().style.left).toBe('692px');
  expect(bar().style.top).toBe('130px'); // 160 − 30
  hover(null, 300, 400); // ブロックのない所
  await act(async () => {
    await vi.advanceTimersByTimeAsync(349);
  });
  expect(bar().hasAttribute('hidden')).toBe(false);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2);
  });
  expect(bar().hasAttribute('hidden')).toBe(true);
});

test('帯の中では、ブロックを探さない（同じブロックのまま）・バーの上でも消えない・別のブロックへは、移れる', async () => {
  vi.useFakeTimers();
  mountDoc(viewOf(1));
  hover(q('#p2'), 300, 180);
  // 帯（p2 の上下 4px）の中：下にあるのが別のブロックでも、p2 のまま
  hover(q('#p1'), 300, 158);
  expect(bar().style.top).toBe('130px');
  // 帯の外：p1 に移る
  hover(q('#p1'), 300, 120);
  expect(bar().style.top).toBe('70px'); // 100 − 30
  // バーへ向かう（ブロックのない所を通る）間に、バーの上に着く：消えない
  place(bar(), 620, 70, 80, 24);
  hover(null, 650, 66);
  fireEvent.mouseEnter(bar());
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(bar().hasAttribute('hidden')).toBe(false);
  fireEvent.mouseLeave(bar());
  await act(async () => {
    await vi.advanceTimersByTimeAsync(351);
  });
  expect(bar().hasAttribute('hidden')).toBe(true);
});

test('バーへ向かって、本文の領域を出るときは、タイマーを始めない（バーに着く前に、消えない）', async () => {
  vi.useFakeTimers();
  mountDoc(viewOf(1));
  hover(q('#p2'), 300, 180);
  // 実際のブラウザの順：mouseout（React の onMouseEnter が、タイマーを止める）→ mouseleave（旧の順と逆。ここで、タイマーを始めてはいけない）
  fireEvent.mouseOut(q('#docscroll'), { relatedTarget: q('#act-comment') });
  q('#docscroll').dispatchEvent(new MouseEvent('mouseleave', { relatedTarget: q('#act-comment') }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(bar().hasAttribute('hidden')).toBe(false);
  fireEvent.mouseLeave(q('#docscroll'), { relatedTarget: document.body }); // 外へ出たときは、消える
  await act(async () => {
    await vi.advanceTimersByTimeAsync(351);
  });
  expect(bar().hasAttribute('hidden')).toBe(true);
});

test('入力欄を開いている間・範囲を選んでいる間は、ブロックのバーを出さない', () => {
  mountDoc(viewOf(1));
  ui().startComposer({
    blockId: 'b0',
    blockHash: '',
    blockTag: '',
    blockText: '',
    quote: 'x',
    prefix: '',
    suffix: '',
    label: '',
  });
  hover(q('#p2'), 300, 180);
  expect(bar().hasAttribute('hidden')).toBe(true);
  ui().closeComposer();
  ui().setRegMode('selecting');
  hover(q('#p2'), 300, 180);
  expect(bar().hasAttribute('hidden')).toBe(true);
});

test('ブロックのバーで「コメント」：そのブロックへのコメント', () => {
  mountDoc(viewOf(1));
  hover(q('#p2'), 300, 180);
  fireEvent.click(screen.getByRole('button', { name: 'コメント' }));
  expect(ui().composer?.anchor).toMatchObject({ blockId: 'b1', quote: '', label: '二つ目の段落' });
});

test('スクロールすると、ブロックのバーは消える。左の一覧の開閉でも、消える', () => {
  mountDoc(viewOf(1));
  hover(q('#p2'), 300, 180);
  fireEvent.scroll(q('#docscroll'));
  expect(bar().hasAttribute('hidden')).toBe(true);
  hover(q('#p2'), 300, 180);
  expect(bar().hasAttribute('hidden')).toBe(false);
  act(() => ui().toggleSide());
  expect(bar().hasAttribute('hidden')).toBe(true);
});

// ---- F37：入口のバーの「拡大」（画像・図を含むブロックだけ。コメントの付いた画像・図も、ここから拡大できる） ----
function addBlocks(): void {
  const art = q('#article');
  art.insertAdjacentHTML(
    'beforeend',
    [
      '<p id="im"><img alt="図" src="/asset/demo/a.png"></p>',
      '<div id="mm" class="mermaid-block"><svg viewBox="0 0 100 50"><rect width="5" height="5"/></svg></div>',
      '<svg id="inl" viewBox="0 0 10 10"><rect width="5" height="5"/></svg>',
      '<pre id="cd">const a = 1;</pre>',
      '<table id="tb"><tbody><tr><td>表</td></tr></tbody></table>',
      '<p id="bl"><span class="img-blocked">[外部画像は表示しません]</span></p>',
      '<div id="ha" class="htmlapp"><iframe></iframe></div>',
    ].join(''),
  );
  markBlocks(art);
  ['im', 'mm', 'inl', 'cd', 'tb', 'bl', 'ha'].forEach((id, i) => {
    place(q(`#${id}`), 100, 220 + i * 60, 600, 40);
  });
}

test('「拡大」：画像・Mermaid の図・インラインの svg を含むブロックの入口のバーだけに出る（「コメント」の左）。コード・表・外部画像・html-app・文では、出ない', () => {
  mountDoc(viewOf(1));
  addBlocks();
  for (const id of ['im', 'mm', 'inl']) {
    hover(q(`#${id}`), 300, 230 + ['im', 'mm', 'inl'].indexOf(id) * 60);
    const z = document.getElementById('act-zoom');
    expect(z, id).not.toBeNull();
    expect(z?.textContent).toBe('拡大');
    expect(z?.getAttribute('aria-label')).toBe('拡大');
    expect(z?.title).toBeTruthy();
    // 「コメント」が、バーの右端（バーの右端の位置は、これまでどおり）
    expect(z?.nextElementSibling).toBe(q('#act-comment'));
  }
  for (const id of ['cd', 'tb', 'bl', 'ha', 'p2']) {
    hover(q(`#${id}`), 300, id === 'p2' ? 180 : 230 + 180 + ['cd', 'tb', 'bl', 'ha'].indexOf(id) * 60);
    expect(bar().hasAttribute('hidden'), id).toBe(false); // コメントのバーは、出る
    expect(document.getElementById('act-zoom'), id).toBeNull();
    expect(q('#act-comment')).toBeTruthy();
  }
});

test('「拡大」を押す：そのブロックの画像（図）を、ライトボックスで開く。バーは消え、コメントの入力欄は、開かない', () => {
  mountDoc(viewOf(1));
  addBlocks();
  hover(q('#im'), 300, 230);
  fireEvent.click(q('#act-zoom'));
  expect(ui().lightbox).toMatchObject({ kind: 'img', zoom: true });
  expect(ui().composer).toBeNull();
  expect(bar().hasAttribute('hidden')).toBe(true);
  ui().closeLightbox();
  hover(q('#mm'), 300, 290);
  fireEvent.click(q('#act-zoom'));
  expect(ui().lightbox).toMatchObject({ kind: 'svg' });
  expect(ui().composer).toBeNull();
});

test('画像のブロックでも、「コメント」は、これまでどおり：入力欄が開く（拡大しない）', () => {
  mountDoc(viewOf(1));
  addBlocks();
  hover(q('#im'), 300, 230);
  fireEvent.click(q('#act-comment'));
  expect(ui().composer?.anchor).toMatchObject({ blockId: expect.any(String) });
  expect(ui().lightbox).toBeNull();
});

test('文を選んだときのバー（sel）には、「拡大」は、出ない', async () => {
  vi.useFakeTimers();
  mountDoc(viewOf(1));
  addBlocks();
  selectText();
  fireEvent.mouseUp(q('#p1'));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5);
  });
  expect(bar().hasAttribute('hidden')).toBe(false);
  expect(document.getElementById('act-zoom')).toBeNull();
});
