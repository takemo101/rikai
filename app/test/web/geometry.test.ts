import { expect, test } from 'vitest';
import {
  DOC_MIN,
  DOC_MIN_NARROW,
  drawerOpen,
  isNarrow,
  PANEL_MIN_NARROW,
  panelMax,
  panelMin,
  panelWidth,
  SIDE_AUTO_HIDE_BELOW,
  SIDE_W,
  SIDE_W_NARROW,
  sideAutoHidden,
  sideShown,
} from '../../src/web/layout/geometry';

test('右の幅の上限：窓の 70%・左の一覧が開いていれば、本文の最小の幅を残す・下限 280', () => {
  expect(panelMax(true, 1600)).toBe(1600 - SIDE_W - DOC_MIN); // 1010（70% は 1120）
  expect(panelMax(false, 1600)).toBe(1120);
  expect(panelMax(true, 1000)).toBe(410);
  expect(panelMax(true, 1200)).toBe(1200 - SIDE_W - DOC_MIN); // 広い窓（>900）は、これまでどおり
  expect(panelMax(true, 901)).toBe(311); // 901 − 230 − 360
  expect(panelMin(901)).toBe(280);
});

test('実際の幅：覚えている幅を、下限 280・上限で抑える。数でなければ 280', () => {
  expect(panelWidth(380, 600)).toBe(380);
  expect(panelWidth(100, 600)).toBe(280);
  expect(panelWidth(900, 600)).toBe(600);
  expect(panelWidth(Number.NaN, 600)).toBe(280);
});

test('狭い窓（〜900px）：下限 220・本文の領域に 400px 残す・左の一覧は 168px。901px からは、広い窓のまま', () => {
  expect(isNarrow(900)).toBe(true);
  expect(isNarrow(901)).toBe(false);
  expect(panelMin(900)).toBe(PANEL_MIN_NARROW);
  expect(panelMin(901)).toBe(280);
  // 左の一覧が出ている：窓 − 168 − 400
  expect(panelMax(true, 900)).toBe(900 - SIDE_W_NARROW - DOC_MIN_NARROW); // 332
  expect(panelMax(true, 800)).toBe(232); // 本文は、400px
  // 左の一覧をしまっている（または自動で隠れている）：窓 − 400
  expect(panelMax(false, 800)).toBe(400);
  expect(panelMax(false, 700)).toBe(300);
  // 本文に 400px を残せない窓：下限 220 で止まる
  expect(panelMax(false, 600)).toBe(220);
  expect(panelMax(true, 500)).toBe(220);
});

test('狭い窓の実際の幅：覚えている幅は、下限 220・上限で抑える（覚えている値は、書き換えない：関数は、値を返すだけ）', () => {
  expect(panelWidth(380, 232, 220)).toBe(232);
  expect(panelWidth(280, 400, 220)).toBe(280);
  expect(panelWidth(100, 400, 220)).toBe(220);
  expect(panelWidth(Number.NaN, 400, 220)).toBe(220);
  expect(panelWidth(380, 600)).toBe(380); // 下限の既定は 280（広い窓）
});

// 意図した変更（RIK-040 の再レビュー）：自動で隠す境界を、700/701px から、788px（左の一覧 168 + 右の下限 220 + 本文の最小 400）に変えた。
// 701〜787px で、左の一覧が戻ると、本文が 400px を割っていた（701px で 313px）ため
test('左の一覧：788px（168 + 220 + 400）未満では、自動で隠す。788px からは、保存した開閉。隠している間は、☰ で、重ねて（ドロワー）出す', () => {
  expect(SIDE_AUTO_HIDE_BELOW).toBe(788);
  expect(sideAutoHidden(787)).toBe(true);
  expect(sideAutoHidden(788)).toBe(false);
  expect(sideShown(true, 787)).toBe(false);
  expect(sideShown(true, 788)).toBe(true);
  expect(sideShown(false, 788)).toBe(false);
  expect(sideShown(false, 1600)).toBe(false);
  expect(drawerOpen(true, 787)).toBe(true);
  expect(drawerOpen(true, 788)).toBe(false); // 自動で隠す窓を出たら、ドロワーではない
  expect(drawerOpen(false, 600)).toBe(false);
});

test('境界をまたいでも、本文は、連続して 400px 以上（620〜900px を 1px ずつ。保存した幅 220・380・600 のどれでも）。620px 未満は、右のパネルが下限で、窓 − 220', () => {
  for (const saved of [220, 380, 600]) {
    for (let w = 620; w <= 900; w++) {
      const shown = sideShown(true, w);
      const max = panelMax(shown, w);
      const doc = w - (shown ? SIDE_W_NARROW : 0) - panelWidth(saved, max, panelMin(w));
      expect(doc, `${w}px・保存 ${saved}`).toBeGreaterThanOrEqual(400);
    }
  }
  for (let w = 400; w < 620; w++) {
    const max = panelMax(false, w);
    expect(max, `${w}px`).toBe(220);
    expect(w - panelWidth(380, max, panelMin(w))).toBe(w - 220);
  }
  // 境界の前後で、本文は、急に狭くならない（保存した幅が広いとき：787 でも 788 でも 400）
  const doc = (w: number) => {
    const shown = sideShown(true, w);
    return w - (shown ? SIDE_W_NARROW : 0) - panelWidth(600, panelMax(shown, w), panelMin(w));
  };
  expect(doc(787)).toBe(400);
  expect(doc(788)).toBe(400);
});
