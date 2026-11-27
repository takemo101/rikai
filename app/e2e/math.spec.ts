// 数式（KaTeX。F57）：GitHub と同じ 3 種類（文中 `$…$`・`$`…`$`・別行 `$$…$$`／```math）。別行の数式は、図と同じブロック（拡大表示・範囲コメント・差分・並べて比べる）。
// 実際の Chrome・本物のマウス・キー。資料・コメントは、作り物。外への通信 0（フォントも 127.0.0.1：N1）・悪意のある TeX でスクリプトが動かず・止まらない（N3）。
import type { Locator, Page } from '@playwright/test';
import { expect, type RikaiApp, test } from './fixtures';
import { decodePng } from './samples';
import { box, dragBox, fillAndAdd, settled, submitAll, ui } from './ui';

const BT = '```';
const QUAD = 'x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}';
const TITLE = '数式の確認';

const DOC = (quad = QUAD, tail = '') =>
  `# ${TITLE}

二次方程式の解の公式です。

$$${quad}$$

文中の数式 $E = mc^2$ と $\`a_1 + a_2\`$ があります。通貨の $5 と $10 は、そのままです。

${BT}math
\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}
${BT}

$$
\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}
$$

| 式 | 意味 |
|---|---|
| $x^2$ | 二乗 |

コードの中の \`$x$\` は、そのままです。
${tail}`;

async function open(page: Page, app: RikaiApp, md = DOC(), slug = 'mt') {
  await page.setViewportSize({ width: 1360, height: 900 });
  await app.switchTopic(page, slug, TITLE, md);
  await expect(page.locator('#article .math-done')).not.toHaveCount(0);
}

const blocks = (page: Page) => page.locator('#article .math-block');
const lbx = (page: Page) => page.locator('#lightbox');
const stage = (page: Page) => page.locator('#lightbox .lb-stage.math');
const dockComposer = (page: Page) => page.locator('#lightbox .fv-dock .thread.composer');
const regionTool = (page: Page) => page.locator('#lightbox .fv-tools [data-tool="region"]');

/** 本文の、文字（needle）の、画面の座標（左端・右端。テキストノードの中） */
async function textRange(page: Page, from: string, to: string) {
  return page.evaluate(
    ([a, b]) => {
      const root = document.querySelector('#article') as HTMLElement;
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let start: DOMRect | null = null;
      let end: DOMRect | null = null;
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        const v = n.nodeValue ?? '';
        const i = v.indexOf(a as string);
        if (!start && i >= 0 && !(n.parentElement as HTMLElement).closest('.math-out')) {
          const r = document.createRange();
          r.setStart(n, i);
          r.setEnd(n, i + 1);
          start = r.getBoundingClientRect();
        }
        const j = v.indexOf(b as string);
        if (start && j >= 0 && !(n.parentElement as HTMLElement).closest('.math-out')) {
          const r = document.createRange();
          r.setStart(n, j + (b as string).length - 1);
          r.setEnd(n, j + (b as string).length);
          end = r.getBoundingClientRect();
          break;
        }
      }
      return start && end
        ? { x1: start.left, y1: start.top + start.height / 2, x2: end.right, y2: end.top + end.height / 2 }
        : null;
    },
    [from, to],
  );
}

/** 本物のマウスで、from の最初の文字〜to の最後の文字を、ドラッグして選ぶ（間に、数式を含んでもよい） */
async function dragThrough(page: Page, from: string, to: string) {
  await page.locator('#article').evaluate((e) => e.scrollIntoView({ block: 'start' }));
  const r = await textRange(page, from, to);
  if (!r) throw new Error('本文に、その文字がありません');
  await page.mouse.move(r.x1 + 1, r.y1);
  await page.mouse.down();
  await page.mouse.move((r.x1 + r.x2) / 2, r.y2, { steps: 6 });
  await page.mouse.move(r.x2 - 1, r.y2, { steps: 6 });
  await page.mouse.up();
}

