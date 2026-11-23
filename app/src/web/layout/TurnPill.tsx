// 「いま、誰の番か」の印（`#turn`：上のバーの先頭）。F39。判定は lib/turn.ts（左の一覧・カードの札・タブのタイトルと同じ）。
// 色：青＝あなたの番・琥珀＝未送信・灰色＝AI の番・緑＝すべて解決。押すと、あなたの番は、最初の項目（AI の新着返信 → 未回答の質問 → 最初の未解決）へ・未送信は、Submit へ。
// 読み上げ：`role="status"`・`aria-live="polite"`。読み上げる文字は、状態の名前だけ（`.turn-sr`）：中の件数が変わっても、状態が同じなら、読み上げない。見える文字は `aria-hidden`
import { CircleCheck, CircleDot, CircleUser, Hourglass, Send } from 'lucide-react';
import { useMemo } from 'react';
import { navigate } from '../lib/route';
import { firstTarget, showsTurn, type Turn, turnDetail, turnLabel, turnOfTopic, turnStateName } from '../lib/turn';
import type { View } from '../lib/view';
import { useUi } from '../store/ui';

/** 開いているトピックの、いまの状態（見たものの一覧が変わっても、取り直す） */
export function useTurn(view: View | null): Turn | null {
  const seen = useUi((s) => s.seen);
  const topic = view?.topic;
  return useMemo(
    () =>
      topic
        ? turnOfTopic({
            threads: topic.threads,
            unsent: topic.unsent,
            pending: topic.meta.pending?.length ?? 0,
            closed: topic.meta.closed,
            seen,
          })
        : null,
    [topic, seen],
  );
}

const ICON = {
  unsent: Send,
  'waiting-ai': Hourglass,
  'your-turn': CircleUser,
  open: CircleDot,
  done: CircleCheck,
} as const;

/** 押したときの行き先へ移る（あなたの番：カードへ・未送信：Submit へフォーカス） */
export function goToTurn(view: View, turn: Turn): void {
  if (turn.kind === 'unsent') {
    document.getElementById('btn-submit')?.focus();
    return;
  }
  if (turn.kind !== 'your-turn' && turn.kind !== 'open') return;
  const t = firstTarget(view.topic.threads, useUi.getState().seen);
  if (!t) return;
  const ui = useUi.getState();
  if (ui.solo) ui.closeSolo();
  if (ui.tab === 'done') ui.setTab('live');
  if (t.page !== view.page) {
    // 別のページのスレッド：そのページへ移ってから、選ぶ
    navigate(view.slug, t.page);
    window.setTimeout(() => useUi.getState().focusThread(t), 150);
    return;
  }
  ui.focusThread(t);
}

export function TurnPill({ view, turn }: { view: View; turn: Turn }) {
  if (!showsTurn(turn)) return null;
  const Icon = ICON[turn.kind as keyof typeof ICON];
  const label = turnLabel(turn);
  const detail = turnDetail(turn);
  const actionable = turn.kind === 'unsent' || turn.kind === 'your-turn' || turn.kind === 'open';
  const hint =
    turn.kind === 'unsent'
      ? '未送信のコメントなどを、AI に送ります。押すと、Submit へ移ります'
      : turn.kind === 'your-turn'
        ? '押すと、最初の項目（AI の返信・未回答の質問）へ移ります'
        : turn.kind === 'open'
          ? '未解決のスレッドが残っています。押すと、最初の未解決へ移ります'
          : turn.kind === 'waiting-ai'
            ? 'Submit 済みです。AI が返信するまで、お待ちください'
            : 'すべてのスレッドが、解決済みです';
  // 内訳（項目の数）は、見える文字でなく、title・aria-label に（読み上げの外：`aria-live` の中は、状態の名前だけ）
  const full = `${label}${detail ? `（${detail}）` : ''}${turn.kind === 'unsent' ? '。Submit' : ''}`;
  const inner = (
    <>
      <Icon aria-hidden="true" focusable="false" />
      <span className="turn-t" aria-hidden="true">
        {label}
      </span>
      {turn.kind === 'unsent' ? (
        <span className="turn-go" aria-hidden="true">
          → Submit
        </span>
      ) : null}
    </>
  );
  return (
    <div id="turn" className={`turn ${turn.kind}`} role="status" aria-live="polite">
      {actionable ? (
        <button
          type="button"
          className="turn-btn"
          title={`${full}。${hint}`}
          aria-label={`${full}。${hint}`}
          onClick={() => goToTurn(view, turn)}
        >
          {inner}
        </button>
      ) : (
        <span className="turn-btn" title={`${full}。${hint}`}>
          {inner}
        </span>
      )}
      <span className="turn-sr">状態：{turnStateName(turn)}</span>
    </div>
  );
}
