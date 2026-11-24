// 「いま、誰の番か」（F39）の判定：優先順位・境界・内訳の数え方・他のトピック（要約だけ）・押したときの行き先・読み上げの名前・タイトル
import { expect, test } from 'vitest';
import type { Message, Thread } from '../../../src/shared/types';
import { trunc } from '../../../src/web/lib/dom';
import {
  docTitle,
  firstTarget,
  openAsksOf,
  showsTurn,
  submitOffReason,
  TITLE_MAX,
  turnCount,
  turnDetail,
  turnLabel,
  turnOfSummary,
  turnOfTopic,
  turnStateName,
  unseenRepliesOf,
} from '../../../src/web/lib/turn';
import { msg, thread } from '../helpers';

const ai = (id: string, over: Partial<Message> = {}): Message =>
  msg({ id, author: 'ai', kind: 'reply', sent: true, text: '返信', ...over });
const ASK = { type: 'yes_no', question: '？' } as const;
const ask = (id: string): Message => ai(id, { ask: ASK });
const answer = (id: string, to: string, sent = true): Message =>
  msg({ id, kind: 'answer', to, answer: { value: true }, sent });
const user = (id: string, over: Partial<Message> = {}): Message => msg({ id, sent: true, ...over });
const T = (id: string, messages: Message[], over: Partial<Thread> = {}): Thread => thread({ id, messages, ...over });
const base = { unsent: 0, pending: 0, closed: false, seen: new Set<string>() };
const turn = (threads: Thread[], over: Partial<typeof base> = {}) => turnOfTopic({ threads, ...base, ...over });
const prog = (total: number, open: number, asks = 0, answered = 0) => ({
  threads: { total, open },
  asks: { total: asks, answered },
});
const sum = (p: ReturnType<typeof prog> | null, pending = 0, closed = false) =>
  turnOfSummary({ pending, closed, progress: p });

test('優先順位：終了 > 未送信 > AI の返信待ち > コメントなし > あなたの番 > 未解決だけ > すべて解決', () => {
  const mine = [T('t1', [ai('a1')])];
  expect(turn(mine, { closed: true, unsent: 3, pending: 1 }).kind).toBe('closed');
  expect(turn(mine, { unsent: 3, pending: 1 }).kind).toBe('unsent'); // 未送信は、AI の返信待ちより先
  expect(turn(mine, { unsent: 3 })).toMatchObject({ kind: 'unsent', unsent: 3 });
  expect(turn(mine, { pending: 2 }).kind).toBe('waiting-ai');
  expect(turn([], {}).kind).toBe('empty');
  expect(turn([], { pending: 1 }).kind).toBe('waiting-ai'); // スレッドがなくても、送信済みなら、待ち
  expect(turn(mine).kind).toBe('your-turn');
  expect(turn(mine, { seen: new Set(['a1']) }).kind).toBe('open'); // 新着も質問もなく、未解決だけ
  expect(turn([T('t1', [ai('a1')], { resolved: true })]).kind).toBe('done');
});

// 意図した変更（RIK-043 の再レビュー）：「あなたの番」は、AI の新着返信か未回答の質問があるときだけ。未解決だけなら、灰色の「未解決 n」（open）。
// 数字は、項目でなく、スレッドの数
test('あなたの番：新着の返信か、未回答の質問を持つスレッドの数（mine）。内訳（replies・asks）は、項目の数。見た返信は、数えない', () => {
  const threads = [T('t1', [user('u1'), ai('a1'), ai('a2')]), T('t2', [ask('q1')]), T('t3', [user('u3')])];
  expect(turn(threads)).toMatchObject({ kind: 'your-turn', replies: 3, asks: 1, mine: 2, open: 3 }); // t1・t2 の 2 スレッド
  const seen = new Set(['a1', 'a2']);
  expect(turn(threads, { seen })).toMatchObject({ replies: 1, asks: 1, mine: 1, open: 3 }); // q1 は未見：t2 だけ
  // 返信と、質問が、同じ発言：1 スレッド（項目は 2）
  const both = turn([T('t', [ask('q1')])]);
  expect(both).toMatchObject({ replies: 1, asks: 1, mine: 1 });
  expect(turnCount(both)).toBe(1);
  // 質問だけが残る（返信は見た）
  expect(turn(threads, { seen: new Set(['a1', 'a2', 'q1']) })).toMatchObject({
    kind: 'your-turn',
    replies: 0,
    asks: 1,
    mine: 1,
  });
  // 返信も質問もなく、未解決だけ：灰色の「未解決 n」
  const only = turn([T('t3', [user('u3')]), T('t4', [user('u4')])]);
  expect(only).toMatchObject({ kind: 'open', mine: 0, open: 2 });
  expect(turnLabel(only)).toBe('未解決 2');
  expect(turnDetail(only)).toBe('');
});

