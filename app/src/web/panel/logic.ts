// 右のパネルの、純粋な判定（React・ストアに触れない）。旧 app.js の threadStatus・askDraftValid・askStale・renderThread の折りたたみ・composerSlot・renderDoneRow・画像の検査と同じ。
import type { Ask, Message, Thread } from '../../shared/types';
import { trunc } from '../lib/dom';
import type { AskDraft } from '../store/ui';

type Msgs = Pick<Thread, 'messages'>;

/** 質問 q への、いちばん新しい回答（なければ null） */
export function answerOf(t: Msgs, q: Pick<Message, 'id'>): Message | null {
  for (let i = t.messages.length - 1; i >= 0; i--) {
    const m = t.messages[i];
    if (m && m.kind === 'answer' && m.to === q.id) return m;
  }
  return null;
}

/** 回答（kind が answer）は、質問の下の入力欄で見せるので、メッセージの列からは除く */
export const shownMessages = (t: Msgs): Message[] => t.messages.filter((m) => m.kind !== 'answer');

export const hasUnsent = (t: Msgs): boolean => t.messages.some((m) => m.author === 'user' && !m.sent);

export type StatusClass = 'ok' | 'draft' | 'new' | 'wait';

/** カードの上の札：[文言, クラス]。既定の `wait`（AI の確認待ち）は、札を出さない（呼ぶ側） */
export function threadStatus(t: Pick<Thread, 'resolved' | 'messages'>): [string, StatusClass] {
  if (t.resolved) return ['解決済み', 'ok'];
  if (hasUnsent(t)) return ['未送信', 'draft'];
  const m = t.messages[t.messages.length - 1];
  if (m && m.author === 'ai') return ['AIの返信', 'new'];
  return ['AIの確認待ち', 'wait'];
}

/** 回答の下書きが、保存してよい形か（サーバーの normAnswer の、手前の目安） */
export function askDraftValid(ask: Ask, d: AskDraft | null | undefined): boolean {
  if (!d) return false;
  const other = (d.other ?? '').trim();
  switch (ask.type) {
    case 'single_choice':
      return !!(d.choice || (ask.allowOther && other));
    case 'multi_choice':
      return !!(d.choices?.length || (ask.allowOther && other));
    case 'yes_no':
      return typeof d.value === 'boolean';
    case 'scale':
      return Number.isInteger(d.value);
    default:
      return !!(d.text ?? '').trim();
  }
}

/**
 * 答えないまま、会話が進んだ質問（あとに、**送信した**利用者の発言がある。別の質問への回答は、数えない）。
 * もう、答えを求めない：小さく見せて、「答える」で開く（答えたければ、答えられる）
 */
export function askStale(t: Pick<Thread, 'resolved' | 'messages'>, q: Message): boolean {
  if (answerOf(t, q) || t.resolved) return false;
  const i = t.messages.findIndex((x) => x.id === q.id);
  return t.messages.slice(i + 1).some((m) => m.author === 'user' && m.sent && m.kind !== 'answer');
}

// ---- 回答の下書きの更新（保存した回答や、前の下書きを、書き換えず、作り直す） ----

/** 選択肢を、選ぶ・外す。単一は、選ぶと「その他」を消す。複数は、選んだ順を保つ */
export function pickOption(d: AskDraft | null, multi: boolean, id: string, on: boolean): AskDraft {
  const cur = d ?? {};
  if (multi) {
    const set = new Set(cur.choices ?? []);
    if (on) set.add(id);
    else set.delete(id);
    return { ...cur, choices: [...set] };
  }
  const { other: _drop, ...rest } = cur;
  return { ...rest, choice: id };
}

/** 「その他」の自由入力。単一は、書き始めると、選択肢を外す */
export function typeOther(d: AskDraft | null, multi: boolean, text: string): AskDraft {
  const cur = d ?? {};
  if (!multi && text) {
    const { choice: _drop, ...rest } = cur;
    return { ...rest, other: text };
  }
  return { ...cur, other: text };
}

// ---- スレッドの会話の折りたたみ（F29） ----

export type Segment =
  | { kind: 'msg'; m: Message }
  /** 「これまでのやり取り（N 件）」。key：開いた状態の鍵（スレッドと、その続きの、最初のメッセージ） */
  | { kind: 'older'; key: string; items: Message[] };

export interface FoldOptions {
  /** 番号を押して、そのカードだけを見るとき：古いやり取りも、たたまない */
  full: boolean;
  seen: ReadonlySet<string>;
  /** 編集中のメッセージ ID */
  editing: string | null;
}

