// ブラウザの通知（F41）の判定と文言：新着は、ID で決める（読んだ・解決の取り消し・メッセージの削除では出ない／読んだあとの新着は出る）。
// ベースライン・同じ状態・画面を見ているとき・許可なし・オフ。質問付きの 1 通は「質問 1」だけ。累計。0 の項目の省略・40 字・絵文字・制御文字

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';
import type { Message, Thread } from '../../../src/shared/types';
import {
  addDelta,
  deltaOf,
  NOTIFY_TITLE,
  type NotifyEnv,
  notifyBody,
  shouldNotify,
  snapshotOf,
} from '../../../src/web/lib/notify';
import { NOTIFY_ICON, NOTIFY_ICON_SOURCE_SHA256 } from '../../../src/web/lib/notifyIcon';
import { meta, msg, thread, topicState } from '../helpers';

const ASK = { type: 'yes_no', question: '？' } as const;
const ai = (id: string, over: Partial<Message> = {}): Message =>
  msg({ id, author: 'ai', kind: 'reply', sent: true, text: '返信', ...over });
const ask = (id: string): Message => ai(id, { ask: ASK });
const answer = (id: string, to: string): Message =>
  msg({ id, kind: 'answer', to, answer: { value: true }, sent: true });
const user = (id: string, over: Partial<Message> = {}): Message => msg({ id, sent: true, ...over });
const T = (id: string, messages: Message[], over: Partial<Thread> = {}): Thread => thread({ id, messages, ...over });
const topic = (threads: Thread[], versions: Record<string, number> = { root: 1 }) =>
  topicState({
    threads,
    meta: meta({
      pages: Object.fromEntries(
        Object.entries(versions).map(([id, v]) => [
          id,
          { title: id, parent: id === 'root' ? null : 'root', versions: v, createdAt: '' },
        ]),
      ),
    }),
  });
const snap = (threads: Thread[], versions?: Record<string, number>) => snapshotOf(topic(threads, versions));
const ENV: NotifyEnv = { enabled: true, permission: 'granted', hidden: true };
const delta = (prev: ReturnType<typeof snap> | null, next: ReturnType<typeof snap>) => shouldNotify(prev, next, ENV);

test('ベースライン（最初の読み込み・再接続の直後：前回がない）では、出さない', () => {
  expect(delta(null, snap([T('t', [ai('a1'), ask('q1')])], { root: 5 }))).toBeNull();
  expect(deltaOf(null, snap([T('t', [ai('a1')])]))).toBeNull();
});

test('新着＝前回の集合に無い ID：返信・質問・版。同じ状態・何も増えないときは、出さない', () => {
  const t0 = [T('t', [user('u1'), ai('a1')])];
  const prev = snap(t0);
  expect(delta(prev, snap([T('t', [user('u1'), ai('a1'), ai('a2'), ai('a3')])]))).toEqual({
    replies: 2,
    asks: 0,
    versions: 0,
  });
  expect(delta(prev, snap([T('t', [user('u1'), ai('a1'), ask('q1')])]))).toEqual({ replies: 0, asks: 1, versions: 0 });
  expect(delta(prev, snap(t0, { root: 2 }))).toEqual({ replies: 0, asks: 0, versions: 1 });
  expect(delta(prev, snap(t0, { root: 1, detail: 2 }))).toEqual({ replies: 0, asks: 0, versions: 2 }); // 新しいページの版も、新しい版
  expect(delta(prev, snap(t0))).toBeNull(); // 取り直しただけ
});

// S4：読んだあとに来た返信が、件数の差で見落とされていた
test('読んだあとの新着：前回に「AI の発言 a」→ 既読になる（ID は同じ）→ 新しい発言 b → 通知される', () => {
  const prev = snap([T('t', [ai('a')])]); // a は、前回に、未読で記録された
  const afterRead = snap([T('t', [ai('a')])]); // 読んだ：発言の ID は、同じ（既読かどうかは、関係ない）
  expect(delta(prev, afterRead)).toBeNull();
  expect(delta(afterRead, snap([T('t', [ai('a'), ai('b')])]))).toEqual({ replies: 1, asks: 0, versions: 0 }); // b：新着
});

