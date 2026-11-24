// ブラウザの通知（F41）：画面が前面にないときに、「あなたの番」になったことを、OS の通知（Web の `Notification` API）で知らせる。
// 方式：画面が、SSE（F38）の更新で取り直したトピックを、前回の見た状態と比べて、**新しく届いたものがあるときだけ**出す（Web Push・サーバーからの OS 通知は、使わない：N1）。
// ここは、判定と文言の純粋関数と、通知を出す薄い部分だけ。DOM のイベント・状態は、layout/useBrowserNotify.ts。
// 載せるのは、トピック名と件数だけ（AI の返信の本文・資料の中身は載せない：N6）。`icon` は、rikai の PNG（data: の定数：lib/notifyIcon.ts）だけ（外部の画像を読まない・通信を増やさない：N1）。`badge`・`data` は付けない。
//
// **新着は、ID で決める**（件数の差では、読んだこと・解決の取り消し・自分のメッセージの削除で、数え直されて、見落とす／誤って出す）。
// 前回までに知っていた、AI の発言の ID・質問付きの AI の発言の ID・ページごとの版の集合を持ち、**前回の集合に無い ID だけ**を、新着とする（既読・未解決・解決済みは、関係ない。ID が減っても、出さない）。

import { type Fresh, freshOf } from '../../shared/fresh';
import type { TopicState } from '../api/queries';
import { trunc } from './dom';
import { NOTIFY_ICON } from './notifyIcon';

/** 前回までに、知っていたもの（ID の集合） */
export interface Snapshot {
  /** 返信（質問のない AI の発言）の ID。既読か未読かに、よらない */
  replies: ReadonlySet<string>;
  /** 質問付きの AI の発言の ID（回答済みも含む：回答した質問が、あとから、新着にならないように） */
  asks: ReadonlySet<string>;
  /** そのうち、いま、未回答のもの（質問の新着は、「前回の `asks` に無く、いま、未回答」） */
  openAsks: ReadonlySet<string>;
  /** ページごとの版のキー（`ページ@版`） */
  versions: ReadonlySet<string>;
  /** 一覧の `fresh` の窓の大きさ（各項目の上限）。上限なし（開いているトピック）は、ない。新着の件数が、窓に達したら、「以上」と出す */
  window?: number;
}

/** 窓に達した（それ以上あるかもしれない）項目 */
export type Capped = { replies?: true; asks?: true; versions?: true };

/** 新着の件数（0 以上）。0 の項目は、文言に出さない。**返信と質問は、別の発言**：質問付きの 1 通は、「質問 1」だけ（返信にも数えない） */
export interface Delta {
  replies: number;
  asks: number;
  versions: number;
  /** 件数が、一覧の窓の上限に達した項目（「返信 200 以上」の「以上」）。なければ、省く */
  capped?: Capped;
}

export type Permission = 'granted' | 'denied' | 'default' | 'unsupported';

export interface NotifyEnv {
  /** ベルが、オンか（保存した設定） */
  enabled: boolean;
  /** `Notification.permission`（API がなければ unsupported） */
  permission: Permission;
  /** 画面を見ていない：`document.visibilityState !== 'visible'` または `!document.hasFocus()` */
  hidden: boolean;
}

/** `fresh`（ID の要約）から、見た状態を作る。ほかのトピックは、一覧の API の `fresh`（サーバーが、上限つきで作る）から（F46） */
export function snapshotFromFresh(f: Fresh): Snapshot {
  return {
    replies: new Set(f.replies),
    asks: new Set(f.asks),
    openAsks: new Set(f.openAsks),
    versions: new Set(f.versions),
    ...(f.window === undefined ? {} : { window: f.window }),
  };
}

/** トピックの状態から、見た状態を作る（開いているトピック：取得した全体から。上限なし）。ID の集め方は、サーバーの `fresh` と同じ関数（`freshOf`：未回答は `awaitsAnswer`） */
export function snapshotOf(topic: Pick<TopicState, 'threads' | 'meta'>): Snapshot {
  return snapshotFromFresh(freshOf(topic.threads, topic.meta.pages));
}

const newIn = (next: ReadonlySet<string>, prev: ReadonlySet<string>): number => {
  let n = 0;
  for (const id of next) if (!prev.has(id)) n++;
  return n;
};

