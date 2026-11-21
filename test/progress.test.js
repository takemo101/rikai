'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { progressOf } = require('../skill/rikai/public/progress.js');
const { rikai, tempProject, removeProject, makeTopic, addComment, submit, readThreads, singleAsk } = require('./helpers.js');

test('空・壊れた入力でも、0 を返す', () => {
  const zero = { threads: { total: 0, resolved: 0, open: 0 }, asks: { total: 0, answered: 0 } };
  assert.deepEqual(progressOf([]), zero);
  assert.deepEqual(progressOf(undefined), zero);
  assert.deepEqual(progressOf(null), zero);
  assert.deepEqual(progressOf([{ messages: null }]), { threads: { total: 1, resolved: 0, open: 1 }, asks: { total: 0, answered: 0 } });
});

const ai = (id, ask) => ({ id, author: 'ai', kind: 'reply', ...(ask ? { ask: { type: 'yes_no', question: 'q' } } : {}) });
const answer = (id, to, sent) => ({ id, author: 'user', kind: 'answer', to, sent });

test('解決したスレッドと、質問・送信済みの回答を数える', () => {
  const threads = [
    { resolved: true, messages: [{ id: 'm1', author: 'user', kind: 'comment', sent: true }, ai('m2', true), answer('m3', 'm2', true)] },
    { resolved: false, messages: [ai('m4', true), answer('m5', 'm4', false)] },
    { resolved: false, messages: [ai('m6', true)] },
    { resolved: false, messages: [ai('m7', false)] },
  ];
  assert.deepEqual(progressOf(threads), { threads: { total: 4, resolved: 1, open: 3 }, asks: { total: 3, answered: 1 } });
});

test('保存しただけの（未送信の）回答・別の質問への回答は、数えない。同じ質問への回答が複数あっても、1 つ', () => {
  const threads = [{ resolved: false, messages: [ai('m1', true), answer('m2', 'm1', true), answer('m3', 'm1', true), answer('m4', 'mX', true)] }];
  assert.deepEqual(progressOf(threads).asks, { total: 1, answered: 1 });
  assert.deepEqual(progressOf([{ messages: [ai('m1', true), answer('m2', 'mX', true)] }]).asks, { total: 1, answered: 0 });
});

test('AI が起点のスレッド（人のコメントがない）の質問も数える。人の発言の ask は数えない', () => {
  const t = [{ resolved: false, messages: [{ id: 'm1', author: 'user', kind: 'comment', ask: { type: 'yes_no', question: 'q' } }, ai('m2', true)] }];
  assert.deepEqual(progressOf(t).asks, { total: 1, answered: 0 });
});

test('実際の操作の流れ：質問 → 回答を保存（数えない）→ Submit（数える）→ 解決', () => {
  const dir = tempProject();
  try {
    makeTopic();
    const id = addComment();
    submit();
    rikai.cmdApply('demo', { replies: [{ thread: id, body: '質問', ask: singleAsk }] });
    const count = () => progressOf(readThreads().threads);
    assert.deepEqual(count(), { threads: { total: 1, resolved: 0, open: 1 }, asks: { total: 1, answered: 0 } });

    const q = readThreads().threads[0].messages.find((m) => m.ask);
    rikai.actions.answer({ topic: 'demo', thread: id, msg: q.id, answer: { choice: 'a' } });
    assert.equal(count().asks.answered, 0, '保存しただけ');
    submit();
    assert.equal(count().asks.answered, 1, '送信した');

    rikai.actions.resolve({ topic: 'demo', thread: id, resolved: true });
    assert.equal(count().threads.resolved, 1);
    rikai.actions.resolve({ topic: 'demo', thread: id, resolved: false });
    assert.equal(count().threads.resolved, 0, '再開すると、減る');
  } finally {
    removeProject(dir);
  }
});
