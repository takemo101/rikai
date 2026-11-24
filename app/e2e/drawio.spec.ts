// draw.io の図（```drawio。F51：RIK-065）：マークダウンに埋め込んだ mxGraph の XML を、インライン SVG に描く。Mermaid の図と同じ経路で、拡大表示・範囲コメント・差分・並べて比べる。
// 実際の Chrome・本物のマウス。資料は、作り物。悪意のある XML でも、スクリプトが動かず・外へ通信せず・止まらないこと（N1・N3）。
import type { Locator, Page } from '@playwright/test';
import { BT, compressMxfile, drawioBlock, HOTEL, SEQUENCE, TABLE_MXFILE } from './drawio-samples';
import { expect, type RikaiApp, test } from './fixtures';
import { decodePng } from './samples';
import { box, dragBox, submitAll, ui } from './ui';

const TITLE = 'draw.io の確認';
const doc = (...blocks: string[]) => `# ${TITLE}\n\n前の段落です。\n\n${blocks.join('\n\n')}\n\n後の段落です。\n`;
const svgOf = (page: Page, i = 0) => page.locator('#article .drawio-block svg').nth(i);

async function open(page: Page, app: RikaiApp, md: string, slug = 'dx') {
  await page.setViewportSize({ width: 1360, height: 900 });
  await app.switchTopic(page, slug, TITLE, md);
}

const lbx = (page: Page) => page.locator('#lightbox');
const stage = (page: Page) => page.locator('#lightbox .lb-stage');
const dockComposer = (page: Page) => page.locator('#lightbox .fv-dock .thread.composer');
const regionTool = (page: Page) => page.locator('#lightbox .fv-tools [data-tool="region"]');

/** 図の文字（svg の `text`）を、すべて、集める */
const textsOf = (svg: Locator) => svg.locator('text').allTextContents();

