// 左の一覧（`#side`）：理解の対象（トピック）と、開いているトピックのページの木。
// 読めない新しい形式のトピックは、押せない（「新しい形式」の印）。ほかの印：解決/全スレッド・待ち・終了。
import { progressOf } from '../../shared/progress';
import type { TopicSummary } from '../api/queries';
import { hrefOf } from '../lib/route';
import type { View } from '../lib/view';

export interface SideNavProps {
  topics: readonly TopicSummary[];
  /** 開いているトピック（ルートの slug。読めない形式のトピックを選んでいる間は null） */
  currentSlug: string | null;
  /** 取得済みのトピックと、見ているページ（なければ null：ページの木は、出さない） */
  view: View | null;
}

export function SideNav({ topics, currentSlug, view }: SideNavProps) {
  return (
    <aside id="side">
      <div className="side-h">理解の対象</div>
      <ul className="topics">
        {topics.map((t) => {
          // 開いているトピックは、画面が持っている最新のスレッドから数える（一覧の更新を待たず、上のバーと食い違わない）
          const p = t.unsupported ? null : t.slug === currentSlug && view ? progressOf(view.topic.threads) : t.progress;
          return (
            <li key={t.slug} className={t.slug === currentSlug ? 'cur' : ''}>
              {t.unsupported ? <span className="topic-off">{t.title}</span> : <a href={hrefOf(t.slug)}>{t.title}</a>}
              {p?.threads.total ? (
                <span className="chip small" title="解決したスレッド / 全スレッド">
                  {p.threads.resolved}/{p.threads.total}
                </span>
              ) : null}
              {!t.unsupported && t.pending ? <span className="chip wait small">待ち</span> : null}
              {t.unsupported ? (
                <span
                  className="chip warn small"
                  title="この rikai が読めない、新しい形式です。rikai を更新してください"
                >
                  新しい形式
                </span>
              ) : null}
              {!t.unsupported && t.closed ? <span className="chip small">終了</span> : null}
            </li>
          );
        })}
      </ul>
      {view ? <PageTree view={view} /> : null}
    </aside>
  );
}

function PageTree({ view }: { view: View }) {
  const all = view.pages;
  const openCount = (id: string): number => view.topic.threads.filter((t) => t.page === id && !t.resolved).length;
  const tree = (parent: string | null) => {
    const kids = Object.keys(all).filter((id) => (all[id]?.parent ?? null) === parent);
    if (!kids.length) return null;
    return (
      <ul className="tree">
        {kids.map((id) => {
          const n = openCount(id);
          return (
            <li key={id}>
              <a href={hrefOf(view.slug, id)} className={id === view.page ? 'cur' : undefined}>
                {all[id]?.title}
                <span className="ver"> v{all[id]?.versions}</span>
                {n ? <span className="badge">{n}</span> : null}
              </a>
              {tree(id)}
            </li>
          );
        })}
      </ul>
    );
  };
  return (
    <>
      <div className="side-h">ページ</div>
      {tree(null)}
    </>
  );
}
