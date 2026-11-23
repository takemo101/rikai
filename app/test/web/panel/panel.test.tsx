// @vitest-environment jsdom
// 右のパネルの表示：札・番号・切り替え・解決済みの 1 行・1 枚だけ見る・入力欄の位置・会話の折りたたみ・F30・フォーカスの復元
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, onTestFinished, test, vi } from 'vitest';
import { topicKey } from '../../../src/web/api/queries';
import { queryClient } from '../../../src/web/api/queryClient';
import { useDoc } from '../../../src/web/store/doc';
import { useUi } from '../../../src/web/store/ui';
import { meta, resetAll, topicState } from '../helpers';
import { ai, anchor, blocks, docModel, renderPanel, say, stubScroll, thread, user } from './fixtures';

beforeEach(() => {
  resetAll();
  stubScroll();
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

const q = (sel: string, root: ParentNode = document) => root.querySelector<HTMLElement>(sel);
const qa = (sel: string, root: ParentNode = document) => [...root.querySelectorAll<HTMLElement>(sel)];
const cardIds = () => qa('#threads .thread[data-tid]').map((c) => c.dataset.tid);

test('見出し「コメント」・スレッドがなければ、説明（切り替えは、なし）。空の aside と、#lightbox がある', () => {
  renderPanel([]);
  expect(q('#threads .panel-top .side-h.panel-h')?.textContent).toBe('コメント');
  expect(q('#threads .empty')?.textContent).toContain('本文の文を選ぶと「コメント」が出ます');
  expect(q('#threads .tabs')).toBeNull();
  expect(q('#lightbox')).toHaveAttribute('hidden');
});

test('view が null：空の aside だけ', async () => {
  const { ThreadsPanel } = await import('../../../src/web/panel/ThreadsPanel');
  const { render } = await import('@testing-library/react');
  const { QueryClientProvider } = await import('@tanstack/react-query');
  const { queryClient } = await import('../../../src/web/api/queryClient');
  render(
    <QueryClientProvider client={queryClient}>
      <ThreadsPanel view={null} />
    </QueryClientProvider>,
  );
  expect(q('#threads')?.children).toHaveLength(0);
});

test('カード：番号・札（未送信／AIの返信）・対象の引用。既定の「AIの確認待ち」は、札を出さない', () => {
  const t1 = thread({ id: 't1', anchor: anchor('一つ目の文'), messages: [user('質問です', { sent: false })] });
  const t2 = thread({
    id: 't2',
    anchor: anchor('二つ目の文'),
    messages: [user('質問', { sent: true }), ai('答えです')],
  });
  const t3 = thread({ id: 't3', anchor: anchor('三つ目の文'), messages: [user('質問', { sent: true })] });
  const [b1, b2] = blocks(2);
  useDoc.setState({
    model: docModel('demo/root/1', { t1: b1 ?? null, t2: b2 ?? null, t3: null }, { nums: { t1: 1, t2: 2 } }),
  });
  renderPanel([t1, t2, t3]);
  const c1 = q('.thread[data-tid="t1"]') as HTMLElement;
  const c2 = q('.thread[data-tid="t2"]') as HTMLElement;
  const c3 = q('.thread[data-tid="t3"]') as HTMLElement;
  expect(c1).toHaveClass('thread', 'draft');
  expect(q('.th-head .no', c1)?.textContent).toBe('1');
  expect(q('.th-head .chip', c1)?.textContent).toBe('未送信');
  expect(q('.th-head .quote', c1)?.textContent).toBe('一つ目の文');
  expect(c2).toHaveClass('new');
  expect(q('.th-head .chip.new', c2)?.textContent).toBe('AIの返信');
  expect(c3).toHaveClass('wait');
  expect(q('.th-head .chip.wait', c3)).toBeNull(); // 「AIの確認待ち」の札は、出さない
  expect(q('.th-head .no', c3)).toBeNull(); // 位置が見つからない：番号なし
  // 位置が「見つからない」と、本文が言っている（kind: none）：印を出す。まだ、本文が知らないスレッド（locs にない）は、出さない
  expect(q('.th-head .chip.warn', c3)?.textContent).toBe('修正で文が変わりました');
  expect(q('.th-head .chip.warn', c1)).toBeNull();
});

test('本文を、まだ描いていない（DocModel なし・別のページのもの）間は、「修正で文が変わりました」を出さない', () => {
  useDoc.setState({ model: docModel('demo/other/1', { t1: null }) }); // 別のページの古いモデル：使わない
  renderPanel([thread({ id: 't1', anchor: anchor('文') })]);
  expect(q('.thread .chip.warn')).toBeNull();
  expect(q('.thread .no')).toBeNull();
});

test('近似の表示（近い内容・同じ位置）・過去の版のスレッド（v 札）・後の版のコメント', () => {
  const [b1, b2] = blocks(2);
  useDoc.setState({
    model: docModel(
      'demo/root/2',
      { t1: b1 ?? null, t2: b2 ?? null, t3: null },
      { approx: { t1: 'similar', t2: 'position' } },
    ),
  });
  renderPanel(
    [
      thread({ id: 't1', version: 1, anchor: anchor('a'), messages: [user('a')] }),
      thread({ id: 't2', version: 2, anchor: anchor('b'), messages: [user('b')] }),
      thread({ id: 't3', version: 3, anchor: anchor('c'), messages: [user('c')] }),
    ],
    { versions: 3, version: 2 },
  );
  const chips = (tid: string) => qa(`.thread[data-tid="${tid}"] .th-head .chip`).map((c) => c.textContent);
  expect(chips('t1')).toEqual(['v1', '近い内容のブロックに表示']);
  expect(chips('t2')).toEqual(['同じ位置のブロックに表示']);
  expect(chips('t3')).toEqual(['v3', '後の版のコメント']);
});

test('AI 起点のスレッド（対象なし）は、引用が「AIからの質問」', () => {
  renderPanel([thread({ id: 't1', origin: 'ai', anchor: null, messages: [ai('こんにちは')] })]);
  expect(q('.thread .quote')?.textContent).toBe('AIからの質問');
});

test('別のページのスレッドは出ない', () => {
  renderPanel([thread({ id: 't1', page: 'root' }), thread({ id: 't2', page: 'sub' })]);
  expect(cardIds()).toEqual(['t1']);
});

// ---- F33：切り替え・解決済みの 1 行 ----
const mixed = () => [
  thread({ id: 't1', anchor: anchor('進行中の一'), messages: [user('いち')] }),
  thread({ id: 't2', anchor: anchor('進行中の二'), messages: [user('に')] }),
  thread({
    id: 't3',
    anchor: anchor('解決した文'),
    resolved: true,
    messages: [user('質問'), ai('これは、**答え**です\n\n```js\nx\n```')],
  }),
];

test('切り替え（進行中・解決済み・すべて）：数つき・既定は進行中・押すと、出るものが変わる', async () => {
  renderPanel(mixed());
  const tabs = qa('.tabs [role="tab"]');
  expect(tabs.map((t) => t.textContent)).toEqual(['進行中2', '解決済み1', 'すべて3']);
  expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false']);
  expect(cardIds()).toEqual(['t1', 't2']);
  expect(qa('.donerow')).toHaveLength(0);

  await userEvent.click(screen.getByRole('tab', { name: /解決済み/ }));
  expect(cardIds()).toEqual([]);
  expect(qa('.donerow').map((r) => r.dataset.tid)).toEqual(['t3']);
  expect(screen.getByRole('tab', { name: /解決済み/ })).toHaveClass('tab', 'on');

  await userEvent.click(screen.getByRole('tab', { name: /すべて/ }));
  expect(cardIds()).toEqual(['t1', 't2']);
  expect(qa('.donerow')).toHaveLength(1);
  expect(useUi.getState().tab).toBe('all');
});

test('空の切り替え：進行中が 0 のときの一言', () => {
  renderPanel([thread({ id: 't3', resolved: true })]);
  expect(q('#threads .empty')?.textContent).toBe('進行中のコメントは、ありません。');
});

test('空の切り替え：解決済みが 0 のとき、「解決済み」を押すと、一言', async () => {
  renderPanel([thread({ id: 't1' })]);
  await userEvent.click(screen.getByRole('tab', { name: /解決済み/ }));
  expect(q('#threads .empty')?.textContent).toBe('解決済みのコメントは、ありません。');
});

test('解決済みの 1 行：番号・対象・最後の発言（AI の Markdown は、記号・コードを外す）。押すと、カードが開く・「一覧の 1 行に戻す」で戻る', async () => {
  const [b] = blocks(1);
  useDoc.setState({ model: docModel('demo/root/1', { t3: b ?? null }, { nums: { t3: 7 } }) });
  renderPanel(mixed());
  await userEvent.click(screen.getByRole('tab', { name: /解決済み/ }));
  const row = q('.donerow') as HTMLElement;
  expect(row.tagName).toBe('BUTTON');
  expect(q('.no.resolved', row)?.textContent).toBe('7');
  expect(q('.dr-q', row)?.textContent).toBe('解決した文');
  expect(q('.dr-last', row)?.textContent).toBe('AI：これは、 答え です （コード・図）');

  await userEvent.click(row);
  expect(q('.donerow')).toBeNull();
  const open = q('.rowopen') as HTMLElement;
  expect(q('.thread[data-tid="t3"]', open)).toHaveClass('ok', 'active');
  expect(q('.th-head .no', open)).toHaveClass('no', 'resolved');
  expect(useUi.getState()).toMatchObject({ active: 't3' });
  expect(useUi.getState().rowOpen.has('t3')).toBe(true);
  expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', behavior: 'smooth' });
  // 解決済みのカードの下は、「再開する」（返信の入力はない）
  expect(q('.th-foot textarea', open)).toBeNull();
  await userEvent.click(within(open).getByRole('button', { name: '一覧の 1 行に戻す' }));
  expect(q('.rowopen')).toBeNull();
  expect(q('.donerow')).not.toBeNull();
});

test('本文から、解決済みを選ぶ（ストアの focusThread）と、「進行中」の切り替えなら「すべて」へ移って、開いて見せる', () => {
  const t3 = mixed()[2];
  if (!t3) throw new Error('fixture');
  renderPanel(mixed());
  expect(q('.rowopen')).toBeNull();
  act(() => useUi.getState().focusThread(t3));
  expect(useUi.getState().tab).toBe('all');
  expect(q('.rowopen .thread[data-tid="t3"]')).not.toBeNull();
});

test('カードの見出しを押す：選ぶ（active）・本文の対象を、画面の真ん中へ・AI の返信を、見たことにする（localStorage）', async () => {
  const [b] = blocks(1);
  const scroll = vi.fn();
  if (b) b.scrollIntoView = scroll;
  useDoc.setState({ model: docModel('demo/root/1', { t2: b ?? null }, { nums: { t2: 1 } }) });
  const reply = ai('返信');
  renderPanel([thread({ id: 't2', anchor: anchor('x'), messages: [user('q'), reply] })]);
  expect(q('.thread')).toHaveClass('fresh');
  expect(q('.msg.ai')).toHaveClass('fresh');
  await userEvent.click(q('.thread .th-head .quote') as HTMLElement);
  expect(useUi.getState().active).toBe('t2');
  expect(scroll).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' });
  expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled(); // 動かすのは、本文。カードは、動かさない
  expect(q('.thread')).toHaveClass('active');
  expect(q('.thread')).not.toHaveClass('fresh');
  expect(JSON.parse(localStorage.getItem('rikai-seen') ?? '[]')).toContain(reply.id);
  // 「いま読んでいる返信」は、すぐには、たたまれない・印も、描き直しまで、そのまま（旧と同じ）
  expect(q('.msg.ai')).toHaveClass('fresh');
});

test('本文から選ばれたとき（ストアの focusThread。番号・強調を押す）：カードを、パネルの見える所へ（nearest）', () => {
  const t = thread({ id: 't2', anchor: anchor('x'), messages: [user('q')] });
  renderPanel([thread({ id: 't1' }), t]);
  expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  act(() => useUi.getState().focusThread(t));
  expect(q('.thread[data-tid="t2"]')).toHaveClass('active');
  expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', behavior: 'smooth' });
});

test('選んでいるスレッドを、本文から、もう一度選んでも（同じ強調を、もう一度押す）、カードを、パネルの見える所へ戻す', () => {
  const t = thread({ id: 't2', anchor: anchor('x'), messages: [user('q')] });
  renderPanel([thread({ id: 't1' }), t]);
  act(() => useUi.getState().focusThread(t));
  vi.mocked(Element.prototype.scrollIntoView).mockClear();
  act(() => useUi.getState().focusThread(t));
  expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', behavior: 'smooth' });
});

test('光り：linkedTid のカードに .linked。選んだカードに .active', () => {
  renderPanel([thread({ id: 't1' }), thread({ id: 't2' })]);
  act(() => {
    useUi.getState().setLinked('t2');
    useUi.getState().setActive('t1');
  });
  expect(q('.thread[data-tid="t2"]')).toHaveClass('linked');
  expect(q('.thread[data-tid="t1"]')).toHaveClass('active');
  act(() => useUi.getState().setLinked(null));
  expect(q('.thread[data-tid="t2"]')).not.toHaveClass('linked');
});

// ---- F33：番号で 1 枚だけ見る ----
const longThread = () => {
  const ms = Array.from({ length: 8 }, (_, i) => (i % 2 === 0 ? user(`ユーザー ${i}`) : ai(`AI ${i}`)));
  useUi.setState({ seen: new Set(ms.map((m) => m.id)) }); // すべて既読
  return thread({ id: 't2', anchor: anchor('長い会話'), messages: ms });
};

test('solo：そのカードだけ・古いやり取りも、たたまない・番号の案内・「すべてのコメントに戻る」で戻る', async () => {
  const [b] = blocks(1);
  useDoc.setState({ model: docModel('demo/root/1', { t2: b ?? null }, { nums: { t2: 3 } }) });
  renderPanel([thread({ id: 't1' }), longThread()]);
  // 一覧では、たたまれる
  expect(q('.thread[data-tid="t2"] details.older summary')?.textContent).toBe('これまでのやり取り（6 件）');
  act(() => useUi.getState().openSolo('t2'));
  expect(cardIds()).toEqual(['t2']);
  expect(q('.thread[data-tid="t2"] details.older')).toBeNull();
  expect(qa('.thread[data-tid="t2"] .msg')).toHaveLength(8);
  expect(q('.panel-top .solobar .hint')?.textContent).toBe('3 番のコメントだけを表示中');
  expect(q('.panel-top .tabs')).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'すべてのコメントに戻る' }));
  expect(useUi.getState().solo).toBeNull();
  expect(cardIds()).toEqual(['t2', 't1']); // 本文に位置のあるもの（t2）が先
});

