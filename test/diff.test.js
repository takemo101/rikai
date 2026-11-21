'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { tokenize, diffText, matchBlocks, MAX_CELLS } = require('../skill/rikai/public/diff.js');

const join = (ops, keep) => ops.filter((o) => keep.includes(o.t)).map((o) => o.s).join('');

test('tokenize：半角の英数字と空白は連続を 1 つに、日本語は 1 文字ずつ', () => {
  assert.deepEqual(tokenize('有効期限 15分 abc_1'), ['有', '効', '期', '限', ' ', '15', '分', ' ', 'abc_1']);
  assert.deepEqual(tokenize(''), []);
});

test('diffText：変わった部分だけが、削除と追加になる', () => {
  assert.deepEqual(diffText('有効期限は15分です', '有効期限は30分です'), [
    { t: 'eq', s: '有効期限は' }, { t: 'del', s: '15' }, { t: 'ins', s: '30' }, { t: 'eq', s: '分です' },
  ]);
  assert.deepEqual(diffText('同じ', '同じ'), [{ t: 'eq', s: '同じ' }]);
  assert.deepEqual(diffText('', '足した'), [{ t: 'ins', s: '足した' }]);
  assert.deepEqual(diffText('消した', ''), [{ t: 'del', s: '消した' }]);
  assert.deepEqual(diffText('', ''), []);
});

test('diffText：どんな入力でも、「同じ」と「削除」をつなぐと前の文字列、「同じ」と「追加」をつなぐと今の文字列になる', () => {
  let seed = 12345;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const alphabet = ['あ', 'い', 'う', '、', ' ', '\n', 'ab', 'cd', '12', 'x'];
  const make = () => Array.from({ length: rnd(40) }, () => alphabet[rnd(alphabet.length)]).join('');
  for (let k = 0; k < 300; k++) {
    const a = make(), b = make();
    const ops = diffText(a, b);
    assert.equal(join(ops, ['eq', 'del']), a, `前: ${JSON.stringify(a)} → ${JSON.stringify(b)}`);
    assert.equal(join(ops, ['eq', 'ins']), b, `今: ${JSON.stringify(a)} → ${JSON.stringify(b)}`);
    for (let i = 1; i < ops.length; i++) assert.notEqual(ops[i].t, ops[i - 1].t, '同じ種類は、続けてまとめる');
  }
});

test('diffText：大きな入力は、固まらずに、丸ごとの置き換えになる（前後の同じ部分は、残す）', () => {
  const a = '共通の頭' + 'あ'.repeat(1500) + '共通の尾';
  const b = '共通の頭' + 'い'.repeat(1500) + '共通の尾';
  assert.ok(1500 * 1500 > MAX_CELLS);
  const t0 = Date.now();
  const ops = diffText(a, b);
  assert.ok(Date.now() - t0 < 1000, '1 秒以内');
  assert.deepEqual(ops.map((o) => o.t), ['eq', 'del', 'ins', 'eq']);
  assert.equal(join(ops, ['eq', 'del']), a);
  assert.equal(join(ops, ['eq', 'ins']), b);
});

const B = (hash, tag, text) => ({ hash, tag, text });

test('matchBlocks：同じ・変更・追加・削除を、順序を保って対応づける', () => {
  const prev = [B('h1', 'H1', '題'), B('h2', 'P', '最初の段落です。'), B('h3', 'TABLE', '項目 値 有効期限 15分'), B('h4', 'P', '消える段落です。')];
  const cur = [B('h1', 'H1', '題'), B('hNew', 'P', '足した段落です。'), B('h2', 'P', '最初の段落です。'), B('h3x', 'TABLE', '項目 値（単位） 有効期限 15（分）')];
  const r = matchBlocks(prev, cur);
  assert.deepEqual(r.cur, [
    { status: 'same', prev: 0 }, { status: 'added', prev: null }, { status: 'same', prev: 1 }, { status: 'changed', prev: 2 },
  ]);
  assert.deepEqual(r.removed, [3]);
});

test('matchBlocks：種類が違うブロックは、内容が似ていても、変更とは見ない（削除と追加）', () => {
  const r = matchBlocks([B('a', 'P', '同じ文章です。')], [B('b', 'LI', '同じ文章です。')]);
  assert.deepEqual(r.cur, [{ status: 'added', prev: null }]);
  assert.deepEqual(r.removed, [0]);
});

test('matchBlocks：似ていないブロックは、変更ではなく、削除と追加', () => {
  const r = matchBlocks([B('a', 'P', '認証の流れについての説明')], [B('b', 'P', 'まったく別の話題です')]);
  assert.deepEqual(r.cur, [{ status: 'added', prev: null }]);
  assert.deepEqual(r.removed, [0]);
});

test('matchBlocks：「同じ」ブロックの間の区間の中でだけ、変更を探す（区切りをまたいで、入れ替わった段落と取り違えない）', () => {
  // 区切り（mid）をまたいで、2 つの段落が入れ替わり、どちらも少し直されている。区間の中では、似た相手がいない
  const prev = [B('a', 'P', '認証の流れ'), B('mid', 'H2', '区切り'), B('c', 'P', '有効期限の値は15分')];
  const cur = [B('c2', 'P', '有効期限の値は30分'), B('mid', 'H2', '区切り'), B('a2', 'P', '認証の流れです')];
  const r = matchBlocks(prev, cur);
  assert.deepEqual(r.cur.map((c) => c.status), ['added', 'same', 'added'], '区切りをまたいだ対応づけ（変更）にならない');
  assert.deepEqual(r.removed, [0, 2]);
});

test('matchBlocks：空の版・同じ版', () => {
  assert.deepEqual(matchBlocks([], [B('a', 'P', 'x')]), { cur: [{ status: 'added', prev: null }], removed: [] });
  assert.deepEqual(matchBlocks([B('a', 'P', 'x')], []), { cur: [], removed: [0] });
  const same = [B('a', 'P', 'x'), B('b', 'P', 'y')];
  assert.deepEqual(matchBlocks(same, same).cur.map((c) => c.status), ['same', 'same']);
});

test('matchBlocks：同じ内容のブロックが複数あっても、1 対 1 で対応づける', () => {
  const r = matchBlocks([B('a', 'P', 'x'), B('a', 'P', 'x')], [B('a', 'P', 'x')]);
  assert.deepEqual(r.cur, [{ status: 'same', prev: 0 }]);
  assert.deepEqual(r.removed, [1]);
});
