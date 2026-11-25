// @vitest-environment jsdom
// Markdown → 無害化。資料は AI が書いた非信頼のデータ（N1〜N3・F28）：スクリプト・イベント属性・危険なリンク・外部画像・フォーム・style を、本文に入れない。
import { expect, test } from 'vitest';
import {
  blockAnchor,
  blockEls,
  blockText,
  markBlocks,
  mediaOf,
  plainText,
  textIndex,
} from '../../../src/web/doc/render/blocks';
import { appHeight, mdToFragment } from '../../../src/web/doc/render/markdown';
import { hash } from '../../../src/web/lib/dom';

/** 断片を、HTML の文字列にする */
function html(md: string, withApps = true): string {
  const div = document.createElement('div');
  div.append(mdToFragment(md, { slug: 'demo', kind: withApps ? 'doc' : 'reply' }));
  return div.innerHTML;
}
function dom(md: string, withApps = true): HTMLElement {
  const div = document.createElement('div');
  div.append(mdToFragment(md, { slug: 'demo', kind: withApps ? 'doc' : 'reply' }));
  return div;
}

test('無害化：script・イベント属性・iframe・フォーム・style 属性・srcset は、残らない', () => {
  const out = dom(
    [
      '<script>window.pwned=1</script>',
      '<img src="assets/a.png" onerror="window.pwned=2" srcset="x 2x" style="position:fixed">',
      '<iframe src="https://evil.example/"></iframe>',
      '<form action="https://evil.example/"><input name="p"><button formaction="https://evil.example/">x</button><textarea></textarea><select></select></form>',
      '<object data="x"></object><embed src="x"><link rel="stylesheet" href="x"><meta http-equiv="refresh" content="0"><base href="https://evil.example/">',
      '<style>body{display:none}</style>',
      '<dialog open>d</dialog>',
      '<p onclick="window.pwned=3" style="color:red" ping="https://evil.example/">本文</p>',
      '<a href="https://example.com/" ping="https://evil.example/" onclick="window.pwned=4">link</a>',
    ].join('\n\n'),
  );
  expect(
    out.querySelector(
      'script, iframe, form, input, button, textarea, select, object, embed, link, meta, base, style, dialog',
    ),
  ).toBeNull();
  for (const el of out.querySelectorAll('*')) {
    for (const a of el.getAttributeNames())
      expect(a, `${el.tagName}[${a}]`).not.toMatch(/^on|^style$|^srcset$|^ping$|^formaction$/);
  }
  expect((window as unknown as { pwned?: number }).pwned).toBeUndefined();
  expect(out.textContent).toContain('本文');
});

test('リンク：page: は、ページへのリンク。http(s)・mailto は、別のタブで開く。それ以外（javascript: など）は、リンクにしない', () => {
  const out = dom(
    [
      '[内部](page:chapter-2)',
      '[外](https://example.com/a)',
      '[メール](mailto:a@example.com)',
      '[js](javascript:window.pwned=1)',
      '[JS](JaVaScRiPt:alert(1))',
      '[data](data:text/html,<script>alert(1)</script>)',
      '[file](file:///etc/passwd)',
      '[ftp](ftp://example.com/)',
      '[相対](other.md)',
      '<a href="vbscript:msgbox(1)">v</a>',
    ].join('\n\n'),
  );
  const a = [...out.querySelectorAll('a')];
  const by = (t: string) => a.find((x) => x.textContent === t) as HTMLAnchorElement;
  expect(by('内部').getAttribute('href')).toBe('#/demo/chapter-2');
  expect(by('内部').dataset.page).toBe('chapter-2');
  expect(by('内部').classList.contains('pagelink')).toBe(true);
  expect(by('外').target).toBe('_blank');
  expect(by('外').rel).toBe('noopener noreferrer');
  expect(by('メール').target).toBe('_blank');
  for (const t of ['js', 'JS', 'data', 'file', 'ftp', 'v'])
    expect(by(t)?.hasAttribute('href') ?? false, `${t}: href がない`).toBe(false);
  expect(by('相対').hasAttribute('href')).toBe(false);
});

