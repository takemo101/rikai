// @vitest-environment jsdom
// サーバーからの通知（SSE）：偽の SharedWorker（接続は、ブラウザ全体で 1 本。タブは、ワーカーのメッセージを受ける）で、つながっている間はポーリングを止め、通知で取り直し、切れたらポーリングに戻ることを確かめる。
import { QueryClientProvider } from '@tanstack/react-query';
import { act, render, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { useServerEvents } from '../../src/web/api/events';
import { useTopic, useTopics } from '../../src/web/api/queries';
import { POLL_MS, queryClient } from '../../src/web/api/queryClient';
import { useUi } from '../../src/web/store/ui';
import { type FakeRequest, mockFetch, resetAll, summary, topicState } from './helpers';

/** 偽の SharedWorker：ポートが、`postMessage`（タブ → ワーカー）を記録し、`emit`（ワーカー → タブ）を届ける */
class FakeSharedWorker {
  static all: FakeSharedWorker[] = [];
  static failOnCreate = false;
  readonly url: string;
  readonly name: string | undefined;
  onerror: ((e: Event) => void) | null = null;
  /** タブからワーカーへ送ったもの */
  sent: unknown[] = [];
  started = false;
  closed = false;
  readonly port: {
    onmessage: ((e: MessageEvent) => void) | null;
    onmessageerror: ((e: Event) => void) | null;
    postMessage: (m: unknown) => void;
    start: () => void;
    close: () => void;
  };
  constructor(url: URL | string, opts?: { name?: string; type?: string }) {
    if (FakeSharedWorker.failOnCreate) throw new DOMException('blocked', 'SecurityError');
    this.url = String(url);
    this.name = opts?.name;
    FakeSharedWorker.all.push(this);
    this.port = {
      onmessage: null,
      onmessageerror: null,
      postMessage: (m) => {
        if (!this.closed) this.sent.push(m);
      },
      start: () => {
        this.started = true;
      },
      close: () => {
        this.closed = true;
      },
    };
  }
  /** ワーカーからのメッセージを、届ける（閉じたポートには、届かない） */
  emit(m: unknown): void {
    if (!this.closed) this.port.onmessage?.({ data: m } as MessageEvent);
  }
}
const sources = () => FakeSharedWorker.all;
const open = () => FakeSharedWorker.all.filter((s) => !s.closed);

function Probe() {
  useServerEvents();
  const topics = useTopics();
  const topic = useTopic('demo');
  return (
    <p>
      {topics.data?.length ?? '-'}:{topic.data?.rev ?? '-'}
    </p>
  );
}
const mount = (strict = false) => {
  const tree = (
    <QueryClientProvider client={queryClient}>
      <Probe />
    </QueryClientProvider>
  );
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree);
};

let rev = 1;
let calls: FakeRequest[];
const count = (path: string) => calls.filter((c) => c.path === path).length;
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

