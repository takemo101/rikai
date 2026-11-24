// @vitest-environment jsdom
// draw.io のラベル：HTML をタグを外した文字にする（リンク・スクリプト・画像の URL を、一切出さない）・折り返し（日本語・行頭禁則）
import { afterEach, expect, test } from 'vitest';
import { approxMeasure, htmlToText, wrapText } from '../../../src/web/doc/render/drawioText';

afterEach(() => {
  (window as unknown as { __pwned?: number }).__pwned = undefined;
});

test('HTML のラベル：<br>・ブロック要素は改行・ほかのタグは捨てる・実体は戻す', () => {
  expect(htmlToText('予約照会<br>システム')).toBe('予約照会\nシステム');
  expect(htmlToText('<b>太字</b>と<i>斜体</i>&amp;&lt;')).toBe('太字と斜体&<');
  expect(htmlToText('<div>1行目</div><div>2行目</div>')).toBe('1行目\n2行目');
  expect(htmlToText('<p>段落</p>後ろ')).toBe('段落\n後ろ');
  expect(htmlToText('タグなし')).toBe('タグなし');
});

test('HTML のラベル：リンク・画像・スクリプト・スタイルの中身や URL は、一切出ない（属性も、捨てる）', () => {
  const out = htmlToText(
    '<a href="javascript:alert(1)">リンク</a><img src="https://evil.example/x.png" onerror="window.__pwned=1"><script>window.__pwned=2</script><style>body{background:url(https://evil.example/y)}</style><svg onload="window.__pwned=3"><text>svg の文字</text></svg>本文<iframe src="https://evil.example"></iframe>',
  );
  expect(out).toBe('リンク本文');
  expect(out).not.toMatch(/javascript|evil|alert|http|onerror/);
  expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined(); // スクリプトは、動かない
});

test('HTML のラベル：長さの上限', () => {
  expect(htmlToText(`<b>${'あ'.repeat(10_000)}</b>`).length).toBeLessThanOrEqual(2000);
});

test('折り返し：全角は、幅で割る・行頭禁則（句読点）・英単語は、空白で・長い語は文字で割る・改行は、段落', () => {
  const m = approxMeasure;
  const lines = wrapText('お客様の希望を聞く。次へ', 5 * 12, 12, false, m);
  expect(lines.length).toBeGreaterThan(1);
  for (const l of lines) expect(l.startsWith('。')).toBe(false); // 句点が、行頭に来ない
  expect(lines.join('')).toBe('お客様の希望を聞く。次へ');
  expect(wrapText('hello world foo', 60, 12, false, m).join(' ')).toBe('hello world foo');
  expect(wrapText('a\nb', 100, 12, false, m)).toEqual(['a', 'b']);
  expect(wrapText('verylongwordwithoutspaces', 40, 12, false, m).length).toBeGreaterThan(1);
  expect(wrapText('折り返さない', null, 12, false, m)).toEqual(['折り返さない']);
  expect(wrapText('x\n'.repeat(1000), 100, 12, false, m).length).toBeLessThanOrEqual(200); // 行数の上限
});