test('画像：assets/ のものだけ、サーバーの /asset/ から。外部（http・//・ほかのスキーム）は、ブロックの表示。data:image は、そのまま', () => {
  const out = dom(
    [
      '![図](assets/dir/figure-1.png)',
      '![相対](./shot.png)',
      '![外](https://evil.example/x.png)',
      '![プロトコル相対](//evil.example/x.png)',
      '![js](javascript:alert(1))',
      '![data](data:image/png;base64,AAAA)',
    ].join('\n\n'),
  );
  const imgs = [...out.querySelectorAll('img')];
  expect(imgs.map((i) => i.getAttribute('src'))).toEqual([
    '/asset/demo/dir/figure-1.png',
    '/asset/demo/shot.png',
    '/asset/demo/', // javascript: は、無害化が src を外す（外部の読み込みにならない）
    'data:image/png;base64,AAAA',
  ]);
  expect(imgs[0]?.loading).toBe('lazy');
  const blocked = [...out.querySelectorAll('.img-blocked')].map((s) => s.textContent);
  expect(blocked).toEqual(['[外部画像は表示しません: 外]', '[外部画像は表示しません: プロトコル相対]']);
  expect(html('<img src="https://evil.example/x.png">')).not.toContain('evil.example/x.png"');
});

test('Mermaid：ソースは、URI エンコードして、data-mermaid に持つ（`-->` や `</style` を含んでも、属性が落ちない）', () => {
  const src = 'graph TD\n  A --> B\n  B --> C["</style><script>x</script>"]';
  const el = dom(`\`\`\`mermaid\n${src}\n\`\`\``).querySelector<HTMLElement>('.mermaid-block');
  expect(el).not.toBeNull();
  expect(decodeURIComponent(el?.dataset.mermaid ?? '')).toBe(src);
  expect(el?.querySelector('script')).toBeNull();
});

test('html-app の情報文字列：height=N（120〜1200 に収める）は固定。height なし・height=auto・読めない値は、自動', () => {
  expect(appHeight('html-app height=480')).toBe(480);
  expect(appHeight('html-app height=480px')).toBe(480);
  expect(appHeight('html-app height=50')).toBe(120);
  expect(appHeight('html-app height=2000')).toBe(1200);
  for (const info of [
    'html-app',
    'html-app height=auto',
    'html-app height=',
    'html-app height=abc',
    'html-app height=9',
    'html-app xheight=480',
  ])
    expect(appHeight(info), info).toBe('auto');
  const auto = dom(
    '```html-app\n<b>1</b>\n```\n\n```html-app height=auto\n<b>2</b>\n```\n\n```html-app height=300\n<b>3</b>\n```',
  );
  expect([...auto.querySelectorAll<HTMLElement>('.htmlapp')].map((b) => b.dataset.h)).toEqual(['auto', 'auto', '300']);
});

test('html-app：置き場は、フェンスの番号と高さ（120〜1200 に収める）だけから作る。ソースは、無害化のあとに、表から付ける（資料の偽の data-src は、使わない）', () => {
  const md = [
    '```html-app height=2000',
    '<div id="real">本物</div>',
    '```',
    '',
    '<div class="htmlapp" data-n="0" data-src="FAKE0" data-h="9999"><div class="cap">偽の枠</div></div>',
    '',
    '<div class="htmlapp" data-n="7" data-src="FAKE7"></div>',
    '',
    '<div class="htmlapp" data-src="FAKE-NO-N"></div>',
    '',
    '```html-app height=50',
    'second',
    '```',
  ].join('\n');
  const boxes = [...dom(md).querySelectorAll<HTMLElement>('.htmlapp')];
  // 本物の置き場は、見出し（`.cap`）が空：安全の注意は、見える文字にしない（利用者の決定：2026-11-25。`title`・`aria-label` は、apps.ts）。資料の生の HTML の偽の置き場は、見出しを持たない・文字がある
  const real = boxes.filter((b) => b.querySelector(':scope > .cap')?.textContent === '');
  expect(real).toHaveLength(2);
  expect(dom(md).textContent).not.toContain('隔離されています');
  expect(real.map((b) => [b.dataset.n, b.dataset.h])).toEqual([
    ['0', '1200'],
    ['1', '120'],
  ]);
  expect(decodeURIComponent(real[0]?.dataset.src ?? '')).toBe('<div id="real">本物</div>');
  expect(decodeURIComponent(real[1]?.dataset.src ?? '')).toBe('second');
  // 偽物：番号が表にあれば、表のソースに上書きされる（偽のソースは、残らない）。表にない番号・番号なしは、data-src を消す
  expect(html(md)).not.toContain('FAKE');
  expect(boxes.filter((b) => !real.includes(b)).some((b) => b.dataset.n === '7' && b.hasAttribute('data-src'))).toBe(
    false,
  );
  expect(boxes.some((b) => !b.dataset.n && b.hasAttribute('data-src'))).toBe(false);
});

