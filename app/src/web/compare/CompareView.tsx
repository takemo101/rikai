// 版を並べて比べる画面（F44）：本文の領域に、左右 2 つの版を、ブロックごとの行で並べる。**読み取り専用**（コメントの追加・範囲選択・要素選択・個別表示は、ここにない）。
// 上：説明（読み取り専用・左から右への変更・枠の状態は共有しない）・左右の版のプルダウンと札（最新／過去の版）・変更の数・比較用ツールバー（枠の幅・外観を、左右そろえて）・「変更のある所だけ」・閉じる。
// 下：行（`compare.ts`。命令的な島）。左右の版の本文は、通常の表示と同じ取得（`usePage`）。片方が取れなくても、その欄だけにエラーを出し、もう一方は出す。
// 状態の所有者は `ui.compare`（左右の版・ツールバーの選び・変更のある所だけ）。ここは、それを読んで描くだけ。
import { RefreshCw, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { usePage } from '../api/queries';
import { ModeButton, WidthButtons } from '../htmlapp/AppToolbar';
import { releaseApps } from '../htmlapp/frameRegistry';
import { versionTag } from '../lib/compare';
import { escapeStep } from '../lib/escape';
import type { View } from '../lib/view';
import { type CompareState, useUi } from '../store/ui';
import { type CompareResult, renderCompare } from './compare';
import { applyCompareMode, applyCompareWidth, publishCompareFrames, useCompareFrames } from './compareFrames';

/** 比較用ツールバー：左右のすべての枠に、同じ幅・枠だけの外観を適用する（枠の状態は、共有しない） */
function CompareToolbar() {
  const f = useCompareFrames();
  if (f.count === 0) return null;
  return (
    <div className="cmptools">
      <span className="cmptools-t">枠の表示（左右そろえて）</span>
      <fieldset className="cmptools-bar" aria-label="枠の表示（左右そろえて変更）">
        <WidthButtons
          width={f.width}
          avail={f.avail}
          onWidth={(w) => {
            useUi.getState().setCompareWidth(w);
            applyCompareWidth(w);
          }}
        />
        <ModeButton
          mode={f.mode}
          onMode={(m) => {
            useUi.getState().setCompareMode(m);
            applyCompareMode(m);
          }}
        />
      </fieldset>
      <span className="cmpnote">
        枠の中の状態（スライダーの位置など）は、左右で共有しません。それぞれ独立に動きます。
      </span>
    </div>
  );
}

/** 版の選択（プルダウン）と札・読み込み・失敗。`q`：その版の本文の取得 */
function VersionColumn({
  side,
  version,
  latest,
  q,
  selectRef,
}: {
  side: 'left' | 'right';
  version: number;
  latest: number;
  q: { isPending: boolean; isError: boolean; error: Error | null; refetch: () => unknown };
  selectRef?: React.Ref<HTMLSelectElement>;
}) {
  const name = side === 'left' ? '左' : '右';
  const tag = versionTag(version, latest);
  return (
    <div className="cmpcol" data-side={side}>
      <div className="cmpcol-row">
        <label className="cmplabel">
          <span>{name}の版</span>
          <select
            ref={selectRef}
            data-compare-select={side}
            value={version}
            onChange={(e) => useUi.getState().setCompareVersion(side, Number(e.target.value))}
          >
            {Array.from({ length: latest }, (_, k) => latest - k).map((i) => (
              <option key={i} value={i}>
                v{i}
                {i === latest ? '（最新）' : ''}
              </option>
            ))}
          </select>
        </label>
        <span className={`chip cmptag${tag === '最新' ? ' latest' : ''}`} data-tag={tag}>
          {tag}
        </span>
        {q.isPending ? (
          <span className="chip" role="status">
            読み込み中…
          </span>
        ) : null}
      </div>
      {q.isError ? (
        <div className="cmperr" role="alert">
          v{version} を読み込めませんでした：{q.error?.message}
          <button type="button" className="ghost" onClick={() => void q.refetch()}>
            <RefreshCw aria-hidden="true" focusable="false" />
            再読み込み
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function CompareView({ view, compare }: { view: View; compare: CompareState }) {
  const { left, right, changesOnly } = compare;
  const leftQ = usePage(view.slug, view.page, left);
  const rightQ = usePage(view.slug, view.page, right);
  // 左右の取得が、どちらも落ち着いてから描く（新しい版を選んだあとは、取れるまで、前の表示のまま：枠を、無駄に作り直さない）
  const ready = (leftQ.isSuccess || leftQ.isError) && (rightQ.isSuccess || rightQ.isError);
  const leftMd = leftQ.data ?? null;
  const rightMd = rightQ.data ?? null;

  const gridRef = useRef<HTMLDivElement>(null);
  const leftSelect = useRef<HTMLSelectElement>(null);
  const token = useRef(0); // 古い非同期の完了を、捨てる
  const viewRef = useRef(view);
  viewRef.current = view;
  const [result, setResult] = useState<CompareResult | null>(null);
  const [failed, setFailed] = useState(false);
  const appframe = view.topic.appframe === true;

  // biome-ignore lint/correctness/useExhaustiveDependencies: view は毎回作り直されるので、ref で読む（新しい版が届いても、描き直さない）。依存は、見ている版・本文・折りたたみ・サーバーの対応
  useEffect(() => {
    const el = gridRef.current;
    if (!el || !ready) return;
    const t = ++token.current;
    const c = useUi.getState().compare;
    renderCompare(
      el,
      {
        view: viewRef.current,
        left: { version: left, md: leftMd },
        right: { version: right, md: rightMd },
        changesOnly,
        frames: { width: c?.width ?? 'auto', mode: c?.mode ?? null },
        onEsc: () => escapeStep(),
      },
      () => t === token.current,
    )
      .then((res) => {
        if (!res || t !== token.current) return;
        setFailed(false);
        setResult(res);
        publishCompareFrames(res.frames);
      })
      .catch(() => {
        if (t === token.current) setFailed(true);
      });
  }, [ready, left, right, leftMd, rightMd, changesOnly, view.slug, view.page, appframe]);

  // 閉じる・ページを移る：枠を、橋から外す（受け口も、枠が 0 になれば外れる）。比較用ツールバーの写しも、空にする
  useEffect(() => {
    const el = gridRef.current;
    return () => {
      token.current++;
      if (el) releaseApps(el);
      publishCompareFrames([]);
    };
  }, []);

  // 開いたら、左の版の選択へ（キーボードで、すぐ選べる）
  useEffect(() => {
    leftSelect.current?.focus({ preventScroll: true });
  }, []);

  const sum = result && leftQ.isSuccess && rightQ.isSuccess ? result.summary : null;
  const sameVersion = left === right;
  const newer = view.latest > Math.max(left, right);

  return (
    <section id="compare" aria-label="版を並べて比べる" aria-busy={!ready}>
      <div className="cmptop">
        <p className="cmpnote cmpnote-main">
          <strong>読み取り専用</strong>
          です。コメントは、最新版の本文で付けます。左から右への変更を、強調しています。
        </p>
        <div className="cmpactions">
          <label className="chk">
            <input
              type="checkbox"
              data-key="chk-changes-only"
              checked={changesOnly}
              onChange={(e) => useUi.getState().setCompareChangesOnly(e.target.checked)}
            />
            変更のある所だけ見る
          </label>
          <button type="button" className="ghost" data-compare-close onClick={() => useUi.getState().closeCompare()}>
            <X aria-hidden="true" focusable="false" />
            閉じる（Esc）
          </button>
        </div>
      </div>
      <div className="cmphead">
        <VersionColumn side="left" version={left} latest={view.latest} q={leftQ} selectRef={leftSelect} />
        <VersionColumn side="right" version={right} latest={view.latest} q={rightQ} />
      </div>
      <div className="cmpmeta">
        {sameVersion ? (
          <span className="chip" role="status">
            同じ版を、左右に選んでいます（差分はありません）
          </span>
        ) : sum ? (
          <span className="chip cmpsum" role="status" aria-live="polite" title="左から右への、ブロックの変更">
            変更 {sum.changed}・追加 {sum.added}・削除 {sum.removed}・同じ {sum.same}
          </span>
        ) : null}
        {newer ? (
          <span className="chip warn" data-newer>
            新しい版 v{view.latest} が届きました
            <button
              type="button"
              className="btnlink"
              onClick={() => useUi.getState().setCompareVersion('right', view.latest)}
            >
              右を v{view.latest} にする
            </button>
          </span>
        ) : null}
        {result?.limited && sum ? (
          <span className="chip warn" role="status" data-limited>
            変更が多すぎて、対応づけていません（追加と削除として並べています）
          </span>
        ) : null}
        {failed ? (
          <span className="chip warn" role="alert">
            比較を表示できませんでした
          </span>
        ) : null}
      </div>
      <CompareToolbar />
      <div className={`cmpgrid${ready ? '' : ' loading'}`} ref={gridRef} />
    </section>
  );
}
