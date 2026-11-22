// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { useMutations } from '../../src/web/api/mutations';
import { queryClient } from '../../src/web/api/queryClient';
import { useUi } from '../../src/web/store/ui';
import { mockFetch, resetAll, topicState } from './helpers';

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

beforeEach(resetAll);
afterEach(() => vi.unstubAllGlobals());

test('成功：POST → onOk（取り直しの前）→ トピックの取り直し（since なし）。結果を返す', async () => {
  const order: string[] = [];
  const { calls } = mockFetch((req) => {
    if (req.method === 'POST') {
      order.push('post');
      return { body: { ok: true, thread: 't9' } };
    }
    order.push('refresh');
    return { body: topicState({ rev: 5 }) };
  });
  const { result } = renderHook(() => useMutations(), { wrapper });
  const r = await result.current.comment(
    { topic: 'demo', page: 'root', version: 1, text: 'こんにちは', anchor: { quote: 'x' } },
    { onOk: () => order.push('ok') },
  );
  expect(r).toMatchObject({ ok: true, thread: 't9' });
  expect(order).toEqual(['post', 'ok', 'refresh']);
  expect(calls[0]).toMatchObject({ method: 'POST', path: '/api/comment' });
  expect(calls[0]?.body).toMatchObject({ topic: 'demo', text: 'こんにちは' });
  expect(calls[1]?.path).toBe('/api/topic/demo');
  expect(calls[1]?.query.has('since')).toBe(false);
  expect(queryClient.getQueryData(['topic', 'demo'])).toMatchObject({ rev: 5 });
});

test('失敗：サーバーの文言のトースト（エラー）・null を返す・取り直さない・onOk を呼ばない', async () => {
  const { calls } = mockFetch(() => ({ status: 400, body: { ok: false, error: '本文が空です' } }));
  const onOk = vi.fn();
  const { result } = renderHook(() => useMutations(), { wrapper });
  const r = await result.current.reply({ topic: 'demo', thread: 't1', text: '' }, { onOk });
  expect(r).toBeNull();
  expect(onOk).not.toHaveBeenCalled();
  expect(useUi.getState().toast).toMatchObject({ msg: '本文が空です', err: true });
  expect(calls).toHaveLength(1);
});

test('接続できない失敗も、トースト・null', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }),
  );
  const { result } = renderHook(() => useMutations(), { wrapper });
  expect(await result.current.end({ topic: 'demo' })).toBeNull();
  expect(useUi.getState().toast).toMatchObject({ msg: 'Failed to fetch', err: true });
});

test('attach は、トピックを取り直さない。delete・resolve・edit・answer・submit は、取り直す', async () => {
  const { calls } = mockFetch((req) =>
    req.method === 'POST' ? { body: { ok: true, name: 'a.png', round: 2 } } : { body: topicState() },
  );
  const { result } = renderHook(() => useMutations(), { wrapper });
  await result.current.attach({ topic: 'demo', data: 'AAAA' });
  expect(calls.map((c) => c.path)).toEqual(['/api/attach']);
  await result.current.delete({ topic: 'demo', thread: 't1', msg: 'm1' });
  await result.current.resolve({ topic: 'demo', thread: 't1', resolved: true });
  await result.current.edit({ topic: 'demo', thread: 't1', msg: 'm1', text: 'x' });
  await result.current.answer({ topic: 'demo', thread: 't1', msg: 'q', answer: null });
  const r = await result.current.submit({ topic: 'demo', note: 'メモ' });
  expect(r).toMatchObject({ round: 2 });
  const paths = calls.map((c) => `${c.method} ${c.path}`);
  expect(paths.filter((p) => p === 'GET /api/topic/demo')).toHaveLength(5);
  expect(paths).toContain('POST /api/submit');
});
