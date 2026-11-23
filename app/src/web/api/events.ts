// サーバーからの通知（SSE：`GET /api/events`）。「変わった」という通知だけを受け、既存の取得（`since` つき）をすぐ実行する。データは、受けない。
// **接続は、ブラウザ全体で 1 本**：SharedWorker（`eventsWorker.ts`）が `EventSource` を持ち、タブは、ワーカーのメッセージを受ける。
// （タブごとに持つと、Chrome の 1 オリジン 6 接続の枠を、6 タブで使い切り、すべてのタブが止まる。SharedWorker がなければ、SSE は使わず、取得だけで動く：タブごとの EventSource には、戻さない）
// - `ready`（つながった直後・再接続のあと・新しいタブがつながった時点で、すでにつながっているとき）：つながっている印（`ui.live`）を立て、全体を 1 回取り直す
// - `changed`：`{topics:true}` なら一覧・`{slug,rev}` なら、そのトピック（と、一覧：`pending`・`progress` が変わる）を取り直す
// - `error`（切れた・再接続の途中）：印を下ろす → 1.5 秒ごとの取得（queries.ts）に戻る。つながっていたものが切れた 1 回だけ、すぐ取り直す（切れたことを、すぐ見せる）
// - ワーカーの失敗（`onerror`・`onmessageerror`・作れない）：印を下ろす（取得に戻る）
// 接続は、`App` が 1 回だけ持つ（`useServerEvents`）。アンマウント・ページを離れるときに、`bye` を送って、ポートを閉じる（StrictMode の二重の効果でも、残らない）。
import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { ChangedEvent } from '../../shared/api';
import { useUi } from '../store/ui';
import type { FromWorker, ToWorker } from './eventsWorker';
import { type TopicState, topicKey, topicsKey } from './queries';

const refetchTopics = (client: QueryClient): Promise<void> => client.invalidateQueries({ queryKey: topicsKey });

/** 全体：一覧と、いま持っているトピックのすべて（`['topic', slug]`） */
const refetchAll = (client: QueryClient): Promise<void> =>
  client.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'topics' || q.queryKey[0] === 'topic' });

/** `changed` の本体を、確かめる（形は 2 つだけ）。読めなければ null */
function parseChanged(raw: string): ChangedEvent | null {
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v !== 'object' || v === null) return null;
    const o = v as Record<string, unknown>;
    if (o.topics === true) return { topics: true };
    if (typeof o.slug === 'string' && typeof o.rev === 'number') return { slug: o.slug, rev: o.rev };
  } catch {}
  return null;
}

function onChanged(client: QueryClient, raw: string): void {
  const e = parseChanged(raw);
  // 読めない通知は、何が変わったか分からない：全体を取り直す
  if (!e) return void refetchAll(client);
  if ('topics' in e) return void refetchTopics(client);
  // 一覧には、トピックの状態（pending・progress・closed）が出るので、一覧も取り直す。トピックは、持っている rev が同じなら、取り直さない（自分の操作のあとなど）
  void refetchTopics(client);
  if (client.getQueryData<TopicState>(topicKey(e.slug))?.rev !== e.rev)
    void client.invalidateQueries({ queryKey: topicKey(e.slug) });
}

export function useServerEvents(): void {
  const client = useQueryClient();
  useEffect(() => {
    if (typeof SharedWorker === 'undefined') return; // 取得だけで動く
    const { setLive } = useUi.getState();
    let worker: SharedWorker;
    try {
      worker = new SharedWorker(new URL('./eventsWorker.ts', import.meta.url), {
        type: 'module',
        name: 'rikai-events',
      });
    } catch {
      return;
    }
    const port = worker.port;
    const fail = (): void => setLive(false);
    worker.onerror = fail;
    port.onmessageerror = fail;
    port.onmessage = (e: MessageEvent<FromWorker>) => {
      const m = e.data;
      if (m.type === 'ready') {
        setLive(true);
        void refetchAll(client);
      } else if (m.type === 'changed') {
        onChanged(client, m.data);
      } else if (m.type === 'error') {
        const wasLive = useUi.getState().live;
        setLive(false);
        if (wasLive) void refetchAll(client);
      }
    };
    port.start();
    const bye = (): void => port.postMessage({ type: 'bye' } satisfies ToWorker);
    window.addEventListener('pagehide', bye);
    return () => {
      window.removeEventListener('pagehide', bye);
      bye();
      port.close();
      setLive(false);
    };
  }, [client]);
}
