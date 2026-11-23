// @vitest-environment jsdom
import { expect, test } from 'vitest';
import { $, $$, h, hash, trunc } from '../../src/web/lib/dom';

test('h：属性・class・text・value・イベント・子（配列・null・数）', () => {
  let clicked = 0;
  const el = h(
    'div',
    { class: 'a b', 'data-x': '1', hidden: true, off: false, none: null, onclick: () => clicked++ },
    'x',
    [h('span', { text: 's' }), null, 2],
    false,
  );
  expect(el.className).toBe('a b');
  expect(el.getAttribute('data-x')).toBe('1');
  expect(el.hasAttribute('hidden')).toBe(true);
  expect(el.hasAttribute('off')).toBe(false);
  expect(el.textContent).toBe('xs2');
  el.click();
  expect(clicked).toBe(1);
  expect(h('input', { value: 'v' }).value).toBe('v');
});

test('h：text は、文字として入る（HTML にしない）', () => {
  const el = h('p', { text: '<b>x</b>' });
  expect(el.querySelector('b')).toBeNull();
  expect(el.textContent).toBe('<b>x</b>');
});

test('$・$$', () => {
  const root = h('div', {}, h('i', { class: 'k' }), h('i', { class: 'k' }));
  expect($('.k', root)).toBe(root.firstChild);
  expect($$('.k', root)).toHaveLength(2);
  expect($('.none', root)).toBeNull();
});

test('trunc：空白をつぶして切り詰める・hash：同じ文字は同じ', () => {
  expect(trunc('  a \n b  ', 10)).toBe('a b');
  expect(trunc('abcdefghij', 5)).toBe('abcd…');
  expect(trunc(null, 5)).toBe('');
  expect(trunc('a\u2800b\u2800', 10)).toBe('ab'); // 点字の空白（U+2800）は、取り除く（見えない文字）
  // 見えない文字（Cf・Default_Ignorable・異体字セレクタ・タグ文字）は、除く。絵文字の ZWJ・U+FE0F は、残す
  expect(trunc('a\u200bb\u2060c\u200cd\u{e0149}e\u{e0100}f\ufe00g\u3164h\u034fi', 20)).toBe('abcdefghi');
  expect(trunc('👨\u200d👩 ❤\ufe0f', 20)).toBe('👨\u200d👩 ❤\ufe0f');
  expect(hash('abc')).toBe(hash('abc'));
  expect(hash('abc')).not.toBe(hash('abd'));
});
