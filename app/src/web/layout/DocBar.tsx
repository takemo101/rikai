// 本文の上のバー（`#docbar`）：パンくず・版の選択・「並べて比べる」（F44）・「前の版からの変更を表示」・変更の数・凡例・「過去の版」の警告。
// 版を並べて比べているときは、パンくずと、「並べて比べる」（押すと閉じる）だけ（版の選択・差分の表示は、比べる画面の中にある）。
import { ArrowRight, ChevronRight, Clock, Columns2, History } from 'lucide-react';
import { Fragment, type RefObject, useEffect, useRef } from 'react';
import { COMPARE_MIN_VERSIONS } from '../lib/compare';
import { hrefOf, navigate } from '../lib/route';
import type { View } from '../lib/view';
import { useDoc } from '../store/doc';
import { toast, useUi } from '../store/ui';

export function DocBar({ view }: { view: View | null }) {
  const showChanges = useUi((s) => s.showChanges);
  const compare = useUi((s) => s.compare !== null);
  const model = useDoc((s) => s.model);
  const compareBtn = useRef<HTMLButtonElement>(null);
  // 閉じたら、フォーカスを、このボタンへ戻す（閉じた画面の中にあった要素が消えて、フォーカスが、失われるとき）
  const wasCompare = useRef(false);
  useEffect(() => {
    if (wasCompare.current && !compare && (!document.activeElement || document.activeElement === document.body))
      compareBtn.current?.focus();
    wasCompare.current = compare;
  }, [compare]);
  if (!view) return <div id="docbar" />;

  const { slug, page, version, latest, pages } = view;
  const crumbs: string[] = [];
  for (let id: string | null | undefined = page; id; id = pages[id]?.parent) crumbs.unshift(id);
  // 件数は、いま見ているページ・版のものだけ（切り替えた直後に、前のページの件数を見せない）
  const diff = model && model.key === view.key ? model.diff : null;

  return (
    <div id="docbar">
      <nav className="crumbs">
        {crumbs.map((id, i) => (
          <Fragment key={id}>
            {i ? (
              <span className="sep">
                <ChevronRight aria-hidden="true" focusable="false" />
              </span>
            ) : null}
            {id === page ? (
              <span className="here">{pages[id]?.title}</span>
            ) : (
              <a href={hrefOf(slug, id)}>{pages[id]?.title}</a>
            )}
          </Fragment>
        ))}
      </nav>
      <div className="spacer" />
      {compare ? (
        <CompareButton btn={compareBtn} open latest={latest} />
      ) : (
        <>
          {latest > 1 ? (
            <>
              <span className="verpick">
                <History aria-hidden="true" focusable="false" />
                <select
                  title="版"
                  value={version}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    navigate(slug, page, v === latest ? null : v);
                  }}
                >
                  {Array.from({ length: latest }, (_, k) => latest - k).map((i) => (
                    <option key={i} value={i}>
                      v{i}
                      {i === latest ? '（最新）' : ''}
                    </option>
                  ))}
                </select>
              </span>
              <CompareButton btn={compareBtn} open={false} latest={latest} />
              {version > 1 ? (
                <>
                  <label className="chk">
                    <input
                      type="checkbox"
                      data-key="chk-changes"
                      checked={showChanges}
                      onChange={(e) => useUi.getState().setShowChanges(e.target.checked)}
                    />
                    前の版からの変更を表示
                  </label>
                  {diff ? (
                    <span className="chip" title="前の版との比較">
                      変更 {diff.changed}・追加 {diff.added}・削除 {diff.removed}
                    </span>
                  ) : null}
                  {showChanges && diff && diff.changed + diff.added > 0 ? (
                    <span className="legend">
                      <i className="swatch" />
                      右端の緑の線：前の版から変えたところ
                    </span>
                  ) : null}
                </>
              ) : null}
            </>
          ) : (
            <CompareButton btn={compareBtn} open={false} latest={latest} />
          )}
          {!view.isLatest ? (
            <>
              <span className="chip warn">
                <Clock aria-hidden="true" focusable="false" />
                過去の版 v{version} を表示中（コメントは最新版にだけ付けられます）
              </span>
              <a className="btnlink" href={hrefOf(slug, page)}>
                最新版へ
                <ArrowRight aria-hidden="true" focusable="false" />
              </a>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}

/** 「並べて比べる」（F44）。版が 1 つのページでは、押せない（`aria-disabled`：キーボードでも、読み上げでも、理由に届く。押すと、理由をトーストで）。開いている間は、押すと閉じる */
function CompareButton({
  btn,
  open,
  latest,
}: {
  btn: RefObject<HTMLButtonElement | null>;
  open: boolean;
  latest: number;
}) {
  const off = latest < COMPARE_MIN_VERSIONS;
  const reason = '版が 2 つ以上になると、並べて比べられます（いまは v1 だけです）';
  return (
    <button
      ref={btn}
      id="btn-compare"
      type="button"
      className={`ghost${off ? ' off' : ''}`}
      aria-pressed={open}
      aria-disabled={off || undefined}
      aria-describedby={off ? 'compare-reason' : undefined}
      title={off ? reason : open ? '並べて比べるを閉じます（Esc）' : '版を左右に並べて、違いを見ます（読み取り専用）'}
      onClick={() => {
        if (off) toast(reason);
        else if (open) useUi.getState().closeCompare();
        else useUi.getState().openCompare(document.getElementById('docscroll')?.scrollTop ?? 0); // 閉じたら、この位置へ戻す
      }}
    >
      <Columns2 aria-hidden="true" focusable="false" />
      並べて比べる
      {off ? (
        <span id="compare-reason" className="cmp-sr">
          。{reason}
        </span>
      ) : null}
    </button>
  );
}
