// draw.io の、スタイル・色の検査（純粋）。資料の XML は非信頼：色は、`#rgb`/`#rrggbb`/`#rrggbbaa`/`none`/CSS の色名/`light-dark(a,b)` だけ。ほかは、無いものとして扱う
import { expect, test } from 'vitest';
import { checkColor, inkOn, luminanceOf, parseStyle } from '../../../src/web/doc/render/drawioStyle';

test('色：許可する形だけ通す（16 進・色名・none・inherit・light-dark）', () => {
  expect(checkColor('#DAE8FC', 'light')).toBe('#dae8fc');
  expect(checkColor('#fff', 'light')).toBe('#fff');
  expect(checkColor('#11223344', 'light')).toBe('#11223344');
  expect(checkColor('Red', 'light')).toBe('red');
  expect(checkColor('none', 'light')).toBe('none');
  expect(checkColor('inherit', 'light')).toBe('inherit');
  expect(checkColor('default', 'light')).toBeNull();
  expect(checkColor('light-dark(#ffffff,#121212)', 'light')).toBe('#ffffff');
  expect(checkColor('light-dark(#ffffff,#121212)', 'dark')).toBe('#121212');
});

test('色：CSS・SVG への注入になる値は、すべて断る', () => {
  for (const bad of [
    'url(https://evil.example/x)',
    'url(#a)',
    'var(--x)',
    'rgb(0,0,0)',
    'red;background:url(x)',
    '#fff;stroke:red',
    '#ggg',
    '#12345',
    'expression(alert(1))',
    'javascript:alert(1)',
    'red" onload="alert(1)',
    'light-dark(url(x),red)',
    'light-dark(red,red,red)',
    'notacolor',
    '',
  ])
    expect(checkColor(bad, 'light'), bad).toBeNull();
});

test('スタイル：`;` 区切り・`=` のない語は bare・数と旗は範囲に収める・`__proto__` などのキーは、オブジェクトを汚さない', () => {
  const s = parseStyle(
    'ellipse;whiteSpace=wrap;strokeWidth=99;fontSize=abc;dashed=1;rounded=0;__proto__=x;fillColor=red;strokeColor=url(x)',
  );
  expect(s.bare).toEqual(['ellipse']);
  expect(s.str('whiteSpace')).toBe('wrap');
  expect(s.num('strokeWidth', 1, 0, 20)).toBe(20);
  expect(s.num('fontSize', 12)).toBe(12); // 数でなければ、既定
  expect(s.num('missing', 5)).toBe(5);
  expect(s.flag('dashed', false)).toBe(true);
  expect(s.flag('rounded', true)).toBe(false);
  expect(s.str('__proto__')).toBe('x');
  expect(({} as Record<string, unknown>).x).toBeUndefined();
  expect(s.color('fillColor', 'light')).toBe('red');
  expect(s.color('strokeColor', 'light')).toBeNull();
  expect(s.badColors).toEqual(['strokeColor']); // 使えない色は、記録する
});

test('スタイル：長すぎる値・文字列は、無いものとして扱う', () => {
  const s = parseStyle(`fillColor=${'a'.repeat(1000)};x=1`);
  expect(s.str('fillColor')).toBeUndefined();
  expect(s.str('x')).toBe('1');
  expect(parseStyle(`${'a=1;'.repeat(5000)}z=9`).str('z')).toBeUndefined(); // 先頭の 4000 文字だけ読む
});

test('明るさ：薄い青の地には黒・濃い地には白。色名も読める', () => {
  expect(inkOn('#dae8fc')).toBe('#000000');
  expect(inkOn('#0b2a5c')).toBe('#ffffff');
  expect(inkOn('yellow')).toBe('#000000');
  expect(inkOn('navy')).toBe('#ffffff');
  expect(inkOn('none')).toBeNull();
  expect(luminanceOf('#fff')).toBeCloseTo(1, 2);
});
