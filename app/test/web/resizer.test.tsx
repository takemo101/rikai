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
