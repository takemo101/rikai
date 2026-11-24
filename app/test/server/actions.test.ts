import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'vitest';
import type { Anchor, Message, Round, RoundItem, RoundPage, Thread } from '../../src/shared/types';
import {
  addComment,
  httpError,
  makeTopic,
  type Project,
  readThreads,
  removeProject,
  submit as submitRound,
  tempProject,
} from './helpers';

let p: Project;
beforeEach(() => {
  p = tempProject();
  makeTopic(p);
});
afterEach(() => removeProject(p));

// 見つからないとき（スレッドごと消えたあと）は undefined。使う側が、あるものとして読む
const thread = (id: string): Thread => readThreads(p).threads.find((t) => t.id === id) as Thread;
// 未処理の round がないときの、未送信の数（peek の unsent）
const unsent = (): number => {
  const r = p.agent.peek('demo');
  return 'unsent' in r ? r.unsent : -1;
};

test('コメントは、最新版にだけ付けられ、空は受けない', () => {
  assert.throws(
    () => p.actions.comment({ topic: 'demo', page: 'root', version: 2, anchor: null, text: 'x' }),
    httpError(400, /最新版/),
  );
  assert.throws(
    () => p.actions.comment({ topic: 'demo', page: 'root', version: 1, anchor: null, text: '  ' }),
    httpError(400, /空/),
  );
  assert.throws(
    () => p.actions.comment({ topic: 'demo', page: 'nope', version: 1, anchor: null, text: 'x' }),
    httpError(400, /ページ/),
  );
  const id = addComment(p);
  assert.equal(thread(id).messages[0].sent, false);
});

test('アンカーは、長さを切って保存する（ブロックの種類・内容の抜粋も）', () => {
  const id = addComment(p, {
    anchor: {
      quote: 'あ'.repeat(5000),
      blockTag: 'TABLE'.repeat(9),
      blockText: 'い'.repeat(500),
      label: 'l'.repeat(500),
    },
  });
  const a = thread(id).anchor as Anchor;
  assert.equal(a.quote.length, 2000);
  assert.equal(a.blockTag.length, 16);
  assert.equal(a.blockText.length, 200);
  assert.equal(a.label.length, 120);
});

test('送るまでは、編集・削除できる。送ったあとは変えられない', () => {
  const id = addComment(p);
  const m = thread(id).messages[0].id;
  p.actions.edit({ topic: 'demo', thread: id, msg: m, text: '直した' });
  assert.equal(thread(id).messages[0].text, '直した');
  assert.throws(() => p.actions.edit({ topic: 'demo', thread: id, msg: m, text: '' }), httpError(400, /空/));

  submitRound(p);
  assert.throws(
    () => p.actions.edit({ topic: 'demo', thread: id, msg: m, text: 'もう一度' }),
    httpError(400, /送信済み/),
  );
  assert.throws(() => p.actions.delete({ topic: 'demo', thread: id, msg: m }), httpError(400, /送信済み/));
});

test('最後の下書きを消すと、スレッドごと消える', () => {
  const id = addComment(p);
  p.actions.delete({ topic: 'demo', thread: id, msg: thread(id).messages[0].id });
  assert.equal(thread(id), undefined);
});

test('他人の（AI の）メッセージは、編集・削除できない', () => {
  const id = addComment(p);
  submitRound(p);
  p.agent.cmdApply('demo', { replies: [{ thread: id, body: '返信' }] });
  const ai = thread(id).messages.find((m) => m.author === 'ai') as Message;
  assert.throws(() => p.actions.delete({ topic: 'demo', thread: id, msg: ai.id }), httpError(404));
});

test('Submit：送るものがなければ断る。メモだけなら送れる', () => {
  assert.throws(() => submitRound(p), httpError(400, /送るコメント/));
  assert.equal(submitRound(p, '全体のメモ'), 1);
  const round = JSON.parse(fs.readFileSync(path.join(p.dir, '.rikai', 'demo', 'rounds', '001.json'), 'utf8'));
  assert.equal(round.status, 'pending');
  assert.equal(round.overallNote, '全体のメモ');
  assert.deepEqual(round.items, []);
  assert.deepEqual(p.store.loadMeta('demo').pending, [1]);
});

const roundFile = (n: number): Round =>
  JSON.parse(
    fs.readFileSync(path.join(p.dir, '.rikai', 'demo', 'rounds', `${String(n).padStart(3, '0')}.json`), 'utf8'),
  );