/** 前回に無かった、新着の件数。前回がない（最初の読み込み・再接続の直後：ベースライン）か、新着がなければ null */
export function deltaOf(prev: Snapshot | null, next: Snapshot): Delta | null {
  if (!prev) return null;
  const d: Delta = {
    replies: newIn(next.replies, prev.replies),
    asks: newIn(next.openAsks, prev.asks), // 質問：前回に無く、いま、未回答
    versions: newIn(next.versions, prev.versions),
  };
  if (d.replies + d.asks + d.versions === 0) return null;
  // 一覧の窓は、新しい側の上限つき：件数が窓に達したら、それ以上かもしれない
  const w = next.window;
  if (w !== undefined) {
    const capped: Capped = {};
    if (d.replies >= w) capped.replies = true;
    if (d.asks >= w) capped.asks = true;
    if (d.versions >= w) capped.versions = true;
    if (Object.keys(capped).length) d.capped = capped;
  }
  return d;
}

/** 通知を出すか：出すなら新着の件数、出さないなら null。オン・許可あり・画面を見ていない・前回に無い新着がある、のすべてのとき */
export function shouldNotify(prev: Snapshot | null, next: Snapshot, env: NotifyEnv): Delta | null {
  if (!env.enabled || env.permission !== 'granted' || !env.hidden) return null;
  return deltaOf(prev, next);
}

/**
 * 画面を見ていない間に溜まった新着の、累計。同じトピックの通知は、`tag` で置き換わる（前の件数が消える）ので、累計で出す。
 * 画面が見える状態に戻ったら、呼ぶ側が捨てる
 */
export const addDelta = (a: Delta | undefined, b: Delta): Delta => {
  const capped = { ...a?.capped, ...b.capped };
  return {
    replies: (a?.replies ?? 0) + b.replies,
    asks: (a?.asks ?? 0) + b.asks,
    versions: (a?.versions ?? 0) + b.versions,
    ...(Object.keys(capped).length ? { capped } : {}),
  };
};

/** 通知の題 */
export const NOTIFY_TITLE = 'rikai';
/** 通知に入れる、トピック名の長さの上限（文字。F39 のタブのタイトルと同じ） */
export const NOTIFY_TITLE_MAX = 40;

/**
 * 通知の本文：「（トピック名）：AI から返信が届きました（返信 2・新しい版 1・質問 1）」。0 の項目は省く。
 * 返信も質問もなく、版だけ増えたときは、「資料が更新されました」。トピック名は、文字のまま（`Notification` の本文は、文字として扱われる）・
 * 見えない文字（制御・書式・異体字セレクタなど。絵文字の ZWJ・U+FE0F は残す）を除いて・40 字に切る（`trunc`）
 */
export function notifyBody(topicTitle: string, d: Delta): string {
  const parts: string[] = [];
  const n = (count: number, k: keyof Capped): string => `${count}${d.capped?.[k] ? ' 以上' : ''}`;
  if (d.replies) parts.push(`返信 ${n(d.replies, 'replies')}`);
  if (d.versions) parts.push(`新しい版 ${n(d.versions, 'versions')}`);
  if (d.asks) parts.push(`質問 ${n(d.asks, 'asks')}`);
  const what = d.replies || d.asks ? 'AI から返信が届きました' : '資料が更新されました';
  return `${trunc(topicTitle, NOTIFY_TITLE_MAX)}：${what}（${parts.join('・')}）`;
}

/** 画面を見ていないか */
export const isHidden = (): boolean => document.visibilityState !== 'visible' || !document.hasFocus();

export const permissionNow = (): Permission =>
  typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;

/**
 * 許可を求める。新しい形（Promise を返す）と、古い形（コールバックを渡し、戻りは undefined）の、両方に対応する：
 * コールバックを渡して、Promise が返れば Promise を・返らなければ、コールバックを、待つ
 */
export function requestPermission(): Promise<Permission> {
  return new Promise<Permission>((resolve) => {
    let done = false;
    const finish = (p: NotificationPermission | undefined): void => {
      if (done) return;
      done = true;
      resolve(p ?? permissionNow());
    };
    try {
      const r = (
        Notification.requestPermission as (
          cb?: (p: NotificationPermission) => void,
        ) => Promise<NotificationPermission> | undefined
      )(finish);
      if (r && typeof r.then === 'function') r.then(finish, () => finish(undefined));
    } catch {
      finish(undefined);
    }
  });
}

/**
 * 通知を出す。`tag` は、トピックごと：同じトピックの通知は、置き換わる（複数のタブが、それぞれ出しても、見た目は 1 つ）。
 * 押したら、画面へ戻る（`onClick`）。`silent` は、OS の既定
 */
export function showNotification(slug: string, topicTitle: string, d: Delta, onClick: () => void): Notification | null {
  if (typeof Notification === 'undefined') return null;
  try {
    const n = new Notification(NOTIFY_TITLE, {
      body: notifyBody(topicTitle, d),
      icon: NOTIFY_ICON,
      tag: `rikai-${slug}`,
      silent: false,
    });
    n.onclick = () => {
      window.focus();
      n.close();
      onClick();
    };
    return n;
  } catch {
    return null; // 通知が作れなくても、使える
  }
}
