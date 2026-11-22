// 終えたトピックは、全面の表示（`#ended`）で覆う。ほかに開いているトピックがあれば、そこへ移れるようにする。
import { CircleCheck } from 'lucide-react';
import type { TopicSummary } from '../api/queries';
import { hrefOf } from '../lib/route';
import type { View } from '../lib/view';

export interface EndedScreenProps {
  view: View | null;
  topics: readonly TopicSummary[];
}

export function EndedScreen({ view, topics }: EndedScreenProps) {
  const closed = !!view?.topic.meta.closed;
  const others = view && closed ? topics.filter((t) => t.slug !== view.slug && !t.unsupported && !t.closed) : [];
  return (
    <div id="ended" hidden={!closed}>
      <div className="ended-box" id="ended-box">
        {closed ? (
          <>
            <CircleCheck aria-hidden="true" focusable="false" />
            <h2>このトピックのレビューを終了しました</h2>
            {others.length ? (
              <>
                <p>ほかに、開いているトピックがあります。</p>
                <ul className="ended-list">
                  {others.map((t) => (
                    <li key={t.slug}>
                      <a href={hrefOf(t.slug)}>{t.title}</a>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p>
                このタブは閉じて構いません。続きはもう一度 <code>/rikai</code> で開けます。
              </p>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
