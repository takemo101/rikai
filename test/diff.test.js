'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { tokenize, diffText, matchBlocks, MAX_CELLS, MAX_BLOCK_CELLS, MAX_GAP_PAIRS } = require('../skill/rikai/public/diff.js');

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

test('diffText：大きな入力（上限を超える）は、丸ごとの置き換えになる。上限の内側なら、共通のトークンを活かす', () => {
  // 中身に共通のトークンがある（「あい」と「いあ」）ので、上限がなければ、細かい差分（5 つの塊）になる
  const head = '共通の頭', tail = '共通の尾';
  const big = [head + 'あい'.repeat(750) + tail, head + 'いあ'.repeat(750) + tail];
  assert.ok(1500 * 1500 > MAX_CELLS);
  const t0 = Date.now();
  const ops = diffText(big[0], big[1]);
  assert.ok(Date.now() - t0 < 1000, '1 秒以内');
  assert.deepEqual(ops.map((o) => o.t), ['eq', 'del', 'ins', 'eq'], '上限を超えたので、丸ごとの置き換え（前後の同じ部分は残る）');
  assert.equal(join(ops, ['eq', 'del']), big[0]);
  assert.equal(join(ops, ['eq', 'ins']), big[1]);

  const small = [head + 'あい'.repeat(20) + tail, head + 'いあ'.repeat(20) + tail];
  assert.ok(diffText(small[0], small[1]).length > 4, '上限の内側では、共通のトークンを活かした細かい差分になる');
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

test('matchBlocks：ほとんど全部が書き直された資料でも、近さを調べる組の数に上限がある（上限を超える区間は、追加と削除）', () => {
  // どのブロックも、前の版の同じ番号のブロックと、とても似ている（上限がなければ、「変更」として対応づく）
  const n = 500;
  assert.ok(n * n > MAX_GAP_PAIRS);
  const prev = Array.from({ length: n }, (_, i) => B(`p${i}`, 'P', `段落${i}の説明です。共通の文言がしばらく続きます`));
  const cur = Array.from({ length: n }, (_, i) => B(`c${i}`, 'P', `段落${i}の説明でした。共通の文言がしばらく続きます`));
  const t0 = Date.now();
  const r = matchBlocks(prev, cur);
  assert.ok(Date.now() - t0 < 1500, '固まらない');
  assert.ok(r.cur.every((c) => c.status === 'added'));
  assert.equal(r.removed.length, n);
  // 上限の内側の区間では、「変更」として対応づく
  const small = matchBlocks(prev.slice(0, 20), cur.slice(0, 20));
  assert.ok(small.cur.every((c, i) => c.status === 'changed' && c.prev === i));
});

test('matchBlocks：ブロックの数が非常に多いとき（順序を見る表が大きすぎる）も、1 対 1 で、同じ内容と変更を対応づける', () => {
  const n = 2100;
  assert.ok(n * n > MAX_BLOCK_CELLS);
  const prev = Array.from({ length: n }, (_, i) => B(`h${i}`, 'P', `x${i}`));
  const cur = prev.map((b, i) => (i === 1000 ? B('changed', 'P', 'x1000b') : b));
  const r = matchBlocks(prev, cur);
  assert.equal(r.cur.filter((c) => c.status === 'same').length, n - 1);
  assert.deepEqual(r.cur[1000], { status: 'changed', prev: 1000 });
  assert.deepEqual(r.removed, []);
  const used = r.cur.map((c) => c.prev).filter((p) => p !== null);
  assert.equal(new Set(used).size, used.length, '前のブロックを、2 回使わない');
});

test('matchBlocks：同じ内容のブロックが複数あっても、1 対 1 で対応づける', () => {
  const r = matchBlocks([B('a', 'P', 'x'), B('a', 'P', 'x')], [B('a', 'P', 'x')]);
  assert.deepEqual(r.cur, [{ status: 'same', prev: 0 }]);
  assert.deepEqual(r.removed, [1]);
});
