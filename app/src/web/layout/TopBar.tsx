// 上のバー（`#top`）：左の一覧の開閉・題・「Markdown を保存」・状態の札（接続・あなたの番・AI の返信待ち…）・「AI に送る」（未送信の数つき）・終了。
// 進み具合（解決 N/M・回答 K/L）は、ここには出さない（左のトピック行だけ）。未送信の数も、札ではなく、「AI に送る」のボタンが持つ。
import { Copy, LogOut, Monitor, Moon, PanelLeft, Send, Sun, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { VERSION } from '../../shared/version';
import { trunc } from '../lib/dom';
import { loadSendHintSeen, saveSendHintSeen } from '../lib/storage';
import { nextTheme, THEME_LABEL, useResolvedTheme } from '../lib/theme';
import { submitOffReason } from '../lib/turn';
import type { View } from '../lib/view';
import { toast, useUi } from '../store/ui';
import { sideAutoHidden, usePanelGeometry } from './geometry';
import { NotifyBell } from './NotifyBell';
import { SaveMarkdown, type SaveSource } from './SaveMarkdown';
import type { ServerStatus } from './status';
import { TurnPill, useTurn } from './TurnPill';

export interface TopBarProps {
  view: View | null;
  status: ServerStatus;
  /** 「Markdown を保存」が使う、いま見ているページ・版の本文（なければ、ボタンを出さない） */
  save?: SaveSource;
}

/** Claude Code 以外のエージェントへの案内。見える文字で出すのは、初めての待ちだけ（以後は、コピーのボタンの title・説明に） */
const OTHER_AGENT_HINT = 'Claude Code 以外は「rikai に送りました」と伝えてください';

export function TopBar({ view, status, save }: TopBarProps) {
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
  const pending = !!topic?.meta.pending?.length;
  const turn = useTurn(view); // 未送信を含む（「AI に送る」の理由・輪）
  const baseTurn = useTurn(view, true); // 札は、未送信を除いた状態（未送信は、「AI に送る」の数）
  // 下書きだけがあって、ほかに言うことがない（未解決だけ）とき：札は出さない（「未解決 n」を、書いた直後に出さない）
  const pillTurn = turn?.kind === 'unsent' && baseTurn?.kind === 'open' ? null : baseTurn;
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
      <div className="brand" title={`rikai v${VERSION}`}>
        rikai
      </div>
      <div id="top-title">{topic ? topic.meta.title : ''}</div>
      <div className="spacer" />
      {view && save ? <SaveMarkdown view={view} source={save} /> : null}
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
        ) : view && pillTurn ? (
          <TurnPill view={view} turn={pillTurn} />
        ) : null}
        {waiting && view ? (
          <>
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
          {unsent ? `AI に送る（${unsent}）` : 'AI に送る'}
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
