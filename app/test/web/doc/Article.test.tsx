// @vitest-environment jsdom
// 本文（命令的な島）：描き直す条件（docSig）・非同期の継ぎ目（renderTok）・DocModel・入力中の強調・選択・scrollTop。
import { act, render, screen } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import type { Anchor, Thread } from '../../../src/shared/types';
import { topicKey } from '../../../src/web/api/queries';
import { queryClient } from '../../../src/web/api/queryClient';
import { Article } from '../../../src/web/doc/Article';
import { buildView } from '../../../src/web/lib/view';
import { useDoc } from '../../../src/web/store/doc';
import { useUi } from '../../../src/web/store/ui';
import { meta, resetAll, thread, topicState } from '../helpers';

// Mermaid は、図ごとに、解決のしかたを、テストが決める
const mermaidRender = vi.fn<(id: string, code: string) => Promise<{ svg: string }>>();
// initialize の引数は、呼ばれた時に控える（vitest は、テストごとに、呼び出しの記録を消すので）
const initArgs = vi.hoisted(() => [] as unknown[]);
vi.mock('mermaid', () => ({
  default: {
    initialize: (config: unknown) => initArgs.push(config),
    render: (id: string, code: string) => mermaidRender(id, code),
  },
}));

beforeEach(() => {
  resetAll();
  mermaidRender.mockReset();
  mermaidRender.mockImplementation(async (_id, code) => ({ svg: `<svg data-code="${code.length}"></svg>` }));
});

const MD = '# 題\n\n最初の段落です。\n\n二つ目の段落で、ここを選びます。\n';
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

function viewOf(threads: Thread[], versions = 1, version = versions) {
  const topic = topicState({
    threads,
    meta: meta({ pages: { root: { title: 'T', parent: null, versions, createdAt: '' } } }),
  });
  const v = buildView({ slug: 'demo', page: 'root', version }, topic);
  if (!v) throw new Error('view');
  return v;
}

/** 本文を、スクロールの領域の中に出す */
function mount(threads: Thread[], md = MD, prev: string | null = null, versions = 1) {
  const view = viewOf(threads, versions);
  const r = render(
    <div id="docscroll">
      <Article view={view} markdown={md} prevMarkdown={prev} />
    </div>,
  );
  const again = (t: Thread[], m = md, p = prev, v = versions) =>
    r.rerender(
      <div id="docscroll">
        <Article view={viewOf(t, v)} markdown={m} prevMarkdown={p} />
      </div>,
    );
  return { ...r, again, art: () => document.getElementById('article') as HTMLElement };
}
const settle = () => act(async () => {});

test('描く：#article.md の中に、ブロックの番号つきの本文。DocModel（key・blocks・locs・nums）を useDoc に入れる。アンマウントで null', async () => {
  const { art, unmount } = mount([on('t1', 'ここを選びます')]);
  await settle();
  expect(art().className).toBe('md');
  expect([...art().querySelectorAll('[data-bid]')].map((e) => e.getAttribute('data-bid'))).toEqual(['b0', 'b1', 'b2']);
  const m = useDoc.getState().model;
  expect(m?.key).toBe('demo/root/1');
  expect(m?.blocks.map((b) => b.tag)).toEqual(['h1', 'p', 'p']);
  expect(m?.locs.get('t1')?.kind).toBe('text');
  expect(m?.nums.get('t1')).toBe(1);
  expect(m?.diff).toBeNull();
  expect(art().querySelector('mark.hl[data-tid="t1"]')?.textContent).toBe('ここを選びます');
  unmount();
  expect(useDoc.getState().model).toBeNull();
});

test('描き直す条件：ポーリングで view が作り直されても（スレッドが同じなら）、描き直さない。解決・版・位置づけが変わったら、描き直す', async () => {
  const t1 = on('t1', 'ここを選びます');
  const { art, again } = mount([t1]);
  await settle();
  const p = art().querySelector('p');
  const epoch = useDoc.getState().model?.epoch;
  again([{ ...t1, messages: [...t1.messages] }]); // 中身が同じ（メッセージだけ新しい配列）
  await settle();
  expect(art().querySelector('p')).toBe(p);
  expect(useDoc.getState().model?.epoch).toBe(epoch);
  again([{ ...t1, resolved: true }]);
  await settle();
  expect(art().querySelector('p')).not.toBe(p);
  expect(art().querySelector('mark.hl.resolved[data-tid="t1"]')).not.toBeNull();
  expect(useDoc.getState().model?.epoch).toBeGreaterThan(epoch ?? 0);
  // 別のページのスレッドは、数えない
  const e2 = useDoc.getState().model?.epoch;
  again([{ ...t1, resolved: true }, thread({ id: 'other', page: 'p2', anchor: anchor('x') })]);
  await settle();
  expect(useDoc.getState().model?.epoch).toBe(e2);
});