test('Submit：未送信を、スレッドごとにまとめ、これまでのやり取りと最新版の場所を添える', () => {
  const id = addComment(p);
  submitRound(p);
  p.agent.cmdApply('demo', { replies: [{ thread: id, body: '最初の返信' }] });
  p.actions.reply({ topic: 'demo', thread: id, text: '追加の質問' });
  assert.equal(submitRound(p), 2);

  const round = roundFile(2);
  assert.equal(round.items.length, 1);
  const item = round.items[0] as RoundItem;
  assert.equal(item.thread, id);
  assert.deepEqual(
    item.new.map((m) => [m.kind, m.text]),
    [['followup', '追加の質問']],
  );
  assert.deepEqual(
    item.history.map((m) => m.author),
    ['user', 'ai'],
  );
  assert.equal(item.anchor?.quote, '本文');
  assert.match((round.pages.root as RoundPage).file, /pages[/\\]root[/\\]v1\.md$/);
  assert.ok(thread(id).messages.every((m) => m.sent));
});

test('「理解できた」と「再開」は、次の Submit で AI に届き、返信の追加でも再開する', () => {
  const id = addComment(p);
  submitRound(p);
  p.agent.cmdApply('demo', { replies: [{ thread: id, body: '返信' }] });

  p.actions.resolve({ topic: 'demo', thread: id, resolved: true });
  assert.equal(thread(id).resolved, true);
  submitRound(p);
  const round = roundFile(2);
  assert.equal(round.items[0]?.userMarked, 'resolved');
  assert.deepEqual(round.items[0]?.new, []);

  p.actions.reply({ topic: 'demo', thread: id, text: 'やっぱり質問' });
  assert.equal(thread(id).resolved, false);
});

test('「解決」と「再開」を、送る前に往復しても、AI に送る変更はない（通知にならない）', () => {
  const id = addComment(p);
  submitRound(p);
  p.agent.cmdApply('demo', { replies: [{ thread: id, body: '返信' }] });

  p.actions.resolve({ topic: 'demo', thread: id, resolved: true });
  assert.equal(unsent(), 1, '解決の操作が、未送信として 1 件');
  p.actions.resolve({ topic: 'demo', thread: id, resolved: false });
  assert.equal(unsent(), 0, '元に戻したので、送るものはない');
  assert.throws(() => submitRound(p), httpError(400, /送るコメント/));
});

test('AI が「解決」と知っているスレッドを、再開して、また解決しても、送る変更はない。再開だけなら、reopened が届く', () => {
  const id = addComment(p);
  submitRound(p);
  p.agent.cmdApply('demo', { replies: [{ thread: id, body: '返信' }] });
  p.actions.resolve({ topic: 'demo', thread: id, resolved: true });
  submitRound(p); // AI は「解決」と知っている
  p.agent.cmdApply('demo', {}); // 届いた round を処理する（未処理があると、peek は unsent でなく feedback を返す）

  p.actions.resolve({ topic: 'demo', thread: id, resolved: false });
  p.actions.resolve({ topic: 'demo', thread: id, resolved: true });
  assert.equal(unsent(), 0);

  p.actions.resolve({ topic: 'demo', thread: id, resolved: false });
  assert.equal(submitRound(p), 3);
  const round = roundFile(3);
  assert.equal(round.items[0]?.userMarked, 'reopened');
});

test('存在しないスレッド・メッセージは 404', () => {
  assert.throws(() => p.actions.reply({ topic: 'demo', thread: 't99', text: 'x' }), httpError(404));
  const id = addComment(p);
  assert.throws(() => p.actions.edit({ topic: 'demo', thread: id, msg: 'm99', text: 'x' }), httpError(404));
});

test('AI が「解決」と知っているスレッドへの返信は、再開として AI に届く。返信を消しても、再開は届く', () => {
  const id = addComment(p);
  submitRound(p);
  p.agent.cmdApply('demo', { replies: [{ thread: id, body: '返信' }] });
  p.actions.resolve({ topic: 'demo', thread: id, resolved: true });
  submitRound(p); // AI は「解決」と知っている
  p.agent.cmdApply('demo', {});

  p.actions.reply({ topic: 'demo', thread: id, text: 'やっぱり質問' });
  const followup = thread(id).messages.find((m) => m.kind === 'followup' && !m.sent) as Message;
  p.actions.delete({ topic: 'demo', thread: id, msg: followup.id });
  assert.equal(unsent(), 1, '返信を消しても、再開は、AI に伝えていない');
  assert.equal(submitRound(p), 3);
  const round = roundFile(3);
  assert.equal(round.items[0]?.userMarked, 'reopened');
  assert.deepEqual(round.items[0]?.new, []);
});

test('AI が「解決」と知っているスレッドへ返信してから、また「解決」にすると、解決の通知は要らない（返信だけが届く）', () => {
  const id = addComment(p);
  submitRound(p);
  p.agent.cmdApply('demo', { replies: [{ thread: id, body: '返信' }] });
  p.actions.resolve({ topic: 'demo', thread: id, resolved: true });
  submitRound(p);
  p.agent.cmdApply('demo', {});

  p.actions.reply({ topic: 'demo', thread: id, text: '補足の質問' });
  p.actions.resolve({ topic: 'demo', thread: id, resolved: true });
  assert.equal(submitRound(p), 3);
  const round = roundFile(3);
  assert.equal(round.items[0]?.userMarked, undefined, 'AI は、すでに「解決」と知っている');
  assert.deepEqual(
    round.items[0]?.new.map((m) => m.text),
    ['補足の質問'],
  );
});