beforeEach(() => {
  resetAll();
  FakeSharedWorker.all = [];
  FakeSharedWorker.failOnCreate = false;
  vi.stubGlobal('SharedWorker', FakeSharedWorker);
  rev = 1;
  ({ calls } = mockFetch((req) => {
    if (req.path === '/api/topics') return { body: [summary('demo', { rev })] };
    if (req.path === '/api/topic/demo')
      return { body: req.query.get('since') === String(rev) ? { unchanged: true, rev } : topicState({ rev }) };
    return undefined;
  }));
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test('ready でつながったら、ポーリングを止める（定期の取得が 0）。ready で、全体を 1 回取り直す', async () => {
  mount();
  await waitFor(() => expect(count('/api/topic/demo')).toBe(1));
  expect(sources()).toHaveLength(1);
  expect(sources()[0]?.url).toMatch(/eventsWorker/);
  expect(sources()[0]?.name).toBe('rikai-events');
  expect(sources()[0]?.started).toBe(true);
  // つながるまでは、ポーリングのまま
  await advance(POLL_MS + 50);
  expect(count('/api/topic/demo')).toBe(2);
  expect(useUi.getState().live).toBe(false);

  sources()[0]?.emit({ type: 'ready' });
  expect(useUi.getState().live).toBe(true);
  await waitFor(() => expect(count('/api/topic/demo')).toBe(3)); // 全体の取り直し（since つき）
  expect(
    calls
      .filter((c) => c.path === '/api/topic/demo')
      .at(-1)
      ?.query.get('since'),
  ).toBe('1');
  const total = calls.length;
  await advance(POLL_MS * 10);
  expect(calls.length, 'つながっている間は、定期の取得が、ない').toBe(total);
});

test('changed（slug・rev）：1.5 秒を待たず、すぐ、since つきで取り直す。一覧も取り直す', async () => {
  const { container } = mount();
  await waitFor(() => expect(container).toHaveTextContent('1:1'));
  sources()[0]?.emit({ type: 'ready' });
  await waitFor(() => expect(useUi.getState().live).toBe(true));
  await advance(10);
  const [t0, l0] = [count('/api/topic/demo'), count('/api/topics')];

  rev = 2;
  sources()[0]?.emit({ type: 'changed', data: JSON.stringify({ slug: 'demo', rev: 2 }) });
  await waitFor(() => expect(container).toHaveTextContent('1:2')); // タイマーは進めていない
  expect(count('/api/topic/demo')).toBe(t0 + 1);
  expect(count('/api/topics')).toBe(l0 + 1);
  expect(
    calls
      .filter((c) => c.path === '/api/topic/demo')
      .at(-1)
      ?.query.get('since'),
  ).toBe('1');
});

test('changed（topics）：一覧だけ取り直す。持っている rev と同じ通知は、トピックを取り直さない', async () => {
  const { container } = mount();
  await waitFor(() => expect(container).toHaveTextContent('1:1'));
  sources()[0]?.emit({ type: 'ready' });
  await waitFor(() => expect(useUi.getState().live).toBe(true));
  await advance(10);
  const [t0, l0] = [count('/api/topic/demo'), count('/api/topics')];

  sources()[0]?.emit({ type: 'changed', data: '{"topics":true}' });
  await waitFor(() => expect(count('/api/topics')).toBe(l0 + 1));
  sources()[0]?.emit({ type: 'changed', data: '{"slug":"demo","rev":1}' }); // すでに持っている rev
  await waitFor(() => expect(count('/api/topics')).toBe(l0 + 2));
  await advance(50);
  expect(count('/api/topic/demo')).toBe(t0);
});

test('読めない通知は、全体を取り直す', async () => {
  mount();
  await waitFor(() => expect(count('/api/topic/demo')).toBe(1));
  sources()[0]?.emit({ type: 'ready' });
  await waitFor(() => expect(count('/api/topic/demo')).toBe(2));
  sources()[0]?.emit({ type: 'changed', data: '{壊れた' });
  await waitFor(() => expect(count('/api/topic/demo')).toBe(3));
  sources()[0]?.emit({ type: 'changed', data: '{"x":1}' });
  await waitFor(() => expect(count('/api/topic/demo')).toBe(4));
});

test('error（切れた）：ポーリングに戻る。再接続の ready で、また止まり、全体を取り直す', async () => {
  mount();
  await waitFor(() => expect(count('/api/topic/demo')).toBe(1));
  const es = sources()[0];
  es?.emit({ type: 'ready' });
  await waitFor(() => expect(count('/api/topic/demo')).toBe(2));
  await advance(POLL_MS * 3);
  expect(count('/api/topic/demo')).toBe(2);

  es?.emit({ type: 'error' }); // ワーカーの EventSource は、自動で再接続を試す（そのたびに error）
  expect(useUi.getState().live).toBe(false);
  // つながっていたものが切れた 1 回だけ、すぐ取り直す（1.5 秒を待たず、切れたことを見せる）
  await waitFor(() => expect(count('/api/topic/demo')).toBe(3));
  es?.emit({ type: 'error' }); // 再接続の失敗の error は、取り直しを、増やさない
  es?.emit({ type: 'error' });
  await advance(50);
  expect(count('/api/topic/demo')).toBe(3);
  await advance(POLL_MS + 50);
  expect(count('/api/topic/demo')).toBe(4);
  await advance(POLL_MS);
  expect(count('/api/topic/demo')).toBe(5);

  rev = 3; // 切れていた間の変化
  es?.emit({ type: 'ready' });
  await waitFor(() => expect(useUi.getState().live).toBe(true));
  await waitFor(() => expect(count('/api/topic/demo')).toBe(6));
  expect(sources(), '再接続は、ワーカーが行う：新しいワーカーを、作らない').toHaveLength(1);
  const total = calls.length;
  await advance(POLL_MS * 5);
  expect(calls.length).toBe(total);
});

test('つながっていても、通知による取り直しが失敗したら、ポーリングに戻る。成功したら、また止まる', async () => {
  let fail = false;
  const { calls: cs } = mockFetch((req) => {
    if (fail) throw new TypeError('Failed to fetch');
    if (req.path === '/api/topics') return { body: [summary('demo', { rev })] };
    if (req.path === '/api/topic/demo')
      return { body: req.query.get('since') === String(rev) ? { unchanged: true, rev } : topicState({ rev }) };
    return undefined;
  });
  calls = cs;
  const { container } = mount();
  await waitFor(() => expect(container).toHaveTextContent('1:1'));
  sources()[0]?.emit({ type: 'ready' });
  await waitFor(() => expect(useUi.getState().live).toBe(true));
  await advance(POLL_MS * 3);
  const total = calls.length;

  fail = true;
  rev = 2;
  sources()[0]?.emit({ type: 'changed', data: JSON.stringify({ slug: 'demo', rev: 2 }) }); // この取り直しが、失敗する（次の通知は、いつ来るか分からない）
  await waitFor(() => expect(calls.length).toBeGreaterThan(total));
  const failed = calls.length;
  await advance(POLL_MS + 50);
  expect(calls.length, '失敗の間は、ポーリングに戻る').toBeGreaterThan(failed);

  fail = false;
  await advance(POLL_MS + 50);
  await waitFor(() => expect(container).toHaveTextContent('1:2'));
  await advance(50);
  const ok = calls.length;
  await advance(POLL_MS * 5);
  expect(calls.length, '成功したら、また止まる').toBe(ok);
});

test('アンマウントで、bye を送って、ポートを閉じる。印も下ろす', async () => {
  const { unmount } = mount();
  await waitFor(() => expect(sources()).toHaveLength(1));
  sources()[0]?.emit({ type: 'ready' });
  expect(useUi.getState().live).toBe(true);
  unmount();
  expect(open()).toHaveLength(0);
  expect(sources()[0]?.sent).toEqual([{ type: 'bye' }]);
  expect(useUi.getState().live).toBe(false);
});

test('ページを離れる（pagehide）：bye を送る。ワーカーが、ポートを解ける', async () => {
  mount();
  await waitFor(() => expect(sources()).toHaveLength(1));
  window.dispatchEvent(new Event('pagehide'));
  expect(sources()[0]?.sent).toEqual([{ type: 'bye' }]);
});

test('ワーカーの失敗（onerror・onmessageerror）：印を下ろして、ポーリングに戻る', async () => {
  mount();
  await waitFor(() => expect(count('/api/topic/demo')).toBe(1));
  const w = sources()[0];
  w?.emit({ type: 'ready' });
  expect(useUi.getState().live).toBe(true);
  w?.onerror?.(new Event('error'));
  expect(useUi.getState().live).toBe(false);
  w?.emit({ type: 'ready' });
  expect(useUi.getState().live).toBe(true);
  w?.port.onmessageerror?.(new Event('messageerror'));
  expect(useUi.getState().live).toBe(false);
  await advance(POLL_MS * 2 + 100);
  expect(count('/api/topic/demo')).toBeGreaterThanOrEqual(4);
});

test('StrictMode（効果が二重に走る）でも、開いている接続は 1 つだけ。アンマウントで 0', async () => {
  const { unmount } = mount(true);
  await waitFor(() => expect(open()).toHaveLength(1));
  expect(sources().length).toBeGreaterThanOrEqual(2); // 作って、閉じて、作り直す
  expect(sources().filter((s) => s.closed)).toHaveLength(sources().length - 1);
  // 閉じた接続の通知は、効かない
  sources()[0]?.emit({ type: 'ready' });
  expect(useUi.getState().live).toBe(false);
  open()[0]?.emit({ type: 'ready' });
  expect(useUi.getState().live).toBe(true);
  unmount();
  expect(open()).toHaveLength(0);
});

test('SharedWorker がない環境：SSE は使わない（タブごとの EventSource に戻さない）。ポーリングだけで動く', async () => {
  const created: string[] = [];
  vi.stubGlobal(
    'EventSource',
    class {
      constructor(url: string) {
        created.push(url);
      }
    },
  );
  vi.stubGlobal('SharedWorker', undefined);
  mount();
  await waitFor(() => expect(count('/api/topic/demo')).toBe(1));
  await advance(POLL_MS + 50);
  expect(count('/api/topic/demo')).toBe(2);
  expect(useUi.getState().live).toBe(false);
  expect(created).toEqual([]);
});

test('SharedWorker を作れない（例外）：ポーリングだけで動く。EventSource も作らない', async () => {
  FakeSharedWorker.failOnCreate = true;
  const created: string[] = [];
  vi.stubGlobal(
    'EventSource',
    class {
      constructor(url: string) {
        created.push(url);
      }
    },
  );
  mount();
  await waitFor(() => expect(count('/api/topic/demo')).toBe(1));
  await advance(POLL_MS + 50);
  expect(count('/api/topic/demo')).toBe(2);
  expect(created).toEqual([]);
});
