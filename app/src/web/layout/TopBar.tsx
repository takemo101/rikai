// 上のバー（`#top`）：左の一覧の開閉・題・状態（解決 N/M・回答 K/L・接続・AI の返信待ち）・Submit・終了。
import { CircleCheck, Copy, Hourglass, LogOut, Monitor, Moon, PanelLeft, Send, Sun, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { progressOf } from '../../shared/progress';
import { trunc } from '../lib/dom';
import { loadSendHintSeen, saveSendHintSeen } from '../lib/storage';
import { nextTheme, THEME_LABEL, useResolvedTheme } from '../lib/theme';
import { submitOffReason } from '../lib/turn';
import type { View } from '../lib/view';
import { toast, useUi } from '../store/ui';
import { sideAutoHidden, usePanelGeometry } from './geometry';
import { NotifyBell } from './NotifyBell';
import type { ServerStatus } from './status';
import { TurnPill, useTurn } from './TurnPill';

export interface TopBarProps {
  view: View | null;
  status: ServerStatus;
}

/** Claude Code 以外のエージェントへの案内。見える文字で出すのは、初めての待ちだけ（以後は、コピーのボタンの title・説明に） */
const OTHER_AGENT_HINT = 'Claude Code 以外は「rikai に送りました」と伝えてください';

const PROGRESS_TITLE =
  '数だけです（人が「解決」にしたスレッドの数と、回答を送信した質問の数。保存しただけの回答は数えません）。理解できたかの判定ではありません';

/** 「解決 N/M・回答 K/L」（回答の質問がなければ、回答は出さない）。スレッドがなければ null */
export function progressLabel(threads: View['topic']['threads']): string | null {
  if (!threads.length) return null;
  const p = progressOf(threads);
  return `解決 ${p.threads.resolved}/${p.threads.total}${p.asks.total ? `・回答 ${p.asks.answered}/${p.asks.total}` : ''}`;
}

export function TopBar({ view, status }: TopBarProps) {
  const { sideShown, drawer, autoHidden } = usePanelGeometry();
  const sideVisible = autoHidden ? drawer : sideShown;
  const theme = useUi((s) => s.ui.theme);
  const ThemeIcon = { system: Monitor, light: Sun, dark: Moon }[theme];
  // システム（自動）のときは、いま、描かれている外観も言う（絵は、モニターだけで、ライトかダークか、分からないため）
  const resolved = useResolvedTheme();
  const nowIs = theme === 'system' ? `いまは${THEME_LABEL[resolved]}。` : '';
  const themeLabel = `外観：${THEME_LABEL[theme]}。${nowIs}押すと、${THEME_LABEL[nextTheme(theme)]}にします`;
  const topic = view?.topic;
  const unsent = topic?.unsent ?? 0;
  const label = topic ? progressLabel(topic.threads) : null;
  const pending = !!topic?.meta.pending?.length;
  const turn = useTurn(view);
  // Submit が押せない理由（押せるときは null）：`title`（押せなくても、上に置くと出る）と、読み上げの説明
  const offReason = topic && unsent ? null : submitOffReason(turn);

  // 案内（Claude Code 以外）：初めて「AI の返信待ち」になったときだけ、見える文字で出す。待ちが終わったら、しまう（以後は、title・説明だけ）
  const waiting = !status.offline && !status.error && pending && !!view;
  const [hintOpen, setHintOpen] = useState(false);
  useEffect(() => {
    if (!waiting) {
      setHintOpen(false);
      return;
    }
    if (loadSendHintSeen()) return;
    saveSendHintSeen();
    setHintOpen(true);
  }, [waiting]);

  return (
    <header id="top">
      <button
        id="btn-side"
        type="button"
        title="左の一覧を、しまう／出す"
        aria-label="左の一覧を、しまう／出す"
        aria-expanded={sideVisible}
        onClick={() => useUi.getState().toggleSide(sideAutoHidden(window.innerWidth))}
      >
        <PanelLeft aria-hidden="true" focusable="false" />
      </button>
      <div className="brand">rikai</div>
      <div id="top-title">{topic ? topic.meta.title : ''}</div>
      <div className="spacer" />
      <NotifyBell />
      <button
        id="btn-theme"
        type="button"
        className="iconbtn"
        title={themeLabel}
        aria-label={themeLabel}
        data-theme-mode={theme}
        onClick={() => useUi.getState().setTheme(nextTheme(theme))}
      >
        <ThemeIcon aria-hidden="true" focusable="false" />
      </button>
      <div id="top-status">
        {status.offline ? (
          <span className="chip warn">
            <TriangleAlert aria-hidden="true" focusable="false" />
            サーバーに接続できません
          </span>
        ) : status.error ? (
          <span className="chip warn" title={status.error}>
            <TriangleAlert aria-hidden="true" focusable="false" />
            サーバーのエラー: {trunc(status.error, 40)}
          </span>
        ) : view && turn ? (
          <TurnPill view={view} turn={turn} />
        ) : null}
        {label ? (
          <span className="chip" title={PROGRESS_TITLE}>
            <CircleCheck aria-hidden="true" focusable="false" />
            <span className="chip-t">{label}</span>
          </span>
        ) : null}
        {waiting && view ? (
          <>
            {turn?.kind === 'unsent' ? (
              <span className="chip wait">
                <Hourglass aria-hidden="true" focusable="false" />
                AIの返信待ち
              </span>
            ) : null}
            {hintOpen ? <span className="hint">{OTHER_AGENT_HINT}</span> : null}
            <button
              type="button"
              className="ghost small"
              title={`AI に伝える文を、コピーする。${OTHER_AGENT_HINT}`}
              onClick={() => {
                navigator.clipboard
                  .writeText(`rikai(${view.slug})に送りました。rikai pull ${view.slug} で読んで返信してください`)
                  .then(() => toast('コピーしました'))
                  .catch((e: unknown) => toast(e instanceof Error ? e.message : String(e), true));
              }}
            >
              <Copy aria-hidden="true" focusable="false" />
              コピー
            </button>
          </>
        ) : null}
      </div>
      {/* 押せないとき：理由を、ボタンを包む `span` の title（無効のボタンは、マウスを受けないので、上に置いても出ないことがある）と、読み上げの説明（`aria-describedby`）で言う */}
      <span id="submit-wrap" {...(offReason ? { title: offReason } : {})}>
        <button
          id="btn-submit"
          type="button"
          className={turn?.kind === 'unsent' ? 'primary attn' : 'primary'}
          disabled={!topic || !unsent}
          {...(offReason ? { 'aria-describedby': 'submit-why', title: offReason } : {})}
          onClick={() => {
            if (topic && unsent) useUi.getState().openDialog('submit');
          }}
        >
          <Send aria-hidden="true" focusable="false" />
          {unsent ? `Submit (${unsent})` : 'Submit'}
        </button>
        {offReason ? (
          <span id="submit-why" className="turn-sr">
            {offReason}
          </span>
        ) : null}
      </span>
      <button
        id="btn-end"
        type="button"
        className="ghost"
        title="レビューを終了する"
        onClick={() => useUi.getState().openDialog('end')}
      >
        <LogOut aria-hidden="true" focusable="false" />
        終了
      </button>
    </header>
  );
}