test('質問：回答（保存しただけでも）があれば、未回答でない。解決済みのスレッド・会話が進んだ（stale）質問は、数えない', () => {
  expect(openAsksOf(T('t', [ask('q1')]))).toBe(1);
  expect(openAsksOf(T('t', [ask('q1'), answer('a1', 'q1', false)]))).toBe(0); // 保存済み（未送信）：未送信のほうで、数える
  expect(openAsksOf(T('t', [ask('q1'), answer('a1', 'q1')]))).toBe(0);
  expect(openAsksOf(T('t', [ask('q1')], { resolved: true }))).toBe(0);
  expect(openAsksOf(T('t', [ask('q1'), user('u2')]))).toBe(0); // 答えないまま、会話が進んだ
  expect(openAsksOf(T('t', [ask('q1'), ask('q2')]))).toBe(2);
  expect(unseenRepliesOf(T('t', [ai('a1')], { resolved: true }), new Set())).toBe(0);
});

test('すべて解決：スレッドが 1 つ以上で、全部が解決済み。解決済みのスレッドの未回答の質問・新着は、数えない', () => {
  const done = turn([T('t1', [ask('q1')], { resolved: true }), T('t2', [ai('a2')], { resolved: true })]);
  expect(done).toMatchObject({ kind: 'done', replies: 0, asks: 0, mine: 0, open: 0 });
  expect(turn([T('t1', [], { resolved: true }), T('t2', [user('u')])]).kind).toBe('open'); // 1 つでも未解決
});

test('他のトピック（要約だけ）：pending・progress・closed。未回答の質問があれば、あなたの番。なければ、未解決（灰色）。unsent と内訳は、ない', () => {
  expect(sum(prog(0, 0)).kind).toBe('empty');
  expect(sum(null).kind).toBe('empty');
  expect(sum(prog(2, 1), 1).kind).toBe('waiting-ai');
  // 未回答の ask（asks.total − asks.answered > 0）：あなたの番
  expect(sum(prog(2, 1, 2, 1))).toMatchObject({ kind: 'your-turn', replies: 0, asks: 0, mine: 0 });
  expect(turnDetail(sum(prog(2, 1, 2, 1)))).toBe(''); // 開いていないトピックは、内訳なし
  expect(turnLabel(sum(prog(2, 1, 2, 1)))).toBe('あなたの番'); // 数は、分からない
  // 質問に、すべて答えた・質問がない：未解決があれば「未解決 n」
  expect(sum(prog(2, 1, 2, 2))).toMatchObject({ kind: 'open', open: 1 });
  expect(sum(prog(2, 1))).toMatchObject({ kind: 'open', open: 1 });
  expect(sum(prog(2, 0)).kind).toBe('done');
  expect(sum(prog(2, 1), 1, true).kind).toBe('closed');
  expect(sum(prog(2, 1, 2, 0), 0, true).kind).toBe('closed');
  expect(sum(prog(2, 1, 2, 0), 1).kind).toBe('waiting-ai'); // 待ちが先
});

test('開いているトピックと、要約だけの判定は、（未送信・新着・内訳を除いて）同じ種類になる', () => {
  const threads = [T('t1', [ask('q1')]), T('t2', [user('u')], { resolved: true })];
  expect(turn(threads).kind).toBe(sum(prog(2, 1, 1, 0)).kind); // 質問が未回答：あなたの番
  const seen = new Set(['q1']);
  const answered = [T('t1', [ask('q1'), answer('a', 'q1')]), T('t2', [user('u')], { resolved: true })];
  expect(turn(answered, { seen }).kind).toBe(sum(prog(2, 1, 1, 1)).kind); // 答えた：未解決だけ
  expect(turn(threads, { pending: 1 }).kind).toBe(sum(prog(2, 1, 1, 0), 1).kind);
});

