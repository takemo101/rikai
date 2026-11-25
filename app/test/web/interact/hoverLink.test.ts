// @vitest-environment jsdom
import { fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { applyLinked, installHoverLink, linkedTargets } from '../../../src/web/interact/hoverLink';
import { type DocModel, nextEpoch, type ThreadLoc, useDoc } from '../../../src/web/store/doc';
import { useUi } from '../../../src/web/store/ui';
import { resetAll } from '../helpers';

let off: () => void = () => {};
const ui = () => useUi.getState();
const $1 = <T extends Element>(sel: string): T => {
  const e = document.querySelector<T>(sel);
  if (!e) throw new Error(sel);
  return e;
};
const linked = (): string[] => [...document.querySelectorAll('.linked')].map((e) => e.id || e.className);

function model(locs: [string, ThreadLoc][]): DocModel {
  return {
    epoch: nextEpoch(),
    key: 'demo/root/1',
    blocks: [],
    locs: new Map(locs),
    nums: new Map(),
    approx: new Map(),
    pending: null,
    diff: null,
  };
}

beforeEach(() => {
  resetAll();
  Element.prototype.scrollIntoView = vi.fn();
  document.body.innerHTML = `
    <div id="docscroll">
      <article id="article">
        <p id="p1">本文 <mark class="hl" id="m1" data-tid="t1">文の印</mark></p>
        <p id="p2" class="blk blk-thread" data-tid="t3">ブロック</p>
        <img id="img" class="blk blk-thread" data-tid="t2" alt="">
      </article>
      <div id="badges"><span class="bno" id="n1" data-tid="t1">1</span><span class="bno" id="n2" data-tid="t2">2</span></div>
    </div>
    <aside id="threads"><div class="thread" id="c1" data-tid="t1"><button id="b1">x</button></div><div class="thread" id="c2" data-tid="t2"></div></aside>`;
  off = installHoverLink();
});
afterEach(() => {
  off();
  document.body.replaceChildren();
});

test('linkedTargets：data-tid が同じ要素（印・番号・カード）と、位置の要素。1 つのブロックに複数のコメントがあっても、位置から取る', () => {
  const m1 = $1<HTMLElement>('#m1');
  const p2 = $1<HTMLElement>('#p2');
  const locs = new Map<string, ThreadLoc>([
    ['t1', { kind: 'text', marks: [m1] }],
    ['t9', { kind: 'block', el: p2 }], // p2 の data-tid は、最後の 1 つ（t3）。t9 は、位置から
  ]);
  const ids = (tid: string) => linkedTargets(document, tid, locs).map((e) => e.id);
  expect(ids('t1').sort()).toEqual(['c1', 'm1', 'n1']);
  expect(ids('t9')).toEqual(['p2']);
});

test('applyLinked：指定のものだけを光らせ、前のものは外す。null で全部外す', () => {
  applyLinked(document, 't1', null);
  expect(linked().sort()).toEqual(['c1', 'm1', 'n1']);
  applyLinked(document, 't2', null);
  expect(linked().sort()).toEqual(['c2', 'img', 'n2']);
  applyLinked(document, null, null);
  expect(linked()).toEqual([]);
});

test('applyLinked：拡大表示の線（svg.fv-links）は、触らない（クラスは、React が持つ。外すと、描き直しで戻らない）', () => {
  document.body.insertAdjacentHTML(
    'beforeend',
    '<svg class="fv-links"><g class="cn-g linked" id="fg" data-tid="t7"></g></svg>',
  );
  applyLinked(document, 't1', null);
  expect(document.getElementById('fg')?.classList.contains('linked')).toBe(true);
  applyLinked(document, null, null);
  expect(document.getElementById('fg')?.classList.contains('linked')).toBe(true);
  expect(linked()).toEqual(['fg']);
});

test('本文にマウスを置く：印・番号・カードが光り、カードを見える所へ。出ると消える（中の移動では消えない）', () => {
  fireEvent.mouseOver($1('#m1'));
  expect(ui().linkedTid).toBe('t1');
  expect(linked().sort()).toEqual(['c1', 'm1', 'n1']);
  expect($1<HTMLElement>('#c1').scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
  fireEvent.mouseOut($1('#m1'), { relatedTarget: $1('#p1') }); // 本文の中へ
  expect(ui().linkedTid).toBe('t1');
  fireEvent.mouseOut($1('#p1'), { relatedTarget: document.body }); // 本文の外へ
  expect(ui().linkedTid).toBeNull();
  expect(linked()).toEqual([]);
});

test('入力欄を開いている間は、カードを動かさない（光りは、付く）', () => {
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
  });
  fireEvent.mouseOver($1('#m1'));
  expect(ui().linkedTid).toBe('t1');
  expect($1<HTMLElement>('#c1').scrollIntoView).not.toHaveBeenCalled();
});

