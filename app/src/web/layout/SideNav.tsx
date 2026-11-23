// 左の一覧（`#side`）：理解の対象（トピック）と、開いているトピックのページの木。
// 読めない新しい形式のトピックは、押せない（「新しい形式」の印）。ほかの印：解決/全スレッド・待ち・終了。
import {
  CircleCheck,
  CircleDot,
  CircleUser,
  CornerDownRight,
  FileText,
  Hourglass,
  Send,
  TriangleAlert,
} from 'lucide-react';
import { progressOf } from '../../shared/progress';
import type { TopicSummary } from '../api/queries';
import { hrefOf } from '../lib/route';
import { type Turn, turnLabel, turnOfSummary, turnOfTopic } from '../lib/turn';
import type { View } from '../lib/view';
import { useUi } from '../store/ui';

export interface SideNavProps {
  topics: readonly TopicSummary[];
  /** 開いているトピック（ルートの slug。読めない形式のトピックを選んでいる間は null） */
  currentSlug: string | null;
  /** 取得済みのトピックと、見ているページ（なければ null：ページの木は、出さない） */
  view: View | null;
}

export function SideNav({ topics, currentSlug, view }: SideNavProps) {
  const seen = useUi((s) => s.seen);
  return (
    <aside id="side">
      <div className="side-h">理解の対象</div>
      <ul className="topics">
        {topics.map((t) => {
          // 開いているトピックは、画面が持っている最新のスレッドから数える（一覧の更新を待たず、上のバーと食い違わない）
          const p = t.unsupported ? null : t.slug === currentSlug && view ? progressOf(view.topic.threads) : t.progress;
          // いま、誰の番か：開いているトピックは、上のバーの `#turn` と同じ判定（スレッドの中身まで）。ほかのトピックは、一覧の要約だけ
          const turn: Turn | null = t.unsupported
            ? null
            : t.slug === currentSlug && view
              ? turnOfTopic({
                  threads: view.topic.threads,
                  unsent: view.topic.unsent,
                  pending: view.topic.meta.pending?.length ?? 0,
                  closed: view.topic.meta.closed,
                  seen,
                })
              : turnOfSummary(t);
          return (
            <li key={t.slug} className={t.slug === currentSlug ? 'cur' : ''}>
              {t.unsupported ? (
                <span className="topic-off">
                  <FileText aria-hidden="true" focusable="false" />
                  <span className="t">{t.title}</span>
                </span>
              ) : (
                <a href={hrefOf(t.slug)}>
                  <FileText aria-hidden="true" focusable="false" />
                  <span className="t">{t.title}</span>
                </a>
              )}
              {p?.threads.total ? (
                <span className="chip small" title="解決したスレッド / 全スレッド">
                  {p.threads.resolved}/{p.threads.total}
                </span>
              ) : null}
              {turn ? <TurnMark turn={turn} /> : null}
              {t.unsupported ? (
                <span
                  className="chip warn small"
                  title="この rikai が読めない、新しい形式です。rikai を更新してください"
                >
                  <TriangleAlert aria-hidden="true" focusable="false" />
                  新しい形式
                </span>
              ) : null}
              {!t.unsupported && t.closed ? (
                <span className="chip small">
                  <CircleCheck aria-hidden="true" focusable="false" />
                  終了
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
      {view ? <PageTree view={view} /> : null}
    </aside>
  );
}

/**
 * 左の一覧の、トピックごとの印（`#turn` と同じ色・意味）。**どの幅でも、アイコンだけ**（題を縮めないため。名前は `title`・`aria-label`）。
 * 例外：AI の返信待ちは、従来の「待ち」（短い文字つき）
 */
function TurnMark({ turn }: { turn: Turn }) {
  if (turn.kind === 'waiting-ai')
    return (
      <span className="chip wait small">
        <Hourglass aria-hidden="true" focusable="false" />
        待ち
      </span>
    );
  const name =
    turn.kind === 'your-turn'
      ? 'あなたの番'
      : turn.kind === 'open'
        ? turnLabel(turn)
        : turn.kind === 'unsent'
          ? `${turnLabel(turn)}。Submit`
          : turn.kind === 'done'
            ? 'すべて解決'
            : '';
  if (!name) return null;
  const Icon = { 'your-turn': CircleUser, open: CircleDot, unsent: Send, done: CircleCheck }[
    turn.kind as 'your-turn' | 'open' | 'unsent' | 'done'
  ];
  const cls = { 'your-turn': 'yours', open: 'aiwait', unsent: 'draft', done: 'ok' }[
    turn.kind as 'your-turn' | 'open' | 'unsent' | 'done'
  ];
  return (
    <span className={`chip ${cls} small turn-mark`} title={name} role="img" aria-label={name}>
      <Icon aria-hidden="true" focusable="false" />
    </span>
  );
}

function PageTree({ view }: { view: View }) {
  const all = view.pages;
  const openCount = (id: string): number => view.topic.threads.filter((t) => t.page === id && !t.resolved).length;
  const tree = (parent: string | null, depth: number) => {
    const kids = Object.keys(all).filter((id) => (all[id]?.parent ?? null) === parent);
    if (!kids.length) return null;
    return (
      <ul className="tree">
        {kids.map((id) => {
          const n = openCount(id);
          return (
            <li key={id}>
              <a href={hrefOf(view.slug, id)} className={id === view.page ? 'cur' : undefined}>
                {depth ? (
                  <CornerDownRight aria-hidden="true" focusable="false" />
                ) : (
                  <FileText aria-hidden="true" focusable="false" />
                )}
                <span className="t">{all[id]?.title}</span>
                <span className="ver"> v{all[id]?.versions}</span>
                {n ? <span className="badge">{n}</span> : null}
              </a>
              {tree(id, depth + 1)}
            </li>
          );
        })}
      </ul>
    );
  };
  return (
    <>
      <div className="side-h">ページ</div>
      {tree(null, 0)}
    </>
  );
}