/** 範囲の画像（添付）：暗い画素（文字）の割合・明るい画素の割合 */
async function inkShare(img: Locator) {
  return img.evaluate((i: HTMLImageElement) => {
    const c = document.createElement('canvas');
    c.width = i.naturalWidth;
    c.height = i.naturalHeight;
    const g = c.getContext('2d') as CanvasRenderingContext2D;
    g.drawImage(i, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let dark = 0;
    for (let p = 0; p < d.length; p += 4) if ((d[p] ?? 255) < 110 && (d[p + 1] ?? 255) < 110) dark++;
    return { w: c.width, h: c.height, dark: dark / (c.width * c.height) };
  });
}

test.describe('数式：記法と描画', () => {
  test('3 種類の記法が描かれる：別行 $$…$$・```math・複数行・文中 $…$・$`…`$・表の中。通貨・コードの中の $ は、そのまま', async ({
    page,
    app,
  }) => {
    await open(page, app);
    await expect(blocks(page)).toHaveCount(3);
    await expect(page.locator('#article .math-block .katex-display .katex')).toHaveCount(3);
    await expect(page.locator('#article .math-inline .katex')).toHaveCount(3); // $E = mc^2$・$`a_1 + a_2`$・表の $x^2$
    // 見えているのは、描いた式（元の文字は、見えない）
    const first = blocks(page).first().locator('.katex-html');
    await expect(first).toBeVisible();
    const b = await box(blocks(page).first().locator('.katex'));
    expect(b.width).toBeGreaterThan(100);
    expect(b.height).toBeGreaterThan(30);
    const src = await page.locator('#article .math-inline.math-done > .math-src').first().boundingBox();
    expect(src?.width ?? 0).toBeLessThanOrEqual(1); // 元の文字は、幅がない（見えない）
    // 根号の線・分数の線は、描かれている（フォントだけでなく、組版）
    await expect(blocks(page).first().locator('svg path')).toHaveCount(1);
    await expect(blocks(page).first().locator('.frac-line')).toHaveCount(1);
    // 通貨・コードの中
    await expect(page.locator('#article p', { hasText: '通貨の' })).toContainText(
      '通貨の $5 と $10 は、そのままです。',
    );
    await expect(page.locator('#article code', { hasText: '$x$' })).toBeVisible();
    // フォントが読み込まれている（KaTeX_Main・KaTeX_Math）
    const faces = await page.evaluate(() =>
      [...document.fonts].filter((f) => f.status === 'loaded' && f.family.startsWith('KaTeX')).map((f) => f.family),
    );
    expect(faces).toContain('KaTeX_Main');
    expect(faces).toContain('KaTeX_Math');
    // 読み上げ用の MathML が、ある（HTML の側は、aria-hidden）
    await expect(blocks(page).first().locator('.katex-mathml math')).toHaveCount(1);
    await expect(blocks(page).first().locator('.katex-html')).toHaveAttribute('aria-hidden', 'true');
  });

  test('外への通信 0：CSS・フォントも 127.0.0.1（相対パス）から。数式のない資料では、KaTeX の chunk・CSS・フォントを、読まない（遅延読み込み）', async ({
    page,
    app,
  }) => {
    await open(page, app);
    const violations: string[] = [];
    page.on('console', (m) => {
      if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text().slice(0, 160));
    });
    const reqs: string[] = [];
    page.on('request', (r) => {
      if (!/^(data|blob|about):/i.test(r.url())) reqs.push(r.url());
    });
    await page.reload();
    await expect(page.locator('#article .math-done')).not.toHaveCount(0);
    await expect.poll(() => reqs.filter((u) => /KaTeX_.*\.woff2$/.test(u)).length).toBeGreaterThan(0);
    const origin = new URL(page.url()).origin;
    for (const u of reqs) expect(u.startsWith(`${origin}/`), u).toBe(true);
    expect(reqs.some((u) => /\/assets\/katex\.css$/.test(u))).toBe(true);
    expect(reqs.some((u) => /\/assets\/katex\.js$/.test(u))).toBe(true);
    // woff2 だけ（woff・ttf は、同梱しない）
    expect(reqs.filter((u) => /KaTeX_/.test(u)).every((u) => u.endsWith('.woff2'))).toBe(true);
    // CSS の @font-face は、相対パス（/assets/…）。外のオリジンを指さない
    const css = await (await page.request.get(`${origin}/assets/katex.css`)).text();
    expect(css).not.toMatch(/https?:\/\//);
    expect(css).not.toMatch(/\.(ttf|woff)\b/);
    expect(violations).toEqual([]); // CSP（font-src は、default-src 'self'）に、フォント・CSS が、拒まれない
    // 数式のない資料
    await app.switchTopic(page, 'plain', '数式なし', '# 数式なし\n\nりんごは $5 と $10 です。コード `$x$`。\n');
    reqs.length = 0;
    await page.reload();
    await expect(page.locator('#article .blk').first()).toBeVisible();
    await page.waitForTimeout(800);
    expect(reqs.filter((u) => /katex|KaTeX/i.test(u))).toEqual([]);
    await expect(page.locator('#article .math-out')).toHaveCount(0);
  });

  test('ダークモード：数式の文字は、画面の文字色（純粋な黒ではない）。描かれた画素が、明るい', async ({
    page,
    app,
  }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await open(page, app);
    const colors = await page.evaluate(() => {
      const art = document.querySelector('#article') as HTMLElement;
      const mord = document.querySelector('#article .math-block .katex-html .mord') as HTMLElement;
      return { art: getComputedStyle(art).color, math: getComputedStyle(mord).color };
    });
    expect(colors.math).toBe(colors.art);
    expect(colors.math).not.toBe('rgb(0, 0, 0)');
    const png = decodePng(await blocks(page).first().screenshot());
    let bright = 0;
    for (let y = 0; y < png.h; y++) for (let x = 0; x < png.w; x++) if ((png.at(x, y)[0] ?? 0) > 180) bright++;
    expect(bright).toBeGreaterThan(80); // 暗い地に、明るい文字
    expect(png.at(1, 1)[0]).toBeLessThan(60);
  });

  test('コピー：数式を含む文を選ぶと、数式は、元の TeX（記号つき）が入り、描いた HTML・MathML の文字は入らない', async ({
    page,
    app,
  }) => {
    await open(page, app);
    await dragThrough(page, '文中の数式', 'があります。');
    const text = await page.evaluate(() => getSelection()?.toString() ?? '');
    expect(text).toContain('文中の数式');
    expect(text).toContain('$E = mc^2$');
    expect(text).toContain('$`a_1 + a_2`$');
    expect(text).not.toContain('E=mc');
  });

  test('悪意のある TeX：\\href（javascript:）・\\url・\\htmlClass・\\includegraphics・文字列の HTML・イベントハンドラは、動かず・リンクにならず・外へ出ない', async ({
    page,
    app,
  }) => {
    const dialogs: string[] = [];
    page.on('dialog', (d) => {
      dialogs.push(d.message());
      void d.dismiss();
    });
    const evil = [
      '$$\\href{javascript:window.pwned=1}{click}$$',
      '$$\\url{javascript:window.pwned=1}$$',
      '$$\\htmlClass{x}{y}$$',
      '$$\\includegraphics{http://example.com/x.png}$$',
      '$$\\text{<img src=x onerror=window.pwned=1><script>window.pwned=1</script>}$$',
      '$$x^{<svg onload=window.pwned=1>}$$',
      '$`\\text{<img src=x onerror=window.pwned=1>}`$ と $\\href{javascript:window.pwned=1}{x}$',
      '$$\\htmlStyle{background:url(http://example.com/a.png)}{z}$$',
    ].join('\n\n');
    await open(page, app, `# 悪意\n\n${evil}\n\n終わり。\n`, 'evil');
    await expect(page.locator('#article .math-done, #article .math-error')).toHaveCount(9);
    await page.waitForTimeout(500);
    expect(dialogs).toEqual([]);
    expect(await page.evaluate(() => Reflect.get(window, 'pwned'))).toBeUndefined();
    const found = await page.evaluate(() => ({
      links: document.querySelectorAll(
        '#article a[href], #article [href], #article [src], #article iframe, #article script',
      ).length,
      handlers: [...document.querySelectorAll('#article *')].filter((e) =>
        e.getAttributeNames().some((n) => /^on/i.test(n)),
      ).length,
      urls: [...document.querySelectorAll('#article *')].filter((e) =>
        /url\(|javascript:/i.test(e.getAttribute('style') ?? ''),
      ).length,
      klass: document.querySelectorAll('#article .x, #article .y').length,
    }));
    expect(found).toEqual({ links: 0, handlers: 0, urls: 0, klass: 0 });
    // 文字は、文字として見える
    await expect(page.locator('#article .math-block').nth(4)).toContainText('<script>');
  });

  test('止まらない：巨大な式（20,000 文字超）・再帰するマクロ・深い入れ子・大量の式でも、画面が応答し、失敗として出る', async ({
    page,
    app,
  }) => {
    const long = `x ${'+ 1 '.repeat(6000)}`; // 24,000 文字
    const nest = `${'x^{'.repeat(2500)}y${'}'.repeat(2500)}`; // 約 10,000 文字
    const many = Array.from({ length: 300 }, (_, i) => `文 $a_{${i}}^2$ と $\\frac{${i}}{2}$。`).join('\n\n');
    const md = [
      '# 上限',
      `$$${long}$$`,
      '$$\\def\\a{\\a\\a}\\a$$',
      '$$\\def\\a{\\b\\b}\\def\\b{\\c\\c}\\def\\c{\\a\\a}\\a$$',
      `$$${nest}$$`,
      `$$${'\\frac{'.repeat(1200)}x${'}{1}'.repeat(1200)}$$`,
      many,
    ].join('\n\n');
    const t0 = Date.now();
    await page.setViewportSize({ width: 1360, height: 900 });
    await app.switchTopic(page, 'lim', '上限', md);
    // 描き終える：すべての式が、描けたか、失敗として出る
    await expect(page.locator('#article .math-block')).toHaveCount(5);
    await expect
      .poll(
        () =>
          page
            .locator(
              '#article .math-block:not(.math-done):not(.math-error), #article .math-inline:not(.math-done):not(.math-error)',
            )
            .count(),
        {
          timeout: 40_000,
        },
      )
      .toBe(0);
    expect(Date.now() - t0).toBeLessThan(40_000);
    await expect(page.locator('#article .math-block').first()).toHaveClass(/math-error/);
    await expect(page.locator('#article .math-block').first()).toContainText('長すぎます');
    await expect(page.locator('#article .math-block').nth(1)).toHaveClass(/math-error/);
    await expect(page.locator('#article .math-block').nth(2)).toHaveClass(/math-error/);
    await expect(page.locator('#article .math-inline.math-done')).toHaveCount(600);
    // 描いたあとも、画面が応答する（フレームが進む・操作に反応する）
    const dt = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          const t = performance.now();
          requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now() - t)));
        }),
    );
    expect(dt).toBeLessThan(1500);
    await ui(page).regbtn.click();
    await expect(ui(page).regsel).toBeVisible();
  });
});

