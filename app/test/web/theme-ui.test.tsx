// @vitest-environment jsdom
// 上のバーの、外観のボタン（F36）：いまのモードと、次の動作が分かる名前。押すと、system → light → dark → system と巡り、<html data-theme> と localStorage に反映する。
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { TopBar } from '../../src/web/layout/TopBar';
import { UI_KEY } from '../../src/web/lib/storage';
import { useUi } from '../../src/web/store/ui';
import { resetAll } from './helpers';

beforeEach(() => {
  resetAll();
  document.documentElement.removeAttribute('data-theme');
});
afterEach(() => document.documentElement.removeAttribute('data-theme'));

const bar = () => render(<TopBar view={null} status={{ offline: false, error: null }} />);
const btn = () => document.getElementById('btn-theme') as HTMLButtonElement;

test('外観のボタン：名前（aria-label・title）は、いまのモードと次の動作。押すと、巡って、data-theme と保存に反映する。system は、属性なし', async () => {
  bar();
  expect(btn().getAttribute('aria-label')).toBe('外観：システム（自動）。押すと、ライトにします');
  expect(btn().title).toBe(btn().getAttribute('aria-label'));
  expect(btn().tagName).toBe('BUTTON'); // キーボードで操作できる（Tab・Enter・Space）
  expect(document.documentElement.hasAttribute('data-theme')).toBe(false);

  await userEvent.click(btn());
  expect(btn().getAttribute('aria-label')).toBe('外観：ライト。押すと、ダークにします');
  expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  expect(JSON.parse(localStorage.getItem(UI_KEY) ?? '{}').theme).toBe('light');

  await userEvent.click(btn());
  expect(btn().getAttribute('aria-label')).toBe('外観：ダーク。押すと、システム（自動）にします');
  expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

  await userEvent.click(btn());
  expect(btn().getAttribute('aria-label')).toBe('外観：システム（自動）。押すと、ライトにします');
  expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  expect(JSON.parse(localStorage.getItem(UI_KEY) ?? '{}').theme).toBe('system');
});

test('外観のボタン：キーボード（Tab で届き、Enter・Space で押せる）。アイコンは、モードごとに変わる（Monitor・Sun・Moon）', async () => {
  bar();
  const icon = () => btn().querySelector('svg')?.getAttribute('class') ?? '';
  expect(icon()).toContain('lucide-monitor');
  btn().focus();
  expect(document.activeElement).toBe(btn());
  await userEvent.keyboard('{Enter}');
  expect(icon()).toContain('lucide-sun');
  await userEvent.keyboard(' ');
  expect(icon()).toContain('lucide-moon');
  act(() => useUi.getState().setTheme('system'));
  expect(icon()).toContain('lucide-monitor');
  expect(screen.getByRole('button', { name: /^外観：システム（自動）/ })).toBe(btn());
});
