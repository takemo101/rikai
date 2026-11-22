// @vitest-environment jsdom
// AI の質問（ask）：5 つの型の回答・保存・取り消し・送信済みの固定・「その他」・下書き（F5・F10）
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Ask, AskAnswer, Message, Thread } from '../../../src/shared/types';
import { useUi } from '../../../src/web/store/ui';
import { resetAll } from '../helpers';
import { ai, anchor, renderPanel, say, stubScroll, thread } from './fixtures';

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

const options = [
  { id: 'a', label: '案 A', detail: 'A の説明' },
  { id: 'b', label: '案 B' },
  { id: 'c', label: '案 C' },
];
const ASKS: Record<string, Ask> = {
  single: { type: 'single_choice', question: '一つ選んで', options, allowOther: true },
  singleNoOther: { type: 'single_choice', question: '一つ選んで', options, allowOther: false },
  multi: { type: 'multi_choice', question: 'いくつか選んで', options, allowOther: true },
  yn: { type: 'yes_no', question: 'よいですか？' },
  scale: { type: 'scale', question: '分かりやすさは？', min: 1, max: 5, minLabel: '難しい', maxLabel: '簡単' },
  free: { type: 'free_text', question: '言い換えて', placeholder: 'ここに書く' },
};

const MID = 'qm';
const answerMsg = (answer: AskAnswer, sent: boolean): Message =>
  say({ id: 'ans1', author: 'user', kind: 'answer', to: MID, answer, sent, text: undefined });

/** 質問 1 つのスレッド。答えを持つ（保存した回答）なら、`saved` */
function withAsk(kind: keyof typeof ASKS, saved?: { answer: AskAnswer; sent: boolean }, over: Partial<Thread> = {}) {
  const ms = [ai('質問です', { id: MID, ask: ASKS[kind] })];
  if (saved) ms.push(answerMsg(saved.answer, saved.sent));
  useUi.setState({ seen: new Set(ms.map((m) => m.id)) });
  return thread({ id: 't1', anchor: anchor('x'), messages: ms, ...over });
}

/** 回答を保存したあとの、サーバーの状態（`/api/answer`：保存・取り消し） */
const saveAnswers: Parameters<typeof renderPanel>[1] = {
  onPost: (path, body, server) => {
    if (path !== '/api/answer') return undefined;
    server.threads = server.threads.map((t) => {
      const rest = t.messages.filter((m) => !(m.kind === 'answer' && m.to === body.msg));
      return {
        ...t,
        messages: body.answer ? [...rest, answerMsg(body.answer as AskAnswer, false)] : rest,
      };
    });
    return undefined;
  },
};
const save = () => screen.getByRole('button', { name: /回答を保存|保存済み/ });

test('質問の文・「回答を保存」は、選ぶまで押せない。回答は、メッセージとして出さない（質問の下の入力で見せる）', () => {
  renderPanel([withAsk('yn', { answer: { value: true }, sent: false })]);
  expect(qa('.thread .msg')).toHaveLength(1);
  expect(q('.ask .ask-q')?.textContent).toBe('よいですか？');
});

test('yes/no：はい／いいえを選ぶ（.on）→ 保存 → POST { value: true } → 「保存済み（未送信）」・「取り消す」で、取り消し（answer: null）', async () => {
  const view = renderPanel([withAsk('yn')], saveAnswers);
  expect(save()).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'はい' }));
  expect(screen.getByRole('button', { name: 'はい' })).toHaveClass('pill', 'on');
  expect(screen.getByRole('button', { name: 'いいえ' })).not.toHaveClass('on');
  expect(save()).toBeEnabled();
  await userEvent.click(save());
  await waitFor(() => expect(view.posts).toHaveLength(1));
  expect(view.posts[0]).toMatchObject({
    path: '/api/answer',
    body: { topic: 'demo', thread: 't1', msg: MID, answer: { value: true } },
  });
  await waitFor(() => expect(screen.getByRole('button', { name: '保存済み（未送信）' })).toBeDisabled());
  expect(screen.getByRole('button', { name: 'はい' })).toHaveClass('on');

  // 選び直す：保存済みとは、違う → 保存できる。「いいえ」は、false も、答え
  await userEvent.click(screen.getByRole('button', { name: 'いいえ' }));
  expect(screen.getByRole('button', { name: '回答を保存' })).toBeEnabled();
  await userEvent.click(screen.getByRole('button', { name: '回答を保存' }));
  await waitFor(() => expect(view.posts[1]?.body.answer).toEqual({ value: false }));

  // 取り消す
  await waitFor(() => expect(screen.getByRole('button', { name: '取り消す' })).toBeEnabled());
  await userEvent.click(screen.getByRole('button', { name: '取り消す' }));
  await waitFor(() => expect(view.posts).toHaveLength(3));
  expect(view.posts[2]).toMatchObject({ path: '/api/answer', body: { msg: MID, answer: null } });
  await waitFor(() => expect(screen.queryByRole('button', { name: '取り消す' })).toBeNull());
  expect(qa('.ask .pill.on')).toHaveLength(0); // 下書きも、保存した回答（なし）から、作り直す
  expect(screen.getByRole('button', { name: '回答を保存' })).toBeDisabled();
});

