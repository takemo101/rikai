// ブラウザの通知（F41・F46）：サーバーの更新（SSE：F38）を、前回の状態と比べて、AI の新着が増えたときだけ、OS の通知を出す。
// 見る経路は 2 つ（**同じ ID の集合（`Snapshot`）を、トピックごとの `last` で共有する**：二重の通知・洩れを防ぐ）：
// - **開いているトピック**：トピックの取得が成功したとき（クエリのキャッシュ）。取得した全体から作る（上限なし）
// - **ほかのトピック**（F46）：一覧（`/api/topics`）の取得が成功したとき。トピックごとの `fresh`（サーバーが、上限つきで作る ID の要約）から作る。
//   開いているトピック（トピックの取得を、いま見ているもの）は、一覧の経路から除く（二重に通知しない）。閉じたトピック・`fresh` のないもの（読めない・上限を超えた）は、対象外
// - 一覧の `fresh` の窓は、通知の対象のトピックの数で決まる（`fresh.window`）。**窓が広がったときは、そのトピックをベースラインにする**（古い ID が、新しく窓に入って、新着に見えるため）。件数が窓に達したら、「以上」と出す
// - **最初の読み込み・再接続の直後は、通知しない**（ベースラインを取るだけ）：トピックごとに、最初の 1 回・つながり直した（`ui.live` が立った）あとの最初の 1 回・**一覧に新しく現れた**とき・
//   **取得元が、一覧からトピックに変わった**とき（トピックを開いたとき：一覧の `fresh` は、新しい側の窓だけなので、全体とは、直接、比べない。開いたトピックは、画面に見えている）
// - 判定・文言は lib/notify.ts（純粋関数）。新着は、前回までに知っていた ID との差（既読・解決の取り消し・メッセージの削除では、出ない）
// - 同じトピックの通知は、`tag` で置き換わる（前の件数が消える）ので、画面を見ていない間に溜まった新着を、累計で出す（トピックごと）。画面が見える状態に戻ったら、0 に戻す
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { type TopicState, type TopicSummary, topicKey, topicsKey } from '../api/queries';
import {
  addDelta,
  type Delta,
  isHidden,
  permissionNow,
  type Snapshot,
  shouldNotify,
  showNotification,
  snapshotFromFresh,
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

/** 前回の見た状態と、その取得元（一覧の `fresh` は、新しい側の窓だけ：トピックの全体とは、混ぜて比べない） */
interface Seen {
  snap: Snapshot;
  from: 'topic' | 'list';
}

export function useBrowserNotify(): void {
  const client = useQueryClient();
  useEffect(() => {
    /** トピックごとの、前回の見た状態 */
    const last = new Map<string, Seen>();
    /** 画面を見なくなってから、通知した新着の累計（トピックごと） */
    const total = new Map<string, Delta>();
    /** つながり直したので、次の取得の結果は、ベースラインにするトピック */
    const rebase = new Set<string>();
    /** いま、トピックの取得を見ている（開いている）トピックか */
    const isOpen = (slug: string): boolean =>
      (client
        .getQueryCache()
        .find({ queryKey: topicKey(slug), exact: true })
        ?.getObserversCount() ?? 0) > 0;

    /** 1 つのトピックの、新しい状態を見る（2 つの経路の、共通の部分） */
    const consider = (slug: string, title: string, next: Snapshot, from: Seen['from']): void => {
      const seen = last.get(slug);
      const rebased = rebase.delete(slug);
      // ベースライン：前回がない・つながり直し・一覧から、トピックに変わった（開いた）
      // 窓が広がった（トピックが減った）：古い ID が、新しく窓に入り、新着に見える：ベースライン（狭まるだけなら、古い ID が窓から消えるだけ）
      const widened = from === 'list' && seen?.from === 'list' && (next.window ?? 0) > (seen.snap.window ?? 0);
      const prev = rebased || !seen || widened || (from === 'topic' && seen.from === 'list') ? null : seen.snap;
      last.set(slug, { snap: next, from });
      if (!prev) total.delete(slug); // ベースライン：累計も、0
      const hidden = isHidden();
      if (!hidden) total.clear();
      const d = shouldNotify(prev, next, { enabled: useUi.getState().ui.notify, permission: permissionNow(), hidden });
      if (!d) return;
      const sum = addDelta(total.get(slug), d);
      total.set(slug, sum);
      showNotification(slug, title, sum, () => backTo(slug));
    };

    const onTopics = (list: readonly TopicSummary[]): void => {
      for (const t of list) {
        if (t.unsupported) continue;
        if (t.closed) {
          last.delete(t.slug); // 閉じたトピックは、対象外（新着がない）
          continue;
        }
        if (!t.fresh || isOpen(t.slug)) continue; // 要約のないもの・開いているトピック（トピックの取得の経路で見る）
        consider(t.slug, t.title, snapshotFromFresh(t.fresh), 'list');
      }
    };

    const unsubCache = client.getQueryCache().subscribe((e) => {
      if (e.type !== 'updated' || e.action.type !== 'success') return;
      const [kind, slug] = e.query.queryKey;
      if (kind === 'topics') {
        const list = client.getQueryData<TopicSummary[]>(topicsKey);
        if (list) onTopics(list);
        return;
      }
      if (kind !== 'topic' || typeof slug !== 'string') return;
      const topic = client.getQueryData<TopicState>(topicKey(slug));
      if (topic) consider(slug, topic.meta.title, snapshotOf(topic), 'topic');
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
