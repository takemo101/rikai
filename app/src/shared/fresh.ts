// AI の新着を決める、ID の集合（F41・F46）。DOM に触れない純粋な関数だけ（サーバー・画面・テストが共有する）。
// **新着は、ID で決める**（件数の差では、読んだこと・解決の取り消し・自分のメッセージの削除で、数え直されて、見落とす／誤って出す）。
// 同じ種類の ID を、2 か所が使う：画面が開いているトピックは、取得した全体から（`freshOf(…, Infinity)`）・ほかのトピックは、一覧の API の `fresh`（サーバーが `freshOf(…, FRESH_MAX)` で作る）。
// 質問の「未回答」の判定（`awaitsAnswer`）も、ここ 1 か所（画面の F39 の判定と、サーバーの `fresh` が、同じ関数を使う）。
import type { Message, PageInfo, Thread } from './types';

/** 新着の判定に使う、ID の要約。`openAsks` は、いつも `asks` の部分集合（上限で切った窓の外の質問が、新着に見えないように） */
export interface Fresh {
  /** 返信（質問のない AI の発言）の ID。既読か未読かに、よらない */
  replies: string[];
  /** 質問付きの AI の発言の ID（回答済みも含む：回答した質問が、あとから、新着にならないように） */
  asks: string[];
  /** そのうち、いま、未回答のもの */
  openAsks: string[];
  /** ページごとの版のキー（`ページ@版`） */
  versions: string[];
  /** 一覧の API の窓の大きさ（各項目の上限）。窓が変わると、前回との差が、窓の境目で「新着」に見えうる：画面は、窓が広がったとき、そのトピックをベースラインにする。上限なしで作ったものには、ない */
  window?: number;
}

/**
 * 一覧の API の窓（1 トピックあたり、各項目の上限。新しい側から）：**通知の対象のトピック（閉じていないもの）の数で割る**（`freshWindow`）。すべてのトピックに、同じ大きさの窓で、付ける。
 * 対象が `FRESH_TOPICS_MAX`（= 全体の予算 ÷ 下限の窓）を超えるときだけ、予算を超える：更新が新しいトピックから順に、`FRESH_TOPICS_MAX` 個に付ける
 */
export const FRESH_MAX = 200;
export const FRESH_MIN = 20;
export const FRESH_TOTAL_MAX = 4000;
export const FRESH_TOPICS_MAX = FRESH_TOTAL_MAX / FRESH_MIN;
export const freshWindow = (topics: number): number =>
  Math.min(FRESH_MAX, Math.max(FRESH_MIN, Math.floor(FRESH_TOTAL_MAX / Math.max(1, topics))));

type Msgs = Pick<Thread, 'messages'>;

/** 質問 q への、いちばん新しい回答（なければ null） */
export function answerOf(t: Msgs, q: Pick<Message, 'id'>): Message | null {
  for (let i = t.messages.length - 1; i >= 0; i--) {
    const m = t.messages[i];
    if (m && m.kind === 'answer' && m.to === q.id) return m;
  }
  return null;
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

/** 質問 q が、まだ答えを求められているか：回答がなく、会話が先へ進んでいない（スレッドが未解決） */
export const awaitsAnswer = (t: Pick<Thread, 'resolved' | 'messages'>, q: Message): boolean =>
  !t.resolved && !!q.ask && q.author === 'ai' && !answerOf(t, q) && !askStale(t, q);

/** ID の、後ろの数（`m12` → 12。なければ 0）。新しさの順に使う（ID は、保存のたびに増える連番） */
const seqOf = (id: string): number => Number(/(\d+)$/.exec(id)?.[1] ?? 0);
/** 版のキー（`ページ@版`）の、版 */
const versionOf = (key: string): number => Number(key.slice(key.lastIndexOf('@') + 1));

/** 新しい側から max 個（古い側を捨てる）。max が Infinity なら、そのまま */
function newest(ids: string[], max: number, order: (id: string) => number): string[] {
  if (ids.length <= max) return ids;
  return ids
    .map((id, i) => [id, order(id), i] as const)
    .sort((a, b) => a[1] - b[1] || a[2] - b[2])
    .slice(-max)
    .map((x) => x[0]);
}

/**
 * トピックの、新着の判定に使う ID の要約。`max`：各項目の上限（新しい側から。切るのは、`replies`・`asks`・`versions`。`openAsks` は、切ったあとの `asks` の中から）。
 * 壊れた入力（threads が配列でない・messages が配列でない）でも、数えられる分だけ集める
 */
export function freshOf(
  threads: readonly Thread[] | null | undefined,
  pages: Record<string, Pick<PageInfo, 'versions'>> | null | undefined,
  max = Number.POSITIVE_INFINITY,
): Fresh {
  const replies: string[] = [];
  const asks: string[] = [];
  const open = new Set<string>();
  for (const t of Array.isArray(threads) ? threads : []) {
    for (const m of Array.isArray(t.messages) ? t.messages : []) {
      if (m.author !== 'ai') continue;
      if (!m.ask) replies.push(m.id);
      else {
        asks.push(m.id);
        if (awaitsAnswer(t, m)) open.add(m.id);
      }
    }
  }
  const versions: string[] = [];
  for (const [id, p] of Object.entries(pages ?? {})) for (let v = 1; v <= p.versions; v++) versions.push(`${id}@${v}`);
  const keptAsks = newest(asks, max, seqOf);
  return {
    replies: newest(replies, max, seqOf),
    asks: keptAsks,
    openAsks: keptAsks.filter((id) => open.has(id)),
    versions: newest(versions, max, versionOf),
  };
}

/** `fresh` の ID の数 */
export const freshSize = (f: Fresh): number => f.replies.length + f.asks.length + f.openAsks.length + f.versions.length;
