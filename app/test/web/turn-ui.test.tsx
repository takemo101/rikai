// @vitest-environment jsdom
// 「いま、誰の番か」（F39）の表示：上のバーの `#turn`（4 状態・押したときの移動・読み上げ）・左の一覧の印・カードの札
import { act, fireEvent, render, within } from '@testing-library/react';
import { beforeEach, expect, test } from 'vitest';
import type { Message, Thread } from '../../src/shared/types';
import { SideNav } from '../../src/web/layout/SideNav';
import { TopBar } from '../../src/web/layout/TopBar';
import { parseHash } from '../../src/web/lib/route';
import { buildView } from '../../src/web/lib/view';
import { threadStatus } from '../../src/web/panel/logic';
import { useUi } from '../../src/web/store/ui';
import { meta, msg, resetAll, summary, thread, topicState } from './helpers';

beforeEach(() => resetAll());

const ASK = { type: 'yes_no', question: '？' } as const;
const ai = (id: string, over: Partial<Message> = {}): Message =>
  msg({ id, author: 'ai', kind: 'reply', sent: true, text: '返信', ...over });
const T = (id: string, messages: Message[], over: Partial<Thread> = {}): Thread => thread({ id, messages, ...over });
const OK = { offline: false, error: null };

function viewOf(over: Parameters<typeof topicState>[0] = {}) {
  const t = topicState(over);
  const v = buildView(parseHash('#/demo/root'), t);
  if (!v) throw new Error('view');
  return v;
}
const bar = (view: ReturnType<typeof viewOf> | null, status = OK) => render(<TopBar view={view} status={status} />);
const turn = () => document.getElementById('turn');

test('#turn：role="status"・aria-live="polite"。コメントなしは、出さない', () => {
  bar(viewOf());
  expect(turn()).toBeNull();
});

test('未送信：「未送信 n 件 → Submit」。Submit に attn の輪。押すと Submit へフォーカス。AI の返信待ちも続くときは、小さく並べる', () => {
  bar(viewOf({ unsent: 2, threads: [T('t1', [msg({ sent: false })])], meta: meta({ pending: [1] }) }));
  expect(turn()).toHaveClass('turn', 'unsent');
  expect(turn()?.getAttribute('role')).toBe('status');
  expect(turn()?.getAttribute('aria-live')).toBe('polite');
  expect(turn()).toHaveTextContent('未送信 2 件');
  expect(turn()).toHaveTextContent('→ Submit');
  expect(document.getElementById('btn-submit')).toHaveClass('primary', 'attn');
  // 前回分の返信待ち：控えめな札（と、コピーのボタン）
  expect(document.getElementById('top-status')?.querySelector('.chip.wait')).toHaveTextContent('AIの返信待ち');
  fireEvent.click(within(turn() as HTMLElement).getByRole('button'));
  expect(document.activeElement).toBe(document.getElementById('btn-submit'));
});

test('AI の返信待ち：灰色の印（押しても移らない：ボタンでない）。コピーのボタン・ヒントは、残る', () => {
  bar(viewOf({ threads: [T('t1', [msg()])], meta: meta({ pending: [1] }) }));
  expect(turn()).toHaveClass('waiting-ai');
  expect(turn()).toHaveTextContent('AIの返信待ち');
  expect(within(turn() as HTMLElement).queryByRole('button')).toBeNull();
  expect(document.getElementById('btn-submit')).not.toHaveClass('attn');
  expect(
    within(document.getElementById('top-status') as HTMLElement).getByRole('button', { name: 'コピー' }),
  ).toBeTruthy();
});