// Minor 1：自分の操作で、数え直されて、「増えた」ように見えた
test('自分の操作では出ない：解決の取り消し・自分のメッセージの削除・読んだこと・質問に答えたこと', () => {
  const msgs = [user('u1'), ai('a1'), ask('q1'), user('u2')];
  const resolved = snap([T('t', msgs, { resolved: true })]);
  const reopened = snap([T('t', msgs, { resolved: false })]); // 解決の取り消し：未解決に戻って、未読・未回答の質問が、また数えられる
  expect(delta(resolved, reopened)).toBeNull();
  expect(delta(reopened, resolved)).toBeNull();
  // 自分のメッセージの削除：質問は、「会話が進んだ（stale）」から、未回答に戻る
  const stale = snap([T('t', msgs)]); // u2 があるので、q1 は、未回答でない
  const deleted = snap([T('t', [user('u1'), ai('a1'), ask('q1')])]);
  expect(delta(stale, deleted)).toBeNull();
  // 質問に答えた・答えを取り消した
  const answered = snap([T('t', [ask('q1'), answer('r1', 'q1')])]);
  const unanswered = snap([T('t', [ask('q1')])]);
  expect(delta(unanswered, answered)).toBeNull();
  expect(delta(answered, unanswered)).toBeNull(); // 取り消し：未回答に戻る（前回の asks に、q1 がある）
});

test('ID が入れ替わる（古い発言が消え、新しい発言が来る）：件数は同じでも、新しい ID は、新着', () => {
  expect(delta(snap([T('t', [ai('a1')])]), snap([T('t', [ai('b1')])]))).toEqual({ replies: 1, asks: 0, versions: 0 });
  expect(delta(snap([T('t', [ai('a1')])], { root: 2 }), snap([T('t', [ai('a1')])], { detail: 2 }))).toEqual({
    replies: 0,
    asks: 0,
    versions: 2,
  });
});

test('ID が縮むだけ（AI の発言・ページが消える）では、出さない。縮んだあとに、新しい ID が来たら、出す', () => {
  const big = snap([T('t', [ai('a1'), ai('a2'), ask('q1')])], { root: 3 });
  const small = snap([T('t', [ai('a1')])], { root: 1 });
  expect(delta(big, small)).toBeNull();
  expect(delta(small, snap([T('t', [ai('a1'), ai('a9')])]))).toEqual({ replies: 1, asks: 0, versions: 0 });
});

// レビューの Nit：「返信 1・質問 1」の二重に数えない
test('質問付きの AI の発言は、1 通につき「質問 1」だけ（返信にも数えない）。質問のない発言が「返信」', () => {
  const prev = snap([T('t', [user('u1')])]);
  expect(delta(prev, snap([T('t', [user('u1'), ask('q1')])]))).toEqual({ replies: 0, asks: 1, versions: 0 });
  expect(delta(prev, snap([T('t', [user('u1'), ai('a1'), ask('q1')])]))).toEqual({ replies: 1, asks: 1, versions: 0 });
  // 質問の新着は、いま、未回答のものだけ（届いてすぐ答えた質問は、数えない）
  expect(delta(prev, snap([T('t', [user('u1'), ask('q1'), answer('r1', 'q1')])]))).toBeNull();
  // 解決済みのスレッドに来た質問は、未回答として、数えない
  expect(delta(prev, snap([T('t', [user('u1'), ask('q1')], { resolved: true })]))).toBeNull();
});

test('出さない条件：オフ・許可が granted でない（default・denied・unsupported）・画面を見ている', () => {
  const prev = snap([T('t', [])]);
  const next = snap([T('t', [ai('a1')])]);
  expect(shouldNotify(prev, next, ENV)).not.toBeNull();
  expect(shouldNotify(prev, next, { ...ENV, enabled: false })).toBeNull();
  for (const permission of ['default', 'denied', 'unsupported'] as const)
    expect(shouldNotify(prev, next, { ...ENV, permission })).toBeNull();
  expect(shouldNotify(prev, next, { ...ENV, hidden: false })).toBeNull();
});

