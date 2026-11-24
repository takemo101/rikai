// 新着の判定に使う ID の要約（F46）：返信・質問・未回答・版・上限・壊れた入力。画面（開いているトピック）とサーバー（一覧の fresh）が、同じ関数を使う
import { expect, test } from 'vitest';
import { answerOf, askStale, awaitsAnswer, FRESH_MAX, freshOf, freshSize } from '../../src/shared/fresh';
import type { Message, PageInfo, Thread } from '../../src/shared/types';

const ASK = { type: 'yes_no', question: '？' } as const;
const m = (id: string, over: Partial<Message> = {}): Message => ({
  id,
  author: 'ai',
  kind: 'reply',
  at: '',
  text: 'x',
  sent: true,
  ...over,
});
const q = (id: string) => m(id, { ask: ASK });
const ans = (id: string, to: string): Message => m(id, { author: 'user', kind: 'answer', to, answer: { value: true } });
const user = (id: string): Message => m(id, { author: 'user', kind: 'comment' });
const T = (id: string, messages: Message[], resolved = false): Thread => ({
  id,
  page: 'root',
  version: 1,
  anchor: null,
  resolved,
  resolveSent: true,
  createdAt: '',
  origin: 'user',
  messages,
});
const pages = (o: Record<string, number>): Record<string, Pick<PageInfo, 'versions'>> =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { versions: v }]));

test('返信（質問のない AI の発言）・質問付き・未回答・ページごとの版のキー。利用者の発言は、入らない', () => {
  const f = freshOf(
    [T('t1', [user('m1'), m('m2'), q('m3'), q('m4'), ans('m5', 'm4')]), T('t2', [m('m6')], true)],
    pages({ root: 2, sub: 1 }),
  );
  expect(f.replies).toEqual(['m2', 'm6']);
  expect(f.asks).toEqual(['m3', 'm4']);
  expect(f.openAsks).toEqual(['m3']); // m4 は、回答済み
  expect(f.versions).toEqual(['root@1', 'root@2', 'sub@1']);
});

test('未回答の判定：解決済み・答えないまま会話が進んだ質問は、未回答でない（awaitsAnswer。画面の F39 と、同じ関数）', () => {
  const stale = T('t', [q('m1'), user('m2')]);
  expect(askStale(stale, stale.messages[0] as Message)).toBe(true);
  expect(awaitsAnswer(stale, stale.messages[0] as Message)).toBe(false);
  expect(answerOf(T('t', [q('m1'), ans('m2', 'm1')]), { id: 'm1' })?.id).toBe('m2');
  expect(freshOf([T('t', [q('m1')], true)], pages({ root: 1 })).openAsks).toEqual([]);
  expect(freshOf([stale], pages({ root: 1 })).openAsks).toEqual([]);
});

test('上限：各項目は、新しい側（ID の連番が大きい側）から max 個。openAsks は、切ったあとの asks の部分集合（窓の外の質問が、新着に見えない）。max なしは、全部', () => {
  const msgs = Array.from({ length: 30 }, (_, i) => m(`m${i + 1}`));
  const asks = Array.from({ length: 30 }, (_, i) => q(`m${i + 101}`));
  const f = freshOf([T('t', [...msgs, ...asks])], pages({ root: 30 }), 10);
  expect(f.replies).toEqual(Array.from({ length: 10 }, (_, i) => `m${i + 21}`));
  expect(f.asks).toEqual(Array.from({ length: 10 }, (_, i) => `m${i + 121}`));
  expect(f.openAsks).toEqual(f.asks); // 古い質問（m101〜）も未回答だが、窓の外：入らない
  expect(f.versions).toEqual(Array.from({ length: 10 }, (_, i) => `root@${i + 21}`));
  for (const id of f.openAsks) expect(f.asks).toContain(id);
  expect(freshOf([T('t', [...msgs, ...asks])], pages({ root: 30 })).replies).toHaveLength(30);
  expect(FRESH_MAX).toBe(200);
  expect(freshSize(f)).toBe(40);
});

test('壊れた入力（threads が配列でない・messages が配列でない・pages がない）でも、集められる分だけ集める', () => {
  expect(freshOf(null, null)).toEqual({ replies: [], asks: [], openAsks: [], versions: [] });
  expect(
    freshOf([{ ...T('t', []), messages: null } as unknown as Thread, T('u', [m('m1')])], undefined).replies,
  ).toEqual(['m1']);
});
