// @vitest-environment jsdom
// パネルの純粋な判定：折りたたみ（F29）・答えずに進んだ質問（F30）・札・解決済みの 1 行（F33）・入力欄の位置（F22）・回答の下書き・添付の画像の URL（F24）
import { expect, test } from 'vitest';
import { answerOf, askStale } from '../../../src/shared/fresh';
import type { Ask, Message } from '../../../src/shared/types';
import {
  askDraftValid,
  composerSlot,
  foldMessages,
  imgUrl,
  lastSpeech,
  latestRevisionId,
  pickOption,
  plainText,
  quoteOf,
  replyExpanded,
  threadStatus,
  typeOther,
} from '../../../src/web/panel/logic';
import { say } from './fixtures';

const T = (messages: Message[], over: { resolved?: boolean } = {}) => ({
  id: 't1',
  resolved: false,
  ...over,
  messages,
});
const yn: Ask = { type: 'yes_no', question: '進めてよいですか？' };
const ask = (id: string, a: Ask = yn): Message =>
  say({ id, author: 'ai', kind: 'reply', text: '質問', sent: true, ask: a });
const ans = (id: string, to: string, sent: boolean): Message =>
  say({ id, author: 'user', kind: 'answer', to, answer: { value: true }, sent, text: undefined });
const ai = (id: string): Message => say({ id, author: 'ai', kind: 'reply', text: id, sent: true });
const me = (id: string, sent = true): Message => say({ id, author: 'user', kind: 'followup', text: id, sent });

/** 折りたたみの結果：表示するものの id と、たたんだ件数（`[older:3]`） */
function shape(segs: ReturnType<typeof foldMessages>): string[] {
  return segs.map((s) => (s.kind === 'msg' ? s.m.id : `[older:${s.items.length}]`));
}
const allSeen = (ms: Message[]) => new Set(ms.map((m) => m.id));

test('threadStatus：解決済み > 未送信 > AI の返信（最後が AI）> AI の返信待ち', () => {
  expect(threadStatus(T([me('a')], { resolved: true }))).toEqual(['解決済み', 'ok']);
  expect(threadStatus(T([ai('a'), me('b', false)]))).toEqual(['未送信', 'draft']);
  expect(threadStatus(T([me('a'), ai('b')]))).toEqual(['AI の返信', 'new']);
  expect(threadStatus(T([ai('a'), me('b')]))).toEqual(['AI の返信待ち', 'wait']);
  // 未送信は、回答でも数える（保存しただけの回答）
  expect(threadStatus(T([ask('q'), ans('a', 'q', false)]))[1]).toBe('draft');
});

test('quoteOf：選んだ文があれば、それ。なければ位置の名前（label）。旧い版が保存した、枠の見出しの注意は、表示から除く（保存したデータは、そのまま）', () => {
  const base = { blockId: 'b', blockHash: 'h', blockTag: 'DIV', blockText: '', prefix: '', suffix: '' };
  const legacy = '範囲：実行できる枠 2（隔離されています。パスワードなどの秘密は…（枠の幅 1028px で選択）';
  const a = { ...base, quote: '', label: legacy };
  expect(quoteOf({ anchor: a })).toBe('範囲：実行できる枠 2（枠の幅 1028px で選択）');
  expect(a.label).toBe(legacy);
  expect(quoteOf({ anchor: { ...base, quote: '選んだ文', label: legacy } })).toBe('選んだ文');
  expect(quoteOf({ anchor: { ...base, quote: '', label: '範囲：実行できる枠 1' } })).toBe('範囲：実行できる枠 1');
});

test('answerOf：質問への、いちばん新しい回答。別の質問への回答は、返さない', () => {
  const q1 = ask('q1');
  const t = T([q1, ask('q2'), ans('a1', 'q1', false), ans('a2', 'q1', true), ans('a3', 'q2', true)]);
  expect(answerOf(t, q1)?.id).toBe('a2');
  expect(answerOf(T([q1]), q1)).toBeNull();
});

// ---- F30：答えないまま会話が進んだ質問 ----
test('askStale：ユーザーのコメントから始まるスレッドの、AI の質問は、小さくしない。質問のメッセージは、id で探す（複製でも、同じ）', () => {
  const q = ask('q');
  const t = T([me('コメント'), q]);
  expect(askStale(t, q)).toBe(false);
  expect(askStale(t, { ...q })).toBe(false);
  const t2 = T([me('コメント'), q, me('続き')]);
  expect(askStale(t2, { ...q })).toBe(true);
});

