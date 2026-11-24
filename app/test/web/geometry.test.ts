import { expect, test } from 'vitest';
import {
  DOC_MIN,
  DOC_MIN_NARROW,
  defaultPanelWidth,
  drawerOpen,
  effectiveSavedWidth,
  isNarrow,
  PANEL_DEFAULT_NARROW,
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

// 意図した変更（0.28.0。UX の分析 P9）：自動で隠す境界を、788px 未満から、1100px 以下に上げた。半画面（720〜1100px）で、左の一覧（230）と右のコメント（380）を並べると、
// 本文が 490px（1100px）・400px（900px）しか残らなかった。旧：788px（左の一覧 168 + 右の下限 220 + 本文の最小 400）未満（RIK-040 の再レビュー）
test('左の一覧：1100px 以下では、自動で隠す。1101px からは、保存した開閉。隠している間は、☰ で、重ねて（ドロワー）出す', () => {
  expect(SIDE_AUTO_HIDE_BELOW).toBe(1101);
  expect(sideAutoHidden(1100)).toBe(true);
  expect(sideAutoHidden(1101)).toBe(false);
  expect(sideAutoHidden(788)).toBe(true); // 旧は、ここから並べていた
  expect(sideShown(true, 1100)).toBe(false);
  expect(sideShown(true, 1101)).toBe(true);
  expect(sideShown(false, 1101)).toBe(false);
  expect(sideShown(false, 1600)).toBe(false);
  expect(drawerOpen(true, 1100)).toBe(true);
  expect(drawerOpen(true, 1101)).toBe(false); // 自動で隠す窓を出たら、ドロワーではない
  expect(drawerOpen(false, 600)).toBe(false);
});

test('右のコメントの既定の幅：1100px 以下では、細く（280）。利用者が決めた幅（印あり）・1101px からは、そのまま', () => {
  expect(PANEL_DEFAULT_NARROW).toBe(280);
  expect(effectiveSavedWidth(380, 1100, false)).toBe(280); // 既定のまま：細く
  expect(effectiveSavedWidth(380, 700, false)).toBe(280);
  expect(effectiveSavedWidth(380, 1101, false)).toBe(380);
  expect(effectiveSavedWidth(450, 1000, false)).toBe(450); // 380 以外は、印がなくても、そのまま
  expect(effectiveSavedWidth(300, 1000, false)).toBe(300);
  expect(effectiveSavedWidth(450, 1000, true)).toBe(450);
  expect(effectiveSavedWidth(300, 1000, true)).toBe(300);
});

test('取っ手で、わざと 380 にした幅（印あり）は、1100px 以下でも、380 のまま（値でなく、印で決める）。ダブルクリックの「もとの幅」は、窓の幅の既定（1100px 以下は 280・以上は 380）', () => {
  for (const w of [600, 900, 1000, 1100]) expect(effectiveSavedWidth(380, w, true), `${w}px`).toBe(380);
  for (const w of [600, 900, 1000, 1100]) expect(effectiveSavedWidth(380, w, false), `${w}px`).toBe(280);
  expect(defaultPanelWidth(1100)).toBe(280);
  expect(defaultPanelWidth(600)).toBe(280);
  expect(defaultPanelWidth(1101)).toBe(380);
  expect(defaultPanelWidth(1600)).toBe(380);
});

test('本文の幅（保存が既定の 380 のとき。左の一覧は、1100px 以下で隠れる）：1100px で 820px・900px で 620px・720px で 440px。1101px では、左の一覧が戻って 491px（旧：1100px で 490px・900px で 400px）', () => {
  const doc = (w: number) => {
    const shown = sideShown(true, w);
    const side = shown ? (isNarrow(w) ? SIDE_W_NARROW : SIDE_W) : 0;
    return w - side - panelWidth(effectiveSavedWidth(380, w, false), panelMax(shown, w), panelMin(w));
  };
  expect(doc(1100)).toBe(820);
  expect(doc(900)).toBe(620);
  expect(doc(720)).toBe(440);
  expect(doc(1101)).toBe(491);
});

test('1100px 以下では、本文は、狭い窓（〜900px）で 400px 以上・901〜1100px で 360px 以上（620〜1100px を 1px ずつ。保存した幅 220・380・600 のどれでも）。620px 未満は、右のパネルが下限で、窓 − 220', () => {
  for (const saved of [220, 380, 600]) {
    for (let w = 620; w <= 1100; w++) {
      const shown = sideShown(true, w); // 常に、隠れている
      expect(shown).toBe(false);
      const doc = w - panelWidth(effectiveSavedWidth(saved, w, false), panelMax(shown, w), panelMin(w));
      expect(doc, `${w}px・保存 ${saved}`).toBeGreaterThanOrEqual(w <= 900 ? 400 : 360);
    }
  }
  for (let w = 400; w < 620; w++) {
    const max = panelMax(false, w);
    expect(max, `${w}px`).toBe(220);
    expect(w - panelWidth(280, max, panelMin(w))).toBe(w - 220);
  }
});