test('差分：v2 以降で showChanges のとき、箱と件数（DocModel.diff）。切り替えると、描き直す', async () => {
  const { art } = mount([], '# 題\n\n新しい段落。\n', '# 題\n', 2);
  await settle();
  expect(useDoc.getState().model?.diff).toEqual({ changed: 0, added: 1, removed: 0 });
  expect(art().querySelector('.blk.changed.added')).not.toBeNull();
  act(() => useUi.getState().setShowChanges(false));
  await settle();
  expect(useDoc.getState().model?.diff).toBeNull();
  expect(art().querySelector('.changed')).toBeNull();
});

test('入力中の対象：mark.hl.pending で強調し、DocModel.pending に入れる（epoch が進む）。閉じると外す。画像を付けるだけでは、触らない', async () => {
  const { art } = mount([]);
  await settle();
  const e0 = useDoc.getState().model?.epoch ?? 0;
  act(() => useUi.setState({ composer: { id: 1, anchor: anchor('ここを選びます') } }));
  const m1 = useDoc.getState().model;
  expect(m1?.pending?.matches('mark.hl.pending')).toBe(true);
  expect(m1?.pending?.textContent).toBe('ここを選びます');
  expect(m1?.epoch).toBeGreaterThan(e0);
  act(() => useUi.getState().setComposerRegionImg(1, 'shot.png'));
  expect(useDoc.getState().model).toBe(m1);
  act(() => useUi.setState({ composer: null }));
  expect(useDoc.getState().model?.pending).toBeNull();
  expect(art().querySelector('mark.pending')).toBeNull();
  expect(art().querySelector('p')?.textContent).toBe('最初の段落です。');
});

test('入力欄を開いたまま描き直しても、入力中の強調は、描き直した本文に付く', async () => {
  const { art, again } = mount([]);
  await settle();
  act(() => useUi.setState({ composer: { id: 1, anchor: anchor('ここを選びます') } }));
  again([on('t9', '最初の段落')]);
  await settle();
  expect(art().querySelector('mark.pending')?.textContent).toBe('ここを選びます');
  expect(useDoc.getState().model?.pending).toBe(art().querySelector('mark.pending'));
});

test('選んでいるスレッド：.hl.active。描き直しても、付いたまま。外すと消える', async () => {
  const t1 = on('t1', 'ここを選びます');
  const { art, again } = mount([t1]);
  await settle();
  act(() => useUi.getState().setActive('t1'));
  expect(art().querySelector('mark.hl.active[data-tid="t1"]')).not.toBeNull();
  again([{ ...t1, resolved: true }]);
  await settle();
  expect(art().querySelector('mark.hl.active[data-tid="t1"]')).not.toBeNull();
  act(() => useUi.getState().setActive(null));
  expect(art().querySelector('.active')).toBeNull();
});

test('光っているもの（linkedTid）は、描き直しても、光ったまま', async () => {
  const t1 = on('t1', 'ここを選びます');
  const { art, again } = mount([t1]);
  await settle();
  act(() => useUi.getState().setLinked('t1'));
  again([{ ...t1, resolved: true }]);
  await settle();
  expect(art().querySelector('mark.hl[data-tid="t1"]')?.classList.contains('linked')).toBe(true);
});

test('非同期の継ぎ目：Mermaid を待つあいだに、別の描画が始まったら、古い描画は、強調も DocModel も、適用しない', async () => {
  let release: (v: { svg: string }) => void = () => {};
  mermaidRender.mockImplementationOnce(() => new Promise((res) => (release = res)));
  const t1 = on('t1', '二つ目');
  const { art, again } = mount([t1], '```mermaid\ngraph TD\nA-->B\n```\n\n二つ目の段落。\n');
  await settle();
  expect(useDoc.getState().model).toBeNull(); // まだ、描き終えていない
  again([t1], '二つ目の段落だけ。\n');
  await settle();
  const m = useDoc.getState().model;
  expect(m?.blocks.map((b) => b.tag)).toEqual(['p']);
  await act(async () => release({ svg: '<svg></svg>' }));
  expect(useDoc.getState().model).toBe(m);
  expect(art().querySelectorAll('mark.hl')).toHaveLength(1);
  expect(art().querySelector('.mermaid-block')).toBeNull();
});

