// 「いま、誰の番か」（F39）：トピックの状態を、1 つに決める純粋関数。上のバーの `#turn`・左の一覧の印・カードの札・タブのタイトルが、同じ判定を使う。DOM・ストアに触れない。
//
// 判定の優先順（上から）：
//   closed     終了したトピック（既存の「終了」）
//   unsent     あなたが、まだ送っていない：未送信のコメント・返信・回答・解決がある（開いているトピックだけ）→「未送信 n 件。Submit」
//   waiting-ai Submit 済みで、AI が未処理の round がある（pending > 0）→「AIの返信待ち」
//   empty      スレッドがない（印を出さない）
//   your-turn  あなたの番：AI の新着返信（seen にない AI の発言）か、未回答の質問がある（青）
//   open       未解決のスレッドだけが残っている（新着も未回答の質問もない）：灰色の中立な印「未解決 n」
//   done       すべて解決（スレッドが 1 つ以上あり、全部が解決済み）
// 他のトピック（開いていない）は、一覧の要約（pending・progress・closed）だけで決める：unsent と、内訳・AI の新着返信（要約から分からない）は、ない。
// 見える数字・タイトルの `(n)` は、「あなたの番のスレッド」の数（1 つの返信に質問が付いていても 1）。内訳（AI の返信 n・未回答の質問 m）は、項目の数で、title・aria-label に出す。
import type { Message, Thread } from '../../shared/types';
import { answerOf, askStale } from '../panel/logic';
import { trunc } from './dom';

export type TurnKind = 'closed' | 'unsent' | 'waiting-ai' | 'empty' | 'your-turn' | 'open' | 'done';

export interface Turn {
  kind: TurnKind;
  /** unsent：未送信の件数 */
  unsent: number;
  /** your-turn の内訳（項目の数。開いているトピックだけ。要約だけのトピックは 0）：AI の新着返信・未回答の質問 */
  replies: number;
  asks: number;
  /** your-turn：新着の返信か、未回答の質問を持つ、スレッドの数（見える数字・タイトルの `(n)`。要約だけのトピックは 0） */
  mine: number;
  /** 未解決のスレッドの数 */
  open: number;
  /** 内訳を出せるか（開いているトピックだけ。要約だけのトピックは false） */
  detailed: boolean;
}

const NONE = { unsent: 0, replies: 0, asks: 0, mine: 0, open: 0, detailed: false } as const;

/** 質問 q が、まだ答えを求められているか：回答がなく、会話が先へ進んでいない（スレッドが未解決） */
export const awaitsAnswer = (t: Pick<Thread, 'resolved' | 'messages'>, q: Message): boolean =>
  !t.resolved && !!q.ask && q.author === 'ai' && !answerOf(t, q) && !askStale(t, q);

/** スレッドの、答えを求められている質問の数 */
export const openAsksOf = (t: Pick<Thread, 'resolved' | 'messages'>): number =>
  t.messages.filter((m) => awaitsAnswer(t, m)).length;

/** スレッドの、まだ見ていない AI の発言の数（解決済みのスレッドは、数えない） */
export const unseenRepliesOf = (t: Pick<Thread, 'resolved' | 'messages'>, seen: ReadonlySet<string>): number =>
  t.resolved ? 0 : t.messages.filter((m) => m.author === 'ai' && !seen.has(m.id)).length;

export interface TopicTurnInput {
  threads: readonly Thread[];
  /** 未送信の件数（サーバーの数え方：未送信の発言・回答・解決の変更） */
  unsent: number;
  /** Submit 済みで、AI が未処理の round（`meta.pending`）の数 */
  pending: number;
  closed: boolean;
  seen: ReadonlySet<string>;
}

/** 開いているトピック：スレッドの中身まで見て決める */
export function turnOfTopic(i: TopicTurnInput): Turn {
  if (i.closed) return { kind: 'closed', ...NONE };
  if (i.unsent > 0) return { kind: 'unsent', ...NONE, unsent: i.unsent };
  if (i.pending > 0) return { kind: 'waiting-ai', ...NONE };
  if (!i.threads.length) return { kind: 'empty', ...NONE };
  let replies = 0;
  let asks = 0;
  let mine = 0;
  let open = 0;
  for (const t of i.threads) {
    if (t.resolved) continue;
    open++;
    const r = unseenRepliesOf(t, i.seen);
    const a = openAsksOf(t);
    replies += r;
    asks += a;
    if (r > 0 || a > 0) mine++;
  }
  if (mine > 0) return { kind: 'your-turn', unsent: 0, replies, asks, mine, open, detailed: true };
  return open > 0 ? { kind: 'open', ...NONE, open } : { kind: 'done', ...NONE };
}

