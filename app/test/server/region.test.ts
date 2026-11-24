import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'vitest';
import { normAnchor, normRect } from '../../src/server/anchor';
import type { Anchor, RoundAnchor } from '../../src/shared/types';
import {
  addComment,
  makeTopic,
  type Project,
  readThreads,
  removeProject,
  submit as submitRound,
  tempProject,
  textAnchor,
} from './helpers';

let p: Project;
beforeEach(() => {
  p = tempProject();
  makeTopic(p);
});
afterEach(() => removeProject(p));

const blockAnchor = (rect?: unknown) => ({
  ...textAnchor(''),
  blockTag: 'P',
  label: '画像の一部',
  ...(rect === undefined ? {} : { rect }),
});

test('範囲は、左上を −100〜100・幅と高さを 1000 までに収め、4 桁に丸める（基準の外へ出てよい）。数でない・小さすぎるものは、範囲なしにする（コメント自体は失敗しない）', () => {
  const n = normRect;
  assert.deepEqual(n({ x: 0.123456, y: 0.2, w: 0.3, h: 0.4 }), { x: 0.1235, y: 0.2, w: 0.3, h: 0.4 });
  assert.deepEqual(
    n({ x: '0.1', y: '0.2', w: '0.3', h: '0.4' }),
    { x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
    '数の文字列は、数として読む',
  );
  assert.deepEqual(
    n({ x: -25, y: 0.5, w: 25, h: 13.75 }),
    { x: -25, y: 0.5, w: 25, h: 13.75 },
    '小さな画像を基準にした、広い範囲（左上が、基準の外）は、そのまま残す',
  );
  assert.deepEqual(
    n({ x: 0.9, y: 0.9, w: 0.5, h: 0.5 }),
    { x: 0.9, y: 0.9, w: 0.5, h: 0.5 },
    '範囲は、基準の右下の外へ出てよい',
  );
  assert.deepEqual(
    n({ x: 300, y: -200, w: 5000, h: 20000 }),
    { x: 100, y: -100, w: 1000, h: 1000 },
    '大きすぎる値は、上限に収める',
  );
  assert.deepEqual(
    n({ x: 0, y: 0, w: 0.0012, h: 0.0006 }),
    { x: 0, y: 0, w: 0.0012, h: 0.0006 },
    '縦に長いブロックの中の、1 行ぶんの範囲は、捨てない',
  );
  for (const bad of [
    null,
    undefined,
    5,
    'x',
    [],
    {},
    { x: 0, y: 0, w: 0, h: 0.5 },
    { x: 0, y: 0, w: 0.0004, h: 0.5 },
    { x: 0, y: 0, w: 0.5, h: 0.0004 },
    { x: 0, y: 0, w: -3, h: 0.5 },
    { x: NaN, y: 0, w: 1, h: 1 },
    { x: 0, y: 0, w: Infinity, h: 1 },
    { x: 'a', y: 0, w: 1, h: 1 },
  ]) {
    assert.equal(n(bad), null, JSON.stringify(bad));
  }
  assert.equal(
    'rect' in (normAnchor({ ...blockAnchor(), rect: { x: 0, y: 0, w: 0, h: 0 } }) as Anchor),
    false,
    '壊れた範囲は、キーごと捨てる',
  );
  assert.deepEqual(
    (normAnchor({ ...blockAnchor(), rect: { x: 0.1, y: 0.1, w: 0.5, h: 0.5, extra: 1 } }) as Anchor).rect,
    { x: 0.1, y: 0.1, w: 0.5, h: 0.5 },
    '余計なキーは、持たない',
  );
});

test('範囲つきのコメントは、範囲を保存し、Submit の出力に region として出す。文の選択・ブロックだけのコメントには出ない', () => {
  const id = addComment(p, { anchor: blockAnchor({ x: 0.25, y: 0.1, w: 0.5, h: 0.4 }) });
  const plain = addComment(p, { anchor: blockAnchor() });
  const quote = addComment(p);
  assert.deepEqual(readThreads(p).threads.find((t) => t.id === id)?.anchor?.rect, { x: 0.25, y: 0.1, w: 0.5, h: 0.4 });
  submitRound(p);
  const fed = p.agent.peek('demo');
  const items = 'items' in fed ? fed.items : [];
  const anchorOf = (thread: string) => items.find((i) => i.thread === thread)?.anchor as RoundAnchor;
  assert.deepEqual(anchorOf(id)?.region, { x: 0.25, y: 0.1, w: 0.5, h: 0.4 });
  assert.equal(anchorOf(id)?.label, '画像の一部');
  assert.equal('region' in anchorOf(plain), false);
  assert.equal('region' in anchorOf(quote), false);
});
