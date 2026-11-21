'use strict';
// 画像・図の中の範囲を、コメントの対象にする：範囲（比率）の検査と、保存・Submit の出力（AI が読む `region`）。
const test = require('node:test');
const assert = require('node:assert/strict');
const { rikai, tempProject, removeProject, makeTopic, addComment, submit, readThreads, textAnchor } = require('./helpers.js');

let dir;
test.beforeEach(() => { dir = tempProject(); makeTopic(); });
test.afterEach(() => removeProject(dir));

const blockAnchor = (rect) => ({ ...textAnchor(''), blockTag: 'P', label: '画像の一部', ...(rect === undefined ? {} : { rect }) });

test('範囲は、0〜1 に収め、4 桁に丸める。数でない・小さすぎるものは、範囲なしにする（コメント自体は失敗しない）', () => {
  const n = rikai.normRect;
  assert.deepEqual(n({ x: 0.123456, y: 0.2, w: 0.3, h: 0.4 }), { x: 0.1235, y: 0.2, w: 0.3, h: 0.4 });
  assert.deepEqual(n({ x: '0.1', y: '0.2', w: '0.3', h: '0.4' }), { x: 0.1, y: 0.2, w: 0.3, h: 0.4 }, '数の文字列は、数として読む');
  assert.deepEqual(n({ x: -5, y: 0.5, w: 10, h: 10 }), { x: 0, y: 0.5, w: 1, h: 0.5 }, '外へはみ出す分は、切る');
  assert.deepEqual(n({ x: 0.9, y: 0.9, w: 0.5, h: 0.5 }), { x: 0.9, y: 0.9, w: 0.1, h: 0.1 }, '右下を、はみ出さない');
  for (const bad of [null, undefined, 5, 'x', [], {}, { x: 0, y: 0, w: 0, h: 0.5 }, { x: 0, y: 0, w: 0.004, h: 0.5 }, { x: 0, y: 0, w: 0.5, h: 0.004 }, { x: NaN, y: 0, w: 1, h: 1 }, { x: 0, y: 0, w: Infinity, h: 1 }, { x: 'a', y: 0, w: 1, h: 1 }, { x: 1, y: 0, w: 0.5, h: 0.5 }]) {
    assert.equal(n(bad), null, JSON.stringify(bad));
  }
  assert.equal('rect' in rikai.normAnchor({ ...blockAnchor(), rect: { x: 0, y: 0, w: 0, h: 0 } }), false, '壊れた範囲は、キーごと捨てる');
  assert.deepEqual(rikai.normAnchor({ ...blockAnchor(), rect: { x: 0.1, y: 0.1, w: 0.5, h: 0.5, extra: 1 } }).rect, { x: 0.1, y: 0.1, w: 0.5, h: 0.5 }, '余計なキーは、持たない');
});

test('範囲つきのコメントは、範囲を保存し、Submit の出力に region として出す。文の選択・ブロックだけのコメントには出ない', () => {
  const id = addComment({ anchor: blockAnchor({ x: 0.25, y: 0.1, w: 0.5, h: 0.4 }) });
  const plain = addComment({ anchor: blockAnchor() });
  const quote = addComment();
  assert.deepEqual(readThreads().threads.find((t) => t.id === id).anchor.rect, { x: 0.25, y: 0.1, w: 0.5, h: 0.4 });
  submit();
  const items = rikai.peek('demo').items;
  assert.deepEqual(items.find((i) => i.thread === id).anchor.region, { x: 0.25, y: 0.1, w: 0.5, h: 0.4 });
  assert.equal(items.find((i) => i.thread === id).anchor.label, '画像の一部');
  assert.equal('region' in items.find((i) => i.thread === plain).anchor, false);
  assert.equal('region' in items.find((i) => i.thread === quote).anchor, false);
});
