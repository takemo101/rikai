// 理解の進み具合を数える。DOM に触れない純粋な関数だけ（サーバー・画面・テストが共有する）。
// 数えるのは、数だけ：人が「理解できた（解決）」にしたスレッドの数と、AI の質問に、送信済みの回答がある数。
// 「理解できた」かどうかの判定ではない（質問の正解は、AI が返信の文章で採点するもので、構造のデータにない）。
import type { Thread } from './types';

export interface Progress {
  threads: { total: number; resolved: number; open: number };
  asks: { total: number; answered: number };
}

/**
 * threads は threads.json の threads。壊れた入力（配列でない・messages が配列でない）でも、数えられる分だけ数える。
 *   threads: スレッドの数・解決済み・まだ
 *   asks:    AI の質問の数・送信済みの回答がある数（保存しただけで、未送信の回答は数えない）
 */
export function progressOf(threads: readonly Thread[] | null | undefined): Progress {
  const list: readonly Thread[] = Array.isArray(threads) ? threads : [];
  let resolved = 0;
  let asks = 0;
  let answered = 0;
  for (const t of list) {
    if (t.resolved) resolved++;
    const messages = Array.isArray(t.messages) ? t.messages : [];
    for (const m of messages) {
      if (m.author !== 'ai' || !m.ask) continue;
      asks++;
      if (messages.some((a) => a.kind === 'answer' && a.to === m.id && a.sent)) answered++;
    }
  }
  return { threads: { total: list.length, resolved, open: list.length - resolved }, asks: { total: asks, answered } };
}
