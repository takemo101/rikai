// いま見ている「ページ・版」（ルート＋トピックから決まる）。旧 app.js の `S.page`・`curVersion()`・`latestOf()`・`isLatest()` の置き場。
// 状態として別に持たない（ルートとトピックの、導出）。W1〜W3 の部品は、props の `view`（App が渡す）か、`useView()` で読む。
import type { PageInfo } from '../../shared/types';
import { type TopicState, topicKey, useTopic } from '../api/queries';
import { queryClient } from '../api/queryClient';
import { parseHash, type Route, useRoute } from './route';

export interface View {
  slug: string;
  /** ルートのページが、トピックにないとき（古いリンク）は、root */
  page: string;
  /** 見ている版（ルートに版がなければ、最新版）。ルートの `v0` も、最新版 */
  version: number;
  /** ページの最新版 */
  latest: number;
  /** 最新版を見ているか。コメントは、最新版にだけ付けられる */
  isLatest: boolean;
  /** `<slug>/<page>/<version>`。本文・差分の「どの版か」の印（DocModel.key と同じ） */
  key: string;
  topic: TopicState;
  pages: Record<string, PageInfo>;
}

/** ルートとトピックから、View を作る（どちらかがなければ null）。ルートの slug と、トピックの slug は、同じものを渡す */
export function buildView(route: Route | null, topic: TopicState | undefined): View | null {
  if (!route || !topic) return null;
  const pages = topic.meta.pages;
  const page = pages[route.page] ? route.page : 'root';
  const latest = pages[page]?.versions ?? 1;
  const version = (page === route.page ? route.version : null) || latest;
  return {
    slug: route.slug,
    page,
    version,
    latest,
    isLatest: version === latest,
    key: `${route.slug}/${page}/${version}`,
    topic,
    pages,
  };
}

/** React の外（ストアの操作）から、いまの View を読む。ハッシュと、取得済みのトピックから作る */
export function getView(): View | null {
  const route = parseHash(location.hash);
  return buildView(route, route ? queryClient.getQueryData<TopicState>(topicKey(route.slug)) : undefined);
}

export function useView(): View | null {
  const route = useRoute();
  const topic = useTopic(route?.slug ?? null);
  return buildView(route, topic.data);
}
