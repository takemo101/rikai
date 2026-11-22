// 本文の上のバー（`#docbar`）：パンくず・版の選択・「前の版からの変更を表示」・変更の数・凡例・「過去の版」の警告。
import { Fragment } from 'react';
import { hrefOf, navigate } from '../lib/route';
import type { View } from '../lib/view';
import { useDoc } from '../store/doc';
import { useUi } from '../store/ui';

export function DocBar({ view }: { view: View | null }) {
  const showChanges = useUi((s) => s.showChanges);
  const model = useDoc((s) => s.model);
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
            {i ? <span className="sep">›</span> : null}
            {id === page ? (
              <span className="here">{pages[id]?.title}</span>
            ) : (
              <a href={hrefOf(slug, id)}>{pages[id]?.title}</a>
            )}
          </Fragment>
        ))}
      </nav>
      <div className="spacer" />
      {latest > 1 ? (
        <>
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
      ) : null}
      {!view.isLatest ? (
        <>
          <span className="chip warn">過去の版 v{version} を表示中（コメントは最新版にだけ付けられます）</span>
          <a className="btnlink" href={hrefOf(slug, page)}>
            最新版へ
          </a>
        </>
      ) : null}
    </div>
  );
}
