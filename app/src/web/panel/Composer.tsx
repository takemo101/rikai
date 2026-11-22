// 新しいコメントの入力欄（`.thread.composer`）。対象（本文のオレンジの部分）の引用・書きかけの文・画像・「コメントを追加」・「やめる」。
// 開く（対象を選んだ・選び直した）たびに、欄にフォーカスを移し、カードを真ん中へ（旧 `startComposer`）。
import { useEffect, useRef } from 'react';
import { useMutations } from '../api/mutations';
import { trunc } from '../lib/dom';
import type { View } from '../lib/view';
import { type ComposerState, useUi } from '../store/ui';
import { caretAtEnd } from './caret';
import { ImageBar } from './ImageBar';
import { usePanel } from './panelContext';
import { useDraftImgs, useImageAttach } from './useImageAttach';

interface Props {
  view: View;
  composer: ComposerState;
  /** 入力中の対象を、本文で強調した要素（DocModel.pending）。見つからなければ null */
  pending: HTMLElement | null;
}

export function Composer({ view, composer, pending }: Props) {
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

  // 対象を選び直すたびに（id が変わるたびに）、欄へ移す
  // biome-ignore lint/correctness/useExhaustiveDependencies: id が変わったときだけ（本文は、使わない）
  useEffect(() => {
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
    if (!text && !imgs.length) return;
    busy.current = true;
    try {
      const r = await comment({
        topic: slug,
        page: view.page,
        version: view.version,
        anchor: a,
        text,
        images: [...imgs],
      });
      if (r) afterComment(r.thread);
    } finally {
      busy.current = false;
    }
  };

  return (
    <div className="thread composer" ref={card}>
      <div className="th-head">
        <span className="no pending" title="本文の、オレンジの部分へのコメントです">
          新
        </span>
        <div className="quote">{trunc(a.quote || a.label, 90)}</div>
        {pending ? (
          <div className="hint">
            {a.rect
              ? '本文の、オレンジの枠へのコメントです（枠は、ドラッグで動かし、角・辺で大きさを変えられます）'
              : '本文の、オレンジの部分へのコメントです'}
          </div>
        ) : null}
      </div>
      <textarea
        ref={area}
        rows={3}
        data-key="composer"
        placeholder="わからない点・確認したい点・直してほしい点（⌘/Ctrl+Enter で追加。画像は、貼り付け・ドラッグでも）"
        value={draft}
        onChange={(e) => useUi.getState().setComposerDraft(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            void submit();
          }
        }}
        {...handlers}
      />
      <ImageBar imgKey="composer" slug={slug} />
      <div className="row">
        <button type="button" className="primary small" onClick={() => void submit()}>
          コメントを追加
        </button>
        <button type="button" className="ghost small" onClick={() => useUi.getState().closeComposer()}>
          やめる
        </button>
      </div>
    </div>
  );
}
