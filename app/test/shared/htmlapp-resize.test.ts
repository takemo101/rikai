// 枠が知らせた高さの検査（parseResize）：厳密な形・数・上下限。
import { expect, test } from 'vitest';
import { MAX_HEIGHT, MIN_HEIGHT, parseResize } from '../../src/shared/htmlapp-resize';

const resize = (height: unknown) => ({ __rikai: 1, type: 'resize', height });

test('parseResize：厳密な形だけ。数は整数に丸め、上下限に収める。型の違う値・NaN・無限・負・0 は、捨てる。余分なキーは、無視', () => {
  expect(parseResize(resize(300))).toBe(300);
  expect(parseResize(resize(300.6))).toBe(301);
  expect(parseResize({ ...resize(300), extra: 'x', other: { a: 1 } })).toBe(300);
  expect(parseResize(resize(5))).toBe(MIN_HEIGHT);
  expect(parseResize(resize(MIN_HEIGHT - 0.4))).toBe(MIN_HEIGHT);
  expect(parseResize(resize(MAX_HEIGHT + 1))).toBe(MAX_HEIGHT);
  expect(parseResize(resize(1e308))).toBe(MAX_HEIGHT);
  expect([MIN_HEIGHT, MAX_HEIGHT]).toEqual([120, 2400]);
  for (const bad of [
    resize(Number.NaN),
    resize(Number.POSITIVE_INFINITY),
    resize(Number.NEGATIVE_INFINITY),
    resize(-300),
    resize(0),
    resize('300'),
    resize([300]),
    resize({ valueOf: () => 300 }),
    resize(null),
    resize(undefined),
    { __rikai: 1, type: 'resize' },
    { __rikai: 2, type: 'resize', height: 300 },
    { __rikai: '1', type: 'resize', height: 300 },
    { type: 'resize', height: 300 },
    { __rikai: 1, type: 'theme', height: 300 },
    { __rikai: 1, type: 'Resize', height: 300 },
    null,
    undefined,
    300,
    '300',
    [],
    [1, 'resize', 300],
  ])
    expect(parseResize(bad), JSON.stringify(bad)).toBeNull();
});
