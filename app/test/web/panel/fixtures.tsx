// パネルのテストの道具：作り物のサーバー（POST を受けて、スレッドを書き換える）・View を読む入れ物・DocModel・メッセージの作り方。
import { vi } from 'vitest';
import type { Anchor, Message, Thread } from '../../../src/shared/types';
import { type TopicState, topicKey, useTopic } from '../../../src/web/api/queries';
import { queryClient } from '../../../src/web/api/queryClient';
import { buildView } from '../../../src/web/lib/view';
import { ThreadsPanel } from '../../../src/web/panel/ThreadsPanel';
import { type DocModel, type ThreadLoc, useDoc } from '../../../src/web/store/doc';
import { type FakeRequest, meta, mockFetch, msg, renderWithClient, thread, topicState } from '../helpers';

export { meta, msg, thread, topicState };

export const anchor = (quote = '引用の文', over: Partial<Anchor> = {}): Anchor => ({
  blockId: 'b1',
  blockHash: 'h1',
  blockTag: 'p',
  blockText: quote,
  quote,
  prefix: '',
  suffix: '',
  label: quote,
  ...over,
});

let seq = 0;
/** 発言：id は、連番（指定しなければ） */
export const say = (over: Partial<Message> = {}): Message => msg({ id: `m${++seq}`, ...over });
export const ai = (text: string, over: Partial<Message> = {}): Message =>
  say({ author: 'ai', kind: 'reply', text, sent: true, ...over });
export const user = (text: string, over: Partial<Message> = {}): Message =>
  say({ author: 'user', kind: 'comment', text, sent: true, ...over });

/** DocModel（本文の位置）：`locs` は、スレッド ID → 要素（ブロック）か、見つからない（null）。番号は、与えたものだけ */
export function docModel(
  key: string,
  locs: Record<string, HTMLElement | null>,
  opts: {
    nums?: Record<string, number>;
    pending?: HTMLElement | null;
    approx?: Record<string, 'similar' | 'position'>;
  } = {},
): DocModel {
  const map = new Map<string, ThreadLoc>();
  for (const [tid, el] of Object.entries(locs)) map.set(tid, el ? { kind: 'block', el } : { kind: 'none' });
  return {
    epoch: 1,
    key,
    blocks: [],
    locs: map,
    nums: new Map(Object.entries(opts.nums ?? {})),
    approx: new Map(Object.entries(opts.approx ?? {})),
    pending: opts.pending ?? null,
    diff: null,
  };
}

export interface Post {
  path: string;
  body: Record<string, unknown>;
}

export interface Harness {
  pages: Record<string, { title: string; parent: string | null; versions: number; createdAt: string }>;
  /** 受けた POST（操作） */
  posts: Post[];
  /** サーバーの、いまのスレッド（POST のたびに、`onPost` が書き換える） */
  server: { threads: Thread[] };
  all: FakeRequest[];
}

type OnPost = (
  path: string,
  body: Record<string, unknown>,
  server: Harness['server'],
) => Record<string, unknown> | undefined | Promise<Record<string, unknown> | undefined>;

function Panel({ page, version }: { page: string; version: number | null }) {
  const topic = useTopic('demo');
  const view = buildView({ slug: 'demo', page, version }, topic.data);
  return <ThreadsPanel view={view} />;
}

/**
 * パネルを、作り物のサーバー（fetch の差し替え）つきで描く。ルートは `#/demo/<page>`（`startComposer` が、最新版かを、ここから見る）。
 * `onPost`：POST を受けたときの、サーバーの変化と、返す JSON（既定：`{ok: true}`）
 */
export function renderPanel(
  threads: Thread[],
  opts: { onPost?: OnPost; versions?: number; version?: number | null; page?: string } = {},
): Harness & ReturnType<typeof renderWithClient> {
  const page = opts.page ?? 'root';
  const versions = opts.versions ?? 1;
  const server = { threads };
  const posts: Post[] = [];
  const all: FakeRequest[] = [];
  const pages = {
    root: { title: 'デモの資料', parent: null, versions, createdAt: '2026-01-01T00:00:00Z' },
    sub: { title: '子ページ', parent: 'root', versions: 1, createdAt: '2026-01-01T00:00:00Z' },
  };
  const state = (): TopicState => ({ ...topicState({ rev: 1, threads: server.threads }), meta: meta({ pages }) });
  mockFetch(async (req) => {
    all.push(req);
    if (req.method === 'POST') {
      const body = (req.body ?? {}) as Record<string, unknown>;
      posts.push({ path: req.path, body });
      return { body: { ok: true, ...(await opts.onPost?.(req.path, body, server)) } };
    }
    if (req.path === '/api/topic/demo') return { body: state() };
    return undefined;
  });
  queryClient.setQueryData(topicKey('demo'), state());
  location.hash = `#/demo/${page}${opts.version ? `/v${opts.version}` : ''}`;
  const r = renderWithClient(<Panel page={page} version={opts.version ?? null} />);
  return { ...r, posts, server, all, pages };
}

/** 本文の要素（ブロック）を、文書に置く。位置の順を、`compareDocumentPosition` で、使えるように */
export function blocks(n: number): HTMLElement[] {
  const art = document.createElement('article');
  document.body.append(art);
  return Array.from({ length: n }, (_, i) => {
    const p = document.createElement('p');
    p.textContent = `段落 ${i + 1}`;
    art.append(p);
    return p;
  });
}

export function stubScroll(): ReturnType<typeof vi.fn> {
  const fn = vi.fn();
  Element.prototype.scrollIntoView = fn;
  return fn;
}

export function modelFor(...args: Parameters<typeof docModel>): void {
  useDoc.setState({ model: docModel(...args) });
}
