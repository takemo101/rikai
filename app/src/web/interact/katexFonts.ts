// 数式（KaTeX）を、画像にするときの、フォント。範囲の画像は、HTML を SVG の `foreignObject` に入れて、画像として読み込み、canvas に描く（region.ts）。
// **画像として読み込まれる SVG の中では、外のファイル（`@font-face` の URL）を読めない**：数式の文字が、代わりのフォントになってしまう。
// そこで、使う面（family・weight・style）の woff2 を、同じオリジンから読み、`data:` として、`@font-face` に入れる（外へ通信しない。N1）。使っている面だけ（全部は、入れない）。
// フォントの面は、画面に読み込んだ KaTeX の CSS（`@font-face` の規則）から探す（フォントの一覧を、二重に持たない）。

const dataUrls = new Map<string, Promise<string>>();

/** 同じオリジンの woff2 を読んで、`data:` にする（同じ URL は、1 度だけ読む） */
function fontDataUrl(url: string): Promise<string> {
  let p = dataUrls.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(`フォントを読めません（${r.status}）`))))
      .then((blob) => {
        const { promise, resolve, reject } = Promise.withResolvers<string>();
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result));
        fr.onerror = () => reject(new Error('フォントを読めません'));
        fr.readAsDataURL(blob);
        return promise;
      });
    p.catch(() => dataUrls.delete(url)); // 失敗は、覚えない（次に、もう一度試す）
    dataUrls.set(url, p);
  }
  return p;
}

const unquote = (s: string): string => s.trim().replace(/^["']|["']$/g, '');
const weightOf = (w: string): string => (w === 'normal' || w === '' ? '400' : w === 'bold' ? '700' : w);

/** 画面に読み込んだ、KaTeX の `@font-face` の規則（面 → woff2 の URL）。KaTeX の CSS が、まだ読まれていなければ、空 */
function katexFaces(): Map<string, { family: string; weight: string; style: string; url: string }> {
  const faces = new Map<string, { family: string; weight: string; style: string; url: string }>();
  for (const sheet of document.styleSheets) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // 読めない CSS（外のもの）は、飛ばす
    }
    for (const rule of rules) {
      if (!(rule instanceof CSSFontFaceRule)) continue;
      const family = unquote(rule.style.getPropertyValue('font-family'));
      if (!family.startsWith('KaTeX_')) continue;
      const url = /url\(\s*["']?([^"')]+\.woff2)["']?\s*\)/.exec(rule.style.getPropertyValue('src'))?.[1];
      if (!url) continue;
      const weight = weightOf(rule.style.getPropertyValue('font-weight').trim());
      const style = rule.style.getPropertyValue('font-style').trim() || 'normal';
      faces.set(`${family}|${weight}|${style}`, { family, weight, style, url });
    }
  }
  return faces;
}

/**
 * `sources`（画像にする要素。子孫を含む）が使っている、KaTeX のフォントの面だけを、`data:` で持つ `@font-face` の CSS。KaTeX の文字が、なければ、空。
 * フォントを読めない面は、入れない（その文字は、代わりのフォントで描く：画像を、失敗させない）
 */
export async function katexFontCss(sources: readonly Element[]): Promise<string> {
  const used = new Set<string>();
  for (const root of sources) {
    for (const el of [root, ...root.querySelectorAll('*')]) {
      const cs = getComputedStyle(el);
      for (const f of cs.fontFamily.split(',')) {
        const family = unquote(f);
        if (family.startsWith('KaTeX_')) used.add(`${family}|${weightOf(cs.fontWeight)}|${cs.fontStyle || 'normal'}`);
      }
    }
  }
  if (!used.size) return '';
  const faces = katexFaces();
  const css = await Promise.all(
    [...used].map(async (key) => {
      const face = faces.get(key);
      if (!face) return '';
      try {
        const data = await fontDataUrl(face.url);
        return `@font-face{font-family:${face.family};font-weight:${face.weight};font-style:${face.style};src:url(${data}) format("woff2")}`;
      } catch {
        return '';
      }
    }),
  );
  return css.join('');
}
