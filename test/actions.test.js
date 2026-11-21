'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { rikai, tempProject, removeProject, makeTopic, addComment, submit, readThreads, httpError } = require('./helpers.js');

let dir;
test.beforeEach(() => { dir = tempProject(); makeTopic(); });
test.afterEach(() => removeProject(dir));

const A = rikai.actions;
const thread = (id) => readThreads().threads.find((t) => t.id === id);

test('コメントは、最新版にだけ付けられ、空は受けない', () => {
  assert.throws(() => A.comment({ topic: 'demo', page: 'root', version: 2, anchor: null, text: 'x' }), httpError(400, /最新版/));
  assert.throws(() => A.comment({ topic: 'demo', page: 'root', version: 1, anchor: null, text: '  ' }), httpError(400, /空/));
  assert.throws(() => A.comment({ topic: 'demo', page: 'nope', version: 1, anchor: null, text: 'x' }), httpError(400, /ページ/));
  const id = addComment();
  assert.equal(thread(id).messages[0].sent, false);
});

test('アンカーは、長さを切って保存する（ブロックの種類・内容の抜粋も）', () => {
  const id = addComment({ anchor: { quote: 'あ'.repeat(5000), blockTag: 'TABLE'.repeat(9), blockText: 'い'.repeat(500), label: 'l'.repeat(500) } });
  const a = thread(id).anchor;
  assert.equal(a.quote.length, 2000);
  assert.equal(a.blockTag.length, 16);
  assert.equal(a.blockText.length, 200);
  assert.equal(a.label.length, 120);
});

test('送るまでは、編集・削除できる。送ったあとは変えられない', () => {
  const id = addComment();
  const m = thread(id).messages[0].id;
  A.edit({ topic: 'demo', thread: id, msg: m, text: '直した' });
  assert.equal(thread(id).messages[0].text, '直した');
  assert.throws(() => A.edit({ topic: 'demo', thread: id, msg: m, text: '' }), httpError(400, /空/));

  submit();
  assert.throws(() => A.edit({ topic: 'demo', thread: id, msg: m, text: 'もう一度' }), httpError(400, /送信済み/));
  assert.throws(() => A.delete({ topic: 'demo', thread: id, msg: m }), httpError(400, /送信済み/));
});

test('最後の下書きを消すと、スレッドごと消える', () => {
  const id = addComment();
  A.delete({ topic: 'demo', thread: id, msg: thread(id).messages[0].id });
  assert.equal(thread(id), undefined);
});

test('他人の（AI の）メッセージは、編集・削除できない', () => {
  const id = addComment();
  submit();
  rikai.cmdApply('demo', { replies: [{ thread: id, body: '返信' }] });
  const ai = thread(id).messages.find((m) => m.author === 'ai');
  assert.throws(() => A.delete({ topic: 'demo', thread: id, msg: ai.id }), httpError(404));
});

test('Submit：送るものがなければ断る。メモだけなら送れる', () => {
  assert.throws(() => submit(), httpError(400, /送るコメント/));
  assert.equal(submit('全体のメモ'), 1);
  const round = JSON.parse(fs.readFileSync(path.join(dir, '.rikai', 'demo', 'rounds', '001.json'), 'utf8'));
  assert.equal(round.status, 'pending');
  assert.equal(round.overallNote, '全体のメモ');
  assert.deepEqual(round.items, []);
  assert.deepEqual(rikai.loadMeta('demo').pending, [1]);
});

test('Submit：未送信を、スレッドごとにまとめ、これまでのやり取りと最新版の場所を添える', () => {
  const id = addComment();
  submit();
  rikai.cmdApply('demo', { replies: [{ thread: id, body: '最初の返信' }] });
  A.reply({ topic: 'demo', thread: id, text: '追加の質問' });
  assert.equal(submit(), 2);

  const round = JSON.parse(fs.readFileSync(path.join(dir, '.rikai', 'demo', 'rounds', '002.json'), 'utf8'));
  assert.equal(round.items.length, 1);
  const item = round.items[0];
  assert.equal(item.thread, id);
  assert.deepEqual(item.new.map((m) => [m.kind, m.text]), [['followup', '追加の質問']]);
  assert.deepEqual(item.history.map((m) => m.author), ['user', 'ai']);
  assert.equal(item.anchor.quote, '本文');
  assert.match(round.pages.root.file, /pages[/\\]root[/\\]v1\.md$/);
  assert.ok(thread(id).messages.every((m) => m.sent));
});

test('「理解できた」と「再開」は、次の Submit で AI に届き、返信の追加でも再開する', () => {
  const id = addComment();
  submit();
  rikai.cmdApply('demo', { replies: [{ thread: id, body: '返信' }] });

  A.resolve({ topic: 'demo', thread: id, resolved: true });
  assert.equal(thread(id).resolved, true);
  submit();
  const round = JSON.parse(fs.readFileSync(path.join(dir, '.rikai', 'demo', 'rounds', '002.json'), 'utf8'));
  assert.equal(round.items[0].userMarked, 'resolved');
  assert.deepEqual(round.items[0].new, []);

  A.reply({ topic: 'demo', thread: id, text: 'やっぱり質問' });
  assert.equal(thread(id).resolved, false);
});

test('存在しないスレッド・メッセージは 404', () => {
  assert.throws(() => A.reply({ topic: 'demo', thread: 't99', text: 'x' }), httpError(404));
  const id = addComment();
  assert.throws(() => A.edit({ topic: 'demo', thread: id, msg: 'm99', text: 'x' }), httpError(404));
});
