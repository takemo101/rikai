// 読み取り：トピックの一覧・トピックの状態・ページの本文。サーバーの状態は、ここ（TanStack Query）だけが持つ。
// - useTopics：1.5 秒ごと
// - useTopic：1.5 秒ごと。`?since=<rev>` で送り、`{unchanged:true}` なら、前のデータ（同じ参照）を返す。失敗は query.error（status なし＝接続できない・あり＝サーバーのエラー）
// - usePage：版は変わらないので、staleTime: Infinity
import { type QueryClient, type UseQueryResult, useQuery } from '@tanstack/react-query';
import type { InferResponseType } from 'hono/client';
import type { Meta, Thread } from '../../shared/types';
import { api, read } from './client';
import { POLL_MS } from './queryClient';

type TopicsResponse = InferResponseType<typeof api.api.topics.$get, 200>;
type TopicResponse = InferResponseType<(typeof api.api.topic)[':slug']['$get'], 200>;

/** 一覧の 1 件：読める形式（unsupported: false）か、読めない新しい形式（unsupported: true） */
export type TopicSummary = TopicsResponse[number];
/** 一覧の、読める形式の 1 件（理解の進み具合と、状態を持つ） */
export type SupportedSummary = Extract<TopicSummary, { unsupported: false }>;
/** トピックの状態。appframe は、このサーバーが、実行できる枠（/appframe）を配れること（古いサーバーを見分ける） */
export type TopicState = Extract<TopicResponse, { meta: Meta }> & { meta: Meta; threads: Thread[] };

export const topicsKey = ['topics'] as const;
export const topicKey = (slug: string) => ['topic', slug] as const;
export const pageKey = (slug: string, page: string, version: number) => ['page', slug, page, version] as const;

async function fetchTopics(): Promise<TopicSummary[]> {
  return read<TopicsResponse>(await api.api.topics.$get());
}

async function fetchTopic(slug: string, since: number | undefined): Promise<TopicResponse> {
  const query = since === undefined ? {} : { since: String(since) };
  return read<TopicResponse>(await api.api.topic[':slug'].$get({ param: { slug }, query }));
}

/**
 * トピックを取る。force なら since を付けない（操作のあと：旧 refreshTopic(true)）。
 * 変わっていなければ、前のデータ（同じ参照）を返すので、読む側は、再描画しない
 */
export async function loadTopic(client: QueryClient, slug: string, force: boolean): Promise<TopicState> {
  const prev = client.getQueryData<TopicState>(topicKey(slug));
  const d = await fetchTopic(slug, force ? undefined : prev?.rev);
  if ('unchanged' in d) {
    if (prev) return prev;
    // 前のデータがない（取り直しの間に消えた）：全部を取る
    return loadTopic(client, slug, true);
  }
  return d;
}

/** 操作のあと、すぐ、取り直す。取得の途中のものは、捨てる（古い応答が、新しいデータを上書きしないように） */
export async function refreshTopic(client: QueryClient, slug: string): Promise<TopicState> {
  await client.cancelQueries({ queryKey: topicKey(slug) });
  const d = await loadTopic(client, slug, true);
  return client.setQueryData<TopicState>(topicKey(slug), d) ?? d; // 同じ内容なら、前の参照が返る（structural sharing）
}

export function useTopics(): UseQueryResult<TopicSummary[]> {
  return useQuery({ queryKey: topicsKey, queryFn: fetchTopics, refetchInterval: POLL_MS });
}

/** slug が null の間は、取らない（トピックを開いていない・読めない形式） */
export function useTopic(slug: string | null): UseQueryResult<TopicState> {
  return useQuery({
    queryKey: topicKey(slug ?? ''),
    enabled: slug !== null,
    refetchInterval: POLL_MS,
    queryFn: ({ client }) => loadTopic(client, slug ?? '', false),
  });
}

/** ページの、ある版の Markdown。slug が null か、版が 1 未満なら、取らない */
export function usePage(slug: string | null, page: string, version: number): UseQueryResult<string> {
  return useQuery({
    queryKey: pageKey(slug ?? '', page, version),
    enabled: slug !== null && version >= 1,
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: async () => {
      const r = await read<{ markdown: string }>(
        await api.api.page[':slug'][':page'][':v'].$get({
          param: { slug: slug ?? '', page, v: String(version) },
        }),
      );
      return r.markdown;
    },
  });
}