test('single_choice：ラジオ（選ぶと .on）・説明つきの選択肢・保存 → { choice }。「その他」を書くと選択が外れ、{ other }。選ぶと「その他」が消える', async () => {
  const view = renderPanel([withAsk('single')], saveAnswers);
  const radios = qa('.ask label.opt:not(.other) input[type="radio"]') as HTMLInputElement[];
  expect(radios).toHaveLength(3);
  expect(new Set(radios.map((r) => r.name)).size).toBe(1);
  expect(q('.opt .opt-l')?.textContent).toBe('案 A');
  expect(q('.opt .opt-d')?.textContent).toBe('A の説明');
  expect(qa('.opt .opt-d')).toHaveLength(1);

  await userEvent.click(screen.getByLabelText(/案 B/));
  expect(screen.getByLabelText(/案 B/).closest('label')).toHaveClass('opt', 'on');
  const other = q('input[type="text"][data-key^="ask-other-"]') as HTMLInputElement;
  expect(other.placeholder).toBe('自由入力');
  await userEvent.type(other, '自由な答え');
  expect(radios.every((r) => !r.checked)).toBe(true);
  expect(qa('.ask label.opt.on')).toHaveLength(0);
  await userEvent.click(save());
  await waitFor(() => expect(view.posts[0]?.body.answer).toEqual({ other: '自由な答え' }));

  await waitFor(() => expect(screen.getByRole('button', { name: '保存済み（未送信）' })).toBeDisabled());
  await userEvent.click(screen.getByLabelText(/案 C/));
  expect((q('input[type="text"][data-key^="ask-other-"]') as HTMLInputElement).value).toBe('');
  await userEvent.click(save());
  await waitFor(() => expect(view.posts[1]?.body.answer).toEqual({ choice: 'c' }));
});

test('single_choice（allowOther なし）：「その他」の欄は、出ない', () => {
  renderPanel([withAsk('singleNoOther')]);
  expect(q('.opt.other')).toBeNull();
});

test('multi_choice：チェックボックス（複数）・外せる・「その他」と両立 → { choices, other }', async () => {
  const view = renderPanel([withAsk('multi')], saveAnswers);
  expect(qa('.ask input[type="checkbox"]')).toHaveLength(3);
  await userEvent.click(screen.getByLabelText(/案 A/));
  await userEvent.click(screen.getByLabelText(/案 C/));
  await userEvent.click(screen.getByLabelText(/案 A/)); // 外す
  expect(qa('.ask label.opt.on').map((l) => q('.opt-l', l)?.textContent)).toEqual(['案 C']);
  await userEvent.type(q('input[data-key^="ask-other-"]') as HTMLElement, 'ほか');
  expect(qa('.ask label.opt.on')).toHaveLength(1); // 複数は、「その他」を書いても、選択を外さない
  await userEvent.click(save());
  await waitFor(() => expect(view.posts[0]?.body.answer).toEqual({ choices: ['c'], other: 'ほか' }));
});

test('scale：min〜max のボタン・両端のラベル → { value: 3 }', async () => {
  const view = renderPanel([withAsk('scale')], saveAnswers);
  const row = q('.ask .scale') as HTMLElement;
  expect([...row.children].map((c) => [c.tagName, c.className, c.textContent])).toEqual([
    ['SPAN', 'sl', '難しい'],
    ...[1, 2, 3, 4, 5].map((n) => ['BUTTON', 'pill', String(n)]),
    ['SPAN', 'sl', '簡単'],
  ]);
  await userEvent.click(within(row).getByRole('button', { name: '3' }));
  expect(within(row).getByRole('button', { name: '3' })).toHaveClass('on');
  await userEvent.click(save());
  await waitFor(() => expect(view.posts[0]?.body.answer).toEqual({ value: 3 }));
});

