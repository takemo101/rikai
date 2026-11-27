// @vitest-environment jsdom
// 範囲の画像（foreignObject の中）に入れる、KaTeX のフォント：使う面だけ・同じオリジンから読んで data: にする・読めない面は、入れない（画像を失敗させない）
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const FACES = `
@font-face{font-family:KaTeX_Main;font-style:normal;font-weight:400;src:url(/assets/KaTeX_Main-Regular.woff2) format("woff2")}
@font-face{font-family:KaTeX_Main;font-style:italic;font-weight:400;src:url(/assets/KaTeX_Main-Italic.woff2) format("woff2")}
@font-face{font-family:KaTeX_Math;font-style:italic;font-weight:400;src:url(/assets/KaTeX_Math-Italic.woff2) format("woff2")}
@font-face{font-family:Other;src:url(/assets/other.woff2) format("woff2")}`;

const katexFontCss = async (sources: Element[]): Promise<string> =>
  (await import('../../../src/web/interact/katexFonts')).katexFontCss(sources);

const used = (css: string): HTMLElement => {
  const el = document.createElement('span');
  el.setAttribute('style', css);
  document.body.append(el);
  return el;
};

beforeEach(() => {
  const st = document.createElement('style');
  st.textContent = FACES;
  document.head.append(st);
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => Promise.resolve(new Response(new Blob([`font:${url}`], { type: 'font/woff2' })))),
  );
  vi.resetModules(); // フォントの読み込み結果は、モジュールが覚える：テストごとに、新しく
});
afterEach(() => {
  document.head.replaceChildren();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

test('KaTeX の文字がなければ、空（フォントを読まない）', async () => {
  expect(await katexFontCss([used('font-family: Arial')])).toBe('');
  expect(fetch).not.toHaveBeenCalled();
});

test('使っている面（family・weight・style）だけを、data: で持つ @font-face にする', async () => {
  const root = used('font-family: KaTeX_Main; font-weight: 400; font-style: normal');
  const child = document.createElement('i');
  child.setAttribute('style', 'font-family: KaTeX_Math; font-style: italic');
  root.append(child);
  const css = await katexFontCss([root]);
  expect(css).toContain('@font-face{font-family:KaTeX_Main;font-weight:400;font-style:normal;src:url(data:');
  expect(css).toContain('@font-face{font-family:KaTeX_Math;font-weight:400;font-style:italic;src:url(data:');
  expect(css).not.toContain('Italic.woff2');
  expect(css.match(/@font-face/g)).toHaveLength(2); // KaTeX_Main の斜体・Other は、使っていない：入れない
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(css).not.toMatch(/url\((?!data:)/); // 外のファイルを指さない
});

test('フォントを読めない面は、入れない（画像を、失敗させない）', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response(null, { status: 404 }))),
  );
  const css = await katexFontCss([used('font-family: KaTeX_Main; font-weight: 400')]);
  expect(css).toBe('');
});