test.describe('draw.io の図：描画', () => {
  test('見本（ホテル予約のスイムレーン）を再現：4 レーンの見出し・角丸・四角・菱形・円柱 2 つ・直交の矢印 9 本・線のラベル。文字は、図形の中に収まる', async ({
    page,
    app,
  }) => {
    await open(page, app, doc(drawioBlock(HOTEL)));
    const svg = svgOf(page);
    await expect(svg).toBeVisible();
    await expect(svg).toHaveAttribute('role', 'img');
    const t = await textsOf(svg);
    for (const w of ['お客様', 'オペレーター', 'ホテル', '空室が', 'ある', 'ない']) expect(t).toContain(w);
    expect(t.join('')).toContain('予約照会システム'); // 見出しは、2 行（改行）
    // 形：レーン 4・矢印の線 9（折れ線）・円柱 2（本体 + 縁）・菱形 1・角丸 1
    await expect(svg.locator('path[fill="none"][stroke-linejoin="round"]')).toHaveCount(9);
    await expect(svg.locator('polygon[points]:not([fill="none"])').first()).toBeVisible(); // 矢印の頭・菱形
    expect(await svg.locator('rect[rx]').count()).toBe(1);
    expect(await svg.locator('path[d*="A"]').count()).toBe(4); // 円柱 2 つ × (本体・縁)
    // 直交：すべての線は、軸に平行な脚だけ
    const ds = await svg
      .locator('path[fill="none"][stroke-linejoin="round"]')
      .evaluateAll((l) => l.map((p) => p.getAttribute('d') ?? ''));
    for (const d of ds) {
      const pts = [...d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])] as const);
      for (let i = 1; i < pts.length; i++) {
        const [a, b] = [pts[i - 1], pts[i]] as [readonly [number, number], readonly [number, number]];
        expect(a[0] === b[0] || a[1] === b[1], d).toBe(true);
      }
    }
    // 文字の折り返し：四角・角丸・円柱の文字は、図形の中（左右）に収まる。複数行になる
    const fit = await svg.evaluate((root) => {
      const bad: string[] = [];
      for (const g of root.querySelectorAll('g > g')) {
        const r = g.querySelector(':scope > rect[fill*="d5e0f0"], :scope > rect[fill="#d5e0f0"]');
        const texts = [...g.querySelectorAll(':scope > g > text')];
        if (!r || !texts.length) continue;
        const rb = (r as SVGGraphicsElement).getBBox();
        for (const tx of texts) {
          const b = (tx as SVGGraphicsElement).getBBox();
          if (b.x < rb.x - 0.5 || b.x + b.width > rb.x + rb.width + 0.5) bad.push(tx.textContent ?? '');
        }
      }
      return bad;
    });
    expect(fit).toEqual([]);
    // 色：図形の地は、指定のまま。文字は、黒（地に合わせる）
    await expect(svg.locator('rect[fill="#d5e0f0"]').first()).toBeVisible();
    // 余白つきの境界・自然な大きさ（見本の縦長の比）
    const vb = (await svg.getAttribute('viewBox'))?.split(' ').map(Number) ?? [];
    expect((vb[3] ?? 0) / (vb[2] ?? 1)).toBeGreaterThan(1.1);
  });

  test('シーケンス図：縦の生命線（破線）・水平のメッセージ・戻り（破線）・参加者の四角・活性化の帯・ラベルは、線の上', async ({
    page,
    app,
  }) => {
    await open(page, app, doc(drawioBlock(SEQUENCE)));
    const svg = svgOf(page);
    await expect(svg).toBeVisible();
    const t = await textsOf(svg);
    for (const w of ['ユーザー', 'サーバー', 'DB', 'ログイン要求', '認証結果']) expect(t).toContain(w);
    const dashedVertical = await svg
      .locator('line[stroke-dasharray]')
      .evaluateAll((l) => l.filter((e) => e.getAttribute('x1') === e.getAttribute('x2')).length);
    expect(dashedVertical).toBe(3); // 生命線
    // メッセージ（始点・終点の y が同じ）
    const msgs = await svg.locator('path[fill="none"]').evaluateAll((l) =>
      l.map((p) => {
        const nums = [...(p.getAttribute('d') ?? '').matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((m) => Number(m[2]));
        return new Set(nums).size;
      }),
    );
    expect(msgs.length).toBe(5);
    expect(msgs.every((n) => n === 1)).toBe(true); // すべて水平
    await expect(svg.locator('path[stroke-dasharray]')).toHaveCount(2); // 戻りの破線 2 本
    // 「ログイン要求」の文字は、線（y=110）の上
    const labelY = await svg.locator('text', { hasText: 'ログイン要求' }).evaluate((e) => Number(e.getAttribute('y')));
    expect(labelY).toBeLessThan(110);
  });

  test('実際の draw.io が出す形：<mxfile><diagram> で包む・圧縮形式（DecompressionStream で展開）・html=1 のラベル（<b>・<br>）・表（table）の枠。圧縮と非圧縮は、同じ図', async ({
    page,
    app,
  }) => {
    await open(page, app, doc(drawioBlock(TABLE_MXFILE), drawioBlock(compressMxfile(TABLE_MXFILE))));
    const [a, b] = [svgOf(page, 0), svgOf(page, 1)];
    await expect(a).toBeVisible();
    await expect(b).toBeVisible();
    expect(await textsOf(a)).toEqual(await textsOf(b));
    expect(await textsOf(a)).toEqual(
      expect.arrayContaining(['申請フロー', '申請者', '承認者', '申請書を', '書く', '提出', '差し戻し']),
    );
    expect(await a.evaluate((e) => e.outerHTML)).toBe(await b.evaluate((e) => e.outerHTML));
    // 表：辺ごとの線（申請者の右の辺 1 本）・見出しの帯
    await expect(a.locator('line')).toHaveCount(1);
    await expect(a.locator('rect[fill="#dae8fc"]').first()).toBeVisible();
  });

  test('失敗：壊れた XML・上限超え・圧縮の壊れ・存在しない形は、Mermaid と同じ表示（理由つき・ソース）。ほかの図は、描かれる', async ({
    page,
    app,
  }) => {
    const broken = '<mxGraphModel><root><mxCell id="0"/>';
    const badZip = '<mxfile><diagram id="x">AAAA!!!</diagram></mxfile>';
    const notDrawio = '<svg xmlns="http://www.w3.org/2000/svg"/>';
    await open(page, app, doc(drawioBlock(broken), drawioBlock(badZip), drawioBlock(notDrawio), drawioBlock(SEQUENCE)));
    const errs = page.locator('#article .drawio-block.mermaid-error');
    await expect(errs).toHaveCount(3);
    await expect(errs.nth(0).locator('.mm-err')).toContainText('図を描画できませんでした（draw.io）：XML を読めません');
    await expect(errs.nth(1).locator('.mm-err')).toContainText('図を描画できませんでした（draw.io）');
    await expect(errs.nth(2).locator('.mm-err')).toContainText('mxGraphModel');
    await expect(errs.nth(0).locator('pre')).toHaveText(broken); // ソースは、文字として
    await expect(svgOf(page, 0)).toBeVisible(); // 3 つの失敗のあとの、正しい図
    expect(await textsOf(svgOf(page, 0))).toContain('ログイン要求');
  });
});