export interface SummaryTurnInput {
  pending: number;
  closed: boolean;
  progress: { threads: { total: number; open: number }; asks: { total: number; answered: number } } | null;
}

/** 他のトピック：一覧の要約（pending・progress・closed）だけで決める */
export function turnOfSummary(s: SummaryTurnInput): Turn {
  if (s.closed) return { kind: 'closed', ...NONE };
  if (s.pending > 0) return { kind: 'waiting-ai', ...NONE };
  const p = s.progress?.threads;
  if (!p || p.total === 0) return { kind: 'empty', ...NONE };
  // 未回答の質問（回答を送信していない質問）があれば、あなたの番。AI の新着返信は、要約から分からない
  if (s.progress && s.progress.asks.total - s.progress.asks.answered > 0)
    return { kind: 'your-turn', ...NONE, open: p.open };
  return p.open > 0 ? { kind: 'open', ...NONE, open: p.open } : { kind: 'done', ...NONE };
}

/** あなたの番のスレッドの数（新着の返信か、未回答の質問を持つスレッド）。見える数字・タイトルの `(n)` */
export const turnCount = (t: Turn): number => t.mine;

/** 印を出す状態か（コメントなし・終了は、出さない） */
export const showsTurn = (t: Turn): boolean => t.kind !== 'empty' && t.kind !== 'closed';

/** 内訳：「AI の返信 2・未回答の質問 1」（項目の数。0 の項目は出さない。要約だけなら、空）。title・aria-label に出す */
export function turnDetail(t: Turn): string {
  if (t.kind !== 'your-turn' || !t.detailed) return '';
  const parts: string[] = [];
  if (t.replies) parts.push(`AI の返信 ${t.replies}`);
  if (t.asks) parts.push(`未回答の質問 ${t.asks}`);
  return parts.join('・');
}

/** 印の見える文言：「あなたの番 2」（数は、スレッドの数）・「未解決 3」・「未送信 3 件」・「AIの返信待ち」・「すべて解決」 */
export function turnLabel(t: Turn): string {
  switch (t.kind) {
    case 'unsent':
      return `未送信 ${t.unsent} 件`;
    case 'waiting-ai':
      return 'AIの返信待ち';
    case 'your-turn':
      return t.mine > 0 ? `あなたの番 ${t.mine}` : 'あなたの番';
    case 'open':
      return `未解決 ${t.open}`;
    case 'done':
      return 'すべて解決';
    default:
      return '';
  }
}

/** 読み上げる、状態の名前（`aria-live` の中）。件数を含まない：件数だけが変わっても、読み上げ直さない */
export function turnStateName(t: Turn): string {
  switch (t.kind) {
    case 'unsent':
      return '未送信あり';
    case 'waiting-ai':
      return 'AIの返信待ち';
    case 'your-turn':
      return 'あなたの番';
    case 'open':
      return '未解決あり';
    case 'done':
      return 'すべて解決';
    default:
      return '';
  }
}

/** 押したときの、行き先：AI の新着返信のあるスレッド → 未回答の質問のあるスレッド → 最初の未解決のスレッド（上から順。「未解決」だけの状態は、最初の未解決）。なければ null */
export function firstTarget(threads: readonly Thread[], seen: ReadonlySet<string>): Thread | null {
  const open = threads.filter((t) => !t.resolved);
  return open.find((t) => unseenRepliesOf(t, seen) > 0) ?? open.find((t) => openAsksOf(t) > 0) ?? open[0] ?? null;
}

/** タブのタイトルに入れる、資料の題の長さの上限（文字） */
export const TITLE_MAX = 40;

/**
 * タブのタイトル（`document.title`）：`(n) あなたの番 | 題 | rikai`（n＝スレッドの数）・`未解決 n | 題 | rikai`・`AIの返信待ち | 題 | rikai`・`未送信 3 件 | 題 | rikai`・`すべて解決 | 題 | rikai`。
 * コメントなし・終了・状態がないとき `題 | rikai`。題がなければ `rikai`。題は、40 字に切る（文字のまま：HTML として解釈されない）
 */
export function docTitle(turn: Turn | null, title: string | null | undefined): string {
  const head = title ? trunc(title, TITLE_MAX) : '';
  const state = turn && showsTurn(turn) ? (turn.kind === 'your-turn' ? 'あなたの番' : turnLabel(turn)) : '';
  const n = turn?.kind === 'your-turn' ? turnCount(turn) : 0;
  const lead = state ? `${n > 0 ? `(${n}) ` : ''}${state}` : '';
  return [lead, head, 'rikai'].filter(Boolean).join(' | ');
}