test('solo：番号がないときの案内。solo のスレッドが、このページにないときは、解く（別のページへ移った）', async () => {
  renderPanel([thread({ id: 't1' })]);
  act(() => useUi.getState().openSolo('t1'));
  expect(q('.solobar .hint')?.textContent).toBe('このコメントだけを表示中');
  act(() => useUi.getState().openSolo('gone'));
  await waitFor(() => expect(useUi.getState().solo).toBeNull());
  expect(cardIds()).toEqual(['t1']);
});

// ---- F29：会話の折りたたみ（旧の手作業の確認：7 往復＋答えていない質問・すべて既読） ----
test('F29：答えていない質問と、続く 10 件（すべて既読）：質問は、見えるまま残り、そのあとの 10 件が 1 つにたたまれる。押すと開き、画面の更新を挟んでも開いたまま', async () => {
  const first = user('最初の質問');
  const askMsg = ai('質問つきの返信', { ask: { type: 'yes_no', question: '進めますか？' } });
  // 質問のあと：AI の返信が続く（送信した利用者の発言は、ない：会話が進んだことにならない。あっても、未送信は数えない）
  const mid = Array.from({ length: 10 }, (_, i) => ai(`返信 ${i}`));
  const lastUser = user('最新のユーザー発言（未送信）', { sent: false });
  const lastAi = ai('最新の AI の返信');
  const ms = [first, askMsg, ...mid, lastUser, lastAi];
  useUi.setState({ seen: new Set(ms.map((m) => m.id)) });
  const t = thread({ id: 't1', anchor: anchor('長い会話'), messages: ms });
  const view = renderPanel([t]);

  const card = q('.thread[data-tid="t1"]') as HTMLElement;
  // 順：最初の質問・質問（答えていないので、たたまれない）・「これまでのやり取り（10 件）」・最新のユーザー・最新の AI
  const order = [...card.children]
    .filter((el) => el.matches('.msg, details.older'))
    .map((el) => (el.matches('details.older') ? `older:${el.querySelectorAll('.msg').length}` : el.className));
  expect(order).toEqual(['msg user', 'msg ai', 'older:10', 'msg user', 'msg ai']);
  expect(q('.msg.ai .ask', card)).not.toBeNull();
  const details = q('details.older', card) as HTMLDetailsElement;
  expect(details.open).toBe(false);
  expect(q('summary', details)?.textContent).toBe('これまでのやり取り（10 件）');

  await userEvent.click(q('summary', details) as HTMLElement);
  const key = `t1:${mid[0]?.id}`;
  await waitFor(() => expect(useUi.getState().olderOpen.has(key)).toBe(true));
  expect((q('details.older', card) as HTMLDetailsElement).open).toBe(true);

  // 画面の更新（ポーリングで、スレッドが、取り直される。新しい返信が足される）を挟んでも、開いたまま
  const next = { ...t, messages: [...t.messages, ai('新しい返信')] };
  act(() => {
    queryClient.setQueryData(topicKey('demo'), {
      ...topicState({ rev: 2, threads: [next] }),
      meta: meta({ pages: view.pages }),
    });
  });
  await waitFor(() => expect(qa('.thread[data-tid="t1"] > .msg')).toHaveLength(4));
  expect((q('.thread[data-tid="t1"] details.older') as HTMLDetailsElement).open).toBe(true);
});