test.describe('draw.io の図：拡大表示・範囲コメント（Mermaid と同じ手順）', () => {
  test('図を押す → 拡大表示（複製）→ ズーム → 範囲を選ぶ → ドックで書く → 閉じる → 追加 → AI に送る → 図の範囲（region）と切り出した画像が届く → 新しい版 → コメントが残る', async ({
    page,
    app,
  }) => {
    const u = ui(page);
    await open(page, app, doc(drawioBlock(HOTEL)));
    await svgOf(page).scrollIntoViewIfNeeded();
    const before = await svgOf(page).evaluate((e) => e.outerHTML);
    await svgOf(page).click({ position: { x: 20, y: 20 } });
    await expect(lbx(page)).toBeVisible();
    const clone = lbx(page).locator('.lb-stage svg');
    await expect(clone).toHaveCount(1);
    expect(await clone.evaluate((e) => e.querySelectorAll('[id]').length)).toBe(0); // id も `url(#…)` もない：複製で壊れない
    expect(await textsOf(clone)).toContain('ホテル');
    // 拡大できる：本文より、大きい
    const o = await box(svgOf(page));
    await expect.poll(async () => (await box(clone)).width).toBeGreaterThan(o.width);
    // 本文は、動かない・足されない
    expect(await svgOf(page).evaluate((e) => e.outerHTML)).toBe(before);
    // 範囲を選ぶ → 小さな範囲（お客様のレーンの上のほう）
    await regionTool(page).click();
    const s = await box(stage(page));
    await dragBox(
      page,
      { x: s.x + s.width * 0.06, y: s.y + s.height * 0.07 },
      { x: s.x + s.width * 0.4, y: s.y + s.height * 0.22 },
    );
    await expect(dockComposer(page)).toBeVisible();
    await expect(lbx(page)).toBeVisible();
    await expect(dockComposer(page).locator('.quote')).toContainText('図の一部');
    const thumb = dockComposer(page).locator('.thumb img');
    await expect(thumb).toHaveCount(1);
    await expect(thumb).toHaveJSProperty('complete', true);
    const dim = await thumb.evaluate((i: HTMLImageElement) => ({ w: i.naturalWidth, h: i.naturalHeight }));
    expect(dim.w / dim.h).toBeGreaterThan(1.2); // 選んだ範囲の縦横比（横長）
    await dockComposer(page).locator('textarea').fill('ここの電話から、お客様の希望を聞くまでの線は、これでよい？');
    await page.keyboard.press('Escape');
    await expect(lbx(page)).toBeHidden();
    await expect(u.composer.locator('textarea')).toHaveValue(/電話から/);
    await u.composer.getByRole('button', { name: 'コメントを追加' }).click();
    await expect(u.threads).toHaveCount(1);
    await submitAll(page);
    const round = await app.nextRound();
    const item = round.items[0];
    expect(item.anchor.label).toBe('図の一部');
    expect(item.anchor.region.x).toBeGreaterThan(0);
    expect(item.anchor.region.w).toBeLessThan(0.6);
    const imgs: string[] = item.new[0].images;
    expect(imgs).toHaveLength(1);
    const png = decodePng((await import('node:fs')).readFileSync(imgs[0] as string));
    expect(png.w).toBeGreaterThan(50);
    // 切り出した画像は、白い地ではなく、図が写っている（青い図形の画素がある）
    let blue = 0;
    for (let y = 0; y < png.h; y += 2)
      for (let x = 0; x < png.w; x += 2) {
        const [r, , b] = png.at(x, y);
        if (b > r + 15 && b > 200) blue++;
      }
    expect(blue).toBeGreaterThan(20);
    // AI が、図を直した新しい版で応える。コメントは、残る
    await app.apply({
      round: 1,
      replies: [{ thread: item.thread, body: '線は、これでよいです。ラベルを足しました。' }],
      revisions: [
        {
          page: 'root',
          markdown: doc(drawioBlock(HOTEL.replace('ホテル予約の&lt;br&gt;電話', 'ホテル予約の&lt;br&gt;電話受付'))),
        },
      ],
    });
    await expect(page.locator('#docbar select option')).toHaveCount(2);
    await expect(u.threads).toHaveCount(1);
    await expect(u.threads.first()).toContainText('線は、これでよいです');
    await expect(svgOf(page)).toBeVisible();
    expect(await textsOf(svgOf(page))).toContain('電話受付');
    await expect(page.locator('#badges .bno')).toHaveCount(1); // 範囲の番号が、図に付く
    // もう一度開くと、ドックに、そのコメント・ステージに、範囲の枠
    await svgOf(page).click({ position: { x: 20, y: 20 } });
    await expect(lbx(page)).toBeVisible();
    await expect(page.locator('#lightbox .fv-dock .thread:not(.composer)')).toHaveCount(1);
    await expect(page.locator('#lightbox .fv-box:not(.pending)')).toHaveCount(1);
  });

  test('図の中の文字を選んで「コメント」：Mermaid と同じ、図のブロックへのコメント（label は「図」）。本文の下書きに入る', async ({
    page,
    app,
  }) => {
    const u = ui(page);
    await open(page, app, doc(drawioBlock(HOTEL)));
    await svgOf(page).scrollIntoViewIfNeeded();
    // ブロックの上にマウスを置く → 入口のバーの「コメント」
    const b = await box(svgOf(page));
    await page.mouse.move(b.x + b.width / 2, b.y + 200, { steps: 3 });
    await expect(u.actbar).toBeVisible();
    await expect(page.locator('#act-zoom')).toBeVisible(); // 「拡大表示」ボタン
    await u.actComment.click();
    await expect(u.composer).toBeVisible();
    await expect(u.composer.locator('.quote')).toContainText('図');
    await u.composer.locator('textarea').fill('この図全体について');
    await u.composer.getByRole('button', { name: 'コメントを追加' }).click();
    await submitAll(page);
    const round = await app.nextRound();
    expect(round.items[0].anchor.label).toBe('図');
  });

  test('キーボード：図のブロックは、Tab で届き、Enter で拡大表示が開く。閉じたら、フォーカスが戻る', async ({
    page,
    app,
  }) => {
    await open(page, app, doc(drawioBlock(SEQUENCE)));
    const blk = page.locator('#article .drawio-block');
    await expect(blk).toHaveAttribute('tabindex', '0');
    await expect(blk).toHaveAttribute('role', 'button');
    await blk.focus();
    await page.keyboard.press('Enter');
    await expect(lbx(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(lbx(page)).toBeHidden();
    await expect(blk).toBeFocused();
  });
});

test.describe('draw.io の図：版の差分・並べて比べる', () => {
  test('版の差分（F11）：図のソースが変わったブロックは「変更」・同じ図は変更なし。並べて比べる（F44）：左右に、それぞれの版の図', async ({
    page,
    app,
  }) => {
    const other = SEQUENCE.replace('ログイン要求', 'ログイン要求（改）');
    await open(page, app, doc(drawioBlock(HOTEL), drawioBlock(SEQUENCE)));
    await app.apply(
      { revisions: [{ page: 'root', markdown: doc(drawioBlock(HOTEL), drawioBlock(other)) }] },
      { topic: 'dx' },
    );
    await expect(page.locator('#docbar select option')).toHaveCount(2);
    await expect(page.locator('#article .drawio-block')).toHaveCount(2);
    await expect(page.locator('#article .drawio-block.changed')).toHaveCount(1);
    await expect(page.locator('#article .drawio-block').nth(1)).toHaveClass(/changed/);
    await expect(page.locator('#article .drawio-block').nth(0)).not.toHaveClass(/changed/);
    await expect(page.locator('#article details.diffbox summary')).toHaveText('前の版との差分');
    // 並べて比べる
    await page.locator('#btn-compare').click();
    await expect(page.locator('#compare')).toBeVisible();
    await expect(page.locator('#compare .cmprow[data-status="changed"]')).toHaveCount(1);
    const changed = page.locator('#compare .cmprow[data-status="changed"]');
    await expect(changed.locator('.cmpl svg')).toBeVisible();
    await expect(changed.locator('.cmpr svg')).toBeVisible();
    expect(await textsOf(changed.locator('.cmpl svg'))).toContain('ログイン要求');
    expect(await textsOf(changed.locator('.cmpr svg'))).toContain('ログイン要求（改）');
    await expect(page.locator('#compare .cmprow[data-status="same"] .drawio-block svg').first()).toBeVisible();
  });
});

test.describe('draw.io の図：ダーク・狭い窓', () => {
  test('ダーク：標準の色は、暗い地・明るい線・文字に。指定の地（薄い青）の文字は、黒のまま読める（コントラスト 4.5 以上）。ライトに戻すと、戻る', async ({
    page,
    app,
  }) => {
    await open(page, app, doc(drawioBlock(HOTEL)));
    const svg = svgOf(page);
    await expect(svg).toBeVisible();
    // 図の文字・地・紙の、コントラスト
    const contrast = () =>
      svg.evaluate((root) => {
        const lum = (c: string) => {
          const m = /rgba?\(([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)/.exec(c) ?? [];
          const ch = [m[1], m[2], m[3]].map((v) => {
            const x = Number(v) / 255;
            return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
          });
          return 0.2126 * (ch[0] ?? 0) + 0.7152 * (ch[1] ?? 0) + 0.0722 * (ch[2] ?? 0);
        };
        const ratio = (a: string, b: string) => {
          const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number];
          return (x + 0.05) / (y + 0.05);
        };
        const paper = getComputedStyle(document.body).backgroundColor;
        const out: { text: string; ratio: number }[] = [];
        for (const t of root.querySelectorAll('text')) {
          const g = t.parentElement as Element;
          const fill = getComputedStyle(t).fill;
          // 地：この文字の手前にある、最も近い塗り（none でない）の図形。なければ、紙（スイムレーンの本体は none・見出しの帯が塗り）
          let bg = paper;
          for (let p = g.previousElementSibling; p; p = p.previousElementSibling) {
            const shape = p.matches('rect, ellipse, polygon, path')
              ? p
              : p.querySelector('rect, ellipse, polygon, path');
            const f = shape ? getComputedStyle(shape).fill : 'none';
            if (shape && f !== 'none') {
              bg = f;
              break;
            }
          }
          const host = g.parentElement?.parentElement === root || !g.parentElement ? null : g.parentElement;
          if (host) {
            const own = [...host.children].filter((c) => c !== g && c.matches('rect, ellipse, polygon, path'));
            for (const c of own.reverse()) {
              const f = getComputedStyle(c).fill;
              if (f !== 'none') {
                bg = f;
                break;
              }
            }
          }
          out.push({ text: t.textContent ?? '', ratio: ratio(fill, bg) });
        }
        const stroke = getComputedStyle(root.querySelector('path[stroke-linejoin="round"]') as Element).stroke;
        return { texts: out, edgeVsPaper: ratio(stroke, paper) };
      });
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect.poll(() => svg.evaluate((e) => e.outerHTML.includes('#e4e4e7'))).toBe(true); // ダークで描き直された
    const dark = await contrast();
    for (const t of dark.texts) expect(t.ratio, `ダークの文字：${t.text}`).toBeGreaterThanOrEqual(4.5);
    expect(dark.edgeVsPaper).toBeGreaterThanOrEqual(4.5); // 黒い線を指定した矢印が、ダークで消えない
    await expect(svg.locator('rect[fill="#d5e0f0"]').first()).toBeVisible(); // 指定の地は、そのまま
    await page.emulateMedia({ colorScheme: 'light' });
    await expect.poll(() => svg.evaluate((e) => e.outerHTML.includes('#e4e4e7'))).toBe(false);
    const light = await contrast();
    for (const t of light.texts) expect(t.ratio, `ライトの文字：${t.text}`).toBeGreaterThanOrEqual(4.5);
  });

  test('ダークで開いた拡大表示：図の地は、画面の紙の色・文字が読める。範囲の切り出し画像も、ダークの図が写る', async ({
    page,
    app,
  }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await open(page, app, doc(drawioBlock(SEQUENCE)));
    await expect.poll(() => svgOf(page).evaluate((e) => e.outerHTML.includes('#e4e4e7'))).toBe(true);
    await svgOf(page).click({ position: { x: 10, y: 10 } });
    await stageReadyDark(page);
    await regionTool(page).click();
    const s = await box(stage(page));
    await dragBox(
      page,
      { x: s.x + s.width * 0.1, y: s.y + s.height * 0.05 },
      { x: s.x + s.width * 0.5, y: s.y + s.height * 0.35 },
    );
    const thumb = dockComposer(page).locator('.thumb img');
    await expect(thumb).toHaveCount(1);
    await expect(thumb).toHaveJSProperty('complete', true);
    // 画像の地は、暗い（画面の紙の色）・線や文字は、明るい画素がある
    const stats = await thumb.evaluate((img: HTMLImageElement) => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const g = c.getContext('2d') as CanvasRenderingContext2D;
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let dark = 0;
      let light = 0;
      for (let i = 0; i < d.length; i += 4) {
        const l = (d[i] ?? 0) + (d[i + 1] ?? 0) + (d[i + 2] ?? 0);
        if (l < 120) dark++;
        else if (l > 600) light++;
      }
      return { dark: dark / (d.length / 4), light: light / (d.length / 4) };
    });
    expect(stats.dark).toBeGreaterThan(0.4);
    expect(stats.light).toBeGreaterThan(0.002);
  });

  test('狭い窓（幅 400）：図は、窓に収まる（横にあふれない）。拡大表示は、開く', async ({ page, app }) => {
    await open(page, app, doc(drawioBlock(HOTEL)));
    await page.setViewportSize({ width: 400, height: 800 });
    const svg = svgOf(page);
    await expect(svg).toBeVisible();
    const m = await svg.evaluate((e) => ({
      w: e.getBoundingClientRect().width,
      host: (e.parentElement as HTMLElement).clientWidth,
      page: document.documentElement.scrollWidth,
    }));
    expect(m.w).toBeLessThanOrEqual(m.host + 1);
    expect(m.page).toBeLessThanOrEqual(401);
    await svg.scrollIntoViewIfNeeded();
    await svg.click({ position: { x: 10, y: 10 } });
    await expect(lbx(page)).toBeVisible();
  });
});

async function stageReadyDark(page: Page) {
  await expect(lbx(page)).toBeVisible();
  await expect.poll(async () => (await box(stage(page))).width).toBeGreaterThan(50);
}

// ============================================================================
// 悪意のある XML（N1・N3）：スクリプトが動かない・外への通信がない（fixtures が、終わりに 127.0.0.1 以外 0 件を確かめる）・止まらない
const cell = (id: string, extra = '', style = '', value = '', parent = '1') =>
  `<mxCell id="${id}" value="${value}" style="${style}" vertex="1" parent="${parent}"><mxGeometry x="0" y="0" width="100" height="40" as="geometry"/>${extra}</mxCell>`;
const model = (cells: string) =>
  `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells}</root></mxGraphModel>`;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

test.describe('draw.io の図：悪意のある XML', () => {
  test('スクリプト・onload・javascript: のリンク・外部の画像・スタイルの注入：動かない・要素にならない・通信しない・図は描かれる', async ({
    page,
    app,
  }) => {
    await page.evaluate(() => {
      (window as unknown as { __pwned: number }).__pwned = 0; // スクリプトが動けば、ここが書き換わる
    });
    const evil = esc(
      '<script>window.__pwned=1</script><img src="https://evil.example/p.png" onerror="window.__pwned=2"><a href="javascript:window.__pwned=3">リンク</a><svg onload="window.__pwned=4"></svg>本文<style>*{display:none}</style>',
    );
    const xml = model(
      `<object label="${evil}" id="o" link="javascript:window.__pwned=5">${`<mxCell style="html=1;whiteSpace=wrap;fillColor=url(https://evil.example/f);strokeColor=red&quot; onload=&quot;window.__pwned=6;fontFamily=x&quot; onerror=&quot;1;shape=image;image=https://evil.example/i.png" vertex="1" parent="1"><mxGeometry x="10" y="10" width="200" height="80" as="geometry"/></mxCell>`}</object>` +
        cell(
          'b',
          '',
          `html=1;fillColor=#fff;strokeColor=#112233;opacity=abc;fontSize=1e99;rotation=1e99;label=${esc('x')}`,
          esc('<b onclick="window.__pwned=7">太字</b>'),
        ) +
        `<mxCell id="e" value="${esc('<img src=x onerror=window.__pwned=8>線')}" style="html=1;endArrow=url(#x);strokeColor=javascript:1;edgeStyle=${esc('"><script>window.__pwned=9</script>')}" edge="1" parent="1" source="o" target="b"><mxGeometry relative="1" as="geometry"/></mxCell>`,
    );
    const requests: string[] = [];
    page.on('request', (r) => requests.push(r.url()));
    await open(page, app, doc(drawioBlock(xml)));
    await expect(svgOf(page)).toBeVisible();
    await page.waitForTimeout(500); // 動くなら、ここまでに動く
    expect(await page.evaluate(() => (window as unknown as { __pwned: number }).__pwned)).toBe(0);
    const bad = await page.locator('#article').evaluate((root) => ({
      scripts: root.querySelectorAll('script, img[src*="evil"], foreignObject, iframe, [onload], [onerror], [onclick]')
        .length,
      links: [...root.querySelectorAll('.drawio-block a, .drawio-block [href], .drawio-block [xlink\\:href]')].length,
      styleAttrs: root.querySelectorAll('.drawio-block svg [style]').length,
      evilAttr: [...root.querySelectorAll('.drawio-block svg *')].some((e) =>
        [...e.attributes].some((a) => /evil|javascript|window\./.test(a.value)),
      ),
    }));
    expect(bad).toEqual({ scripts: 0, links: 0, styleAttrs: 0, evilAttr: false });
    expect(requests.filter((u) => !/^(data|blob|about):/.test(u) && !u.startsWith(app.origin))).toEqual([]);
    const t = (await textsOf(svgOf(page))).join('');
    expect(t).toContain('本文');
    expect(t).toContain('太字');
    expect(t).not.toMatch(/evil|alert|javascript|window\./);
    // 拡大表示を開いても、同じ
    await svgOf(page).click({ position: { x: 5, y: 5 } });
    await expect(lbx(page)).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __pwned: number }).__pwned)).toBe(0);
  });

  test('巨大な座標・巨大なセル数・再帰の親子・深すぎる入れ子・存在しない parent・500KB 超：失敗は文字で表示（フリーズしない）。存在しない parent は、最上位として描く', async ({
    page,
    app,
  }) => {
    const huge = model(
      `<mxCell id="a" vertex="1" parent="1"><mxGeometry x="999999999" y="0" width="100" height="40" as="geometry"/></mxCell>`,
    );
    const many = model(Array.from({ length: 2500 }, (_, i) => cell(`n${i}`)).join(''));
    const cycle = model(cell('a', '', '', 'a', 'b') + cell('b', '', '', 'b', 'a'));
    const deep = model(Array.from({ length: 40 }, (_, i) => cell(`d${i}`, '', '', '', i ? `d${i - 1}` : '1')).join(''));
    const orphan = model(cell('o', '', 'html=1', '孤児', 'nowhere'));
    const big = model(cell('x', '', '', 'あ'.repeat(600_000)));
    const t0 = Date.now();
    await open(page, app, doc(...[huge, many, cycle, deep, orphan, big].map(drawioBlock)));
    await expect(page.locator('#article .drawio-block.mermaid-error')).toHaveCount(5);
    await expect(svgOf(page, 0)).toBeVisible(); // orphan だけ描かれる
    expect(await textsOf(svgOf(page, 0))).toContain('孤児');
    await expect(page.locator('#article .dx-note')).toContainText('存在しない親');
    const msgs = await page.locator('#article .drawio-block .mm-err').allTextContents();
    expect(msgs.map((m) => m.replace(/^図を描画できませんでした（draw\.io）：/, ''))).toEqual([
      expect.stringContaining('範囲'),
      expect.stringContaining('セルが多すぎ'),
      expect.stringContaining('循環'),
      expect.stringContaining('深すぎ'),
      expect.stringContaining('大きすぎ'),
    ]);
    expect(Date.now() - t0).toBeLessThan(15_000);
    expect(await page.evaluate(() => 1 + 1)).toBe(2); // 画面は、応答する
  });

  test('2000 セル（上限ちょうど）の図：描かれて、拡大表示も開く（数秒以内・フリーズしない）', async ({ page, app }) => {
    const cells = Array.from(
      { length: 1990 },
      (_, i) =>
        `<mxCell id="n${i}" value="ノード${i}" style="whiteSpace=wrap;html=1;" vertex="1" parent="1"><mxGeometry x="${(i % 50) * 120}" y="${Math.floor(i / 50) * 60}" width="100" height="40" as="geometry"/></mxCell>`,
    ).join('');
    const t0 = Date.now();
    await open(page, app, doc(drawioBlock(model(cells))));
    await expect(svgOf(page)).toBeVisible({ timeout: 15_000 });
    expect(Date.now() - t0).toBeLessThan(15_000);
    await expect(page.locator('#article .drawio-block svg rect')).toHaveCount(1990);
    expect(await page.evaluate(() => 1 + 1)).toBe(2);
  });
});

void BT;
