// 拡大表示（F43）の右のドック（幅 約 340px。窓が 760px 未満のときは、下からのシート）：新しいコメントの入力欄（本文のパネルと**同じ**状態・下書き：`Composer`）と、
// この対象（ブロック）に付いた、既存のコメント（`ThreadCard`。読める・返信できる・解決できる）。上に、「未送信 n 件」（「AI に送る」は、画面のバーのまま：二重にしない）。
// 拡大表示で書いた下書きは、閉じたあとも、本文のパネルに残り、パネルの「AI に送る」で送る。ドックの中の添付の画像は、押すと、その上に重ねて、拡大表示で開く（閉じると、ここへ戻る）。
import { MessageSquarePlus } from 'lucide-react';
import { useContext, useEffect, useMemo, useRef } from 'react';
import type { AppFrame } from '../doc/frameRegistry';
import { blockAnchor, blockLabel } from '../doc/render/blocks';
import { noteMouseDown, zoomOnCardClick } from '../doc/zoomOpen';
import { openComposer } from '../interact/compose';
import { frameMetaOf } from '../lib/frameMeta';
import { useDoc } from '../store/doc';
import { type FocusRef, useUi } from '../store/ui';
import { Composer } from './Composer';
import { type PanelActions, PanelContext } from './panelContext';
import { ThreadCard } from './ThreadCard';
import type { FocusCtx } from './useFocusCtx';

/** `frame`：html-app の個別表示の枠（本文の枠ではない。状態の添付は、この枠の状態） */
export function FocusDock({ focus, ctx, frame }: { focus: FocusRef; ctx: FocusCtx; frame?: AppFrame | null }) {
  const { view, block, threads, canComment } = ctx;
  const composer = useUi((s) => s.composer);
  const editing = useUi((s) => s.editing);
  const focusSeq = useUi((s) => s.focusSeq);
  const parent = useContext(PanelContext);
  const ref = useRef<HTMLElement>(null);
  const model = useDoc((s) => s.model);

  // 選んだカード（本文のパネル・ステージの枠から選んだ）を、見える所へ
  useEffect(() => {
    const tid = useUi.getState().active;
    if (!tid || !focusSeq) return;
    for (const c of ref.current?.querySelectorAll<HTMLElement>('.thread[data-tid]') ?? [])
      if (c.dataset.tid === tid) c.scrollIntoView({ block: 'nearest' });
  }, [focusSeq]);

  // ドックの中では、カードを押しても、本文（窓の後ろ）を動かさない。コメントを追加したあとの処理は、パネルのもの（入力欄を閉じる・追加したカードを選ぶ）
  const actions = useMemo<PanelActions>(
    () => ({
      focusThread: (tid) => {
        const t = view?.topic.threads.find((x) => x.id === tid);
        if (t) useUi.getState().focusThread(t);
        else useUi.getState().setActive(tid);
      },
      afterComment: (tid, composerId) => parent?.afterComment(tid, composerId),
    }),
    [view, parent],
  );

  if (!view) return <aside className="fv-dock" aria-label="この対象のコメント" ref={ref} />;
  const unsent = view.topic.unsent;
  /** カードに、マウス・フォーカスがあるとき、ステージの、同じスレッドの枠を光らせる */
  const linkCard = (e: { target: EventTarget }): void => {
    const card = e.target instanceof Element ? e.target.closest<HTMLElement>('.thread[data-tid]') : null;
    const tid = card?.dataset.tid ?? null;
    if (tid !== useUi.getState().linkedTid) useUi.getState().setLinked(tid);
  };
  const isApp = block?.classList.contains('htmlapp') ?? false;
  const seen = useUi.getState().seen; // 描き直すときの値（パネルと同じ）：読んだだけで、すぐ、たたまない

  /** 対象全体にコメント（html-app の枠は、枠の状態があれば、下書きの `frameMeta.state` に持つ：F42・F45。本文には書かない） */
  const commentOnTarget = (): void => {
    if (!block) return;
    const r = frameMetaOf({ stateJson: isApp ? (frame?.latestState() ?? null) : null });
    if (!r.ok) useUi.getState().showToast(r.reason, true); // 状態は付けず、対象だけで開く
    openComposer(blockAnchor(block), r.ok ? r.meta : undefined);
  };

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: ドックの中の添付の画像の押下を、ドック全体で受ける（画像は、押す前提のマウス操作。本文のパネルと同じ）
    <aside
      className="fv-dock"
      aria-label="この対象のコメント"
      ref={ref}
      onClick={zoomOnCardClick}
      onMouseDown={noteMouseDown}
      onMouseLeave={() => useUi.getState().setLinked(null)}
    >
      <div className="fv-dock-h">
        <span className="fv-dock-t">コメント</span>
        {block ? <span className="fv-dock-target">{blockLabel(block)}</span> : null}
        {unsent > 0 ? (
          <span
            className="chip draft small fv-unsent"
            title="まだ AI には送られていない下書きの数です。送るのは、画面の上の「AI に送る」です"
          >
            未送信 {unsent} 件
          </span>
        ) : null}
      </div>
      <PanelContext.Provider value={actions}>
        {/* biome-ignore lint/a11y/noStaticElementInteractions: カードにマウスを置く・カードの中にフォーカスがあると、ステージの枠を光らせる（見た目の補助） */}
        <div className="fv-dock-body" onMouseOver={linkCard} onFocus={linkCard}>
          {!canComment ? (
            <p className="hint fv-note">最新版（v{view.latest}）にだけ、コメントを付けられます。ここでは、読めます。</p>
          ) : composer ? (
            <>
              {composer.anchor.blockId !== focus.id || composer.anchor.blockHash !== focus.hash ? (
                <p className="hint fv-note">
                  書きかけのコメントは、別の対象へのものです。この対象に付けるには、ステージで、範囲（要素）を選び直してください。
                </p>
              ) : null}
              <Composer key="composer" view={view} composer={composer} pending={null} dock />
            </>
          ) : (
            <div className="fv-start">
              <p className="hint">
                {focus.base
                  ? isApp
                    ? '枠の上の「範囲を選ぶ」・「要素を選ぶ」で、細かい所を選んで、コメントします。'
                    : '「範囲を選ぶ」で、細かい所を、ドラッグで選んで、コメントします。'
                  : '「範囲を選ぶ」は、ブロックの最初の画像・図だけで使えます。'}
              </p>
              <button type="button" className="ghost small" onClick={commentOnTarget} disabled={!block}>
                <MessageSquarePlus aria-hidden="true" focusable="false" />
                {isApp ? 'この枠にコメント' : 'この対象全体にコメント'}
              </button>
            </div>
          )}
          {threads.map((t) => (
            <ThreadCard key={t.id} view={view} thread={t} model={model} seen={seen} editing={editing} />
          ))}
          {!threads.length ? <p className="empty fv-empty">この対象には、まだコメントがありません。</p> : null}
        </div>
      </PanelContext.Provider>
    </aside>
  );
}