test('F29：まだ見ていない返信は、すぐには、たたまれない（描き直し＝発言が変わったときに、取り直す）', () => {
  const ms = [ai('a1'), user('u1'), ai('a2'), user('u2'), ai('a3'), user('u3'), ai('a4'), user('u4')];
  useUi.setState({ seen: new Set(ms.filter((m) => m.author === 'user').map((m) => m.id)) });
  renderPanel([thread({ id: 't1', anchor: anchor('x'), messages: ms })]);
  // 最新の 4 件の中の、見ていない AI（a3・a4）は、たたまない：[a1 u1 a2 u2] がたたまれる
  expect(q('details.older summary')?.textContent).toBe('これまでのやり取り（4 件）');
  expect(qa('.thread > .msg').length).toBe(4);
  // 見たことになる（ストアの markSeen）：その場では、たたみ直さない（読んでいる最中の返信が、消えない）
  act(() => useUi.getState().markSeen(ms.map((m) => m.id)));
  expect(qa('.thread > .msg').length).toBe(4);
  expect(q('.thread')).not.toHaveClass('fresh');
});

test('F29：パネルが、描き直される（切り替え・1 枚だけ見る・データの更新）と、見たことが、折りたたみに反映される（旧と同じ）', () => {
  const ms = [ai('a1'), user('u1'), ai('a2'), user('u2'), ai('a3'), user('u3'), ai('a4'), user('u4')];
  useUi.setState({ seen: new Set(ms.filter((m) => m.author === 'user').map((m) => m.id)) });
  renderPanel([thread({ id: 't1', anchor: anchor('x'), messages: ms }), thread({ id: 't2' })]);
  expect(q('details.older summary')?.textContent).toBe('これまでのやり取り（4 件）');
  act(() => useUi.getState().markSeen(ms.map((m) => m.id)));
  expect(q('details.older summary')?.textContent).toBe('これまでのやり取り（4 件）'); // まだ
  act(() => useUi.getState().openSolo('t2'));
  act(() => useUi.getState().closeSolo());
  expect(q('.thread[data-tid="t1"] details.older summary')?.textContent).toBe('これまでのやり取り（6 件）');
  expect(qa('.msg.ai.fresh')).toHaveLength(0);
});

