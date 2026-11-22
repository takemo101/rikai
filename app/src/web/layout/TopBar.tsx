// 上のバー（`#top`）：左の一覧の開閉・題・状態（解決 N/M・回答 K/L・接続・AI の返信待ち）・Submit・終了。
import { progressOf } from '../../shared/progress';
import { trunc } from '../lib/dom';
import type { View } from '../lib/view';
import { toast, useUi } from '../store/ui';
import type { ServerStatus } from './status';

export interface TopBarProps {
  view: View | null;
  status: ServerStatus;
}

const PROGRESS_TITLE =
  '数だけです（人が「理解できた（解決）」にしたスレッドの数と、回答を送信した質問の数。保存しただけの回答は数えません）。理解できたかの判定ではありません';

/** 「解決 N/M・回答 K/L」（回答の質問がなければ、回答は出さない）。スレッドがなければ null */
export function progressLabel(threads: View['topic']['threads']): string | null {
  if (!threads.length) return null;
  const p = progressOf(threads);
  return `解決 ${p.threads.resolved}/${p.threads.total}${p.asks.total ? `・回答 ${p.asks.answered}/${p.asks.total}` : ''}`;
}

export function TopBar({ view, status }: TopBarProps) {
  const sideOpen = useUi((s) => s.ui.sideOpen);
  const topic = view?.topic;
  const unsent = topic?.unsent ?? 0;
  const label = topic ? progressLabel(topic.threads) : null;
  const pending = !!topic?.meta.pending?.length;

  return (
    <header id="top">
      <button
        id="btn-side"
        type="button"
        className="ghost small"
        title="左の一覧を、しまう／出す"
        aria-label="左の一覧を、しまう／出す"
        aria-expanded={sideOpen}
        onClick={() => useUi.getState().toggleSide()}
      >
        ☰
      </button>
      <div className="brand">rikai</div>
      <div id="top-title">{topic ? topic.meta.title : ''}</div>
      <div className="spacer" />
      <div id="top-status">
        {label ? (
          <span className="chip" title={PROGRESS_TITLE}>
            {label}
          </span>
        ) : null}
        {status.offline ? (
          <span className="chip warn">サーバーに接続できません</span>
        ) : status.error ? (
          <span className="chip warn" title={status.error}>
            サーバーのエラー: {trunc(status.error, 40)}
          </span>
        ) : pending && view ? (
          <>
            <span className="chip wait">AIの返信待ち</span>
            <span className="hint">Claude Code 以外は「rikai に送りました」と伝えてください</span>
            <button
              type="button"
              className="ghost small"
              onClick={() => {
                navigator.clipboard
                  .writeText(`rikai(${view.slug})に送りました。rikai pull ${view.slug} で読んで返信してください`)
                  .then(() => toast('コピーしました'))
                  .catch((e: unknown) => toast(e instanceof Error ? e.message : String(e), true));
              }}
            >
              コピー
            </button>
          </>
        ) : null}
      </div>
      <button
        id="btn-submit"
        type="button"
        className="primary"
        disabled={!topic || !unsent}
        onClick={() => {
          if (topic && unsent) useUi.getState().openDialog('submit');
        }}
      >
        {unsent ? `Submit (${unsent})` : 'Submit'}
      </button>
      <button id="btn-end" type="button" className="ghost" onClick={() => useUi.getState().openDialog('end')}>
        終了
      </button>
    </header>
  );
}
