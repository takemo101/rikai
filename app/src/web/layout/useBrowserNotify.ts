// ブラウザの通知（F41）：サーバーの更新（SSE：F38。取り直したトピック）を、前回の状態と比べて、増えたときだけ、OS の通知を出す。
// - 見るのは、トピックの取得が成功したとき（クエリのキャッシュ）：開いているトピックだけ（ほかのトピックの AI の新着は、画面から分からない：F39 の制約）
// - **最初の読み込み・再接続の直後は、通知しない**（ベースラインを取るだけ）：トピックごとに、最初の 1 回と、つながり直した（`ui.live` が立った）あとの最初の 1 回
// - 判定・文言は lib/notify.ts（純粋関数）。新着は、前回までに知っていた ID との差（既読・解決の取り消し・メッセージの削除では、出ない）。未回答の質問の判定は、lib/turn.ts（F39）と同じ関数
// - 同じトピックの通知は、`tag` で置き換わる（前の件数が消える）ので、画面を見ていない間に溜まった新着を、累計で出す。画面が見える状態に戻ったら、0 に戻す
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { type TopicState, topicKey } from '../api/queries';
import {
  addDelta,
  type Delta,
  isHidden,
  permissionNow,
  type Snapshot,
  shouldNotify,
  showNotification,
  snapshotOf,
} from '../lib/notify';
import { navigate } from '../lib/route';
import { turnOfTopic } from '../lib/turn';
import { getView } from '../lib/view';
import { useUi } from '../store/ui';
import { goToTurn } from './TurnPill';

/** 通知を押したとき：画面へ戻って、そのトピックの、最初の項目（新着の返信・未回答の質問）へ。ほかのトピックを見ていたら、そのトピックを開く */
function backTo(slug: string): void {
  const v = getView();
  if (!v || v.slug !== slug) {
    navigate(slug);
    return;
  }
  const t = v.topic;
  const turn = turnOfTopic({
    threads: t.threads,
    unsent: t.unsent,
    pending: t.meta.pending?.length ?? 0,
    closed: t.meta.closed,
    seen: useUi.getState().seen,
  });
  if (turn.kind === 'your-turn' || turn.kind === 'open') goToTurn(v, turn);
}

export function useBrowserNotify(): void {
  const client = useQueryClient();
  useEffect(() => {
    /** トピックごとの、前回の見た状態 */
    const last = new Map<string, Snapshot>();
    /** 画面を見なくなってから、通知した新着の累計（トピックごと） */
    const total = new Map<string, Delta>();
    /** つながり直したので、次の取得の結果は、ベースラインにするトピック */
    const rebase = new Set<string>();
    const unsubCache = client.getQueryCache().subscribe((e) => {
      if (e.type !== 'updated' || e.action.type !== 'success') return;
      const [kind, slug] = e.query.queryKey;
      if (kind !== 'topic' || typeof slug !== 'string') return;
      const topic = client.getQueryData<TopicState>(topicKey(slug));
      if (!topic) return;
      const next = snapshotOf(topic);
      const rebased = rebase.delete(slug);
      const prev = rebased ? null : (last.get(slug) ?? null);
      last.set(slug, next);
      if (!prev) total.delete(slug); // ベースライン（最初の取得・つながり直し）：累計も、0
      const hidden = isHidden();
      if (!hidden) total.clear();
      const d = shouldNotify(prev, next, { enabled: useUi.getState().ui.notify, permission: permissionNow(), hidden });
      if (!d) return;
      const sum = addDelta(total.get(slug), d);
      total.set(slug, sum);
      showNotification(slug, topic.meta.title, sum, () => backTo(slug));
    });
    const unsubUi = useUi.subscribe((s, prev) => {
      if (s.live && !prev.live) for (const slug of last.keys()) rebase.add(slug);
    });
    // 画面が見える状態に戻った：累計を、0 に戻す
    const onVisible = (): void => {
      if (!isHidden()) total.clear();
    };
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      unsubCache();
      unsubUi();
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [client]);
}