// 意図した変更（RIK-043 の再レビュー）：見える文字は「あなたの番 n」（n＝スレッドの数）。内訳（項目の数）は title・aria-label。
// 「あなたの番」は、AI の新着返信か、未回答の質問があるときだけ。未解決だけなら、灰色の「未解決 n」
test('あなたの番：見える文字は「あなたの番 n（スレッドの数）」。内訳は title・aria-label。押すと、最初の項目のカードを選ぶ（解決済みの一覧・1 枚だけ見る状態は、解く）', () => {
  const threads = [T('t1', [msg({ sent: true })]), T('t2', [ai('a2', { ask: ASK })]), T('t3', [ai('a3')])];
  bar(viewOf({ threads }));
  expect(turn()).toHaveClass('your-turn');
  expect(turn()?.querySelector('.turn-t')).toHaveTextContent('あなたの番 2'); // t2・t3 の 2 スレッド
  expect(turn()).not.toHaveTextContent('AI の返信'); // 内訳は、見える文字にない
  const btn = () => within(turn() as HTMLElement).getByRole('button');
  expect(btn().getAttribute('aria-label')).toContain('（AI の返信 2・未回答の質問 1）');
  expect(btn().getAttribute('title')).toContain('（AI の返信 2・未回答の質問 1）');
  act(() => {
    useUi.getState().setTab('done');
    useUi.getState().openSolo('t1');
  });
  fireEvent.click(btn());
  expect(useUi.getState().active).toBe('t2'); // AI の新着返信のある、最初のスレッド
  expect(useUi.getState().tab).toBe('live');
  expect(useUi.getState().solo).toBeNull();
  expect(useUi.getState().seen.has('a2')).toBe(true); // 選ぶと、見たことになる
  expect(turn()?.querySelector('.turn-t')).toHaveTextContent('あなたの番 2'); // t2 は、質問が残る・t3 は、まだ新着
  fireEvent.click(btn());
  expect(useUi.getState().active).toBe('t3');
  expect(turn()?.querySelector('.turn-t')).toHaveTextContent('あなたの番 1'); // 質問が残る t2 だけ
});

test('未解決だけ：灰色の「未解決 n」（あなたの番ではない）。押すと、最初の未解決のカード', () => {
  const threads = [T('t1', [msg({ sent: true })]), T('t2', [msg({ id: 'm2', sent: true })])];
  bar(viewOf({ threads }));
  expect(turn()).toHaveClass('turn', 'open');
  expect(turn()).not.toHaveClass('your-turn');
  expect(turn()?.querySelector('.turn-t')).toHaveTextContent('未解決 2');
  expect(turn()?.querySelector('.turn-sr')?.textContent).toBe('状態：未解決あり');
  fireEvent.click(within(turn() as HTMLElement).getByRole('button'));
  expect(useUi.getState().active).toBe('t1');
});

test('読み上げ：見える文字は aria-hidden・`aria-live` の中は、状態の名前だけ（件数を含まない）。件数だけが変わっても、その文字列は、変わらない', () => {
  const threads = (n: number) => Array.from({ length: n }, (_, i) => T(`t${i}`, [ai(`a${i}`)]));
  const r = bar(viewOf({ threads: threads(3) }));
  const live = () => turn()?.querySelector('.turn-sr')?.textContent;
  expect(live()).toBe('状態：あなたの番');
  expect(live()).not.toMatch(/\d/);
  act(() => useUi.getState().markSeen(['a0']));
  expect(turn()?.querySelector('.turn-t')).toHaveTextContent('あなたの番 2');
  expect(live()).toBe('状態：あなたの番'); // 件数だけが変わった：同じ
  expect(turn()?.querySelector('.turn-t')?.getAttribute('aria-hidden')).toBe('true');
  r.unmount();
  // 未送信の件数が変わる
  const u = (n: number) => viewOf({ unsent: n, threads: [T('t1', [msg({ sent: false })])] });
  const r2 = render(<TopBar view={u(1)} status={OK} />);
  expect(live()).toBe('状態：未送信あり');
  expect(turn()).toHaveTextContent('未送信 1 件');
  r2.rerender(<TopBar view={u(2)} status={OK} />);
  expect(turn()).toHaveTextContent('未送信 2 件');
  expect(live()).toBe('状態：未送信あり'); // aria-live の中は、変わらない
  expect(
    within(turn() as HTMLElement)
      .getByRole('button')
      .getAttribute('aria-label'),
  ).toContain('未送信 2 件'); // 件数は、ボタンの名前に
  expect(live()).not.toMatch(/\d/);
});

test('すべて解決（緑）。サーバーに接続できないときは、#turn を出さない（接続の警告が先）', () => {
  const done = viewOf({ threads: [T('t1', [ai('a1')], { resolved: true })] });
  const r = bar(done);
  expect(turn()).toHaveClass('done');
  expect(turn()).toHaveTextContent('すべて解決');
  r.unmount();
  bar(done, { offline: true, error: null });
  expect(turn()).toBeNull();
  expect(document.getElementById('top-status')).toHaveTextContent('サーバーに接続できません');
});

