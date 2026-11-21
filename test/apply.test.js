'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { rikai, tempProject, removeProject, makeTopic, addComment, submit, readThreads, httpError, singleAsk } = require('./helpers.js');

let dir;
test.beforeEach(() => { dir = tempProject(); makeTopic(); });
test.afterEach(() => removeProject(dir));

const files = () => fs.readdirSync(path.join(dir, '.rikai', 'demo', 'pages')).sort();
const snapshot = () => JSON.stringify([
  fs.readFileSync(path.join(dir, '.rikai', 'demo', 'meta.json'), 'utf8'),
  fs.readFileSync(path.join(dir, '.rikai', 'demo', 'threads.json'), 'utf8'),
  files(),
  rikai.listRounds('demo'),
]);

test('誤りがあれば、すべての誤りを返し、何も書かない', () => {
  const id = addComment();
  submit();
  const before = snapshot();
  assert.throws(() => rikai.cmdApply('demo', {
    replies: [{ thread: 't99', body: '' }, { thread: id, body: '有効な返信' }],
    revisions: [{ page: 'nope', markdown: 'x' }],
    pages: [{ id: 'Bad_ID', title: '', markdown: '' }],
  }), (e) => e instanceof rikai.HttpError && e.status === 400 && e.message.split('\n').length >= 5);
  assert.equal(snapshot(), before, '有効な返信も書かれず、round も pending のまま');
});

test('返信・新版・子ページ・質問を 1 回で反映し、round を handled にする', () => {
  const id = addComment();
  submit();
  const r = rikai.cmdApply('demo', {
    round: 1,
    replies: [{ thread: id, body: '返信です', page: 'detail', ask: singleAsk }],
    revisions: [{ page: 'root', markdown: '# 題\n\n直した本文です。\n' }],
    pages: [{ id: 'detail', title: '詳細', markdown: '# 詳細\n' }],
    threads: [{ page: 'root', anchor: { quote: '直した' }, body: '確認です', ask: { type: 'yes_no', question: 'いい？' } }],
  });
  assert.deepEqual(r.handledRounds, [1]);
  assert.deepEqual(r.newPages, ['detail']);
  assert.deepEqual(r.revised, { root: 2 });
  assert.deepEqual(r.repliedThreads, [id]);
  assert.equal(r.unansweredThreads, undefined);

  const meta = rikai.loadMeta('demo');
  assert.equal(meta.pages.root.versions, 2);
  assert.equal(meta.pages.detail.parent, 'root');
  assert.deepEqual(meta.pending, []);
  assert.equal(rikai.listRounds('demo')[0].status, 'handled');
  assert.match(fs.readFileSync(rikai.pageFile('demo', 'root', 2), 'utf8'), /直した本文/);
  assert.match(fs.readFileSync(rikai.pageFile('demo', 'root', 1), 'utf8'), /本文です/, '古い版は残る');

  const [t1, t2] = readThreads().threads;
  const reply = t1.messages.find((m) => m.author === 'ai');
  assert.equal(reply.revision, 2, '資料を直した返信には、新しい版が付く');
  assert.equal(reply.page, 'detail');
  assert.equal(reply.ask.type, 'single_choice');
  assert.equal(t2.origin, 'ai');
  assert.equal(t2.messages[0].ask.type, 'yes_no');
});

test('返信し忘れたスレッドを知らせる（解決・再開の通知だけのものは除く）', () => {
  const a = addComment();
  const b = addComment({ text: '別の質問' });
  submit();
  const r = rikai.cmdApply('demo', { replies: [{ thread: a, body: '返信' }] });
  assert.deepEqual(r.unansweredThreads, [b]);
  assert.match(r.warning, /返信していない/);
});

test('同じページは、1 回の apply で 1 回しか直せない。存在しない参照は断る', () => {
  assert.throws(() => rikai.cmdApply('demo', {
    revisions: [{ page: 'root', markdown: 'a' }, { page: 'root', markdown: 'b' }],
  }), httpError(400, /2回直せない/));
  assert.throws(() => rikai.cmdApply('demo', { pages: [{ id: 'x', title: 't', parent: 'nope', markdown: 'm' }] }), httpError(400, /parent/));
  assert.throws(() => rikai.cmdApply('demo', { pages: [{ id: 'root', title: 't', markdown: 'm' }] }), httpError(400, /既存/));
  const id = addComment();
  assert.throws(() => rikai.cmdApply('demo', { replies: [{ thread: id, body: 'b', page: 'nope' }] }), httpError(400, /page/));
});

test('同じ呼び出しで作った子ページへ、返信からリンクできる。孫ページも作れる', () => {
  const id = addComment();
  rikai.cmdApply('demo', {
    replies: [{ thread: id, body: 'b', page: 'child' }],
    pages: [{ id: 'child', title: '子', markdown: 'c' }, { id: 'grand', title: '孫', parent: 'child', markdown: 'g' }],
  });
  assert.equal(rikai.loadMeta('demo').pages.grand.parent, 'child');
  assert.deepEqual(files(), ['child', 'grand', 'root']);
});

test('round を指定すると、その round だけを処理する。未処理でない round は断る', () => {
  const id = addComment();
  submit();
  rikai.actions.reply({ topic: 'demo', thread: id, text: '追加' });
  submit();
  assert.deepEqual(rikai.loadMeta('demo').pending, [1, 2]);
  assert.throws(() => rikai.cmdApply('demo', { round: 9, replies: [] }), httpError(400, /未処理ではありません/));
  const r = rikai.cmdApply('demo', { round: 1, replies: [{ thread: id, body: '返信' }] });
  assert.deepEqual(r.handledRounds, [1]);
  assert.deepEqual(rikai.loadMeta('demo').pending, [2]);
  assert.deepEqual(rikai.cmdApply('demo', {}).handledRounds, [2], 'round を省くと、残りを処理する');
});

test('質問が不正なら、apply 全体を断る', () => {
  const id = addComment();
  assert.throws(() => rikai.cmdApply('demo', {
    replies: [{ thread: id, body: 'b', ask: { type: 'single_choice', question: 'q', options: [{ id: 'a', label: 'A' }] } }],
  }), httpError(400, /options/));
  assert.equal(readThreads().threads[0].messages.length, 1);
});