test('解決済みの行を開く：開いた直後の AI の発言には「新着」の印（●）が残り、見たことになる（旧と同じ順：描いてから、選ぶ）', async () => {
  const reply = ai('これが答え');
  const t = thread({ id: 't3', anchor: anchor('x'), resolved: true, messages: [user('質問'), reply] });
  renderPanel([t]);
  await userEvent.click(screen.getByRole('tab', { name: /解決済み/ }));
  await userEvent.click(q('.donerow') as HTMLElement);
  expect(q('.rowopen .msg.ai')).toHaveClass('fresh');
  expect(q('.rowopen .thread')).not.toHaveClass('fresh');
  expect(useUi.getState().seen.has(reply.id)).toBe(true);
});

// ---- F30：答えずに進んだ質問（旧の手作業の確認：質問 A〔答えず、続けた〕・質問 B〔答えて、送信済み〕） ----
test('F30：質問 A（答えず、続けた）は小さく出て、B（答えて、送信済み）は、ふつうに出る。「答える」で、A の入力が出る', async () => {
  const qa_ = ai('A について', { id: 'qA', ask: { type: 'yes_no', question: '質問 A：進めますか？' } });
  const qb = ai('B について', { id: 'qB', ask: { type: 'yes_no', question: '質問 B：公開しますか？' } });
  const answerB = say({
    id: 'ansB',
    author: 'user',
    kind: 'answer',
    to: 'qB',
    answer: { value: true },
    sent: true,
    text: undefined,
  });
  const t = thread({
    id: 't1',
    anchor: anchor('x'),
    messages: [qa_, qb, answerB, user('先へ進みます', { id: 'u1' }), ai('了解')],
  });
  useUi.setState({ seen: new Set(t.messages.map((m) => m.id)) });
  renderPanel([t]);

  // A：小さい表示（質問の文・「答えずに、会話が進みました」・「答える」だけ。「はい」「いいえ」・「回答を保存」はない）
  const stale = q('.ask.stale') as HTMLElement;
  expect(q('.ask-q', stale)?.textContent).toBe('質問 A：進めますか？');
  expect(q('.chip.small', stale)?.textContent).toBe('答えずに、会話が進みました');
  expect(within(stale).getByRole('button', { name: '答える' })).toHaveClass('link');
  expect(q('.pill', stale)).toBeNull();
  expect(within(stale).queryByRole('button', { name: '回答を保存' })).toBeNull();

  // B：ふつうに出る（ボタンは無効・「回答を送信済み」）
  const askB = qa('.ask').find((a) => q('.ask-q', a)?.textContent === '質問 B：公開しますか？') as HTMLElement;
  expect(askB).not.toHaveClass('stale');
  expect(
    qa('.pill', askB).map((p) => [p.textContent, (p as HTMLButtonElement).disabled, p.classList.contains('on')]),
  ).toEqual([
    ['はい', true, true],
    ['いいえ', true, false],
  ]);
  expect(q('.ask-foot .chip.ok', askB)?.textContent).toBe('回答を送信済み');

  // 「答える」：A の入力が、ふつうに出る
  await userEvent.click(within(stale).getByRole('button', { name: '答える' }));
  const askA = qa('.ask').find((a) => q('.ask-q', a)?.textContent === '質問 A：進めますか？') as HTMLElement;
  expect(askA).not.toHaveClass('stale');
  expect(qa('.pill', askA).map((p) => p.textContent)).toEqual(['はい', 'いいえ']);
  expect(within(askA).getByRole('button', { name: '回答を保存' })).toBeDisabled(); // 選ぶまでは、保存できない
  expect(useUi.getState().askOpen.has('qA')).toBe(true);
});