// 意図した変更：左の一覧の印は、どの幅でも、アイコンだけ（名前は title・aria-label）。未回答の質問がある要約だけ「あなたの番」・未解決だけは、灰色の「未解決 n」。
// 例外：AI の返信待ちは、従来の「待ち」（文字つき）
test('左の一覧の印：開いていないトピックは、要約だけ（未回答の質問→あなたの番・未解決だけ→灰色・待ち・すべて解決・終了）。アイコンだけ。開いているトピックは、上のバーと同じ判定', () => {
  const view = viewOf({ unsent: 1, threads: [T('t1', [msg({ sent: false })])] });
  const progress = (total: number, open: number, asks = 0, answered = 0) => ({
    threads: { total, resolved: total - open, open },
    asks: { total: asks, answered },
  });
  const topics = [
    summary('demo', { title: '開いている資料' }),
    summary('mine', { title: '自分の番', progress: progress(2, 1, 1, 0) }),
    summary('open', { title: '未解決だけ', progress: progress(2, 2, 1, 1) }),
    summary('wait', { title: '待ちの資料', pending: 1, progress: progress(1, 1) }),
    summary('done', { title: '済んだ資料', progress: progress(1, 0) }),
    summary('none', { title: 'コメントなし' }),
    summary('end', { title: '終わった資料', closed: true }),
  ];
  render(<SideNav topics={topics} currentSlug="demo" view={view} />);
  const li = (t: string) =>
    document.evaluate(`//li[contains(., '${t}')]`, document, null, 9, null).singleNodeValue as HTMLElement;
  expect(li('開いている資料').querySelector('.chip.draft')?.getAttribute('aria-label')).toBe('未送信 1 件。Submit'); // 開いている：未送信（#turn と同じ）
  const mine = li('自分の番').querySelector('.chip.yours');
  expect(mine?.getAttribute('aria-label')).toBe('あなたの番');
  expect(mine?.getAttribute('title')).toBe('あなたの番');
  expect(mine?.textContent).toBe(''); // アイコンだけ（文字は、ない）
  expect(li('自分の番')).not.toHaveTextContent('あなたの番');
  const open = li('未解決だけ').querySelector('.chip.aiwait');
  expect(open?.getAttribute('aria-label')).toBe('未解決 2');
  expect(open?.textContent).toBe('');
  expect(li('待ちの資料').querySelector('.chip.wait')).toHaveTextContent('待ち');
  expect(li('済んだ資料').querySelector('.chip.ok[aria-label="すべて解決"]')).toBeTruthy();
  expect(li('コメントなし').querySelector('.turn-mark, .chip.wait')).toBeNull();
  expect(li('終わった資料')).toHaveTextContent('終了');
  expect(li('終わった資料').querySelector('.turn-mark')).toBeNull();
});

test('カードの札：解決済み／未送信／回答待ち（AI の返信と質問が重なっても 1 つ）／AIの返信／AIの返信待ち（pending の round）／札なし', () => {
  expect(threadStatus(T('t', [ai('a')], { resolved: true }))).toEqual(['解決済み', 'ok']);
  expect(threadStatus(T('t', [msg({ sent: false })]))).toEqual(['未送信', 'draft']);
  // AI の返信と、未回答の質問が重なる：「回答待ち」の 1 つ
  expect(threadStatus(T('t', [ai('a', { ask: ASK })]))).toEqual(['回答待ち', 'yours']);
  expect(threadStatus(T('t', [ai('q', { ask: ASK }), ai('a')]))).toEqual(['回答待ち', 'yours']);
  expect(threadStatus(T('t', [ai('a')]))).toEqual(['AIの返信', 'new']);
  // 答えた質問は、数えない
  expect(
    threadStatus(
      T('t', [ai('q', { ask: ASK }), msg({ id: 'r', kind: 'answer', to: 'q', answer: { value: true }, sent: true })]),
    )[1],
  ).toBe('wait');
  expect(
    threadStatus(
      T('t', [
        ai('q', { ask: ASK }),
        msg({ id: 'r', kind: 'answer', to: 'q', answer: { value: true }, sent: true }),
        ai('a2'),
      ]),
    ),
  ).toEqual(['AIの返信', 'new']);
  // 送った発言を、AI が処理待ち：その round が pending のときだけ「AIの返信待ち」
  const sent = T('t', [msg({ sent: true, round: 2 })]);
  expect(threadStatus(sent, [2])).toEqual(['AIの返信待ち', 'aiwait']);
  expect(threadStatus(sent, [1])).toEqual(['AIの確認待ち', 'wait']);
  expect(threadStatus(sent)).toEqual(['AIの確認待ち', 'wait']);
});
