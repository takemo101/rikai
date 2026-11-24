// 本文の上のバー（`#docbar`）：パンくず（子ページのときだけ）・版の選択・変更の数・凡例（変更を重ねているときだけ）・**変更の見せ方の切り替え**（通常｜変更を重ねる｜並べて比べる）・「過去の版」の警告（過去の版のときだけ）。
// 切り替えは、1 つの入口（旧：「前の版からの変更を表示」のチェックと、「並べて比べる」のボタン）：どれも 1 クリック。`ui.showChanges`（変更を重ねる：F11）と `ui.compare`（並べて比べる：F44）の意味は、そのまま
// （並べて比べる画面を、閉じたあと、重ねる・通常は、開く前のまま）。「変更を重ねる」は、前の版がある（v2 以降を見ている）ときだけ。「並べて比べる」は、版が 2 つ以上あるページだけ（比べる相手がない：押せない顔のボタンを置かない）。
// 押している（`aria-pressed`）ものを、もう一度押すと、切る（重ねる・並べるを止めて、通常へ。旧：チェックを外す・同じボタンで閉じる）。並べて比べているときも、この切り替えが残り、ここから戻れる。
// **本文の列が十分なら 1 行**（1360px・右のコメント 380 で 40px）：長い説明は、`title` に移し、見える文字を短くした（凡例は、件数の札の頭の、色の見本・過去の版の警告は、縮められる）。**足りなければ、折り返す**（窓の幅でなく、本文の列の幅で決まる：右のコメントを取っ手で広げても、右の端が隠れない）。
// 中身が何もないとき（版が 1 つの、子でないページ）は、出さない（`hidden`：高さ 0。ID は残る）。
// 版を並べて比べているときは、パンくずと、この切り替えだけ（版の選択・差分の表示は、比べる画面の中にある）。切り替えは、列の右端に寄せる（版の選択・件数が、その左に並ぶ）：最新版では、並べて比べるに替わっても、本文の列の右端から、同じ位置にある（過去の版では、警告が、右に並ぶ）。
import { ArrowRight, ChevronRight, History } from 'lucide-react';
import { Fragment, useEffect, useRef } from 'react';
import { hrefOf, navigate } from '../lib/route';
import type { View } from '../lib/view';
import { useDoc } from '../store/doc';
import { useUi } from '../store/ui';

type ChangeMode = 'normal' | 'overlay' | 'side';

export function DocBar({ view }: { view: View | null }) {
  const showChanges = useUi((s) => s.showChanges);
  const compare = useUi((s) => s.compare !== null);
  const model = useDoc((s) => s.model);
  const sideBtn = useRef<HTMLButtonElement>(null);
  // 閉じたら、フォーカスを、「並べて比べる」へ戻す（閉じた画面の中にあった要素が消えて、フォーカスが、失われるとき）
  const wasCompare = useRef(false);
  useEffect(() => {
    if (wasCompare.current && !compare && (!document.activeElement || document.activeElement === document.body))
      sideBtn.current?.focus();
    wasCompare.current = compare;
  }, [compare]);
  if (!view) return <div id="docbar" hidden />;

  const { slug, page, version, latest, pages } = view;
  const crumbs: string[] = [];
  for (let id: string | null | undefined = page; id; id = pages[id]?.parent) crumbs.unshift(id);
  // 件数は、いま見ているページ・版のものだけ（切り替えた直後に、前のページの件数を見せない）
  const diff = model && model.key === view.key ? model.diff : null;
  // 並べて比べるときは、切り替えがある。そうでなく、パンくずも・版の選択も・過去の版の警告もなければ、空
  const empty = !compare && crumbs.length <= 1 && latest <= 1 && view.isLatest;
  const overlay = showChanges && version > 1; // 変更を重ねて見せている（v1 には、前の版がない）
  const mode: ChangeMode = compare ? 'side' : overlay ? 'overlay' : 'normal';

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
      {!compare && latest > 1 ? (
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
      ) : null}
      {!compare && version > 1 && diff ? (
        // 凡例は、件数の札の頭の色の見本（右端の緑の線と同じ色）：変更を重ねていて、変えた所があるときだけ。説明の文は title（1 行に収めるため：見える文にすると、過去の版で 2 行になった）
        <span
          className="chip stats"
          title={
            overlay && diff.changed + diff.added > 0
              ? '前の版との比較。右端の緑の線：前の版から変えたところ'
              : '前の版との比較'
          }
        >
          {overlay && diff.changed + diff.added > 0 ? <i className="swatch legend-swatch" /> : null}
          変更 {diff.changed}・追加 {diff.added}・削除 {diff.removed}
        </span>
      ) : null}
      {latest > 1 ? <ChangeModeSwitch mode={mode} canOverlay={version > 1} sideBtn={sideBtn} /> : null}
      {!compare && !view.isLatest ? (
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
    </div>
  );
}

/**
 * 変更の見せ方：通常｜変更を重ねる（F11）｜並べて比べる（F44）。どれも 1 クリック。
 * 「通常」：並べて比べるを閉じて、重ねるを止める。「変更を重ねる」：並べて比べるを閉じて、重ねる（重ねているときに押すと、止める）。
 * 「並べて比べる」：開く（開いているときに押すと、閉じる：開く前の、通常・重ねるへ戻る）。「並べて比べる」は、`#btn-compare`（閉じたあと、フォーカスを戻す先）。`canOverlay`：前の版がある（v2 以降を見ている）
 */
function ChangeModeSwitch({
  mode,
  canOverlay,
  sideBtn,
}: {
  mode: ChangeMode;
  canOverlay: boolean;
  sideBtn: React.RefObject<HTMLButtonElement | null>;
}) {
  const choose = (next: ChangeMode): void => {
    const ui = useUi.getState();
    if (next === 'side') {
      if (mode === 'side') ui.closeCompare();
      else ui.openCompare(document.getElementById('docscroll')?.scrollTop ?? 0); // 閉じたら、この位置へ戻す
      return;
    }
    if (next === 'normal' && mode === 'normal') return; // すでに「通常」（v1 では、重ねる設定が残ったまま「通常」に見える：押しても、設定を変えない）
    if (ui.compare) ui.closeCompare();
    ui.setShowChanges(next === 'overlay' && mode !== 'overlay');
  };
  return (
    // biome-ignore lint/a11y/useSemanticElements: ボタンを連ねた切り替え（`aria-pressed` のボタンの集まり）。fieldset にすると、行の中で余白が崩れる
    <div className="modeseg" role="group" aria-label="変更の見せ方">
      <button
        type="button"
        data-mode="normal"
        aria-pressed={mode === 'normal'}
        title="通常の表示（変更の強調なし）"
        onClick={() => choose('normal')}
      >
        通常
      </button>
      {canOverlay ? (
        <button
          type="button"
          id="btn-changes"
          data-mode="overlay"
          aria-pressed={mode === 'overlay'}
          title="前の版からの変更を、本文に重ねて表示します"
          onClick={() => choose('overlay')}
        >
          変更を重ねる
        </button>
      ) : null}
      <button
        ref={sideBtn}
        type="button"
        id="btn-compare"
        data-mode="side"
        aria-pressed={mode === 'side'}
        title={mode === 'side' ? '並べて比べるを閉じます（Esc）' : '版を左右に並べて、違いを見ます（読み取り専用）'}
        onClick={() => choose('side')}
      >
        並べて比べる
      </button>
    </div>
  );
}