test('F30：解決済みのスレッドの質問は、小さくならない（再開すると、小さくなる）', () => {
  const qq = ai('質問', { id: 'q', ask: { type: 'yes_no', question: '？' } });
  const t = thread({ id: 't1', resolved: true, anchor: anchor('x'), messages: [qq, user('続き')] });
  renderPanel([t]);
  act(() => useUi.getState().setRowOpen('t1', true));
  act(() => useUi.getState().setTab('all'));
  expect(q('.ask')).not.toHaveClass('stale');
  expect(q('.ask .pill')).toBeDisabled();
});

// ---- F22：入力欄は、対象の位置の順 ----
test('入力欄：対象の位置の順に、スレッドの間へ入る（いつも一番上、ではない）。進行中を出さない切り替えでは、一番上', async () => {
  const [p1, p2, p3, target] = blocks(4) as [HTMLElement, HTMLElement, HTMLElement, HTMLElement];
  // 本文の順：p1（t1）・p2（t2）・target（入力中の対象）・p3（t3）
  target.before(p3);
  p2.after(target);
  const threads = [thread({ id: 't1' }), thread({ id: 't2' }), thread({ id: 't3' })];
  useDoc.setState({
    model: docModel('demo/root/1', { t1: p1, t2: p2, t3: p3 }, { nums: { t1: 1, t2: 2, t3: 3 }, pending: target }),
  });
  renderPanel(threads);
  // t3 を、本文の順で、いちばん後ろにしたので、p3 は target の前になるように組み直す
  p3.remove();
  target.after(p3);
  act(() => {
    useUi.getState().startComposer(anchor('選んだ文'));
  });
  const order = () =>
    qa('#threads > .thread').map((c) => (c.classList.contains('composer') ? 'composer' : c.dataset.tid));
  expect(order()).toEqual(['t1', 't2', 'composer', 't3']);
  expect(q('.thread.composer .hint')?.textContent).toBe('本文の、点線の部分へのコメントです');

  // 範囲の対象：枠の説明
  act(() => {
    useUi.getState().closeComposer();
    useUi.getState().startComposer(anchor('範囲', { rect: { x: 0, y: 0, w: 1, h: 1 } }));
  });
  expect(q('.thread.composer .hint')?.textContent).toContain('点線の枠へのコメントです');

  // 解決済みだけの切り替え：一番上
  await userEvent.click(screen.getByRole('tab', { name: /解決済み/ }));
  expect(order()).toEqual(['composer']);
});

