// @vitest-environment jsdom
// 自動で隠す窓（788px 未満）：左の一覧は、本文の列から外れる。上のバーの開閉ボタンは、見えている状態を示し、押すと、本文の上に重ねて出す（ドロワー）。保存した sideOpen は、書き換えない（F23(3)）。
// 境界は 788px（168 + 220 + 400）。以前は 700/701px だった（意図した変更）
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test } from 'vitest';
import { TopBar } from '../../src/web/layout/TopBar';
import { UI_KEY } from '../../src/web/lib/storage';
import { useUi } from '../../src/web/store/ui';
import { resetAll } from './helpers';

beforeEach(() => resetAll());
const setWidth = (w: number) => Object.defineProperty(window, 'innerWidth', { value: w, configurable: true });
const bar = () => render(<TopBar view={null} status={{ offline: false, error: null }} />);
const side = () => document.getElementById('btn-side') as HTMLButtonElement;

test('788px 以上：保存した開閉。押すと、保存する', async () => {
  setWidth(788);
  bar();
  expect(side().getAttribute('aria-expanded')).toBe('true');
  await userEvent.click(side());
  expect(side().getAttribute('aria-expanded')).toBe('false');
  expect(JSON.parse(localStorage.getItem(UI_KEY) ?? '{}').sideOpen).toBe(false);
  expect(useUi.getState().narrowSideOpen).toBe(false);
});

test('787px 以下：隠れている（aria-expanded=false）。押すと、重ねて出る・もう一度で隠れる。保存した sideOpen・localStorage は、そのまま', async () => {
  setWidth(787);
  bar();
  expect(useUi.getState().ui.sideOpen).toBe(true); // 保存した値は、開いている
  expect(side().getAttribute('aria-expanded')).toBe('false');
  await userEvent.click(side());
  expect(side().getAttribute('aria-expanded')).toBe('true');
  expect(useUi.getState().ui.sideOpen).toBe(true);
  expect(localStorage.getItem(UI_KEY)).toBeNull();
  await userEvent.click(side());
  expect(side().getAttribute('aria-expanded')).toBe('false');
  expect(localStorage.getItem(UI_KEY)).toBeNull();
});