test('free_text：欄（placeholder・既定は「自分の言葉で」）→ 保存 → { text }。空白だけは、保存できない', async () => {
  const view = renderPanel([withAsk('free')], saveAnswers);
  const ta = q('.ask textarea') as HTMLTextAreaElement;
  expect(ta.placeholder).toBe('ここに書く');
  expect(ta.dataset.key).toBe(`ask-text-${MID}`);
  await userEvent.type(ta, '   ');
  expect(save()).toBeDisabled();
  await userEvent.type(ta, '自分の言葉');
  await userEvent.click(save());
  await waitFor(() => expect(view.posts[0]?.body.answer).toEqual({ text: '   自分の言葉' }));
});

test('下書き：選びかけ（保存していない）は、再描画・パネルの更新を挟んでも、残る', async () => {
  renderPanel([withAsk('yn')]);
  await userEvent.click(screen.getByRole('button', { name: 'いいえ' }));
  act(() => useUi.getState().setActive('t1'));
  act(() => useUi.getState().setTab('all'));
  expect(screen.getByRole('button', { name: 'いいえ' })).toHaveClass('on');
  expect(useUi.getState().drafts.ask[MID]).toEqual({ value: false });
});

test('保存した回答がある質問は、最初から、その回答で出る（下書きの出発点）', () => {
  renderPanel([withAsk('multi', { answer: { choices: ['a', 'b'], other: 'ほか' }, sent: false })]);
  expect(qa('.ask label.opt.on:not(.other)').map((l) => q('.opt-l', l)?.textContent)).toEqual(['案 A', '案 B']);
  expect((q('input[data-key^="ask-other-"]') as HTMLInputElement).value).toBe('ほか');
  expect(screen.getByRole('button', { name: '保存済み（未送信）' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '取り消す' })).toBeEnabled();
});

test('送信済みの回答：入力は、すべて無効・「回答を送信済み」・保存・取り消しのボタンはない', () => {
  renderPanel([withAsk('single', { answer: { choice: 'b' }, sent: true })]);
  expect(qa('.ask input').every((i) => (i as HTMLInputElement).disabled)).toBe(true);
  expect(screen.getByLabelText(/案 B/).closest('label')).toHaveClass('on');
  expect(q('.ask-foot .chip.ok')?.textContent).toBe('回答を送信済み');
  expect(screen.queryByRole('button', { name: /保存|取り消す/ })).toBeNull();
});

test('解決済みのスレッドの質問：入力は無効。保存した回答があれば「回答済み」（送信していなければ）', () => {
  renderPanel([withAsk('yn', { answer: { value: true }, sent: false }, { resolved: true })]);
  act(() => {
    useUi.getState().setRowOpen('t1', true);
    useUi.getState().setTab('all');
  });
  expect(qa('.ask .pill').every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
  expect(q('.ask-foot .chip.ok')?.textContent).toBe('回答済み');
  expect(screen.queryByRole('button', { name: /保存|取り消す/ })).toBeNull();
});

test('回答の保存が失敗したら、トースト・選んだものは、残る。送っている間の、2 回押しは、1 件', async () => {
  renderPanel([withAsk('yn')]);
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => {
    release = r;
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      await gate;
      return new Response(JSON.stringify({ ok: false, error: '送信済みの回答は変えられません' }), { status: 400 });
    }),
  );
  await userEvent.click(screen.getByRole('button', { name: 'はい' }));
  await userEvent.click(save());
  await userEvent.click(save());
  release();
  await waitFor(() => expect(useUi.getState().toast).toMatchObject({ err: true }));
  expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'はい' })).toHaveClass('on');
});

test('取り消しが失敗したら、下書きは、保存した回答に戻る（旧と同じ：下書きを消してから送る）', async () => {
  renderPanel([withAsk('yn', { answer: { value: true }, sent: false })]);
  await userEvent.click(screen.getByRole('button', { name: 'いいえ' }));
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ ok: false, error: '失敗' }), { status: 400 })),
  );
  await userEvent.click(screen.getByRole('button', { name: '取り消す' }));
  await waitFor(() => expect(useUi.getState().toast?.msg).toBe('失敗'));
  expect(screen.getByRole('button', { name: 'はい' })).toHaveClass('on');
  expect(screen.getByRole('button', { name: '保存済み（未送信）' })).toBeDisabled();
});
