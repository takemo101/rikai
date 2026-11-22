// 画面のテストの道具：jsdom にない API の代用（`<dialog>`・ポインターの取り込み）・fetch の差し替え・描画・作り物のトピック。
import { QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { vi } from 'vitest';
import type { Message, Meta, Thread } from '../../src/shared/types';
import type { TopicState } from '../../src/web/api/queries';
import { queryClient } from '../../src/web/api/queryClient';
import { useDoc } from '../../src/web/store/doc';
import { initialUi, useUi } from '../../src/web/store/ui';

/**
 * jsdom にない `<dialog>` の showModal・close と、`<form method="dialog">` のボタン（submit の value が returnValue になって閉じる）を、ブラウザと同じに動かす。
 * close は、`close` イベントを出す（React の onClose）。
 */
export function installDialog(): void {
  const proto = HTMLDialogElement.prototype;
  proto.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  proto.close = function close(this: HTMLDialogElement, returnValue?: string) {
    if (!this.hasAttribute('open')) return;
    if (returnValue !== undefined) this.returnValue = returnValue;
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
  document.addEventListener('submit', (e) => {
    const form = e.target;
    if (!(form instanceof HTMLFormElement) || form.getAttribute('method') !== 'dialog') return;
    e.preventDefault();
    const dlg = form.closest('dialog');
    const submitter = (e as SubmitEvent).submitter;
    dlg?.close(submitter?.getAttribute('value') ?? undefined);
  });
}

/** jsdom にない setPointerCapture 系（ドラッグの取り込み）の代用 */
export function installPointerCapture(): void {
  const held = new WeakMap<Element, Set<number>>();
  Element.prototype.setPointerCapture = function setPointerCapture(this: Element, id: number) {
    held.set(this, (held.get(this) ?? new Set()).add(id));
  };
  Element.prototype.hasPointerCapture = function hasPointerCapture(this: Element, id: number) {
    return held.get(this)?.has(id) ?? false;
  };
  Element.prototype.releasePointerCapture = function releasePointerCapture(this: Element, id: number) {
    if (held.get(this)?.delete(id)) this.dispatchEvent(new Event('lostpointercapture', { bubbles: true }));
  };
}

export interface FakeRequest {
  method: string;
  /** クエリを除いたパス（`/api/topic/x`） */
  path: string;
  query: URLSearchParams;
  body: unknown;
}
export interface FakeResponse {
  status?: number;
  body: unknown;
}
export type FakeHandler = (req: FakeRequest) => FakeResponse | undefined | Promise<FakeResponse | undefined>;

/** fetch を差し替える。handler が undefined を返したら 404。例外（TypeError）を投げれば、接続できない扱い */
export function mockFetch(handler: FakeHandler) {
  const calls: FakeRequest[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input), 'http://127.0.0.1');
    const raw = typeof init?.body === 'string' ? init.body : '';
    const req: FakeRequest = {
      method: init?.method ?? 'GET',
      path: url.pathname,
      query: url.searchParams,
      body: raw ? (JSON.parse(raw) as unknown) : undefined,
    };
    calls.push(req);
    const r = await handler(req);
    if (!r) return new Response(JSON.stringify({ ok: false, error: 'not found' }), { status: 404 });
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  });
  vi.stubGlobal('fetch', fn);
  return { fn, calls };
}

export const meta = (over: Partial<Meta> = {}): Meta => ({
  slug: 'demo',
  title: 'デモの資料',
  source: 'test',
  createdAt: '2026-01-01T00:00:00Z',
  rev: 1,
  round: 0,
  closed: false,
  pending: [],
  pages: { root: { title: 'デモの資料', parent: null, versions: 1, createdAt: '2026-01-01T00:00:00Z' } },
  ...over,
});

export const msg = (over: Partial<Message> = {}): Message => ({
  id: 'm1',
  author: 'user',
  kind: 'comment',
  at: '2026-01-01T00:00:00Z',
  text: 'どういう意味？',
  sent: false,
  ...over,
});

export const thread = (over: Partial<Thread> = {}): Thread => ({
  id: 't1',
  page: 'root',
  version: 1,
  anchor: null,
  resolved: false,
  resolveSent: true,
  createdAt: '2026-01-01T00:00:00Z',
  origin: 'user',
  messages: [msg()],
  ...over,
});

export function topicState(over: Partial<TopicState> & { meta?: Partial<Meta> } = {}): TopicState {
  const { meta: m, ...rest } = over;
  return { rev: 1, meta: meta({ rev: over.rev ?? 1, ...m }), threads: [], unsent: 0, appframe: true, ...rest };
}

/** 一覧の 1 件（読める形式） */
export const summary = (slug: string, over: Record<string, unknown> = {}) => ({
  slug,
  title: `題 ${slug}`,
  closed: false,
  pending: 0,
  rev: 1,
  progress: null,
  unsupported: false as const,
  ...over,
});

/** 全部の状態を、初期に戻す（テストの間で、持ち越さない） */
export function resetAll(): void {
  localStorage.clear();
  queryClient.clear();
  useUi.setState(initialUi());
  useDoc.setState({ model: null });
  location.hash = '';
}

export function renderWithClient(ui: ReactElement) {
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}
