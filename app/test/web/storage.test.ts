// @vitest-environment jsdom
import { beforeEach, expect, test } from 'vitest';
import { DEFAULT_UI, loadSeen, loadUi, SEEN_KEY, SEEN_MAX, saveSeen, saveUi, UI_KEY } from '../../src/web/lib/storage';

beforeEach(() => localStorage.clear());

test('seen：保存して、読み戻す。新しい 2000 件だけ覚える', () => {
  saveSeen(new Set(['a', 'b']));
  expect([...loadSeen()]).toEqual(['a', 'b']);
  saveSeen(new Set(Array.from({ length: SEEN_MAX + 5 }, (_, i) => `m${i}`)));
  const seen = loadSeen();
  expect(seen.size).toBe(SEEN_MAX);
  expect(seen.has('m4')).toBe(false);
  expect(seen.has(`m${SEEN_MAX + 4}`)).toBe(true);
});

test('seen：壊れていたら、空（配列でない・文字列でない要素）', () => {
  localStorage.setItem(SEEN_KEY, '{oops');
  expect(loadSeen().size).toBe(0);
  localStorage.setItem(SEEN_KEY, '{"a":1}');
  expect(loadSeen().size).toBe(0);
  localStorage.setItem(SEEN_KEY, '["a",1,null,"b"]');
  expect([...loadSeen()]).toEqual(['a', 'b']);
});

test('ui：既定・保存・読み戻し・壊れていたら既定', () => {
  expect(loadUi()).toEqual(DEFAULT_UI);
  expect(DEFAULT_UI).toEqual({ sideOpen: true, panelW: 380, links: true, theme: 'system' });
  saveUi({ sideOpen: false, panelW: 450, links: true, theme: 'system' });
  expect(loadUi()).toEqual({ sideOpen: false, panelW: 450, links: true, theme: 'system' });
  localStorage.setItem(UI_KEY, 'not json');
  expect(loadUi()).toEqual(DEFAULT_UI);
  localStorage.setItem(UI_KEY, JSON.stringify({ sideOpen: 'yes', panelW: 'abc' }));
  expect(loadUi()).toEqual(DEFAULT_UI);
  localStorage.setItem(UI_KEY, JSON.stringify({ panelW: '420' }));
  expect(loadUi()).toEqual({ sideOpen: true, panelW: 420, links: true, theme: 'system' });
});

test('ui：外観のモード（theme）は、light・dark・system だけ。壊れた値・知らない値は、system に戻す。ほかの設定は、そのまま', () => {
  for (const t of ['light', 'dark', 'system'] as const) {
    saveUi({ sideOpen: false, panelW: 450, links: false, theme: t });
    expect(loadUi()).toEqual({ sideOpen: false, panelW: 450, links: false, theme: t });
  }
  // 古い保存（theme がない）：既定
  localStorage.setItem(UI_KEY, JSON.stringify({ sideOpen: false, panelW: 420, links: false }));
  expect(loadUi()).toEqual({ sideOpen: false, panelW: 420, links: false, theme: 'system' });
  // 知らない値・型違い：system。ほかの設定は、読める
  for (const bad of ['Dark', 'auto', 1, null, {}, true]) {
    localStorage.setItem(UI_KEY, JSON.stringify({ sideOpen: false, theme: bad }));
    expect(loadUi()).toMatchObject({ sideOpen: false, theme: 'system' });
  }
});