test('文言：見える文字は「あなたの番 n（スレッドの数）」「未解決 n」「未送信 n 件」。内訳は、項目の数で、別', () => {
  expect(turnLabel(turn([T('t', [ai('a')])], { unsent: 3 }))).toBe('未送信 3 件');
  expect(turnLabel(turn([T('t', [ai('a')])], { pending: 1 }))).toBe('AIの返信待ち');
  const mine = turn([T('t1', [ask('q1')]), T('t2', [ai('a2')])]);
  expect(turnLabel(mine)).toBe('あなたの番 2');
  expect(turnDetail(mine)).toBe('AI の返信 2・未回答の質問 1');
  expect(turnCount(mine)).toBe(2);
  expect(turnLabel(turn([T('t', [], { resolved: true })]))).toBe('すべて解決');
  expect(showsTurn(turn([]))).toBe(false);
  expect(showsTurn(turn([], { closed: true }))).toBe(false);
  expect(showsTurn(turn([T('t', [user('u')])]))).toBe(true); // 未解決だけも、印を出す（灰色）
});

test('読み上げる状態の名前（aria-live の中）：件数を含まない。件数だけが変わっても、同じ文字', () => {
  const unsent = (n: number) => turnStateName(turn([T('t', [ai('a')])], { unsent: n }));
  expect(unsent(1)).toBe('未送信あり');
  expect(unsent(2)).toBe(unsent(1));
  const mine = (...ids: string[]) => turnStateName(turn(ids.map((id) => T(id, [ai(`a${id}`)]))));
  expect(mine('t1')).toBe('あなたの番');
  expect(mine('t1', 't2', 't3')).toBe(mine('t1'));
  expect(turnStateName(turn([T('t', [ai('a')])], { pending: 1 }))).toBe('AIの返信待ち');
  expect(turnStateName(turn([T('t', [user('u')])]))).toBe('未解決あり');
  expect(turnStateName(turn([T('t', [], { resolved: true })]))).toBe('すべて解決');
  expect(turnStateName(turn([]))).toBe('');
  for (const t of [turn([T('t', [ai('a')])], { unsent: 12 }), turn([T('t', [user('u')]), T('s', [user('v')])])])
    expect(turnStateName(t)).not.toMatch(/\d/);
});

test('押したときの行き先：AI の新着返信のあるスレッド → 未回答の質問 → 最初の未解決。解決済みは、飛ばす', () => {
  const t1 = T('t1', [user('u1')]);
  const t2 = T('t2', [ask('q2')]);
  const t3 = T('t3', [ai('a3')]);
  const t0 = T('t0', [ai('a0')], { resolved: true });
  expect(firstTarget([t0, t1, t2, t3], new Set())?.id).toBe('t2'); // t2 の質問（AI の発言）が、先の新着
  expect(firstTarget([t0, t1, t3, t2], new Set())?.id).toBe('t3');
  expect(firstTarget([t0, t1, t2, t3], new Set(['q2', 'a3']))?.id).toBe('t2'); // 新着なし → 未回答の質問
  expect(firstTarget([t0, t1, t3], new Set(['a3']))?.id).toBe('t1'); // 質問もなし → 最初の未解決
  expect(firstTarget([t0], new Set())).toBeNull();
});

