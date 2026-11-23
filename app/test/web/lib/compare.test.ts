// 版を並べて比べる（F44）の純粋な部分：開いたときの版の組・版の制約・行の並べ方・まとめ方。
import { expect, test } from 'vitest';
import { type BlockSig, matchBlocks } from '../../../src/shared/diff';
import {
  alignRows,
  COMPARE_MIN_VERSIONS,
  defaultPair,
  groupSame,
  isVersion,
  summarize,
} from '../../../src/web/lib/compare';

const sig = (hash: string, text = hash, tag = 'P'): BlockSig => ({ hash, tag, text });
const rowsOf = (prev: BlockSig[], cur: BlockSig[]) => alignRows(matchBlocks(prev, cur), prev.length, cur.length);
const brief = (rows: ReturnType<typeof alignRows>) => rows.map((r) => `${r.status}:${r.left ?? '-'}:${r.right ?? '-'}`);

test('開いたときの版の組：右＝いま見ている版・左＝その 1 つ前。v1 を見ていれば v1・v2。版が 1 つなら開けない', () => {
  expect(COMPARE_MIN_VERSIONS).toBe(2);
  expect(defaultPair(3, 3)).toEqual({ left: 2, right: 3 }); // 最新を見ている：最新の 1 つ前と、最新
  expect(defaultPair(2, 3)).toEqual({ left: 1, right: 2 }); // 過去の版を見ている：その版と、1 つ前
  expect(defaultPair(1, 3)).toEqual({ left: 1, right: 2 }); // v1 には、前がない
  expect(defaultPair(1, 2)).toEqual({ left: 1, right: 2 });
  expect(defaultPair(1, 1)).toBeNull();
  expect(defaultPair(9, 3)).toEqual({ left: 2, right: 3 }); // 最新を超えていても、収める
  expect(defaultPair(3, 0)).toBeNull();
});

test('版の制約：1 以上・最新版以下の整数だけ', () => {
  expect(isVersion(1, 3)).toBe(true);
  expect(isVersion(3, 3)).toBe(true);
  expect(isVersion(0, 3)).toBe(false);
  expect(isVersion(4, 3)).toBe(false);
  expect(isVersion(1.5, 3)).toBe(false);
  expect(isVersion(Number.NaN, 3)).toBe(false);
  expect(isVersion('2', 3)).toBe(false);
});

test('行：同じ・変更・追加が、右の順に。左右の添字が、対応する', () => {
  const prev = [sig('a'), sig('b', '一日に三回食べます。'), sig('c')];
  const cur = [sig('a'), sig('b2', '一日に四回食べます。'), sig('n', '新しい段落です'), sig('c')];
  expect(brief(rowsOf(prev, cur))).toEqual(['same:0:0', 'changed:1:1', 'added:-:2', 'same:2:3']);
});

test('行：なくなったブロックは、前の版で、そのあとにあったブロックの直前に出る（先頭・途中・末尾）', () => {
  expect(brief(rowsOf([sig('x'), sig('a')], [sig('a')]))).toEqual(['removed:0:-', 'same:1:0']);
  expect(brief(rowsOf([sig('a'), sig('x'), sig('b')], [sig('a'), sig('b')]))).toEqual([
    'same:0:0',
    'removed:1:-',
    'same:2:1',
  ]);
  expect(brief(rowsOf([sig('a'), sig('x')], [sig('a')]))).toEqual(['same:0:0', 'removed:1:-']);
});

test('行：同じ場所の削除と追加は、「削除→追加」の順（差分を読み慣れた順）', () => {
  const prev = [sig('a'), sig('x', '睡眠について'), sig('b')];
  const cur = [sig('a'), sig('n', 'まったく別の内容です'), sig('b')];
  expect(brief(rowsOf(prev, cur))).toEqual(['same:0:0', 'removed:1:-', 'added:-:1', 'same:2:2']);
});

test('行：すべての左右のブロックが、ちょうど 1 回ずつ出る（落とさない・重ねない）', () => {
  const prev = [sig('a'), sig('p1', '猫は朝によく鳴きます。'), sig('x'), sig('b'), sig('d1', 'おわり')];
  const cur = [
    sig('n1', '新しい前書き'),
    sig('a'),
    sig('p2', '猫は朝によく鳴いて起こします。'),
    sig('b'),
    sig('e', '付録'),
  ];
  const rows = rowsOf(prev, cur);
  expect(rows.flatMap((r) => (r.left === null ? [] : [r.left])).sort()).toEqual([0, 1, 2, 3, 4]);
  expect(rows.flatMap((r) => (r.right === null ? [] : [r.right])).sort()).toEqual([0, 1, 2, 3, 4]);
  // 右は、本文の順
  const right = rows.flatMap((r) => (r.right === null ? [] : [r.right]));
  expect(right).toEqual([0, 1, 2, 3, 4]);
  expect(summarize(rows)).toEqual({ same: 2, changed: 1, added: 2, removed: 2 });
});

test('行：片方の版だけ（もう一方は、まだ・取れなかった）：ある側だけの行で、反対側は空白。両方なければ、行はない', () => {
  expect(brief(alignRows(null, 2, 0))).toEqual(['solo:0:-', 'solo:1:-']);
  expect(brief(alignRows(null, 0, 3))).toEqual(['solo:-:0', 'solo:-:1', 'solo:-:2']);
  expect(alignRows(null, 0, 0)).toEqual([]);
  expect(summarize(alignRows(null, 2, 0))).toEqual({ same: 0, changed: 0, added: 0, removed: 0 });
});

test('同じ版どうし：すべて「同じ」', () => {
  const doc = [sig('a'), sig('b'), sig('c')];
  expect(summarize(rowsOf(doc, doc))).toEqual({ same: 3, changed: 0, added: 0, removed: 0 });
});

test('変更のある所だけ：続く「同じ」を、1 つにまとめる。変更・追加・削除の行は、そのまま', () => {
  const rows = rowsOf(
    [sig('a'), sig('b'), sig('c', '猫は一日に三回、ごはんを食べます。'), sig('d'), sig('x', '睡眠について')],
    [sig('a'), sig('b'), sig('c2', '猫は一日に四回、ごはんを食べます。'), sig('d'), sig('n', 'まったく別の内容')],
  );
  const g = groupSame(rows);
  expect(g.map((i) => (i.kind === 'same' ? `same×${i.rows.length}` : i.row.status))).toEqual([
    'same×2',
    'changed',
    'same×1',
    'removed',
    'added',
  ]);
  expect(groupSame([])).toEqual([]);
});
