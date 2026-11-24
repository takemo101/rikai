// @vitest-environment jsdom
// キー判定：変換中（IME。`isComposing` か `keyCode 229`）は、Esc も ⌘/Ctrl+Enter も、処理しない。
import { expect, test } from 'vitest';
import { isImeKey, isModEnter } from '../../../src/web/lib/keys';

const key = (init: KeyboardEventInit & { keyCode?: number }): KeyboardEvent => new KeyboardEvent('keydown', init);

test('isImeKey：変換中（isComposing か keyCode 229）だけ true', () => {
  expect(isImeKey(key({ key: 'Escape' }))).toBe(false);
  expect(isImeKey(key({ key: 'Escape', isComposing: true }))).toBe(true);
  expect(isImeKey(key({ key: 'Escape', keyCode: 229 }))).toBe(true);
  expect(isImeKey(key({ key: 'Escape', keyCode: 27 }))).toBe(false);
  // 変換の確定の Enter も、変換中として扱う（Safari 系は、keyCode 229 を付ける）
  expect(isImeKey(key({ key: 'Enter', keyCode: 229, metaKey: true }))).toBe(true);
});

test('isModEnter：⌘ か Ctrl + Enter。ほかのキー・修飾なし・Shift だけ・変換中は false', () => {
  expect(isModEnter(key({ key: 'Enter', metaKey: true }))).toBe(true);
  expect(isModEnter(key({ key: 'Enter', ctrlKey: true }))).toBe(true);
  expect(isModEnter(key({ key: 'Enter' }))).toBe(false);
  expect(isModEnter(key({ key: 'Enter', shiftKey: true }))).toBe(false);
  expect(isModEnter(key({ key: 'a', metaKey: true }))).toBe(false);
  expect(isModEnter(key({ key: 'Enter', metaKey: true, isComposing: true }))).toBe(false);
  expect(isModEnter(key({ key: 'Enter', ctrlKey: true, keyCode: 229 }))).toBe(false);
});
