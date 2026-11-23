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

test('ダブルクリック：もとの幅（380）へ。保存する', () => {
  render(<Resizer />);
  act(() => useUi.getState().setPanelW(600));
  fireEvent.doubleClick(sep());
  expect(useUi.getState().ui.panelW).toBe(380);
  expect(savedW()).toBe(380);
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
test('狭い窓（800px）：下限 220・上限は、本文に 400px 残す幅（232）。取っ手の値・矢印キー・ドラッグが、その範囲。保存した幅（380）は、書き換えない・localStorage にも書かない', () => {
  Object.defineProperty(window, 'innerWidth', { value: 800, configurable: true });
  render(<Resizer />);
  expect(sep()).toHaveAttribute('aria-valuemin', '220');
  expect(sep()).toHaveAttribute('aria-valuemax', '232'); // 800 − 168 − 400
  expect(sep()).toHaveAttribute('aria-valuenow', '232'); // 覚えている 380 を、上限で抑えた表示
  expect(useUi.getState().ui.panelW).toBe(380);
  expect(savedW()).toBeUndefined();
  // 矢印キー：→ で狭める（下限 220 で止まる）・← は、上限（232）で止まる
  fireEvent.keyDown(sep(), { key: 'ArrowRight' });
  expect(sep()).toHaveAttribute('aria-valuenow', '220');
  fireEvent.keyDown(sep(), { key: 'ArrowRight' });
  expect(useUi.getState().panelWNarrow).toBe(220);
  fireEvent.keyDown(sep(), { key: 'ArrowLeft' });
  fireEvent.keyDown(sep(), { key: 'ArrowLeft' });
  expect(useUi.getState().panelWNarrow).toBe(232);
  // ドラッグ：下限・上限で止まる
  fireEvent.pointerDown(sep(), { button: 0, pointerId: 4, clientX: 600 });
  fireEvent.pointerMove(sep(), { pointerId: 4, clientX: 790 });
  expect(useUi.getState().panelWNarrow).toBe(220);
  fireEvent.pointerMove(sep(), { pointerId: 4, clientX: 0 });
  expect(useUi.getState().panelWNarrow).toBe(232);
  fireEvent.pointerUp(sep(), { pointerId: 4 });
  // ダブルクリック：もとの幅（既定 380 を、上限で抑える）
  fireEvent.doubleClick(sep());
  expect(sep()).toHaveAttribute('aria-valuenow', '232');
  // 保存した幅は、どの操作でも、そのまま
  expect(useUi.getState().ui.panelW).toBe(380);
  expect(savedW()).toBeUndefined();
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
