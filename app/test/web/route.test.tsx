// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import { hrefOf, navigate, parseHash, useRoute } from '../../src/web/lib/route';

afterEach(() => {
  location.hash = '';
});

test('ハッシュを読む：トピック・ページ・版（省略は root・null）', () => {
  expect(parseHash('#/demo')).toEqual({ slug: 'demo', page: 'root', version: null });
  expect(parseHash('#/demo/root')).toEqual({ slug: 'demo', page: 'root', version: null });
  expect(parseHash('#/demo/intro/v3')).toEqual({ slug: 'demo', page: 'intro', version: 3 });
  expect(parseHash('#/a-1/b-2')).toEqual({ slug: 'a-1', page: 'b-2', version: null });
});

test('旧と同じ：`#/<slug>/v2` の v2 は、ページの名前（版ではない）', () => {
  expect(parseHash('#/demo/v2')).toEqual({ slug: 'demo', page: 'v2', version: null });
});

test('読めないハッシュは null（大文字・空・余分な階層・先頭の # なし）', () => {
  for (const h of ['', '#', '#/', '#/Demo', '#/demo/root/v2/x', '#/demo/root/2', 'demo', '#demo']) {
    expect(parseHash(h), h).toBeNull();
  }
});

test('href：版は、あるときだけ', () => {
  expect(hrefOf('demo')).toBe('#/demo/root');
  expect(hrefOf('demo', 'intro')).toBe('#/demo/intro');
  expect(hrefOf('demo', 'intro', 2)).toBe('#/demo/intro/v2');
});

test('useRoute：hashchange で更新する', () => {
  location.hash = '#/demo/root';
  const { result } = renderHook(() => useRoute());
  expect(result.current).toEqual({ slug: 'demo', page: 'root', version: null });
  act(() => {
    navigate('other', 'p', 2);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
  expect(result.current).toEqual({ slug: 'other', page: 'p', version: 2 });
  act(() => {
    location.hash = '#/!';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
  expect(result.current).toBeNull();
});