// 見出しの文字（旧は「実行できる枠 N（隔離されています。…）」）を消しても、既存のコメントの錨・差分は、変わらない：枠のブロックの文字・ハッシュ・位置づけは、**ソース**から（見出しの文字は、使わない）
test('html-app の見出しの文字を消しても、ブロックの文字・ハッシュ・名前・差分の文字は、変わらない（旧い版が保存したコメントの錨が、そのまま合う）', () => {
  const src = '<button id="x">押す</button>';
  const md = `前の段落。\n\n\`\`\`html-app height=200\n${src}\n\`\`\`\n\n後の段落。\n`;
  const render = (capText: string | null) => {
    const root = dom(md);
    const cap = root.querySelector('.htmlapp .cap');
    if (cap && capText !== null) cap.textContent = capText; // 旧い版の見出しを、再現する
    markBlocks(root);
    return root;
  };
  const now = render(null);
  const legacy = render('実行できる枠 1（隔離されています。パスワードなどの秘密は、入力しないでください）');
  const [a, b] = [now, legacy].map((r) => r.querySelector('.htmlapp') as HTMLElement);
  if (!a || !b) throw new Error('枠の置き場がない');
  expect(a.querySelector('.cap')?.textContent).toBe('');
  // 旧い版が保存した blockHash は、ソースから（`hash('html-app ' + ソース)`）：いまも同じ
  expect(a.dataset.bhash).toBe(hash(`html-app ${src}`));
  expect(a.dataset.bhash).toBe(b.dataset.bhash);
  expect(a.dataset.bid).toBe(b.dataset.bid);
  expect(blockText(a)).toBe(`html-app ${src}`);
  expect(blockText(a)).toBe(blockText(b));
  expect(plainText(a)).toBe(plainText(b));
  expect(blockAnchor(a)).toEqual(blockAnchor(b)); // 錨（blockId・blockHash・blockText・label）
  expect(blockAnchor(a).label).toBe('実行できる枠');
  // 位置づけの文字（引用）には、枠の中の文字は、入らない：本文の段落は、前後で変わらない
  expect(textIndex(now).text).toBe(textIndex(legacy).text);
});

test('html-app：資料の本文以外（返信・前の版の差分）では、枠にしない（ふつうのコードブロック）', () => {
  const out = dom('```html-app\n<b>x</b>\n```', false);
  expect(out.querySelector('.htmlapp')).toBeNull();
  expect(out.querySelector('pre code')?.textContent).toBe('<b>x</b>\n');
});

test('形式：diff・json・terminal・trace は、決まった形の HTML に。読めないものは、ふつうのコードブロック。敵意のある文字は、タグにならない', () => {
  const evil = '<img src=x onerror=window.pwned=1>';
  const out = dom(
    [
      `\`\`\`diff\n+${evil}\n-${evil}\n\`\`\``,
      `\`\`\`json\n${JSON.stringify({ [evil]: evil })}\n\`\`\``,
      `\`\`\`terminal\n\u001b[31m${evil}\u001b[0m\n\`\`\``,
      `\`\`\`trace\n${evil} | 0 | 10 | ${evil}\n\`\`\``,
      '```json\n{ broken\n```',
    ].join('\n\n'),
  );
  expect([...out.querySelectorAll<HTMLElement>('.fmt')].map((e) => e.dataset.fmt)).toEqual([
    'diff',
    'json',
    'terminal',
    'trace',
  ]);
  expect(out.querySelector('img')).toBeNull();
  expect(out.textContent).toContain(evil);
  expect(out.querySelector('pre code')?.textContent).toBe('{ broken\n');
});

test('trace：棒の位置・長さは、無害化のあとに、data-s・data-w（数）から、設定する。数でないものは、設定しない・範囲に収める。資料の style 属性は、使わない', () => {
  const out = dom(
    [
      '```trace\na | 0 | 50\nb | 50 | 50\n```',
      '<div class="fmt fmt-trace"><span class="tb" data-s="abc" data-w="5" style="left:99%"></span><span class="tb" data-s="-20" data-w="0" style="position:fixed"></span><span class="tb" data-s="120" data-w="500"></span></div>',
    ].join('\n\n'),
  );
  const bars = [...out.querySelectorAll<HTMLElement>('.fmt-trace .tb')];
  expect(bars.map((b) => [b.style.left, b.style.width])).toEqual([
    ['0%', '50%'],
    ['50%', '50%'],
    ['', ''],
    ['0%', '0.4%'],
    ['100%', '100%'],
  ]);
  expect(bars.some((b) => b.style.position === 'fixed')).toBe(false);
});