test('「枠から」の札（F42）：枠（DIV）の錨の入力欄・保存したカードにだけ付く。本文の文を選んだ（引用あり）・段落（P）の、ラベルが似たコメントには、付かない', () => {
  const frame = anchor('', { blockTag: 'DIV', label: '枠から：button' });
  const fakeQuote = anchor('枠から：button', { blockTag: 'DIV', label: '枠から：button' }); // 利用者が、本文の「枠から：button」という文を選んだ
  const fakePara = anchor('', { blockTag: 'P', label: '枠から：button' });
  renderPanel([
    thread({ id: 't1', anchor: frame, messages: [user('枠の要素')] }),
    thread({ id: 't2', anchor: fakeQuote }),
    thread({ id: 't3', anchor: fakePara }),
  ]);
  act(() => {
    useUi.getState().startComposer(frame);
  });
  expect(q('.thread.composer .fromframe')?.textContent).toBe('枠から');
  expect(q('.thread.composer')?.hasAttribute('data-from-frame')).toBe(true);
  expect(q('.thread[data-tid="t1"] .fromframe')).not.toBeNull();
  expect(q('.thread[data-tid="t1"]')?.hasAttribute('data-from-frame')).toBe(true);
  for (const id of ['t2', 't3']) {
    expect(q(`.thread[data-tid="${id}"] .fromframe`), id).toBeNull();
    expect(q(`.thread[data-tid="${id}"]`)?.hasAttribute('data-from-frame'), id).toBe(false);
  }
  act(() => {
    useUi.getState().closeComposer();
    useUi.getState().startComposer(fakeQuote);
  });
  expect(q('.thread.composer .fromframe')).toBeNull();
});