test('右のカードにマウスを置く：本文の印が光る。出ると消える', () => {
  useDoc.getState().setModel(model([['t1', { kind: 'text', marks: [$1('#m1')] }]]));
  fireEvent.mouseOver($1('#b1')); // カードの中の要素
  expect(ui().linkedTid).toBe('t1');
  expect($1('#m1').classList.contains('linked')).toBe(true);
  fireEvent.mouseOut($1('#b1'), { relatedTarget: $1('#c1') });
  expect(ui().linkedTid).toBe('t1');
  fireEvent.mouseOut($1('#c1'), { relatedTarget: document.body });
  expect(ui().linkedTid).toBeNull();
  expect($1('#m1').classList.contains('linked')).toBe(false);
});

test('本文が描き直された・層が置き直された：光っているものは、光ったまま', async () => {
  ui().setLinked('t1');
  expect(linked().sort()).toEqual(['c1', 'm1', 'n1']);
  // 層（番号）が、新しい要素に置き直された
  $1('#badges').replaceChildren();
  const n = document.createElement('span');
  n.className = 'bno';
  n.dataset.tid = 't1';
  n.id = 'n1b';
  $1('#badges').append(n);
  await vi.waitFor(() => expect(n.classList.contains('linked')).toBe(true));
  // 本文が描き直された（DocModel が、入れ替わる）
  const fresh = document.createElement('mark');
  fresh.id = 'm1b';
  fresh.dataset.tid = 't1';
  $1('#p1').replaceChildren(fresh);
  useDoc.getState().setModel(model([['t1', { kind: 'text', marks: [fresh] }]]));
  expect(fresh.classList.contains('linked')).toBe(true);
});

test('範囲のコメントだけのブロックは、範囲の外では、どのコメントにも当てない（最後の範囲に、飛ばない）', () => {
  const img = $1<HTMLElement>('#img');
  useDoc
    .getState()
    .setModel(model([['t2', { kind: 'region', el: img, frame: img, rect: { x: 0, y: 0, w: 0.5, h: 0.5 } }]]));
  fireEvent.mouseOver(img);
  expect(ui().linkedTid).toBeNull();
  // ブロックへのコメントがあれば、当てる
  useDoc.getState().setModel(
    model([
      ['t2', { kind: 'region', el: img, frame: img, rect: { x: 0, y: 0, w: 1, h: 1 } }],
      ['t3', { kind: 'block', el: img }],
    ]),
  );
  fireEvent.mouseOver(img);
  expect(ui().linkedTid).toBe('t2');
});

test('範囲の枠（#badges の .regionbox）の下にマウスがあるとき、その範囲のコメントを光らせる（同じ画像に複数の範囲があっても）', () => {
  const layer = $1('#badges');
  const small = document.createElement('div');
  small.className = 'regionbox';
  small.dataset.tid = 't1';
  const big = document.createElement('div');
  big.className = 'regionbox';
  big.dataset.tid = 't2';
  layer.append(big, small);
  vi.spyOn(big, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 200, 200));
  vi.spyOn(small, 'getBoundingClientRect').mockReturnValue(new DOMRect(50, 50, 20, 20));
  useDoc
    .getState()
    .setModel(model([['t2', { kind: 'region', el: $1('#img'), frame: $1('#img'), rect: { x: 0, y: 0, w: 1, h: 1 } }]]));
  fireEvent.mouseMove($1('#img'), { clientX: 60, clientY: 60 });
  expect(ui().linkedTid).toBe('t1'); // 重なるときは、小さい枠
  fireEvent.mouseMove($1('#img'), { clientX: 150, clientY: 150 });
  expect(ui().linkedTid).toBe('t2');
});

test('解除すると、イベントにも、store の変化にも、反応しない', () => {
  off();
  fireEvent.mouseOver($1('#m1'));
  expect(ui().linkedTid).toBeNull();
  ui().setLinked('t1');
  expect(linked()).toEqual([]);
  off = installHoverLink();
});