/**
 * 会話が長くなっても、最新のやり取りが、すぐ見えるように、古いやり取りを折りたたむ。
 * **たたまないもの**：最新の 2 件・最新の AI の発言・最新のユーザーの発言・未送信・編集中・答えていない質問（会話が進んでいないもの）・
 * まだ見ていない AI の返信（最新の 4 件の中のもの）。**そのあいだの、続く 2 件以上**を、それぞれ「これまでのやり取り」にたたむ（たたみが、複数、出ることがある）。1 件だけなら、たたまない
 */
export function foldMessages(t: Pick<Thread, 'id' | 'resolved' | 'messages'>, o: FoldOptions): Segment[] {
  const shown = shownMessages(t);
  const authors = shown.map((m) => m.author);
  const lastAi = authors.lastIndexOf('ai');
  const lastUser = authors.lastIndexOf('user');
  const keep = (m: Message, i: number): boolean =>
    o.full ||
    i >= shown.length - 2 ||
    i === lastAi ||
    i === lastUser ||
    (m.author === 'user' && !m.sent) ||
    (m.author === 'ai' && !o.seen.has(m.id) && i >= shown.length - 4) ||
    o.editing === m.id ||
    !!(m.ask && !answerOf(t, m) && !askStale(t, m));

  const out: Segment[] = [];
  let run: Message[] = [];
  const flush = (): void => {
    const first = run[0];
    if (first && run.length >= 2) out.push({ kind: 'older', key: `${t.id}:${first.id}`, items: run });
    else for (const m of run) out.push({ kind: 'msg', m });
    run = [];
  };
  shown.forEach((m, i) => {
    if (keep(m, i)) {
      flush();
      out.push({ kind: 'msg', m });
    } else run.push(m);
  });
  flush();
  return out;
}

// ---- 入力欄を入れる位置（F22） ----

/**
 * 入力欄を入れる位置（進行中の何番目の前か）。入力欄がなければ -1・対象が本文の中で見つからないときは、先頭 0。
 * 対象（`pending`）の後ろにある、最初のスレッドの前。後ろがなければ、位置のあるスレッドの数（＝位置のないものの前）
 */
export function composerSlot(
  live: readonly Pick<Thread, 'id'>[],
  hasComposer: boolean,
  pending: Element | null,
  locOf: (tid: string) => Element | null,
): number {
  if (!hasComposer) return -1;
  if (!pending) return 0;
  const i = live.findIndex((t) => {
    const e = locOf(t.id);
    return !!e && !!(pending.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  return i >= 0 ? i : live.filter((t) => locOf(t.id)).length;
}

// ---- 解決済みの 1 行（F33） ----

/** AI の発言は Markdown：コード・図を略し、記号を外した文字にする */
export function plainText(s: string | undefined): string {
  return String(s ?? '')
    .replace(/```[\s\S]*?```/g, ' （コード・図） ')
    .replace(/[`*_#>|~]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 1 行の「最後の発言」：`AI：…`・`あなた：…`。画像だけの発言は「（画像）」。発言がなければ空 */
export function lastSpeech(t: Msgs): string {
  const m = shownMessages(t).pop();
  if (!m) return '';
  const text = plainText(m.text) || (m.images?.length ? '（画像）' : '');
  return text ? `${m.author === 'ai' ? 'AI' : 'あなた'}：${trunc(text, 48)}` : '';
}

/** 対象の文字（カードの引用）。AI 起点で、位置のないスレッドは「AIからの質問」 */
export const quoteOf = (t: Pick<Thread, 'anchor'>): string =>
  t.anchor ? t.anchor.quote || t.anchor.label : 'AIからの質問';

// ---- 画像の添付（F24）。形式・大きさ・枚数の最終の検査は、サーバー ----

export const IMG_TYPES: readonly string[] = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
export const IMG_MAX_MB = 5;
export const IMG_MAX_N = 4;

export interface ImageRejection {
  reason: 'type' | 'size' | 'count';
  message: string;
}

/** 付ける前の検査。`count`：すでに付けている枚数。通れば null */
export function checkImage(file: { type: string; size: number }, count: number): ImageRejection | null {
  if (!IMG_TYPES.includes(file.type))
    return { reason: 'type', message: '画像は、png・jpeg・gif・webp だけ付けられます' };
  if (file.size > IMG_MAX_MB * 1024 * 1024)
    return { reason: 'size', message: `画像が大きすぎます（${IMG_MAX_MB}MB まで）` };
  if (count >= IMG_MAX_N) return { reason: 'count', message: `画像は ${IMG_MAX_N} 枚までです` };
  return null;
}

/** 添付の画像の URL（トピックの assets/） */
export const imgUrl = (slug: string, name: string): string =>
  `/asset/${encodeURIComponent(slug)}/${encodeURIComponent(name)}`;
