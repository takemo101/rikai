// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, beforeEach, expect, test } from 'vitest';
import { Resizer } from '../../src/web/layout/Resizer';
import { UI_KEY } from '../../src/web/lib/storage';
import { useUi } from '../../src/web/store/ui';
import { installPointerCapture, resetAll } from './helpers';

beforeAll(installPointerCapture);
beforeEach(() => {
  resetAll();
  Object.defineProperty(window, 'innerWidth', { value: 1600, configurable: true });
});

const sep = () => screen.getByRole('separator');
const savedW = () => JSON.parse(localStorage.getItem(UI_KEY) ?? '{}').panelW as number | undefined;

test('属性：F23 の名前・矢印キーで操作できる・上限下限の値', () => {
  render(<Resizer />);
  expect(sep()).toHaveAttribute('id', 'panel-resizer');
  expect(sep()).toHaveAttribute('tabindex', '0');
  expect(sep()).toHaveAttribute('aria-orientation', 'vertical');
  expect(sep()).toHaveAttribute('aria-valuemin', '280');
  expect(sep()).toHaveAttribute('aria-valuenow', '380');
  // 左の一覧が開いている：1600 − 230 − 360
  expect(sep()).toHaveAttribute('aria-valuemax', '1010');
});

test('矢印キー：← で広げ・→ で狭める（24px）。保存する。下限 280・上限で止まる', () => {
  render(<Resizer />);
  fireEvent.keyDown(sep(), { key: 'ArrowLeft' });
  expect(useUi.getState().ui.panelW).toBe(404);
  expect(savedW()).toBe(404);
  expect(sep()).toHaveAttribute('aria-valuenow', '404');
  fireEvent.keyDown(sep(), { key: 'ArrowRight' });
  fireEvent.keyDown(sep(), { key: 'ArrowRight' });
  expect(useUi.getState().ui.panelW).toBe(356);
  for (let i = 0; i < 10; i++) fireEvent.keyDown(sep(), { key: 'ArrowRight' });
  expect(useUi.getState().ui.panelW).toBe(280);
  for (let i = 0; i < 60; i++) fireEvent.keyDown(sep(), { key: 'ArrowLeft' });
  expect(useUi.getState().ui.panelW).toBeLessThanOrEqual(1010);
  expect(sep()).toHaveAttribute('aria-valuenow', String(useUi.getState().ui.panelW));
});

test('ほかのキーは、何もしない', () => {
  render(<Resizer />);
  fireEvent.keyDown(sep(), { key: 'Enter' });
  expect(useUi.getState().ui.panelW).toBe(380);
  expect(savedW()).toBeUndefined();
});

test('ダブルクリック：もとの幅（380）へ。保存する。利用者が決めた印は、消える', () => {
  render(<Resizer />);
  act(() => useUi.getState().setPanelW(600));
  expect(useUi.getState().ui.panelUser).toBe(true);
  fireEvent.doubleClick(sep());
  expect(useUi.getState().ui.panelW).toBe(380);
  expect(useUi.getState().ui.panelUser).toBe(false);
  expect(savedW()).toBe(380);
  expect(JSON.parse(localStorage.getItem(UI_KEY) ?? '{}').panelUser).toBe(false);
});

test('ドラッグ：窓の右端からの距離が幅。途中は保存せず、離したとき保存。上限・下限で止まる。drag の class と body.resizing', () => {
  render(<Resizer />);
  fireEvent.pointerDown(sep(), { button: 0, pointerId: 1, clientX: 1220 });
  expect(sep()).toHaveClass('drag');
  expect(document.body).toHaveClass('resizing');

  fireEvent.pointerMove(sep(), { pointerId: 1, clientX: 1100 });
  expect(useUi.getState().ui.panelW).toBe(500);
  expect(savedW()).toBeUndefined();
  fireEvent.pointerMove(sep(), { pointerId: 1, clientX: 1590 }); // 下限
  expect(useUi.getState().ui.panelW).toBe(280);
  fireEvent.pointerMove(sep(), { pointerId: 1, clientX: 10 }); // 上限
  expect(useUi.getState().ui.panelW).toBe(1010);

  act(() => sep().releasePointerCapture(1));
  expect(sep()).not.toHaveClass('drag');
  expect(document.body).not.toHaveClass('resizing');
  expect(savedW()).toBe(1010);
});

test('ドラッグ：左の一覧をしまっていれば、上限は 70%・右ボタンでは始まらない・取り込みのない移動は無視', () => {
  render(<Resizer />);
  act(() => useUi.getState().toggleSide());
  expect(sep()).toHaveAttribute('aria-valuemax', '1120');
  fireEvent.pointerDown(sep(), { button: 2, pointerId: 2, clientX: 1000 });
  expect(sep()).not.toHaveClass('drag');
  fireEvent.pointerMove(sep(), { pointerId: 2, clientX: 900 });
  expect(useUi.getState().ui.panelW).toBe(380);
  fireEvent.pointerDown(sep(), { button: 0, pointerId: 3, clientX: 1000 });
  fireEvent.pointerMove(sep(), { pointerId: 3, clientX: 0 });
  expect(useUi.getState().ui.panelW).toBe(1120);
});

