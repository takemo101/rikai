// 新しいコメントの入力欄（`.thread.composer`）。対象（本文の点線の部分）の引用・書きかけの文・画像・「コメントを追加」・「やめる」。
// 開く（対象を選んだ・選び直した）たびに、欄にフォーカスを移し、カードを真ん中へ。
import { Send } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useMutations } from '../api/mutations';
import { effectiveFrameMeta } from '../lib/frameMeta';
import type { View } from '../lib/view';
import type { BlockEl } from '../store/doc';
import { type ComposerState, useUi } from '../store/ui';
import { caretAtEnd } from './caret';
import { FrameMetaChip } from './FrameMetaChip';
import { AttachButton, ImageBar } from './ImageBar';
import { usePanel } from './panelContext';
import { Quote } from './Quote';
import { useDraftImgs, useImageAttach } from './useImageAttach';

interface Props {
  view: View;
  composer: ComposerState;
  /** 入力中の対象を、本文で強調した要素（DocModel.pending）。見つからなければ null */
  pending: BlockEl | null;
  /** 個別表示（F43）の、右のドックの入力欄か。下書き・対象は、パネルの入力欄と同じ状態。個別表示が開いている間は、ドックのものだけが、フォーカスを受ける */
  dock?: boolean;
}

export function Composer({ view, composer, pending, dock = false }: Props) {
  const a = composer.anchor;
  const slug = view.slug;
  const draft = useUi((s) => s.drafts.composer);
  const imgs = useDraftImgs('composer');
  const { comment } = useMutations();
  const { afterComment } = usePanel();
  const { handlers } = useImageAttach('composer', slug);
  const card = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const busy = useRef(false);
  // 枠から取った情報（F45）：本文には書かず、情報の行に出す・メッセージの `frameMeta` として送る。札も、これの有無で決める（本文の見出しの行には、頼らない）
  const meta = effectiveFrameMeta(composer.frameMeta, composer.regionImg, imgs);
  const fromFrame = !!meta;

  // 対象を選び直すたびに（id が変わるたびに）、欄へ移す
  // biome-ignore lint/correctness/useExhaustiveDependencies: id が変わったときだけ（本文は、使わない）
  useEffect(() => {
    if (!dock && useUi.getState().lightbox?.focus) return; // 個別表示の間は、窓の後ろのパネルの入力欄に、フォーカスを移さない
    area.current?.focus();
    caretAtEnd(area.current);
    card.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [composer.id]);

  const submit = async (): Promise<void> => {
    if (busy.current) return;
    const text = draft.trim();
    const ui = useUi.getState();
    if (ui.uploading) {
      ui.showToast('画像のアップロード中です。終わってから、送ってください', true);
      return;
    }
    if (!text && !imgs.length) {
      // 枠から取った情報だけでは、送れない（本文は、利用者の言葉）：知らせて、入力欄へ戻す
      if (meta) {
        ui.showToast('コメントの本文を書いてください（枠から取った情報だけでは送れません）', true);
        area.current?.focus();
      }
      return;
    }
    busy.current = true;
    try {
      const composerId = composer.id;
      await comment(
        {
          topic: slug,
          page: view.page,
          version: view.version,
          anchor: a,
          text,
          images: [...imgs],
          ...(meta ? { frameMeta: meta } : {}),
        },
        {
          // 保存できた：書きかけを消す（取り直しが遅れても、もう一度押して、二重に保存されない）。入力欄は、追加したカードが届いてから閉じる
          onOk: (res) => {
            const s = useUi.getState();
            if (s.composer?.id === composerId) {
              s.setComposerDraft('');
              s.resetImgs('composer');
            }
            afterComment(res.thread, composerId);
          },
        },
      );
    } finally {
      busy.current = false;
    }
  };

  return (
    <div className="thread composer" ref={card} {...(fromFrame ? { 'data-from-frame': '' } : {})}>
      <div className="th-head">
        <span className="no pending" title="本文の、点線の部分へのコメントです">
          新
        </span>
        <Quote anchor={a} text={a.quote || a.label} />
        {dock && a.rect ? <div className="hint">選んだ範囲（ステージの、点線の枠）へのコメントです</div> : null}
        {!dock && pending ? (
          <div className="hint">
            {a.rect
              ? '本文の、点線の枠へのコメントです（枠は、ドラッグで動かし、角・辺で大きさを変えられます）'
              : '本文の、点線の部分へのコメントです'}
          </div>
        ) : null}
      </div>
      {meta ? <FrameMetaChip meta={meta} onRemove={() => useUi.getState().removeFrameMeta()} /> : null}
      <textarea
        ref={area}
        rows={3}
        data-key="composer"
        placeholder="わからない点・確認したい点・直してほしい点（⌘/Ctrl+Enter で追加。画像は、貼り付け・ドラッグでも）"
        value={draft}
        onChange={(e) => useUi.getState().setComposerDraft(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) {
            e.preventDefault();
            void submit();
          }
        }}
        {...handlers}
      />
      <ImageBar imgKey="composer" slug={slug} />
      <div className="row">
        <AttachButton imgKey="composer" slug={slug} />
        <button type="button" className="primary small" onClick={() => void submit()}>
          <Send aria-hidden="true" focusable="false" />
          コメントを追加
        </button>
        <button type="button" className="ghost small" onClick={() => useUi.getState().closeComposer()}>
          やめる
        </button>
      </div>
    </div>
  );
}