test('入力欄：対象が本文にない（pending が null）なら、先頭。入力欄だけ（スレッドなし）でも、説明は出さない', () => {
  renderPanel([thread({ id: 't1' }), thread({ id: 't2' })]);
  act(() => {
    useUi.getState().startComposer(anchor('文'));
  });
  expect(qa('#threads > .thread').map((c) => (c.classList.contains('composer') ? 'composer' : c.dataset.tid))).toEqual([
    'composer',
    't1',
    't2',
  ]);
  expect(q('.thread.composer .hint')).toBeNull();
  document.body.replaceChildren();
  resetAll();
  renderPanel([]);
  act(() => {
    useUi.getState().startComposer(anchor('文'));
  });
  expect(q('#threads .empty')).toBeNull();
  expect(q('.thread.composer')).not.toBeNull();
});

test('入力欄を開くと、欄にフォーカス・カードを真ん中へ。対象を選び直すと、もう一度、フォーカス（書きかけの文は、残る）', async () => {
  renderPanel([thread({ id: 't1' })]);
  act(() => {
    useUi.getState().startComposer(anchor('一つ目'));
  });
  const ta = q('textarea[data-key="composer"]') as HTMLTextAreaElement;
  expect(ta).toHaveFocus();
  expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' });
  await userEvent.type(ta, '書きかけ');
  (q('.thread[data-tid="t1"] textarea') as HTMLElement).focus();
  expect(ta).not.toHaveFocus();
  act(() => {
    useUi.getState().startComposer(anchor('二つ目'));
  });
  expect(q('textarea[data-key="composer"]')).toHaveFocus();
  expect((q('textarea[data-key="composer"]') as HTMLTextAreaElement).value).toBe('書きかけ');
  expect(q('.thread.composer .quote')?.textContent).toBe('二つ目');
});

