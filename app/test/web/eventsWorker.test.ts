// @vitest-environment jsdom
// 通知の SharedWorker（api/eventsWorker.ts）：EventSource は 1 本だけ・全部のポートへ配る・新しいポートに、いまの状態を返す・bye でポートを解き、0 になったら閉じる。
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

class FakeEventSource {
  static all: FakeEventSource[] = [];
  closed = false;
  private handlers = new Map<string, Array<(e: Event) => void>>();
  constructor(readonly url: string) {
    FakeEventSource.all.push(this);
  }
  addEventListener(type: string, fn: (e: Event) => void): void {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), fn]);
  }
  close(): void {
    this.closed = true;
  }
  emit(type: string, data?: string): void {
    const e = data === undefined ? new Event(type) : Object.assign(new Event(type), { data });
    for (const fn of this.handlers.get(type) ?? []) fn(e);
  }
}

interface FakePort {
  got: unknown[];
  closed: boolean;
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage(m: unknown): void;
  close(): void;
}
const newPort = (): FakePort => ({
  got: [],
  closed: false,
  onmessage: null,
  postMessage(m) {
    this.got.push(m);
  },
  close() {
    this.closed = true;
  },
});
const connect = (port: FakePort): void =>
  (self as unknown as { onconnect: (e: unknown) => void }).onconnect({ ports: [port] });
const bye = (port: FakePort): void => port.onmessage?.({ data: { type: 'bye' } } as MessageEvent);
const es = () => FakeEventSource.all;

beforeEach(async () => {
  FakeEventSource.all = [];
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.resetModules();
  await import('../../src/web/api/eventsWorker');
});
afterEach(() => vi.unstubAllGlobals());

test('接続は 1 本だけ：何本のタブがつながっても、EventSource は 1 つ（/api/events）', () => {
  const [a, b, c] = [newPort(), newPort(), newPort()];
  for (const p of [a, b, c]) connect(p);
  expect(es()).toHaveLength(1);
  expect(es()[0]?.url).toBe('/api/events');
});

test('ready・changed（本体は、そのまま）・error を、全部のポートへ配る', () => {
  const [a, b] = [newPort(), newPort()];
  connect(a);
  connect(b);
  es()[0]?.emit('ready');
  es()[0]?.emit('changed', '{"slug":"demo","rev":3}');
  es()[0]?.emit('error');
  for (const p of [a, b])
    expect(p.got).toEqual([{ type: 'ready' }, { type: 'changed', data: '{"slug":"demo","rev":3}' }, { type: 'error' }]);
});

test('新しいポートには、いまの状態を、すぐ返す（つながっていれば ready・切れていれば error・まだなら、何も送らない）', () => {
  const a = newPort();
  connect(a);
  const early = newPort();
  connect(early);
  expect(early.got).toEqual([]);
  es()[0]?.emit('ready');
  const late = newPort();
  connect(late);
  expect(late.got).toEqual([{ type: 'ready' }]);
  es()[0]?.emit('error');
  const later = newPort();
  connect(later);
  expect(later.got).toEqual([{ type: 'error' }]);
  es()[0]?.emit('ready');
  expect(later.got.at(-1)).toEqual({ type: 'ready' });
  expect(es()).toHaveLength(1);
});

test('bye：そのポートを解き（閉じる・以後、送らない）、ほかのポートは続く。0 になったら EventSource を閉じ、次のポートが、新しく開く', () => {
  const [a, b] = [newPort(), newPort()];
  connect(a);
  connect(b);
  es()[0]?.emit('ready');
  bye(a);
  expect(a.closed).toBe(true);
  es()[0]?.emit('changed', '{"topics":true}');
  expect(a.got).toEqual([{ type: 'ready' }]);
  expect(b.got).toHaveLength(2);
  expect(es()[0]?.closed).toBe(false);
  bye(a); // 二重の bye は、害がない
  bye(b);
  expect(b.closed).toBe(true);
  expect(es()[0]?.closed).toBe(true);

  const c = newPort();
  connect(c);
  expect(es()).toHaveLength(2);
  expect(c.got).toEqual([]); // 前の状態（ready）を、持ち越さない
});