// 狭い窓（〜900px）の取っ手は、保存した幅（ui.panelW）を書き換えない（F23(3)）：その窓の間だけ、panelWNarrow に持つ
// 意図した変更（0.28.0）：1100px 以下は左の一覧が隠れる（上限は 800 − 400 = 400。旧：800 − 168 − 400 = 232）。既定（380）のままなら、細い既定（280）で始まる（旧：上限の 232）
test('狭い窓（800px）：下限 220・上限は、本文に 400px 残す幅（400）。既定のままなら 280。取っ手の値・矢印キー・ドラッグが、その範囲。保存した幅（380）は、書き換えない・localStorage にも書かない', () => {
  Object.defineProperty(window, 'innerWidth', { value: 800, configurable: true });
  render(<Resizer />);
  expect(sep()).toHaveAttribute('aria-valuemin', '220');
  expect(sep()).toHaveAttribute('aria-valuemax', '400'); // 800 − 0（左の一覧は、隠れる）− 400
  expect(sep()).toHaveAttribute('aria-valuenow', '280'); // 覚えている 380 は既定：1100px 以下では、細い既定
  expect(useUi.getState().ui.panelW).toBe(380);
  expect(savedW()).toBeUndefined();
  // 矢印キー：→ で狭める（下限 220 で止まる）・← で広げる（上限 400 で止まる）
  fireEvent.keyDown(sep(), { key: 'ArrowRight' });
  expect(sep()).toHaveAttribute('aria-valuenow', '256');
  for (let i = 0; i < 5; i++) fireEvent.keyDown(sep(), { key: 'ArrowRight' });
  expect(useUi.getState().panelWNarrow).toBe(220);
  for (let i = 0; i < 12; i++) fireEvent.keyDown(sep(), { key: 'ArrowLeft' });
  expect(useUi.getState().panelWNarrow).toBe(400);
  // ドラッグ：下限・上限で止まる
  fireEvent.pointerDown(sep(), { button: 0, pointerId: 4, clientX: 600 });
  fireEvent.pointerMove(sep(), { pointerId: 4, clientX: 790 });
  expect(useUi.getState().panelWNarrow).toBe(220);
  fireEvent.pointerMove(sep(), { pointerId: 4, clientX: 0 });
  expect(useUi.getState().panelWNarrow).toBe(400);
  fireEvent.pointerUp(sep(), { pointerId: 4 });
  // ダブルクリック：もとの幅（既定の 380 → 1100px 以下では、細い既定の 280）
  fireEvent.doubleClick(sep());
  expect(sep()).toHaveAttribute('aria-valuenow', '280');
  // 保存した幅は、どの操作でも、そのまま
  expect(useUi.getState().ui.panelW).toBe(380);
  expect(savedW()).toBeUndefined();
});

test('取っ手で変えた幅（380 以外）は、1100px 以下でも、そのまま使う。既定の 380 のままの人だけ、細い既定（280）', () => {
  Object.defineProperty(window, 'innerWidth', { value: 1000, configurable: true });
  useUi.setState({ ui: { ...useUi.getState().ui, panelW: 450 } });
  render(<Resizer />);
  expect(sep()).toHaveAttribute('aria-valuenow', '450'); // 1000 − 0 − 400 = 600 が上限：450 は収まる
});

test('回帰：保存 380・800px で ← を 1 回 → 保存は 380 のまま。1200px に広げると、380（280 に縮まない）', () => {
  Object.defineProperty(window, 'innerWidth', { value: 800, configurable: true });
  const { rerender } = render(<Resizer />);
  fireEvent.keyDown(sep(), { key: 'ArrowRight' });
  expect(useUi.getState().ui.panelW).toBe(380);
  Object.defineProperty(window, 'innerWidth', { value: 1200, configurable: true });
  act(() => void window.dispatchEvent(new Event('resize')));
  rerender(<Resizer />);
  expect(sep()).toHaveAttribute('aria-valuenow', '380');
});

test('狭い窓（600px）：左の一覧は、自動で隠れている。上限は、下限 220（本文は 380px）', () => {
  Object.defineProperty(window, 'innerWidth', { value: 600, configurable: true });
  render(<Resizer />);
  expect(sep()).toHaveAttribute('aria-valuemax', '220');
  expect(sep()).toHaveAttribute('aria-valuenow', '220');
});

