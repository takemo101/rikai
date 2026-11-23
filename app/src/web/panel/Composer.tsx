// 新しいコメントの入力欄（`.thread.composer`）。対象（本文の点線の部分）の引用・書きかけの文・画像・「コメントを追加」・「やめる」。
// 開く（対象を選んだ・選び直した）たびに、欄にフォーカスを移し、カードを真ん中へ（旧 `startComposer`）。
import { Send } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { fromFrameAnchor } from '../../shared/htmlapp-bridge';
import { useMutations } from '../api/mutations';
import { trunc } from '../lib/dom';
import type { View } from '../lib/view';
import type { BlockEl } from '../store/doc';
import { type ComposerState, useUi } from '../store/ui';
import { caretAtEnd } from './caret';
import { AttachButton, ImageBar } from './ImageBar';
import { usePanel } from './panelContext';
import { useDraftImgs, useImageAttach } from './useImageAttach';

interface Props {
  view: View;
  composer: ComposerState;
  /** 入力中の対象を、本文で強調した要素（DocModel.pending）。見つからなければ null */
  pending: BlockEl | null;
}

/** 「枠から」の札：枠の中のコードが作った情報（要素・状態・画像）が入っている下書き・コメント。AI の文章・あなたの文章と、見分ける（F42） */
export function FromFrame() {
  return (
    <span
      className="chip small fromframe"
      title="html-app の枠の中のコードが作った情報が、入っています（要素・状態・画像）"
    >
      枠から
    </span>
  );
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
      const composerId = composer.id;
      await comment(
        { topic: slug, page: view.page, version: view.version, anchor: a, text, images: [...imgs] },
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
    <div className="thread composer" ref={card} {...(fromFrameAnchor(a) ? { 'data-from-frame': '' } : {})}>
      <div className="th-head">
        <span className="no pending" title="本文の、点線の部分へのコメントです">
          新
        </span>
        {fromFrameAnchor(a) ? <FromFrame /> : null}
        <div className="quote">{trunc(a.quote || a.label, 90)}</div>
        {pending ? (
          <div className="hint">
            {a.rect
              ? '本文の、点線の枠へのコメントです（枠は、ドラッグで動かし、角・辺で大きさを変えられます）'
              : '本文の、点線の部分へのコメントです'}
          </div>
        ) : null}
      </div>
      <textarea
        ref={area}
        rows={fromFrameAnchor(a) ? 8 : 3} // 枠からの下書き（見出し＋ JSON）は、長い：読める高さにする
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
