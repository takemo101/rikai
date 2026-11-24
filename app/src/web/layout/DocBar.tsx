// 本文の上のバー（`#docbar`）：パンくず（子ページのときだけ）・版の選択・「並べて比べる」（F44）・「前の版からの変更を表示」・変更の数・凡例（変更を表示しているときだけ）・「過去の版」の警告（過去の版のときだけ）。
// **本文の列が十分なら 1 行**（1360px・右のコメント 380 で 40px）：長い説明は、`title` に移し、見える文字を短くした（凡例は、件数の札の頭の、色の見本・過去の版の警告は、縮められる）。**足りなければ、折り返す**（窓の幅でなく、本文の列の幅で決まる：右のコメントを取っ手で広げても、右の端が隠れない）。
// 中身が何もないとき（版が 1 つの、子でないページ）は、出さない（`hidden`：高さ 0。ID は残る）。
// 版を並べて比べているときは、パンくずと、「並べて比べる」（押すと閉じる）だけ（版の選択・差分の表示は、比べる画面の中にある）。
// 版が 1 つのページ（v1 だけ）では、「並べて比べる」を出さない（比べる相手がない：押せない顔のボタンを置かない）。
import { ArrowRight, ChevronRight, Columns2, History } from 'lucide-react';
import { Fragment, type RefObject, useEffect, useRef } from 'react';
import { hrefOf, navigate } from '../lib/route';
import type { View } from '../lib/view';
import { useDoc } from '../store/doc';
import { useUi } from '../store/ui';

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
  if (!view) return <div id="docbar" hidden />;

  const { slug, page, version, latest, pages } = view;
  const crumbs: string[] = [];
  for (let id: string | null | undefined = page; id; id = pages[id]?.parent) crumbs.unshift(id);
  // 件数は、いま見ているページ・版のものだけ（切り替えた直後に、前のページの件数を見せない）
  const diff = model && model.key === view.key ? model.diff : null;
  // 並べて比べるときは、「並べて比べる」（閉じる）がある。そうでなく、パンくずも・版の選択も・過去の版の警告もなければ、空
  const empty = !compare && crumbs.length <= 1 && latest <= 1 && view.isLatest;

  return (
    <div id="docbar" hidden={empty}>
      {crumbs.length > 1 ? (
        <nav className="crumbs" aria-label="ページの階層">
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
      ) : null}
      {compare ? (
        <CompareButton btn={compareBtn} open />
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
              <CompareButton btn={compareBtn} open={false} />
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
                    // 凡例は、件数の札の頭の色の見本（右端の緑の線と同じ色）：変更を表示していて、変えた所があるときだけ。説明の文は title（1 行に収めるため：見える文にすると、過去の版で 2 行になった）
                    <span
                      className="chip stats"
                      title={
                        showChanges && diff.changed + diff.added > 0
                          ? '前の版との比較。右端の緑の線：前の版から変えたところ'
                          : '前の版との比較'
                      }
                    >
                      {showChanges && diff.changed + diff.added > 0 ? <i className="swatch legend-swatch" /> : null}
                      変更 {diff.changed}・追加 {diff.added}・削除 {diff.removed}
                    </span>
                  ) : null}
                </>
              ) : null}
            </>
          ) : null}
          {!view.isLatest ? (
            <>
              <span
                className="chip warn pastver"
                title={`過去の版 v${version} を表示中です。コメントは、最新版にだけ付けられます`}
              >
                <span className="chip-t">過去の版 v{version}（コメントは最新版で）</span>
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

/** 「並べて比べる」（F44）。開いている間は、押すと閉じる。版が 1 つのページには、置かない（呼ぶ側で出し分ける） */
function CompareButton({ btn, open }: { btn: RefObject<HTMLButtonElement | null>; open: boolean }) {
  return (
    <button
      ref={btn}
      id="btn-compare"
      type="button"
      className="ghost"
      aria-pressed={open}
      title={open ? '並べて比べるを閉じます（Esc）' : '版を左右に並べて、違いを見ます（読み取り専用）'}
      onClick={() => {
        if (open) useUi.getState().closeCompare();
        else useUi.getState().openCompare(document.getElementById('docscroll')?.scrollTop ?? 0); // 閉じたら、この位置へ戻す
      }}
    >
      <Columns2 aria-hidden="true" focusable="false" />
      並べて比べる
    </button>
  );
}