test('askStale：答えがなく、あとに、送信した利用者の発言があるとき（F30）', () => {
  const q = ask('q');
  expect(askStale(T([q, me('u1')]), q)).toBe(true);
  // 質問で終わっている・AI の発言が続くだけ
  expect(askStale(T([q]), q)).toBe(false);
  expect(askStale(T([q, ai('a1')]), q)).toBe(false);
  // 未送信の発言は、数えない
  expect(askStale(T([q, me('u1', false)]), q)).toBe(false);
  // 別の質問への回答は、数えない（同じスレッドの 2 つの質問の、2 つ目から答えても、1 つ目は、小さくならない）
  const q2 = ask('q2');
  expect(askStale(T([q, q2, ans('a2', 'q2', false)]), q)).toBe(false);
  expect(askStale(T([q, q2, ans('a2', 'q2', true)]), q)).toBe(false);
  // 答えがある質問・解決済みは、小さくしない
  expect(askStale(T([q, ans('a', 'q', false), me('u1')]), q)).toBe(false);
  expect(askStale(T([q, me('u1')], { resolved: true }), q)).toBe(false);
});

test('askDraftValid：5 つの型ごとの、保存してよい形', () => {
  const single: Ask = { type: 'single_choice', question: '?', options: [{ id: 'a', label: 'A' }], allowOther: false };
  const singleOther: Ask = { ...single, allowOther: true } as Ask;
  const multi: Ask = { type: 'multi_choice', question: '?', options: [{ id: 'a', label: 'A' }], allowOther: false };
  const multiOther: Ask = { ...multi, allowOther: true } as Ask;
  const scale: Ask = { type: 'scale', question: '?', min: 1, max: 5 };
  const free: Ask = { type: 'free_text', question: '?' };

  expect(askDraftValid(single, null)).toBe(false);
  expect(askDraftValid(single, {})).toBe(false);
  expect(askDraftValid(single, { choice: 'a' })).toBe(true);
  expect(askDraftValid(single, { other: '自由' })).toBe(false); // allowOther でなければ、その他は使えない
  expect(askDraftValid(singleOther, { other: '  ' })).toBe(false);
  expect(askDraftValid(singleOther, { other: '自由' })).toBe(true);

  expect(askDraftValid(multi, { choices: [] })).toBe(false);
  expect(askDraftValid(multi, { choices: ['a'] })).toBe(true);
  expect(askDraftValid(multi, { other: 'x' })).toBe(false);
  expect(askDraftValid(multiOther, { choices: [], other: 'x' })).toBe(true);

  expect(askDraftValid(yn, {})).toBe(false);
  expect(askDraftValid(yn, { value: false })).toBe(true); // false も、答え
  expect(askDraftValid(yn, { value: 1 })).toBe(false);

  expect(askDraftValid(scale, { value: 3 })).toBe(true);
  expect(askDraftValid(scale, { value: 0 })).toBe(true); // 範囲の検査は、サーバー
  expect(askDraftValid(scale, { value: 2.5 })).toBe(false);
  expect(askDraftValid(scale, { value: true })).toBe(false);

  expect(askDraftValid(free, { text: '  ' })).toBe(false);
  expect(askDraftValid(free, { text: '答え' })).toBe(true);
});

test('pickOption・typeOther：下書きを、書き換えず、作り直す。単一は、選ぶと「その他」が消え、「その他」を書くと選択が外れる', () => {
  const d0 = { choice: 'a', other: 'x' };
  const picked = pickOption(d0, false, 'b', true);
  expect(picked).toEqual({ choice: 'b' });
  expect(d0).toEqual({ choice: 'a', other: 'x' });
  expect(typeOther({ choice: 'a' }, false, '自由')).toEqual({ other: '自由' });
  expect(typeOther({ choice: 'a' }, false, '')).toEqual({ choice: 'a', other: '' }); // 消したときは、選択を外さない
  // 複数：足す・外す。「その他」は、選択と、両立する
  expect(pickOption(null, true, 'a', true)).toEqual({ choices: ['a'] });
  expect(pickOption({ choices: ['a', 'b'], other: 'x' }, true, 'a', false)).toEqual({ choices: ['b'], other: 'x' });
  expect(typeOther({ choices: ['a'] }, true, 'x')).toEqual({ choices: ['a'], other: 'x' });
});

// ---- F29：会話の折りたたみ ----
test('foldMessages：短い会話は、たたまない', () => {
  const ms = [me('u1'), ai('a1'), me('u2')];
  expect(shape(foldMessages(T(ms), { full: false, seen: allSeen(ms), editing: null }))).toEqual(['u1', 'a1', 'u2']);
});