test('ブロックの番号・ハッシュ：data-bid・data-bhash（data-hash ではない）・blk。ハッシュは、blockText の旧と同じ djb2', () => {
  const frag = mdToFragment(
    '# 題\n\n本文 **強調** です。\n\n- 一\n- 二\n\n```mermaid\ngraph TD\nA-->B\n```\n\n```html-app\nx\n```\n',
    { slug: 'demo', kind: 'doc' },
  );
  markBlocks(frag);
  const ids = [...frag.querySelectorAll<HTMLElement>('[data-bid]')];
  expect(ids.map((e) => [e.dataset.bid, e.tagName])).toEqual([
    ['b0', 'H1'],
    ['b1', 'P'],
    ['b2', 'LI'],
    ['b3', 'LI'],
    ['b4', 'DIV'],
    ['b5', 'DIV'],
  ]);
  expect(ids[1]?.dataset.bhash).toBe(hash('本文 強調 です。'));
  expect(ids.every((e) => e.classList.contains('blk') && !e.hasAttribute('data-hash'))).toBe(true);
  // 図は、ソース（URI エンコードのまま）・実行できる枠は、ソース（デコードして、「html-app 」を付ける）から
  expect(ids[4]?.dataset.bhash).toBe(hash(ids[4]?.dataset.mermaid ?? ''));
  expect(blockText(ids[5] as HTMLElement)).toBe('html-app x');
  expect(ids[5]?.dataset.bhash).toBe(hash('html-app x'));
  // ul・ol の中の li が、ブロック（ul 自体は、ブロックにしない）
  expect(frag.querySelector('ul')?.hasAttribute('data-bid')).toBe(false);
});

test('返信（kind: reply）：形式・リンク・画像・Mermaid の置き場は、本文と同じ。html-app は、ふつうのコードブロック。ブロックの番号は、付かない（markBlocks は、本文だけ）', () => {
  const md = [
    '```diff\n+a\n```',
    '```json\n{"a":1}\n```',
    '```mermaid\ngraph TD\nA-->B\n```',
    '```html-app\n<b>x</b>\n```',
    '[内部](page:detail) [外](https://example.com/) [js](javascript:alert(1))',
    '![図](assets/a.png) ![外](https://evil.example/x.png)',
    '<script>window.pwned=1</script><img src=x onerror=window.pwned=2>',
  ].join('\n\n');
  const reply = document.createElement('div');
  reply.append(mdToFragment(md, { slug: 'demo', kind: 'reply' }));
  expect([...reply.querySelectorAll<HTMLElement>('.fmt')].map((e) => e.dataset.fmt)).toEqual(['diff', 'json']);
  expect(reply.querySelectorAll('.mermaid-block')).toHaveLength(1);
  expect(reply.querySelector('.htmlapp')).toBeNull();
  expect(reply.querySelector('pre code')?.textContent).toBe('<b>x</b>\n');
  expect(reply.querySelector<HTMLAnchorElement>('a.pagelink')?.getAttribute('href')).toBe('#/demo/detail');
  expect(reply.querySelector('a[target=_blank]')?.getAttribute('rel')).toBe('noopener noreferrer');
  expect(reply.querySelector('img[src="/asset/demo/a.png"]')).not.toBeNull();
  expect(reply.querySelector('.img-blocked')?.textContent).toBe('[外部画像は表示しません: 外]');
  expect(reply.querySelector('script, [onerror]')).toBeNull();
  expect(reply.querySelector('[data-bid], .blk')).toBeNull();
  // 本文（doc）では、html-app は、枠になる
  const doc = document.createElement('div');
  doc.append(mdToFragment(md, { slug: 'demo', kind: 'doc' }));
  expect(doc.querySelector('.htmlapp')).not.toBeNull();
});

test('本文の直下のインライン <svg> も、ブロック（data-bid・blk）。後ろのブロックの番号が、ずれない', () => {
  const frag = mdToFragment(
    '前の段落。\n\n<svg width="200" height="80" viewBox="0 0 200 80">\n<rect width="200" height="80" fill="#eee"/>\n<text x="10" y="40">図</text>\n</svg>\n\n後ろの段落。\n',
    { slug: 'demo', kind: 'doc' },
  );
  markBlocks(frag);
  const els = blockEls(frag);
  expect(els.map((e) => [e.tagName.toLowerCase(), e.dataset.bid])).toEqual([
    ['p', 'b0'],
    ['svg', 'b1'],
    ['p', 'b2'],
  ]);
  const svg = els[1] as SVGElement;
  expect(svg.classList.contains('blk')).toBe(true);
  expect(svg.dataset.bhash).toBe(hash('図'));
  expect(blockAnchor(svg)).toMatchObject({ blockId: 'b1', blockTag: 'svg', blockText: '図' });
  expect(mediaOf(svg)).toBe(svg);
});
