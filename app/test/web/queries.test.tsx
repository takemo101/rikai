// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ApiError } from '../../src/web/api/client';
import { refreshTopic, usePage, useTopic, useTopics } from '../../src/web/api/queries';
import { POLL_MS, queryClient } from '../../src/web/api/queryClient';
import { mockFetch, resetAll, summary, topicState } from './helpers';

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

beforeEach(resetAll);

/** 1 回の取得（POLL_MS）を進め、その結果の通知まで流す */
async function tick(): Promise<void> {
  await act(() => vi.advanceTimersByTimeAsync(POLL_MS + 50));
  await act(() => vi.advanceTimersByTimeAsync(50));
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test('useTopic：最初は since なし。2 回目からは since=<rev> を付け、unchanged なら、前のデータ（同じ参照）', async () => {
  const state = topicState({ rev: 3 });
  const { calls } = mockFetch((req) =>
    req.path === '/api/topic/demo'
      ? { body: req.query.get('since') === '3' ? { unchanged: true, rev: 3 } : state }
      : undefined,
  );
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const { result } = renderHook(() => useTopic('demo'), { wrapper });
  await waitFor(() => expect(result.current.data?.rev).toBe(3));
  const first = result.current.data;
  expect(calls[0]?.query.has('since')).toBe(false);

  await tick();
  await waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(2));
  expect(calls[1]?.query.get('since')).toBe('3');
  expect(result.current.data).toBe(first);
});

test('useTopic：rev が変われば、新しいデータ（1.5 秒ごとの取得）', async () => {
  let rev = 1;
  mockFetch(() => ({ body: topicState({ rev }) }));
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const { result } = renderHook(() => useTopic('demo'), { wrapper });
  await waitFor(() => expect(result.current.data?.rev).toBe(1));
  rev = 2;
  await tick();
  await waitFor(() => expect(result.current.data?.rev).toBe(2));
});

test('useTopic：slug が null の間は、取らない', async () => {
  const { fn } = mockFetch(() => ({ body: topicState() }));
  renderHook(() => useTopic(null), { wrapper });
  await new Promise((r) => setTimeout(r, 30));
  expect(fn).not.toHaveBeenCalled();
});

test('失敗：接続できない（TypeError）は status なし・サーバーのエラーは ApiError（status・文言）。前のデータは残す', async () => {
  let mode: 'ok' | 'down' | 'err' = 'ok';
  mockFetch(() => {
    if (mode === 'down') throw new TypeError('Failed to fetch');
    if (mode === 'err') return { status: 500, body: { ok: false, error: '内部エラー' } };
    return { body: [summary('demo')] };
  });
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const { result } = renderHook(
    () => {
      const q = useTopics(); // 描画の中で読む（読んだ項目の変化だけが、通知される）
      return { data: q.data, error: q.error };
    },
    { wrapper },
  );
  await waitFor(() => expect(result.current.data).toHaveLength(1));

  mode = 'down';
  await tick();
  await waitFor(() => expect(String(result.current.error)).toContain('Failed to fetch'));
  expect(result.current.error).not.toBeInstanceOf(ApiError);
  expect(result.current.data).toHaveLength(1);

  mode = 'err';
  await tick();
  await waitFor(() => expect(result.current.error).toBeInstanceOf(ApiError));
  expect(result.current.error).toMatchObject({ status: 500, message: '内部エラー' });

  mode = 'ok';
  await tick();
  await waitFor(() => expect(result.current.error).toBeNull());
});

test('JSON でない応答は「通信エラー」', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('<html>', { status: 502 })),
  );
  const { result } = renderHook(() => useTopics(), { wrapper });
  await waitFor(() => expect(result.current.error).toBeInstanceOf(ApiError));
  expect(result.current.error).toMatchObject({ status: 502, message: '通信エラー' });
});

test('usePage：版ごとに 1 回だけ取る（staleTime: Infinity）・version が 1 未満なら取らない', async () => {
  const { calls } = mockFetch((req) => ({ body: { markdown: `# ${req.path}` } }));
  const { result, rerender } = renderHook(({ v }) => usePage('demo', 'root', v), {
    wrapper,
    initialProps: { v: 2 },
  });
  await waitFor(() => expect(result.current.data).toBe('# /api/page/demo/root/2'));
  rerender({ v: 1 });
  await waitFor(() => expect(result.current.data).toBe('# /api/page/demo/root/1'));
  rerender({ v: 2 });
  await waitFor(() => expect(result.current.data).toBe('# /api/page/demo/root/2'));
  expect(calls.map((c) => c.path)).toEqual(['/api/page/demo/root/2', '/api/page/demo/root/1']);
  rerender({ v: 0 });
  expect(calls).toHaveLength(2);
});

test('refreshTopic：since を付けず、全部を取って、キャッシュへ入れる', async () => {
  queryClient.setQueryData(['topic', 'demo'], topicState({ rev: 1 }));
  const { calls } = mockFetch(() => ({ body: topicState({ rev: 2, unsent: 4 }) }));
  const d = await refreshTopic(queryClient, 'demo');
  expect(d.unsent).toBe(4);
  expect(calls[0]?.query.has('since')).toBe(false);
  expect(queryClient.getQueryData(['topic', 'demo'])).toBe(d);
});