test('foldMessages：最新の 2 件・最新の AI・最新のユーザーを残し、そのあいだの 2 件以上を、たたむ（SPEC F29 の 7 往復）', () => {
  const ms = [me('u1'), ai('a1'), me('u2'), ai('a2'), me('u3'), ai('a3'), me('u4'), ai('a4')];
  const segs = foldMessages(T(ms), { full: false, seen: allSeen(ms), editing: null });
  // 最新の 2 件（u4・a4）。最新の AI は a4・最新のユーザーは u4：残りは、すべて、1 つにたたまれる
  expect(shape(segs)).toEqual(['[older:6]', 'u4', 'a4']);
  expect(segs[0]).toMatchObject({ kind: 'older', key: 't1:u1' });
});

test('foldMessages：番号を押して見るとき（full）は、たたまない', () => {
  const ms = [me('u1'), ai('a1'), me('u2'), ai('a2'), me('u3'), ai('a3')];
  expect(shape(foldMessages(T(ms), { full: true, seen: allSeen(ms), editing: null }))).toEqual(ms.map((m) => m.id));
});

test('foldMessages：ユーザーだけ・AI だけが続いても、最新の AI・最新のユーザーは、残る', () => {
  const ms = [ai('a1'), ai('a2'), ai('a3'), ai('a4'), me('u1'), me('u2'), me('u3'), me('u4')];
  const segs = foldMessages(T(ms), { full: false, seen: allSeen(ms), editing: null });
  // 最新の AI（a4）・最新の 2 件（u3・u4）・最新のユーザー（u4）。a4 の前の 3 件と、a4 と u3 の間の u1・u2 は、別々のたたみ
  expect(shape(segs)).toEqual(['[older:3]', 'a4', '[older:2]', 'u3', 'u4']);
});

test('foldMessages：未送信・編集中・答えていない質問は、たたまない', () => {
  const q = ask('q');
  const ms = [me('u1'), me('draft', false), ai('a1'), me('u2'), q, me('u3'), ai('a2'), me('u4'), ai('a3')];
  // q の後ろに、送信した発言があるので、q は「答えずに進んだ」：残す対象ではない
  const stale = foldMessages(T(ms), { full: false, seen: allSeen(ms), editing: null });
  expect(shape(stale)).not.toContain('q');
  const ms2 = [me('u1'), q, ai('a1'), ai('a2'), ai('a3'), ai('a4')];
  // 答えていなくて、会話が進んでいない質問は、残る（質問のあと、送信したユーザーの発言がない）
  expect(shape(foldMessages(T(ms2), { full: false, seen: allSeen(ms2), editing: null }))).toEqual([
    'u1',
    'q',
    '[older:2]',
    'a3',
    'a4',
  ]);
  // 編集中・未送信
  const ms3 = [me('u1'), ai('a1'), me('u2'), ai('a2'), me('u3'), ai('a3'), me('u4'), ai('a4')];
  expect(shape(foldMessages(T(ms3), { full: false, seen: allSeen(ms3), editing: 'a1' }))).toEqual([
    'u1',
    'a1',
    '[older:4]',
    'u4',
    'a4',
  ]);
  const ms4 = [me('u1'), ai('a1'), me('u2'), me('d', false), ai('a3'), me('u4'), ai('a4')];
  expect(shape(foldMessages(T(ms4), { full: false, seen: allSeen(ms4), editing: null }))).toEqual([
    '[older:3]',
    'd',
    'a3',
    'u4',
    'a4',
  ]);
});

test('foldMessages：まだ見ていない AI の返信は、最新の 4 件の中のものだけ、たたまない', () => {
  const ms = [ai('a1'), me('u1'), ai('a2'), me('u2'), ai('a3'), me('u3'), ai('a4'), me('u4')];
  // すべて既読：最新の AI（a4）・最新のユーザー（u4）・最新の 2 件（a4・u4）
  expect(shape(foldMessages(T(ms), { full: false, seen: allSeen(ms), editing: null }))).toEqual([
    '[older:6]',
    'a4',
    'u4',
  ]);
  // a3 だけ未読（最新の 4 件の中：index 4 ≥ 8-4）：a3 は残り、前後が、それぞれたたまれる
  const seen = allSeen(ms);
  seen.delete('a3');
  expect(shape(foldMessages(T(ms), { full: false, seen, editing: null }))).toEqual([
    '[older:4]',
    'a3',
    'u3',
    'a4',
    'u4',
  ]);
  // a1 だけ未読：最新の 4 件の外なので、たたまれたまま（初めて開く画面で、AI の返信が並ばない）
  const seen2 = allSeen(ms);
  seen2.delete('a1');
  expect(shape(foldMessages(T(ms), { full: false, seen: seen2, editing: null }))).toEqual(['[older:6]', 'a4', 'u4']);
});

test('foldMessages：回答（kind: answer）は、数えない（質問の下の入力欄で見せる）', () => {
  const q = ask('q');
  const ms = [q, ans('a', 'q', true), me('u1')];
  const ids = foldMessages(T(ms), { full: true, seen: new Set(), editing: null }).flatMap((s) =>
    s.kind === 'msg' ? [s.m.id] : s.items.map((m) => m.id),
  );
  expect(ids).toEqual(['q', 'u1']);
});