test('Mermaid：描けた図は svg に・描けなかった図は、エラーの表示とソース。どちらも、ブロック（図）のまま', async () => {
  mermaidRender.mockImplementation(async (_id, code) => {
    if (code.includes('BAD')) throw new Error('parse');
    return { svg: '<svg class="ok"></svg>' };
  });
  const { art } = mount([], '```mermaid\ngraph LR\nX-->Y\n```\n\n```mermaid\nBAD\n```\n');
  await settle();
  const blocks = art().querySelectorAll('.mermaid-block');
  expect(blocks[0]?.querySelector('svg.ok')).not.toBeNull();
  expect(blocks[1]?.classList.contains('mermaid-error')).toBe(true);
  expect(blocks[1]?.querySelector('.mm-err')?.textContent).toBe('図を描画できませんでした');
  expect(blocks[1]?.querySelector('pre')?.textContent).toBe('BAD');
  // 図の描画は、strict（図の中の HTML・スクリプトを、動かさない）
  expect(initArgs).toEqual([expect.objectContaining({ securityLevel: 'strict', startOnLoad: false })]);
  expect(useDoc.getState().model?.blocks).toHaveLength(2);
});

test('scrollTop は、描き直しの前後で保つ。範囲を選んでいる途中は、描き直すとき、範囲選択をやめる', async () => {
  const t1 = on('t1', 'ここを選びます');
  const { again } = mount([t1]);
  await settle();
  const scroller = document.getElementById('docscroll') as HTMLElement;
  let top = 240;
  Object.defineProperty(scroller, 'scrollTop', { get: () => top, set: (v: number) => (top = v), configurable: true });
  act(() => useUi.getState().setRegMode('selecting'));
  top = 240;
  again([{ ...t1, resolved: true }]);
  top = 0; // 描き直しで、中身が空になる間に、ブラウザが戻す
  await settle();
  expect(top).toBe(240);
  expect(useUi.getState().regMode).toBe('idle');
});

test('本文の強調を押す：選ぶ（active）・1 枚だけ見る状態（solo）を解く。範囲のコメントだけのブロックは、範囲の外では、選ばない', async () => {
  const t1 = on('t1', 'ここを選びます');
  const { art } = mount([t1]);
  await settle();
  act(() => useUi.getState().openSolo('t9'));
  act(() => art().querySelector<HTMLElement>('mark.hl')?.click());
  expect(useUi.getState().active).toBe('t1');
  expect(useUi.getState().solo).toBeNull();
  // ページ内のリンクは、選ばない
  act(() => useUi.getState().setActive(null));
  const a = document.createElement('a');
  a.dataset.page = 'x';
  art().querySelector('mark.hl')?.append(a);
  act(() => a.click());
  expect(useUi.getState().active).toBeNull();
});

test('「この枠にコメント」：その枠を対象に、入力欄を開く（最新版）', async () => {
  queryClient.setQueryData(
    topicKey('demo'),
    topicState({ meta: meta({ pages: { root: { title: 'T', parent: null, versions: 1, createdAt: '' } } }) }),
  );
  const { art } = mount([], '```html-app\n<b>x</b>\n```\n');
  await settle();
  expect(art().querySelector('iframe')?.getAttribute('sandbox')).toBe('allow-scripts');
  location.hash = '#/demo';
  act(() => screen.getByText('この枠にコメント').click());
  const c = useUi.getState().composer;
  expect(c?.anchor.blockTag).toBe('DIV');
  expect(c?.anchor.label).toBe('実行できる枠');
  expect(c?.anchor.quote).toBe('');
  expect(useDoc.getState().model?.pending).toBe(art().querySelector('.htmlapp'));
  expect(art().querySelector('.htmlapp')?.classList.contains('blk-pending')).toBe(true);
});

test('位置が見つからないスレッド（引用なし・anchor なし・新しい版のもの）も、DocModel.locs に { kind: "none" } で入る。別のページのスレッドは、入らない', async () => {
  mount([
    on('ok', 'ここを選びます'),
    on('lost', '修正で消えた文'),
    thread({ id: 'free', anchor: null }),
    on('future', 'ここを選びます', { version: 5 }),
    thread({ id: 'other', page: 'p2', anchor: anchor('x') }),
  ]);
  await settle();
  const m = useDoc.getState().model;
  expect([...(m?.locs.keys() ?? [])].sort()).toEqual(['free', 'future', 'lost', 'ok']);
  for (const id of ['lost', 'free', 'future']) expect(m?.locs.get(id)).toEqual({ kind: 'none' });
  expect(m?.locs.get('ok')?.kind).toBe('text');
  expect([...(m?.nums.keys() ?? [])]).toEqual(['ok']);
});
