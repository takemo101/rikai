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
  expect(hash('abc')).toBe(hash('abc'));
  expect(hash('abc')).not.toBe(hash('abd'));
});