// ---- 追加：agent を使わずに確かめる、解決・回答の状態（threads.json を直接見る） ----

test('解決：送ったあとの変更は未送信になり、元に戻すと未送信でなくなる。返信は、解決を再開に戻す', () => {
  const id = addComment(p);
  submitRound(p);
  assert.equal(thread(id).resolveSent, true);
  p.actions.resolve({ topic: 'demo', thread: id, resolved: true });
  assert.deepEqual([thread(id).resolved, thread(id).resolveSent], [true, false]);
  p.actions.resolve({ topic: 'demo', thread: id, resolved: false });
  assert.deepEqual([thread(id).resolved, thread(id).resolveSent], [false, true]);
  p.actions.resolve({ topic: 'demo', thread: id, resolved: true });
  submitRound(p);
  assert.equal(thread(id).resolveSent, true);
  p.actions.reply({ topic: 'demo', thread: id, text: '続き' });
  assert.deepEqual([thread(id).resolved, thread(id).resolveSent], [false, false]);
});

test('送信済みの回答は、選び直しも取り消しもできない（質問は、threads.json に直接置く）', () => {
  const id = addComment(p);
  const th = p.store.loadThreads('demo');
  th.threads[0].messages.push({
    id: 'm9',
    author: 'ai',
    kind: 'reply',
    at: 'x',
    text: '質問',
    sent: true,
    ask: { type: 'yes_no', question: 'q' },
  });
  th.seq = 9;
  p.store.saveThreads('demo', th);
  p.actions.answer({ topic: 'demo', thread: id, msg: 'm9', answer: { value: true } });
  submitRound(p);
  assert.throws(
    () => p.actions.answer({ topic: 'demo', thread: id, msg: 'm9', answer: { value: false } }),
    httpError(400, /送信済みの回答/),
  );
  assert.throws(
    () => p.actions.answer({ topic: 'demo', thread: id, msg: 'm9', answer: null }),
    httpError(400, /送信済みの回答/),
  );
});

test('Submit：AI に渡すメッセージの形（キーの順・空文字と 0 は残す・null は省く・余分なキーは落とす・画像は絶対パス）', () => {
  const id = addComment(p);
  const file = path.join(p.store.tdir('demo'), 'threads.json');
  const th = JSON.parse(fs.readFileSync(file, 'utf8'));
  const base = { author: 'ai', kind: 'reply', at: '2026-01-01T00:00:00Z', sent: true, round: 0, junk: 'x' };
  th.threads[0].messages = [
    // 履歴（送信済み）：全項目あり。値は、型の都合のない作り物（保存された JSON を、そのまま読む形）
    {
      ...base,
      id: 'h1',
      revision: 3,
      page: 'child',
      to: 'u0',
      answer: { text: 'はい' },
      ask: { type: 'text', question: '質問' },
      frameMeta: { state: '{"a":1}' },
      text: '本文',
      images: ['a.png', 'b.png'],
    },
    // 新規（未送信）：空文字と 0 は残す。null・省略・空の画像は省く
    {
      id: 'n1',
      author: 'user',
      kind: 'followup',
      at: '2026-01-01T00:00:00Z',
      junk: 'x',
      images: [],
      text: '',
      revision: 0,
      to: '',
      page: null,
      ask: null,
      answer: null,
      frameMeta: null,
    },
  ];
  fs.writeFileSync(file, JSON.stringify(th));
  submitRound(p);
  const round: Round = JSON.parse(fs.readFileSync(path.join(p.dir, '.rikai', 'demo', 'rounds', '001.json'), 'utf8'));
  const item = round.items.find((i) => i.thread === id) as RoundItem;
  const a = path.join(p.store.tdir('demo'), 'assets');

  assert.deepEqual(Object.keys(item.history[0]), [
    'id',
    'author',
    'kind',
    'text',
    'frameMeta',
    'ask',
    'answer',
    'to',
    'page',
    'revision',
    'images',
  ]);
  assert.deepEqual(item.history[0], {
    id: 'h1',
    author: 'ai',
    kind: 'reply',
    text: '本文',
    frameMeta: { state: '{"a":1}' },
    ask: { type: 'text', question: '質問' },
    answer: { text: 'はい' },
    to: 'u0',
    page: 'child',
    revision: 3,
    images: [path.join(a, 'a.png'), path.join(a, 'b.png')],
  });
  assert.deepEqual(Object.keys(item.new[0]), ['id', 'author', 'kind', 'text', 'to', 'revision']);
  assert.deepEqual(item.new[0], { id: 'n1', author: 'user', kind: 'followup', text: '', to: '', revision: 0 });
});
