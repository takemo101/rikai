'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { findQuote, locateBlock, similarity } = require('../skill/rikai/public/anchor.js');

const slice = (text, hit) => text.slice(hit.start, hit.end);

test('findQuote：1 か所ならそこ。なければ null', () => {
  const text = 'トークンの更新は冪等である必要がある。';
  assert.equal(slice(text, findQuote(text, { quote: '冪等' })), '冪等');
  assert.equal(findQuote(text, { quote: '存在しない文' }), null);
  assert.equal(findQuote(text, { quote: '' }), null);
  assert.equal(findQuote(text, null), null);
});

test('findQuote：同じ文が複数あるときは、前後の文脈が合うほうを選ぶ', () => {
  const text = 'AAA 冪等 BBB。CCC 冪等 DDD。';
  const second = findQuote(text, { quote: '冪等', prefix: 'CCC ', suffix: ' DDD' });
  assert.equal(second.start, text.lastIndexOf('冪等'));
  const first = findQuote(text, { quote: '冪等', prefix: 'AAA ', suffix: ' BBB' });
  assert.equal(first.start, text.indexOf('冪等'));
});

test('findQuote：整形し直されて、空白だけが変わった文も、元の位置の範囲で見つかる', () => {
  const text = 'ユーザーは\n  ログイン後に\nトークンを受け取る。';
  const hit = findQuote(text, { quote: 'ログイン後に トークンを' });
  assert.equal(slice(text, hit), 'ログイン後に\nトークンを');
});

test('locateBlock：同じ内容のブロックは確実に見つかる（推定にならない）', () => {
  const blocks = [
    { id: 'b0', hash: 'h0', tag: 'H1', text: '題' },
    { id: 'b1', hash: 'h1', tag: 'TABLE', text: '項目 値 有効期限 15分' },
  ];
  assert.deepEqual(locateBlock(blocks, { blockId: 'b5', blockHash: 'h1', blockTag: 'TABLE' }), { index: 1, approx: null });
});

test('locateBlock：同じ内容のブロックが複数あれば、元の位置に近い（同じ ID の）ほうを選ぶ', () => {
  const blocks = [{ id: 'b0', hash: 'x', tag: 'P', text: 'a' }, { id: 'b1', hash: 'x', tag: 'P', text: 'a' }];
  assert.equal(locateBlock(blocks, { blockId: 'b1', blockHash: 'x', blockTag: 'P' }).index, 1);
});

test('locateBlock：直されたブロックは、近い内容のものを、推定として見つける', () => {
  const blocks = [
    { id: 'b0', hash: 'h0', tag: 'H1', text: '題' },
    { id: 'b1', hash: 'h1', tag: 'P', text: '全く別の段落です。' },
    { id: 'b2', hash: 'hNew', tag: 'TABLE', text: '項目 値（単位） 有効期限 15（分）' },
  ];
  const a = { blockId: 'b1', blockHash: 'hOld', blockTag: 'TABLE', blockText: '項目 値 有効期限 15分' };
  assert.deepEqual(locateBlock(blocks, a), { index: 2, approx: 'similar' });
});

test('locateBlock：内容が大きく変わったときは、同じ種類の、同じ位置のブロックを、推定として見つける', () => {
  const blocks = [
    { id: 'b0', hash: 'h0', tag: 'H1', text: '題' },
    { id: 'b1', hash: 'h1', tag: 'TABLE', text: '完全に書き直した内容 ABC XYZ' },
  ];
  const a = { blockId: 'b1', blockHash: 'hOld', blockTag: 'TABLE', blockText: '項目 値 有効期限 15分' };
  assert.deepEqual(locateBlock(blocks, a), { index: 1, approx: 'position' });
});

test('locateBlock：種類が違うブロックは、位置が同じでも選ばない。なければ null', () => {
  const blocks = [{ id: 'b0', hash: 'h0', tag: 'P', text: '段落' }];
  assert.equal(locateBlock(blocks, { blockId: 'b0', blockHash: 'hOld', blockTag: 'TABLE', blockText: '表' }), null);
  assert.equal(locateBlock([], { blockId: 'b0', blockHash: 'h', blockTag: 'P' }), null);
  assert.equal(locateBlock(blocks, null), null);
});

test('similarity：空白の違いは無視し、同じなら 1、重ならなければ 0', () => {
  assert.equal(similarity('a b  c', 'a b c'), 1);
  assert.equal(similarity('あいうえお', 'かきくけこ'), 0);
  assert.ok(similarity('項目 値 有効期限 15分', '項目 値（単位） 有効期限 15（分）') > 0.5);
  assert.equal(similarity('', 'a'), 0);
});