// 利用者が決めた幅は、値でなく、印（panelUser）で見分ける：1100px 以下で、わざと 380 にしても、細い既定（280）に戻らない
test('回帰：1000px で、取っ手を、ちょうど 380 まで動かしても 280 に戻らない。ドラッグの途中（380 を通る瞬間）も、跳ねない。離したあと、印つきで保存', () => {
  Object.defineProperty(window, 'innerWidth', { value: 1000, configurable: true });
  render(<Resizer />);
  expect(sep()).toHaveAttribute('aria-valuenow', '280'); // 既定のまま：細い既定
  fireEvent.pointerDown(sep(), { button: 0, pointerId: 5, clientX: 720 });
  // 380 より広い所から、狭める。通るたびに、幅は、窓の右端からの距離のとおり（100px の跳ねがない）
  const seen: string[] = [];
  for (const x of [560, 580, 600, 619, 620, 621, 640]) {
    fireEvent.pointerMove(sep(), { pointerId: 5, clientX: x });
    seen.push(sep().getAttribute('aria-valuenow') ?? '');
  }
  expect(seen).toEqual(['440', '420', '400', '381', '380', '379', '360']);
  fireEvent.pointerMove(sep(), { pointerId: 5, clientX: 620 }); // ちょうど 380 で止める
  expect(sep()).toHaveAttribute('aria-valuenow', '380');
  act(() => sep().releasePointerCapture(5));
  expect(sep()).toHaveAttribute('aria-valuenow', '380'); // 離しても、380 のまま
  expect(useUi.getState().ui).toMatchObject({ panelW: 380, panelUser: true });
  expect(JSON.parse(localStorage.getItem(UI_KEY) ?? '{}')).toMatchObject({ panelW: 380, panelUser: true });
});

test('回帰：保存が「380・印あり」なら、1000px でも 380。「380・印なし」（古い保存）なら、既定のまま 280。ダブルクリックは、印を消して、280（既定）へ', () => {
  Object.defineProperty(window, 'innerWidth', { value: 1000, configurable: true });
  useUi.setState({ ui: { ...useUi.getState().ui, panelW: 380, panelUser: true } });
  render(<Resizer />);
  expect(sep()).toHaveAttribute('aria-valuenow', '380');
  fireEvent.doubleClick(sep()); // もとの幅 = 既定
  expect(useUi.getState().ui).toMatchObject({ panelW: 380, panelUser: false });
  expect(sep()).toHaveAttribute('aria-valuenow', '280');
  expect(JSON.parse(localStorage.getItem(UI_KEY) ?? '{}')).toMatchObject({ panelW: 380, panelUser: false });
});

test('矢印キーで決めた幅も、印つきで保存する（1000px：280 から、← を 1 回 → 304）。1101px 以上の窓で、380 にした幅は、窓を狭めても 380', () => {
  Object.defineProperty(window, 'innerWidth', { value: 1000, configurable: true });
  render(<Resizer />);
  fireEvent.keyDown(sep(), { key: 'ArrowLeft' });
  expect(sep()).toHaveAttribute('aria-valuenow', '304');
  expect(useUi.getState().ui).toMatchObject({ panelW: 304, panelUser: true });
  // 広い窓で、380 を、矢印キーで選ぶ（380 − 24 = 356 → ← で 380）
  act(() => useUi.getState().setPanelW(356));
  Object.defineProperty(window, 'innerWidth', { value: 1600, configurable: true });
  act(() => void window.dispatchEvent(new Event('resize')));
  fireEvent.keyDown(sep(), { key: 'ArrowLeft' });
  expect(useUi.getState().ui).toMatchObject({ panelW: 380, panelUser: true });
  Object.defineProperty(window, 'innerWidth', { value: 1000, configurable: true });
  act(() => void window.dispatchEvent(new Event('resize')));
  expect(sep()).toHaveAttribute('aria-valuenow', '380'); // わざと選んだ 380：窓を狭めても、そのまま
});

test('回帰：狭い窓（800px）でも、取っ手で、ちょうど 380 にすると 380（その窓の間だけ。保存した幅は、書き換えない）。ダブルクリックは、その窓の既定（280）', () => {
  Object.defineProperty(window, 'innerWidth', { value: 800, configurable: true });
  render(<Resizer />);
  fireEvent.pointerDown(sep(), { button: 0, pointerId: 6, clientX: 520 });
  fireEvent.pointerMove(sep(), { pointerId: 6, clientX: 420 }); // 800 − 420 = 380
  expect(sep()).toHaveAttribute('aria-valuenow', '380');
  fireEvent.pointerUp(sep(), { pointerId: 6 });
  act(() => sep().releasePointerCapture(6));
  expect(sep()).toHaveAttribute('aria-valuenow', '380');
  expect(useUi.getState().panelWNarrow).toBe(380);
  expect(useUi.getState().ui).toMatchObject({ panelW: 380, panelUser: false }); // 保存した幅は、そのまま
  expect(savedW()).toBeUndefined();
  fireEvent.doubleClick(sep());
  expect(sep()).toHaveAttribute('aria-valuenow', '280');
});