test('描き直しても、入力中の欄は、同じ DOM のまま・フォーカスと選択範囲も、保つ（入力欄が、並びの中で動いても）', () => {
  const [p1, p2, p3] = blocks(3) as [HTMLElement, HTMLElement, HTMLElement];
  useDoc.setState({ model: docModel('demo/root/1', { t1: p1, t2: p2 }, { pending: p3 }) });
  renderPanel([thread({ id: 't1' }), thread({ id: 't2' })]);
  act(() => {
    useUi.getState().startComposer(anchor('文'));
  });
  const order = () =>
    qa('#threads > .thread').map((c) => (c.classList.contains('composer') ? 'composer' : c.dataset.tid));
  expect(order()).toEqual(['t1', 't2', 'composer']);
  act(() => useUi.getState().setComposerDraft('こんにちは世界'));
  const panel = q('#threads') as HTMLElement;
  // ブラウザは、フォーカスのある要素を、DOM の中で動かす（外して、挿し直す）と、フォーカスを外す。jsdom は、外さないので、同じにする
  const restore: (() => void)[] = [];
  for (const op of ['insertBefore', 'appendChild'] as const) {
    const orig = Node.prototype[op] as (this: Node, ...a: unknown[]) => Node;
    (Node.prototype as unknown as Record<string, unknown>)[op] = function (this: Node, node: Node, ...rest: unknown[]) {
      const ae = document.activeElement;
      if (this === panel && node.contains(ae)) (ae as HTMLElement).blur();
      return orig.call(this, node, ...rest);
    };
    restore.push(() => {
      (Node.prototype as unknown as Record<string, unknown>)[op] = orig;
    });
  }
  onTestFinished(() => {
    for (const r of restore) r();
  });
  const ta = q('textarea[data-key="composer"]') as HTMLTextAreaElement;
  ta.focus();
  ta.setSelectionRange(2, 5);

  // 入力中の対象が、本文の先頭へ移った：入力欄が、並びの前へ
  p1.before(p3);
  act(() => useDoc.setState({ model: docModel('demo/root/1', { t1: p1, t2: p2 }, { pending: p3 }) }));
  expect(order()).toEqual(['composer', 't1', 't2']);
  // もう一度、後ろへ（このとき、入力欄の DOM が、動く）
  p2.after(p3);
  act(() => useDoc.setState({ model: docModel('demo/root/1', { t1: p1, t2: p2 }, { pending: p3 }) }));
  expect(order()).toEqual(['t1', 't2', 'composer']);
  const last = q('textarea[data-key="composer"]') as HTMLTextAreaElement;
  expect(last).toBe(ta);
  expect(last).toHaveFocus();
  expect([last.selectionStart, last.selectionEnd]).toEqual([2, 5]);
});

test('パネルのスクロールの位置：カードを組み替える途中で、ブラウザが、詰めてしまっても（0 に戻る）、描いたあとに、戻す。変わっていなければ、触らない', () => {
  renderPanel([thread({ id: 't1' })]);
  const panel = q('#threads') as HTMLElement;
  let top = 120;
  const sets: number[] = [];
  Object.defineProperty(panel, 'scrollTop', {
    get: () => top,
    set: (v: number) => {
      sets.push(v);
      top = v;
    },
    configurable: true,
  });
  act(() => useUi.getState().setActive('t1'));
  expect(sets).toEqual([]);
  // 並びが変わる（入力欄が、足される）途中で、スクロールが 0 に詰められる（中身が、一時的に短くなって、レイアウトされたときの、ブラウザの動き）
  for (const op of ['insertBefore', 'appendChild'] as const) {
    const orig = panel[op].bind(panel) as (...a: unknown[]) => Node;
    (panel as unknown as Record<string, unknown>)[op] = (...a: unknown[]) => {
      top = 0;
      return orig(...a);
    };
  }
  act(() => {
    useUi.getState().startComposer(anchor('文'));
  });
  expect(top).toBe(120);
});

test('ファイルを、入力欄の外へ落としても、ブラウザが開かない（preventDefault）。文字のドラッグ・ファイルでないものは、止めない', () => {
  renderPanel([]);
  const drag = (type: 'dragover' | 'drop', types: string[]) => {
    const e = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(e, 'dataTransfer', { value: { types, files: [] } });
    document.body.dispatchEvent(e);
    return e.defaultPrevented;
  };
  expect(drag('dragover', ['Files'])).toBe(true);
  expect(drag('drop', ['Files'])).toBe(true);
  expect(drag('drop', ['text/plain'])).toBe(false);
});
