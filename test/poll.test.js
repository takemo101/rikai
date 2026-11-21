'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { rikai, tempProject, removeProject, makeTopic, addComment, submit } = require('./helpers.js');

let dir;
test.beforeEach(() => { dir = tempProject(); makeTopic(); });
test.afterEach(() => removeProject(dir));

test('Submit 前は none。届いたら feedback（round の status の pending で上書きしない）', () => {
  addComment();
  assert.equal(rikai.peek('demo').status, 'none');
  assert.equal(rikai.peek('demo').unsent, 1);

  submit();
  const r = rikai.peek('demo');
  assert.equal(r.status, 'feedback');
  assert.equal(r.round, 1);
  assert.equal(r.items[0].new[0].text, '質問です');
});

test('apply のあとは none に戻る。同じ round を、poll し直しても、apply までは出る', () => {
  const id = addComment();
  submit();
  assert.equal(rikai.peek('demo').status, 'feedback');
  assert.equal(rikai.peek('demo').status, 'feedback');
  rikai.cmdApply('demo', { replies: [{ thread: id, body: '返信' }] });
  assert.equal(rikai.peek('demo').status, 'none');
});

test('終了したら closed（未送信の数つき）。届いているものは、closed より先に出す', () => {
  addComment();
  const original = rikai.hooks.allClosed;
  rikai.hooks.allClosed = () => {};
  try {
    rikai.actions.end({ topic: 'demo' });
    assert.deepEqual(rikai.peek('demo'), { status: 'closed', unsent: 1 });
  } finally {
    rikai.hooks.allClosed = original;
  }
  submit();
  assert.equal(rikai.peek('demo').status, 'feedback');
});

test('すべてのトピックが閉じたときだけ、サーバーを終える合図が出る', () => {
  makeTopic('other');
  let calls = 0;
  const original = rikai.hooks.allClosed;
  rikai.hooks.allClosed = () => { calls += 1; };
  try {
    rikai.actions.end({ topic: 'demo' });
    assert.equal(calls, 0, 'まだ開いているトピックがある');
    rikai.actions.end({ topic: 'other' });
    assert.equal(calls, 1);
  } finally {
    rikai.hooks.allClosed = original;
  }
});
