// @vitest-environment jsdom
// AI の返信（Markdown）の、無害化（N3・旧 PURIFY と同じ）・リンク・画像の変換
import { expect, test } from 'vitest';
import { mdToFragment } from '../../../src/web/doc/render';

function render(md: string, slug = 'demo'): HTMLElement {
  const div = document.createElement('div');
  div.append(mdToFragment(md, { slug, kind: 'reply' }));
  return div;
}

test('Markdown：見出し・表・箇条書き・コードが、HTML になる', () => {
  const el = render('## 見出し\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n- 項目\n\n```ts\nconst x = 1;\n```');
  expect(el.querySelector('h2')?.textContent).toBe('見出し');
  expect(el.querySelectorAll('table td')).toHaveLength(2);
  expect(el.querySelector('li')?.textContent).toBe('項目');
  expect(el.querySelector('pre code')?.textContent).toContain('const x = 1;');
});

test('スクリプト・iframe・フォーム・style・イベント属性・javascript: は、残らない（N3）', () => {
  const el = render(
    [
      '<script>window.pwned = 1</script>',
      '<iframe src="https://example.com"></iframe>',
      '<form action="/x"><input name="a"><button>送る</button></form>',
      '<style>body{display:none}</style>',
      '<p style="color:red" onclick="alert(1)">p</p>',
      '<img src="x" onerror="alert(1)">',
      '[悪い](javascript:alert(1))',
      '<a href="data:text/html,<script>alert(1)</script>">d</a>',
      '<svg><script>alert(1)</script><a xlink:href="javascript:alert(1)"><text>s</text></a></svg>',
    ].join('\n\n'),
  );
  for (const tag of ['script', 'iframe', 'form', 'input', 'button', 'style']) expect(el.querySelector(tag)).toBeNull();
  const html = el.innerHTML;
  expect(html).not.toMatch(/onerror|onclick|javascript:|style=/i);
  expect(el.querySelector('p')?.getAttribute('style')).toBeNull();
  for (const a of el.querySelectorAll('a')) expect(a.getAttribute('href') ?? '').not.toMatch(/^(javascript|data):/i);
  expect((window as unknown as { pwned?: number }).pwned).toBeUndefined();
});

test('リンク：http(s)・mailto は、新しい窓（noopener noreferrer）・page: は、ページへの移動・それ以外は、href を外す', () => {
  const el = render(
    '[外](https://example.com/a) [メール](mailto:a@example.com) [子](page:sub) [相対](other.html)',
    'my-topic',
  );
  const [ext, mail, page, rel] = [...el.querySelectorAll('a')];
  expect(ext?.getAttribute('target')).toBe('_blank');
  expect(ext?.getAttribute('rel')).toBe('noopener noreferrer');
  expect(mail?.getAttribute('target')).toBe('_blank');
  expect(page?.getAttribute('href')).toBe('#/my-topic/sub');
  expect(page?.classList.contains('pagelink')).toBe(true);
  expect(page?.getAttribute('data-page')).toBe('sub');
  expect(page?.getAttribute('target')).toBeNull();
  expect(rel?.hasAttribute('href')).toBe(false);
});

test('画像：assets/ のものは、/asset/<topic>/ から・外部の画像は、表示しない・data:image は、そのまま', () => {
  const el = render(
    '![図](assets/sub/a.png) ![相対](./c.png) ![外](https://example.com/x.png) ![外2](//example.com/y.png) ![埋め込み](data:image/png;base64,AAAA)',
    'my topic',
  );
  const imgs = [...el.querySelectorAll('img')];
  expect(imgs.map((i) => i.getAttribute('src'))).toEqual([
    '/asset/my%20topic/sub/a.png',
    '/asset/my%20topic/c.png',
    'data:image/png;base64,AAAA',
  ]);
  expect((imgs[0] as HTMLImageElement).loading).toBe('lazy');
  const blocked = [...el.querySelectorAll('.img-blocked')].map((s) => s.textContent);
  expect(blocked).toEqual(['[外部画像は表示しません: 外]', '[外部画像は表示しません: 外2]']);
});

test('Mermaid：図の置き場にする（ソースは、URI エンコードして属性に持つ）。html-app は、返信では、枠にしない（ふつうのコード）', () => {
  const src = 'graph TD\n  A-->B';
  const el = render(`\`\`\`mermaid\n${src}\n\`\`\`\n\n\`\`\`html-app\n<p>x</p>\n\`\`\``);
  const block = el.querySelector<HTMLElement>('.mermaid-block');
  expect(block).not.toBeNull();
  expect(decodeURIComponent(block?.dataset.mermaid ?? '')).toBe(src);
  expect(el.querySelector('.htmlapp')).toBeNull();
  expect(el.querySelectorAll('pre code')).toHaveLength(1);
  expect(el.querySelector('pre code')?.textContent).toContain('<p>x</p>');
});

test('形式：diff・json・terminal・trace が、返信でも描かれる（本文と同じ）。敵意のある中身は、escape される', () => {
  const el = render(
    [
      '```diff\n--- a\n+++ b\n@@ -1 +1 @@\n-古い\n+新しい <img src=x onerror=alert(1)>\n```',
      '```json\n{"a": [1, 2], "b": "x"}\n```',
      '```terminal\n\u001b[31m赤\u001b[0m 普通\n```',
      '```trace\n準備 | 0 | 100\n実行 | 100 | 300 | メモ\n```',
    ].join('\n\n'),
  );
  expect([...el.querySelectorAll('.fmt')].map((f) => f.getAttribute('data-fmt'))).toEqual([
    'diff',
    'json',
    'terminal',
    'trace',
  ]);
  expect(el.querySelector('.fmt-diff')?.textContent).toContain('新しい <img src=x onerror=alert(1)>');
  expect(el.querySelector('.fmt-diff img')).toBeNull();
  expect(el.querySelector('.fmt-json')?.textContent).toContain('"b"');
  expect(el.querySelector('.fmt-term')?.textContent).toContain('赤');
  expect(el.querySelectorAll('.fmt-trace .tr').length).toBeGreaterThan(1);
  expect(el.querySelector('pre code')).toBeNull(); // ふつうのコードブロックには、ならない
});

test('空・未定義は、空の断片', () => {
  expect(render('').childNodes).toHaveLength(0);
  expect(mdToFragment(undefined, { slug: 'demo', kind: 'reply' }).childNodes).toHaveLength(0);
});
