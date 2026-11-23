// @vitest-environment jsdom
// 外観のモード（F36）：保存値の検査・巡る順・`<html data-theme>`・解決した外観（OS の外観との関係）・変化の購読（後始末まで）。
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
  applyTheme,
  nextTheme,
  parseTheme,
  resolvedTheme,
  subscribeResolved,
  THEME_ORDER,
} from '../../../src/web/lib/theme';

/** matchMedia の代用：OS の外観（`prefers-color-scheme`）を、テストが決め、変えられる */
function osScheme(initial: 'light' | 'dark') {
  let dark = initial === 'dark';
  const listeners = new Set<() => void>();
  const mq = {
    get matches() {
      return dark;
    },
    addEventListener: vi.fn((_: string, cb: () => void) => void listeners.add(cb)),
    removeEventListener: vi.fn((_: string, cb: () => void) => void listeners.delete(cb)),
  };
  vi.stubGlobal('matchMedia', () => mq);
  return {
    mq,
    set(next: 'light' | 'dark') {
      dark = next === 'dark';
      for (const l of [...listeners]) l();
    },
    count: () => listeners.size,
  };
}

beforeEach(() => document.documentElement.removeAttribute('data-theme'));
afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute('data-theme');
});

test('保存した値：light・dark・system だけ。壊れた値・知らない値・型違いは、既定（system）に戻す', () => {
  expect(['light', 'dark', 'system'].map(parseTheme)).toEqual(['light', 'dark', 'system']);
  for (const bad of [undefined, null, 'Dark', '', 'auto', 1, true, {}, []]) expect(parseTheme(bad)).toBe('system');
});

test('巡る順：system → light → dark → system', () => {
  expect(THEME_ORDER).toEqual(['system', 'light', 'dark']);
  expect(nextTheme('system')).toBe('light');
  expect(nextTheme('light')).toBe('dark');
  expect(nextTheme('dark')).toBe('system');
});

test('applyTheme：light・dark は、<html data-theme> を付ける。system は、付けない（外す）', () => {
  const root = document.documentElement;
  applyTheme('dark');
  expect(root.getAttribute('data-theme')).toBe('dark');
  applyTheme('light');
  expect(root.getAttribute('data-theme')).toBe('light');
  applyTheme('system');
  expect(root.hasAttribute('data-theme')).toBe(false);
});

test('resolvedTheme：data-theme があれば、それ（OS の外観に関係なく）。なければ、OS の外観に従う', () => {
  const os = osScheme('dark');
  expect(resolvedTheme()).toBe('dark'); // system：OS（ダーク）
  os.set('light');
  expect(resolvedTheme()).toBe('light'); // system：OS が変わった
  applyTheme('dark');
  expect(resolvedTheme()).toBe('dark'); // 選んだ：OS はライト
  applyTheme('light');
  os.set('dark');
  expect(resolvedTheme()).toBe('light'); // 選んだ：OS はダーク
});

test('resolvedTheme：matchMedia がなくても、ライト', () => {
  vi.stubGlobal('matchMedia', undefined);
  expect(resolvedTheme()).toBe('light');
});

test('subscribeResolved：data-theme の変更・OS の外観の変更で、呼ばれる。外すと、どちらも、止まる（リスナー・監視が残らない）', async () => {
  const os = osScheme('light');
  const cb = vi.fn();
  const off = subscribeResolved(cb);
  expect(os.count()).toBe(1);
  os.set('dark');
  expect(cb).toHaveBeenCalledTimes(1);
  applyTheme('dark');
  await Promise.resolve(); // MutationObserver は、非同期
  await vi.waitFor(() => expect(cb).toHaveBeenCalledTimes(2));
  off();
  expect(os.count()).toBe(0);
  expect(os.mq.removeEventListener).toHaveBeenCalledTimes(1);
  os.set('light');
  applyTheme('light');
  await new Promise((r) => setTimeout(r, 10));
  expect(cb).toHaveBeenCalledTimes(2);
});

// public/assets/theme-init.js（描く前に、保存した外観を付ける小さなスクリプト）は、parseTheme と、同じ規則
test('theme-init.js：保存値の読み方は parseTheme と同じ（light・dark だけ付ける。system・壊れた値・知らない値・例外は、付けない）', () => {
  const code = fs.readFileSync(path.resolve(__dirname, '../../../src/web/public/assets/theme-init.js'), 'utf8');
  const raws: (string | null)[] = [
    null,
    '',
    'not json',
    'null',
    '123',
    '[]',
    '{}',
    '{"theme":"light"}',
    '{"theme":"dark"}',
    '{"theme":"system"}',
    '{"theme":"Dark"}',
    '{"theme":1}',
    '{"theme":null}',
    '{"theme":"dark","side":300}',
  ];
  for (const raw of raws) {
    document.documentElement.removeAttribute('data-theme');
    localStorage.clear();
    if (raw !== null) localStorage.setItem('rikai-ui', raw);
    new Function(code)();
    let theme: unknown;
    try {
      theme = JSON.parse(raw ?? '{}').theme;
    } catch {
      theme = undefined;
    }
    const want = parseTheme(theme);
    expect(document.documentElement.getAttribute('data-theme'), String(raw)).toBe(want === 'system' ? null : want);
  }
  // localStorage が使えなくても、例外を出さない
  document.documentElement.removeAttribute('data-theme');
  vi.stubGlobal('localStorage', {
    getItem() {
      throw new Error('denied');
    },
  });
  expect(() => new Function(code)()).not.toThrow();
  expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  vi.unstubAllGlobals();
});
