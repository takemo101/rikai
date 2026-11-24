import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'vitest';
import { addComment, makeTopic, type Project, removeProject, submit, tempProject } from './helpers';

let p: Project;
beforeEach(() => {
  p = tempProject();
  makeTopic(p);
});
afterEach(() => removeProject(p));

test('Submit 前は none。届いたら feedback（round の status の pending で上書きしない）', () => {
  addComment(p);
  const before = p.agent.peek('demo');
  assert.equal(before.status, 'none');
  assert.equal('unsent' in before && before.unsent, 1);

  submit(p);
  const r = p.agent.peek('demo');
  assert.equal(r.status, 'feedback');
  assert.ok('round' in r);
  assert.equal(r.round, 1);
  assert.equal(r.items[0]?.new[0]?.text, '質問です');
});

test('apply のあとは none に戻る。同じ round を、poll し直しても、apply までは出る', () => {
  const id = addComment(p);
  submit(p);
  assert.equal(p.agent.peek('demo').status, 'feedback');
  assert.equal(p.agent.peek('demo').status, 'feedback');
  p.agent.cmdApply('demo', { replies: [{ thread: id, body: '返信' }] });
  assert.equal(p.agent.peek('demo').status, 'none');
});

test('終了したら closed（未送信の数つき）。届いているものは、closed より先に出す', () => {
  addComment(p);
  p.hooks.allClosed = () => {}; // 全部が閉じたときの合図は、ここでは要らない（p ごと、テストのたびに作り直す）
  p.actions.end({ topic: 'demo' });
  assert.deepEqual(p.agent.peek('demo'), { status: 'closed', unsent: 1 });
  // 意図した変更（0.1.4・F54）：終了したトピックへの Submit は、断る（409）。旧は、終了してから送っても通った。
  // 「届いているものは、closed より先に出す」は、送ってから終了した場合（開き直して、送り、終了）で確かめる
  assert.throws(() => submit(p), /終了しています/);
  p.store.mutate('demo', (m) => {
    m.closed = false;
    return {};
  });
  submit(p);
  p.actions.end({ topic: 'demo' });
  assert.equal(p.agent.peek('demo').status, 'feedback');
});

test('すべてのトピックが閉じたときだけ、サーバーを終える合図が出る', () => {
  makeTopic(p, 'other');
  let calls = 0;
  p.hooks.allClosed = () => {
    calls += 1;
  };
  p.actions.end({ topic: 'demo' });
  assert.equal(calls, 0, 'まだ開いているトピックがある');
  p.actions.end({ topic: 'other' });
  assert.equal(calls, 1);
});