// ---- F22：入力欄の位置 ----
test('composerSlot：入力欄がなければ -1・対象が本文にないときは 0・対象の後ろの、最初のスレッドの前・後ろがなければ、位置のあるものの数', () => {
  const art = document.createElement('article');
  document.body.append(art);
  const el = (): HTMLElement => art.appendChild(document.createElement('p'));
  const [p1, p2, p3, p4] = [el(), el(), el(), el()] as [HTMLElement, HTMLElement, HTMLElement, HTMLElement];
  const locs: Record<string, HTMLElement | null> = { a: p1, b: p3, c: p4, none: null };
  const locOf = (tid: string) => locs[tid] ?? null;
  const live = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'none' }];

  expect(composerSlot(live, false, p2, locOf)).toBe(-1);
  expect(composerSlot(live, true, null, locOf)).toBe(0);
  expect(composerSlot(live, true, p2, locOf)).toBe(1); // a（p1）の後ろ・b（p3）の前
  expect(composerSlot(live, true, p1, locOf)).toBe(1); // 自分と同じ位置は、「後ろ」ではない
  const before = document.createElement('p');
  art.prepend(before);
  expect(composerSlot(live, true, before, locOf)).toBe(0);
  const after = el();
  expect(composerSlot(live, true, after, locOf)).toBe(3); // 位置のあるもの（a・b・c）のあと、位置のない none の前
  art.remove();
});

// ---- F33：解決済みの 1 行 ----
test('plainText：コード・図を略し、記号を外す', () => {
  expect(plainText('# 見出し\n\n**強調** と `code`\n```js\nconst x = 1;\n```\n続き')).toBe(
    '見出し 強調 と code （コード・図） 続き',
  );
  expect(plainText(undefined)).toBe('');
});

test('lastSpeech：最後の発言（回答は除く）。AI は「AI：」・自分は「あなた：」・画像だけは「（画像）」・長いものは切り詰める', () => {
  const q = ask('q');
  expect(lastSpeech(T([me('こんにちは'), ai('**了解**です')]))).toBe('AI：了解 です');
  expect(lastSpeech(T([ai('a'), me('お願いします')]))).toBe('あなた：お願いします');
  expect(lastSpeech(T([ai('a'), say({ author: 'user', text: '', images: ['x.png'], sent: true })]))).toBe(
    'あなた：（画像）',
  );
  // 回答は、最後の発言にしない
  expect(lastSpeech(T([me('先に'), q, ans('a', 'q', true)]))).toBe('AI：質問');
  expect(lastSpeech(T([]))).toBe('');
  expect(lastSpeech(T([me('あ'.repeat(100))]))).toBe(`あなた：${'あ'.repeat(47)}…`);
  // 画像もなく、記号だけの発言は、空
  expect(lastSpeech(T([say({ author: 'user', text: '***', sent: true })]))).toBe('');
});

test('imgUrl：トピックと名前を、URL エンコードして、assets の配信の道へ', () => {
  expect(imgUrl('demo', 'c-abc.png')).toBe('/asset/demo/c-abc.png');
  expect(imgUrl('a b', '../x.png')).toBe('/asset/a%20b/..%2Fx.png');
});

test('latestRevisionId：資料の更新（revision）を持つ AI の発言のうち、いちばん新しいもの。なければ null', () => {
  const m = (over: Partial<Message>) => say(over);
  const a = m({ author: 'ai', revision: 2 });
  const b = m({ author: 'ai', revision: 3 });
  const c = m({ author: 'ai' }); // 更新のない、新しい返信：最新の更新は、b のまま
  expect(latestRevisionId({ messages: [m({ author: 'user' }), a, b, c] })).toBe(b.id);
  expect(latestRevisionId({ messages: [a, c] })).toBe(a.id);
  expect(latestRevisionId({ messages: [m({ author: 'user' }), c] })).toBeNull();
});

test('replyExpanded：選んでいる・書きかけの文・付けた画像・アップロード中のどれかで開く。どれもなければ畳む（書きかけは、いつも開く）', () => {
  const none = { active: false, draft: '', imgs: 0, uploading: false };
  expect(replyExpanded(none)).toBe(false);
  expect(replyExpanded({ ...none, active: true })).toBe(true);
  expect(replyExpanded({ ...none, draft: '書きかけ' })).toBe(true);
  expect(replyExpanded({ ...none, draft: ' ' })).toBe(true); // 空白だけでも、書きかけ（消さない・隠さない）
  expect(replyExpanded({ ...none, imgs: 1 })).toBe(true);
  expect(replyExpanded({ ...none, uploading: true })).toBe(true);
});