test.describe('数式：別行は図と同じブロック（拡大表示・範囲コメント・版・差分・並べて比べる）', () => {
  test('ラベルは「数式」：ブロックに触れると出る「コメント」「拡大表示」・コメントのカードの見出し', async ({
    page,
    app,
  }) => {
    const u = ui(page);
    await open(page, app);
    const blk = blocks(page).first();
    await blk.scrollIntoViewIfNeeded();
    const b = await box(blk);
    await page.mouse.move(b.x + 12, b.y + b.height / 2, { steps: 3 }); // 式の外（ブロックの左）
    await expect(u.actbar).toBeVisible();
    await u.actComment.click();
    await expect(u.composer).toBeVisible();
    await expect(u.composer).toContainText('数式');
    await fillAndAdd(page, '解の公式の、この形は、どこから来ますか');
    await expect(u.panel).toContainText('数式');
    await expect(blk).toHaveClass(/blk-thread/);
  });

  test('拡大表示：式を押す（HTML のまま拡大）→ ズーム・移動 → 範囲を選ぶ → コメント → 送る → 版を更新しても、コメントが残る（範囲の画像は、フォントつき）', async ({
    page,
    app,
  }) => {
    const u = ui(page);
    await open(page, app);
    const blk = blocks(page).first();
    await blk.scrollIntoViewIfNeeded();
    const inline = await box(blk.locator('.katex'));
    await blk.locator('.katex').click();
    await expect(lbx(page)).toBeVisible();
    await expect(stage(page).locator('.katex')).toBeVisible();
    await expect(page.locator('#lightbox .fv-dock')).toBeVisible();
    // 自然な大きさの、拡大：窓に収まる倍率（本文より大きい）
    const s0 = await box(stage(page));
    expect(s0.width).toBeGreaterThan(inline.width * 1.5);
    expect(Math.abs(s0.width / s0.height - inline.width / inline.height)).toBeLessThan(0.05); // 縦横比が、本文と同じ（箱が、式そのもの）
    // + で拡大：倍率が上がる（ズームの値は、50% 刻み以上）
    const before = Number.parseInt((await page.locator('#lightbox .lb-pct').textContent()) ?? '0', 10);
    await page.keyboard.press('+');
    await expect
      .poll(async () => Number.parseInt((await page.locator('#lightbox .lb-pct').textContent()) ?? '0', 10))
      .toBeGreaterThan(before);
    await page.keyboard.press('0'); // 全体に合わせる
    // 範囲を選ぶ：分数の部分（右側）をドラッグ
    await regionTool(page).click();
    await expect(regionTool(page)).toHaveAttribute('aria-pressed', 'true');
    const s1 = await box(stage(page));
    await dragBox(
      page,
      { x: s1.x + s1.width * 0.34, y: s1.y + s1.height * 0.08 },
      { x: s1.x + s1.width * 0.99, y: s1.y + s1.height * 0.95 },
    );
    await expect(dockComposer(page)).toBeVisible();
    await expect(lbx(page)).toBeVisible();
    await expect(dockComposer(page)).toContainText('数式の一部');
    await settled(page);
    // 範囲の画像が付く：フォントつきで描かれた式（暗い画素がある・白い地）
    const thumb = dockComposer(page).locator('.thumb img').first();
    await expect(thumb).toBeVisible();
    await expect.poll(() => thumb.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth)).toBeGreaterThan(50);
    const ink = await inkShare(thumb);
    expect(ink.dark).toBeGreaterThan(0.02);
    expect(ink.dark).toBeLessThan(0.6);
    await dockComposer(page).locator('textarea').fill('分数の分母は、なぜ 2a ですか');
    await dockComposer(page).getByRole('button', { name: 'コメントを追加' }).click();
    await expect(dockComposer(page)).toHaveCount(0);
    await expect(page.locator('#lightbox .fv-dock .thread:not(.composer)')).toHaveCount(1);
    await expect(page.locator('#lightbox .fv-dock .fv-box')).toHaveCount(0); // 枠は、ステージの上
    await expect(page.locator('#lightbox .fv-box')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(lbx(page)).toBeHidden();
    // 本文：範囲の枠が、式の上に重なる
    const regionBox = async () => box(page.locator('#badges .regionbox:not(.pending)'));
    const katex = async () => box(blocks(page).first().locator('.katex'));
    const rb = await regionBox();
    const kb = await katex();
    expect(rb.x).toBeGreaterThanOrEqual(kb.x - 2);
    expect(rb.x + rb.width).toBeLessThanOrEqual(kb.x + kb.width + 2);
    expect(rb.y).toBeGreaterThanOrEqual(kb.y - 2);
    expect(rb.y + rb.height).toBeLessThanOrEqual(kb.y + kb.height + 2);
    expect(rb.width / kb.width).toBeGreaterThan(0.5);
    expect(rb.width / kb.width).toBeLessThan(0.75); // 選んだ幅（約 0.65）
    // 送る → AI の返信と、資料の更新（式のない段落を足す）→ コメントが残る・枠も同じ場所
    await submitAll(page);
    const r = await app.nextRound();
    expect(r.items).toHaveLength(1);
    expect(r.items[0].anchor.label).toBe('数式の一部');
    expect(r.items[0].anchor.region.w).toBeGreaterThan(0.5);
    await app.apply({
      round: r.round,
      revisions: [{ page: 'root', markdown: DOC(QUAD, '\n新しい段落です。\n') }],
      replies: [{ thread: r.items[0].thread, body: '分母の $2a$ は、解の公式の定義から来ます。' }],
    });
    await expect(u.toast).toContainText('資料が v2 に更新されました');
    await expect(page.locator('#docbar select')).toHaveValue('2');
    await expect(page.locator('#article .math-done')).not.toHaveCount(0);
    await expect(page.locator('#badges .regionbox:not(.pending)')).toHaveCount(1);
    const rb2 = await regionBox();
    const kb2 = await katex();
    expect(Math.abs((rb2.x - kb2.x) / kb2.width - (rb.x - kb.x) / kb.width)).toBeLessThan(0.02);
    expect(Math.abs(rb2.width / kb2.width - rb.width / kb.width)).toBeLessThan(0.02);
    await expect(u.panel).toContainText('分数の分母は、なぜ 2a ですか');
    // 返信の中の数式も、描かれる
    await expect(u.panel.locator('.msg .katex')).toHaveCount(1);
  });

  test('版の差分：式を 1 つ直す（v2）→ そのブロックが「変更」・差分の文字は TeX・コメントは、新しい版にも残る。並べて比べる：左右とも描かれる', async ({
    page,
    app,
  }) => {
    const u = ui(page);
    await open(page, app);
    // 式のブロックにコメント（ブロック全体）
    const blk = blocks(page).first();
    await blk.scrollIntoViewIfNeeded();
    const b = await box(blk);
    await page.mouse.move(b.x + 12, b.y + b.height / 2, { steps: 3 });
    await u.actComment.click();
    await fillAndAdd(page, 'この式は、正しいですか');
    await submitAll(page);
    const r = await app.nextRound();
    const fixed = QUAD.replace('b^2 - 4ac', 'b^2 + 4ac');
    await app.apply({
      round: r.round,
      revisions: [{ page: 'root', markdown: DOC(fixed) }],
      replies: [{ thread: r.items[0].thread, body: '符号を直しました。' }],
    });
    await expect(page.locator('#docbar select')).toHaveValue('2');
    await expect(u.docbar).toContainText('変更 1');
    const changed = page.locator('#article .math-block.changed');
    await expect(changed).toHaveCount(1);
    await expect(page.locator('#article .math-block').first()).toHaveClass(/changed/);
    const diffbox = page.locator('#article .diffbox').first();
    await diffbox.locator('summary').click();
    await expect(diffbox.locator('del')).toContainText('-');
    await expect(diffbox.locator('ins')).toContainText('+');
    await expect(diffbox).toContainText('4ac');
    await expect(u.panel).toContainText('この式は、正しいですか');
    await expect(page.locator('#article .blk-thread')).toHaveCount(1); // コメントは、式を直した新しい版にも、付く
    // 並べて比べる
    await page.locator('#btn-compare').click();
    await expect(page.locator('#compare .cmprow').first()).toBeVisible();
    await expect(page.locator('#compare .cmprow[data-status="changed"]')).toHaveCount(1);
    await expect(page.locator('#compare .cmpl .math-block .katex')).not.toHaveCount(0);
    await expect(page.locator('#compare .cmpr .math-block .katex')).not.toHaveCount(0);
    expect(await page.locator('#compare .math-block:not(.math-done)').count()).toBe(0);
  });

  test('文中の数式は、ふつうの文：数式を含む文に、コメントを付ける。引用は元の TeX・強調は、数式の上にも出る・数式を押すとカードを選ぶ・版を更新しても残る', async ({
    page,
    app,
  }) => {
    const u = ui(page);
    await open(page, app);
    await dragThrough(page, '文中の数式', 'があります。');
    await expect(u.actbar).toBeVisible();
    await u.actComment.click();
    await expect(u.composer).toBeVisible();
    await expect(u.composer.locator('.quote')).toContainText('$E = mc^2$');
    await fillAndAdd(page, 'E と m の単位を、教えてください');
    const hl = page.locator('#article mark.hl.live');
    await expect(hl.first()).toBeAttached();
    // 数式の上にも、強調（見えない元の文字の強調を、描いた式に写す）
    const bg = await page
      .locator('#article .math-inline')
      .first()
      .locator('.math-out')
      .evaluate((e) => getComputedStyle(e).backgroundColor);
    expect(bg).not.toBe('rgba(0, 0, 0, 0)');
    // 数式を押すと、そのカードが選ばれる
    const kb = await box(page.locator('#article .math-inline').first().locator('.katex'));
    await page.mouse.click(kb.x + kb.width * 0.1, kb.y + kb.height / 2);
    await expect(u.panel.locator('.thread.active')).toHaveCount(1);
    // 送って、版を更新：数式の入った文を、直さない → コメントは、そのまま付く
    await submitAll(page);
    const r = await app.nextRound();
    expect(r.items[0].anchor.quote).toContain('$E = mc^2$');
    await app.apply({
      round: r.round,
      revisions: [{ page: 'root', markdown: DOC(QUAD, '\n追加の段落です。\n') }],
      replies: [{ thread: r.items[0].thread, body: 'E はジュール・m は kg です。' }],
    });
    await expect(page.locator('#docbar select')).toHaveValue('2');
    await expect(page.locator('#article .math-done')).not.toHaveCount(0);
    await expect(page.locator('#article mark.hl.live').first()).toBeAttached();
    await expect(u.panel).toContainText('E と m の単位を、教えてください');
    expect(await page.locator('#badges .bno').count()).toBeGreaterThan(0);
  });

  test('本文の範囲選択：式の内側（元の解像度から切り出す）・式の外へ出る範囲（本文を画像にする）で、範囲の画像に、KaTeX のフォントが入る', async ({
    page,
    app,
  }) => {
    const u = ui(page);
    await open(page, app);
    // 範囲の画像にする SVG に、フォント（data:）が入ることを、記録する（画像の src に入れる、SVG の文字を調べる）
    await page.evaluate(() => {
      const d = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
      if (!d?.set || !d.get) throw new Error('src がない');
      const { get, set } = d;
      const seen: boolean[] = [];
      Reflect.set(window, '__fontSvgs', seen);
      Object.defineProperty(HTMLImageElement.prototype, 'src', {
        configurable: true,
        get() {
          return get.call(this);
        },
        set(v: string) {
          const text = decodeURIComponent(String(v));
          if (text.startsWith('data:image/svg+xml'))
            seen.push(/@font-face\{font-family:KaTeX_Main[^}]*font\/woff2;base64/.test(text));
          set.call(this, v);
        },
      });
    });
    const blk = blocks(page).first();
    await blk.scrollIntoViewIfNeeded();
    const kb = await box(blk.locator('.katex'));
    // 式の内側：右半分
    await u.regbtn.click();
    await dragBox(
      page,
      { x: kb.x + kb.width * 0.5, y: kb.y + kb.height * 0.1 },
      { x: kb.x + kb.width * 0.95, y: kb.y + kb.height * 0.9 },
    );
    await expect(u.composer).toBeVisible();
    await expect(u.composer).toContainText('数式の一部');
    await settled(page);
    const thumb = u.composer.locator('.thumb img').first();
    await expect.poll(() => thumb.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth)).toBeGreaterThan(30);
    expect((await inkShare(thumb)).dark).toBeGreaterThan(0.02);
    await u.composer.getByRole('button', { name: 'やめる' }).click();
    // 式の外へ出る範囲：見出しの文〜式の下
    const p0 = await box(page.locator('#article p').first());
    await u.regbtn.click();
    await dragBox(page, { x: p0.x, y: p0.y }, { x: kb.x + kb.width, y: kb.y + kb.height });
    await expect(u.composer).toBeVisible();
    await settled(page);
    const wide = u.composer.locator('.thumb img').first();
    await expect.poll(() => wide.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth)).toBeGreaterThan(200);
    expect((await inkShare(wide)).dark).toBeGreaterThan(0.01);
    const seen: boolean[] = await page.evaluate(() => Reflect.get(window, '__fontSvgs'));
    expect(seen.filter(Boolean).length).toBeGreaterThanOrEqual(2); // 2 つの画像の、どちらにも、フォントが入った
  });

  test('返信の中の数式：描かれる。押すと拡大表示（見るだけ：ドックも、範囲を選ぶ道具もない）', async ({
    page,
    app,
  }) => {
    const u = ui(page);
    await open(page, app);
    await dragThrough(page, '二次方程式', 'です。');
    await u.actComment.click();
    await fillAndAdd(page, '公式の意味を教えてください');
    await submitAll(page);
    const r = await app.nextRound();
    await app.apply({
      round: r.round,
      replies: [
        {
          thread: r.items[0].thread,
          body: `次の式です。\n\n${BT}math\n\\sum_{k=1}^{n} k = \\frac{n(n+1)}{2}\n${BT}\n\n文中の $k$ も描かれます。`,
        },
      ],
    });
    const reply = u.panel.locator('.msg .body .math-block .katex').first();
    await expect(reply).toBeVisible();
    await expect(u.panel.locator('.msg .body .math-inline .katex')).toHaveCount(1);
    await reply.click();
    await expect(lbx(page)).toBeVisible();
    await expect(stage(page).locator('.katex')).toBeVisible();
    await expect(page.locator('#lightbox .fv-dock')).toHaveCount(0);
    await expect(page.locator('#lightbox .fv-tools')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(lbx(page)).toBeHidden();
  });

  test('どの記法の数式ブロックでも、マウスを置くと、入口のバーに「拡大表示」と「コメント」が出る：svg（根号）を含まない式・```math の単一／空行で区切った複数の式・$$ の 1 行／複数行。押して開く・範囲を選んで付けられる・Enter で開く', async ({
    page,
    app,
  }) => {
    const u = ui(page);
    const kinds = [
      ['```math（行列。svg なし）', `${BT}math\n\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}\n${BT}`],
      [
        '```math（空行で区切った 2 つの式）',
        `${BT}math\n\\alpha + \\beta = \\gamma\n\n\\int_0^1 x\\,dx = \\frac{1}{2}\n${BT}`,
      ],
      ['$$ 1 行（svg なし）', '$$a^2 + b^2 = c^2$$'],
      ['$$ 複数行', '$$\n\\frac{a}{b}\n+ \\frac{c}{d}\n$$'],
      ['$$ 根号（svg あり）', '$$\\sqrt{x + 1}$$'],
    ] as const;
    const md = `# 記法ごと\n\n${kinds.map(([, t], i) => `段落 ${i}。\n\n${t}`).join('\n\n')}\n\n終わり。\n`;
    await open(page, app, md, 'kinds');
    await expect(blocks(page)).toHaveCount(kinds.length);
    await expect(page.locator('#article .math-block:not(.math-done)')).toHaveCount(0);
    await expect(page.locator('#article .math-block .katex')).toHaveCount(kinds.length); // 空行で区切っても、1 つのブロックは、1 つの式の箱
    for (const [i, [name]] of kinds.entries()) {
      const blk = blocks(page).nth(i);
      await blk.scrollIntoViewIfNeeded();
      const b = await box(blk);
      // 式の外（ブロックの左）にマウスを置く。バーのボタン名を集める
      await page.mouse.move(b.x + 10, b.y + b.height / 2, { steps: 3 });
      await expect(u.actbar, name).toBeVisible();
      await expect(u.actbar.locator('button'), name).toHaveText(['拡大表示', 'コメント']);
      // バーの「拡大表示」で開く → 範囲を選んで、コメントが付けられる
      await u.actbar.locator('#act-zoom').click();
      await expect(stage(page).locator('.katex'), name).toBeVisible();
      await regionTool(page).click();
      const s = await box(stage(page));
      await dragBox(
        page,
        { x: s.x + s.width * 0.2, y: s.y + s.height * 0.2 },
        { x: s.x + s.width * 0.8, y: s.y + s.height * 0.8 },
      );
      await expect(dockComposer(page), name).toBeVisible();
      await expect(dockComposer(page), name).toContainText('数式の一部');
      await dockComposer(page).getByRole('button', { name: 'やめる' }).click();
      await page.keyboard.press('Escape');
      await expect(lbx(page)).toBeHidden();
      // 式を直接押して開く
      await blk.locator('.katex').click();
      await expect(stage(page).locator('.katex'), name).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(lbx(page)).toBeHidden();
      // Enter・Space（キーボード）
      await blk.focus();
      await page.keyboard.press('Space');
      await expect(stage(page).locator('.katex'), name).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(lbx(page)).toBeHidden();
      await blk.focus();
      await page.keyboard.press('Enter');
      await expect(stage(page).locator('.katex'), name).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(lbx(page)).toBeHidden();
    }
  });

  test('キーボード：数式のブロックに Tab で届き、Enter で拡大表示が開く。Esc で閉じて、フォーカスが戻る', async ({
    page,
    app,
  }) => {
    await open(page, app);
    const blk = blocks(page).first();
    await expect(blk).toHaveAttribute('tabindex', '0');
    await expect(blk).toHaveAttribute('aria-label', '数式を、拡大表示で開く');
    await blk.focus();
    await page.keyboard.press('Enter');
    await expect(lbx(page)).toBeVisible();
    await expect(stage(page).locator('.katex')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(lbx(page)).toBeHidden();
    await expect(blk).toBeFocused();
  });

  test('数式のない場所の押下：式の外（ブロックの余白）を押しても、拡大しない（ふつうのブロックの操作）', async ({
    page,
    app,
  }) => {
    await open(page, app);
    const blk = blocks(page).first();
    await blk.scrollIntoViewIfNeeded();
    const b = await box(blk);
    await page.mouse.click(b.x + 6, b.y + b.height / 2);
    await expect(lbx(page)).toBeHidden();
  });
});
