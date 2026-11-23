// 枠の中身が、画面の配色への対応を示しているか（オプトインの判定。サーバーと画面が、同じ関数を使う）。
import { expect, test } from 'vitest';
import { BRIDGE_COLORS, bridgeColorDecls, followsTheme } from '../../src/shared/htmlapp-theme';

test('橋が配る色の変数を使い、同じ名前を自分で定義していなければ、true（直後は、`)`・`,`・空白）', () => {
  for (const name of Object.keys(BRIDGE_COLORS)) {
    expect(followsTheme(`<p style="color: var(--color-${name})">x</p>`), name).toBe(true);
    expect(followsTheme(`<style>.c{color:var(--color-${name}, #333)}</style>`), name).toBe(true);
    expect(followsTheme(`<style>.c{color:var( --color-${name} )}</style>`), name).toBe(true);
  }
  expect(
    followsTheme('<style>.card{background:var(--color-surface,#fff);border:1px solid var(--color-line)}</style>'),
  ).toBe(true);
});

test('橋が配らない名前（自作の --color-primary など）は、印ではない。自作の定義だけの資料は、false（従来のまま）', () => {
  expect(
    followsTheme(
      '<style>:root{--color-primary:#06c;--color-text:#222}.b{background:var(--color-primary);color:var(--color-text)}</style>',
    ),
  ).toBe(false);
  expect(followsTheme('<p style="color:var(--color-primary)">x</p>')).toBe(false);
  expect(followsTheme('<p style="color:var(--color-inks)">x</p>')).toBe(false); // 名前の途中までは、一致しない
  expect(followsTheme('<p style="color:var(--color-bgx)">x</p>')).toBe(false);
  expect(followsTheme('<p style="color:var(--color-)">x</p>')).toBe(false);
});

test('橋の名前を、自分で定義している資料は、false（自作の --color-bg を定義して、使う）。定義していない別の橋の名前も使えば、true', () => {
  expect(
    followsTheme(
      '<style>:root{--color-bg:#f4f4f5;--color-ink:#111}body{background:var(--color-bg);color:var(--color-ink)}</style>',
    ),
  ).toBe(false);
  expect(followsTheme('<style>:root { --color-bg : #f4f4f5 }body{background:var(--color-bg)}</style>')).toBe(false);
  expect(
    followsTheme('<style>:root{--color-bg:#eee}body{background:var(--color-bg);color:var(--color-ink)}</style>'),
  ).toBe(true);
});

test('名前の前方一致を取り違えない：var(--color-ink-2) だけを使い --color-ink を定義 → ink-2 を使っている（true）／--color-ink-2 を定義して --color-ink を使う → ink を使っている（true）', () => {
  expect(followsTheme('<style>:root{--color-ink:#111}p{color:var(--color-ink-2)}</style>')).toBe(true);
  expect(followsTheme('<style>:root{--color-ink-2:#333}p{color:var(--color-ink)}</style>')).toBe(true);
  expect(followsTheme('<style>:root{--color-ink-2:#333}p{color:var(--color-ink-2)}</style>')).toBe(false);
  expect(followsTheme('<style>:root{--color-ink:#111}p{color:var(--color-ink)}</style>')).toBe(false);
  expect(followsTheme('<style>:root{--color-accent:#111}p{color:var(--color-accent-ink)}</style>')).toBe(true);
});

test('<meta name="color-scheme"> は、印（標準の、明示の宣言）', () => {
  expect(followsTheme('<meta name="color-scheme" content="light dark"><p>x</p>')).toBe(true);
  expect(followsTheme("<META NAME='color-scheme' content='dark'>")).toBe(true);
  expect(followsTheme('<meta  charset="utf-8" name=color-scheme content="light dark">')).toBe(true);
});

test('data-theme という文字・color-scheme の CSS・別の meta・色の直書きは、印ではない（false）', () => {
  for (const c of [
    '',
    '<p>何も書かない</p>',
    '<p>"data-theme" について書く</p>',
    '<style>[data-theme="dark"] .c{color:#fff}</style>',
    '<script>document.documentElement.getAttribute("data-theme")</script>',
    '<style>body{margin:0;background:#fff;color:#111}</style>',
    '<style>:root{color-scheme: light dark}</style>',
    '<meta name="viewport" content="width=device-width">',
    '<p style="color: var(--ink)">x</p>',
    '<meta charset="utf-8">',
  ])
    expect(followsTheme(c), c).toBe(false);
});

test('単純な文字の検査：コメントの中の var(--color-bg) も、使っているとみなす（まれ。許容）', () => {
  expect(followsTheme('<!-- body{background:var(--color-bg)} -->')).toBe(true);
});

test('土台の色の宣言は、BRIDGE_COLORS から作る（名前が、二重にならない）', () => {
  const decls = bridgeColorDecls();
  expect(decls.split(';')).toHaveLength(Object.keys(BRIDGE_COLORS).length);
  expect(decls).toContain('--color-bg:light-dark(#fff,#09090b)');
  expect(decls).toContain('--color-accent-fill:#2563eb');
});