test('タブのタイトル：(n) あなたの番（n＝スレッドの数）／未解決 n／AIの返信待ち／未送信 n 件／すべて解決／状態なし。題は 40 字に切る。文字のまま', () => {
  const mine = turn([T('t1', [ask('q1')]), T('t2', [ai('a2')])]);
  expect(docTitle(mine, '資料')).toBe('(2) あなたの番 | 資料 | rikai');
  // 1 つの返信に質問が付いているだけ：(1)（2 回数えない）
  expect(docTitle(turn([T('t1', [ask('q1')])]), '資料')).toBe('(1) あなたの番 | 資料 | rikai');
  expect(docTitle(turn([T('t', [user('u')]), T('s', [user('v')])]), '資料')).toBe('未解決 2 | 資料 | rikai'); // (n) なし
  expect(docTitle(turn([T('t', [ai('a')])], { pending: 1 }), '資料')).toBe('AIの返信待ち | 資料 | rikai');
  expect(docTitle(turn([T('t', [ai('a')])], { unsent: 3 }), '資料')).toBe('未送信 3 件 | 資料 | rikai');
  expect(docTitle(turn([T('t', [], { resolved: true })]), '資料')).toBe('すべて解決 | 資料 | rikai');
  expect(docTitle(turn([]), '資料')).toBe('資料 | rikai');
  expect(docTitle(turn([], { closed: true }), '資料')).toBe('資料 | rikai');
  expect(docTitle(null, '資料')).toBe('資料 | rikai');
  expect(docTitle(null, null)).toBe('rikai');
  expect(docTitle(null, '')).toBe('rikai');
  // 40 字（… を含む）
  expect(TITLE_MAX).toBe(40);
  expect(docTitle(null, 'あ'.repeat(60))).toBe(`${'あ'.repeat(39)}… | rikai`);
  expect(docTitle(null, 'あ'.repeat(40))).toBe(`${'あ'.repeat(40)} | rikai`); // 40 字ちょうど：切らない
  // HTML の文字は、そのまま
  expect(docTitle(null, '<b>x</b> & "y"')).toBe('<b>x</b> & "y" | rikai');
  expect(docTitle(null, '  空白   を\nつぶす ')).toBe('空白 を つぶす | rikai');
});

test('切り詰めは、コードポイント単位：絵文字（サロゲートペア）を、半分に割らない。結合文字も、孤立した半端な文字にしない', () => {
  const lone = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
  // 絵文字（1 文字 = UTF-16 で 2 つ）が、境界にかかる
  const emoji = `${'あ'.repeat(38)}😀😀😀`;
  const t = docTitle(null, emoji);
  expect(t).toBe(`${'あ'.repeat(38)}😀… | rikai`); // 39 字 + …
  expect(t).not.toMatch(lone);
  expect([...trunc('😀😀😀😀', 3)]).toEqual(['😀', '😀', '…']);
  expect(trunc('😀😀😀', 3)).toBe('😀😀😀'); // ちょうど 3 字：切らない
  // 結合文字（e + 結合アクセント）：コードポイント単位でも、孤立したサロゲートは出ない
  const comb = `${'e\u0301'.repeat(30)}`; // 60 コードポイント
  expect(docTitle(null, comb)).not.toMatch(lone);
  expect([...trunc(comb, 40)].length).toBe(40);
  // 家族の絵文字（ZWJ 連結）：コードポイントで切る（孤立したサロゲートは、出ない）
  expect(trunc('👨‍👩‍👧‍👦'.repeat(20), 40)).not.toMatch(lone);
});

test('Submit が押せない理由：未送信なら null。終了・AI の返信待ち・コメントなし・ほかの状態ごとに、別の文。トピックがなければ、その旨', () => {
  const mine = [T('t1', [ai('a1')])];
  expect(submitOffReason(turn(mine, { unsent: 2 }))).toBeNull();
  expect(submitOffReason(turn(mine, { closed: true }))).toContain('終了');
  expect(submitOffReason(turn(mine, { pending: 1 }))).toContain('AI の返信を待っています');
  expect(submitOffReason(turn([]))).toContain('コメントを書くと、送れます');
  for (const t of [turn(mine), turn(mine, { seen: new Set(['a1']) }), turn([T('t1', [ai('a1')], { resolved: true })])])
    expect(submitOffReason(t)).toContain('未送信のものがありません'); // あなたの番・未解決・すべて解決：送るものがない
  expect(submitOffReason(null)).toContain('トピックがありません');
  // どの理由も、空でない・互いに違う（押せない理由が、状態ごとに言い分けられる）
  const all = [turn(mine, { closed: true }), turn(mine, { pending: 1 }), turn([]), turn(mine)].map(submitOffReason);
  expect(new Set(all).size).toBe(4);
});