test('累計：画面を見ていない間に溜まった新着を足す（返信 1 → 返信 2）。0 の項目は、そのまま 0', () => {
  const a = { replies: 1, asks: 0, versions: 0 };
  const b = { replies: 1, asks: 1, versions: 2 };
  expect(addDelta(undefined, a)).toEqual(a);
  expect(addDelta(a, a)).toEqual({ replies: 2, asks: 0, versions: 0 });
  expect(addDelta(addDelta(a, b), a)).toEqual({ replies: 3, asks: 1, versions: 2 });
});

test('文言：「（トピック名）：AI から返信が届きました（返信 2・新しい版 1・質問 1）」。0 の項目は、省く。版だけなら「資料が更新されました」', () => {
  expect(NOTIFY_TITLE).toBe('rikai');
  expect(notifyBody('資料', { replies: 2, asks: 1, versions: 1 })).toBe(
    '資料：AI から返信が届きました（返信 2・新しい版 1・質問 1）',
  );
  expect(notifyBody('資料', { replies: 1, asks: 0, versions: 0 })).toBe('資料：AI から返信が届きました（返信 1）');
  expect(notifyBody('資料', { replies: 0, asks: 2, versions: 0 })).toBe('資料：AI から返信が届きました（質問 2）');
  expect(notifyBody('資料', { replies: 0, asks: 0, versions: 3 })).toBe('資料：資料が更新されました（新しい版 3）');
});

test('トピック名：文字のまま（HTML として解釈しない）・40 字に切る（絵文字を割らない）・制御文字・双方向文字の制御は、取り除く', () => {
  const one = { replies: 1, asks: 0, versions: 0 };
  expect(notifyBody('<b>太字</b> & "題"', one)).toBe('<b>太字</b> & "題"：AI から返信が届きました（返信 1）');
  expect(notifyBody('あ'.repeat(60), one)).toBe(`${'あ'.repeat(39)}…：AI から返信が届きました（返信 1）`);
  const lone = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
  const e = notifyBody(`${'あ'.repeat(38)}😀😀😀`, one);
  expect(e).toBe(`${'あ'.repeat(38)}😀…：AI から返信が届きました（返信 1）`);
  expect(e).not.toMatch(lone);
  expect(notifyBody('  空白   を\nつぶす ', one)).toBe('空白 を つぶす：AI から返信が届きました（返信 1）');
  // 双方向文字の制御（RLO など）・制御文字・ゼロ幅の向き指定：本文に入らない
  const evil = notifyBody('資\u202E料\u2066x\u2069\u200E\u200F\u0007\u0000終', one);
  expect(evil).toBe('資料x終：AI から返信が届きました（返信 1）');
  expect(evil).not.toMatch(/[\u202a-\u202e\u2066-\u2069\u200e\u200f\p{Cc}]/u);
});

// 通知のアイコン：data: の PNG（192×192・数 KB）。外部の URL ではない。絵の元（public/favicon.svg）が変わったら、作り直す
test('通知のアイコン：data:image/png;base64 の定数。PNG の署名・192×192・透過つき（RGBA）・20KB 以内。外部の URL ではない（data: で始まる）', () => {
  expect(NOTIFY_ICON.startsWith('data:image/png;base64,')).toBe(true);
  const b64 = NOTIFY_ICON.slice('data:image/png;base64,'.length);
  expect(b64).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
  const png = Buffer.from(b64, 'base64');
  expect([...png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]); // PNG の署名
  expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  expect(png.subarray(12, 16).toString('ascii')).toBe('IHDR');
  expect(png.readUInt32BE(16)).toBe(192); // 幅
  expect(png.readUInt32BE(20)).toBe(192); // 高さ
  expect(png[25]).toBe(6); // RGBA（角が透明）
  expect(png.length).toBeLessThanOrEqual(20 * 1024);
  expect(Buffer.from(b64, 'base64').toString('base64')).toBe(b64); // base64 として、正しい
});

test('通知のアイコンは、public/favicon.svg を描いたもの：元が変わっていたら、作り直す（lib/notifyIcon.ts のコメント）', () => {
  const svg = fs.readFileSync(path.resolve(__dirname, '../../../src/web/public/favicon.svg'));
  expect(createHash('sha256').update(svg).digest('hex')).toBe(NOTIFY_ICON_SOURCE_SHA256);
});
