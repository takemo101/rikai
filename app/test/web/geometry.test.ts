import { expect, test } from 'vitest';
import { DOC_MIN, panelMax, panelWidth, SIDE_W } from '../../src/web/layout/geometry';

test('右の幅の上限：窓の 70%・左の一覧が開いていれば、本文の最小の幅を残す・下限 280', () => {
  expect(panelMax(true, 1600)).toBe(1600 - SIDE_W - DOC_MIN); // 1010（70% は 1120）
  expect(panelMax(false, 1600)).toBe(1120);
  expect(panelMax(true, 1000)).toBe(410);
  expect(panelMax(true, 500)).toBe(280);
});

test('実際の幅：覚えている幅を、下限 280・上限で抑える。数でなければ 280', () => {
  expect(panelWidth(380, 600)).toBe(380);
  expect(panelWidth(100, 600)).toBe(280);
  expect(panelWidth(900, 600)).toBe(600);
  expect(panelWidth(Number.NaN, 600)).toBe(280);
});
