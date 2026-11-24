// 範囲を選んでコメントする（F25・F31・F32）：「範囲を選ぶ」ボタン・ドラッグ・範囲の画像が付く・枠の調整（ハンドルのドラッグ）・Esc・やめる・画像の拡大
import fs from 'node:fs';
import type { Locator, Page } from '@playwright/test';
import { expect, type RikaiApp, test } from './fixtures';
import { makePng } from './samples';
import { box, dragBox, fillAndAdd, settled, submitAll, ui } from './ui';

const DOC_IMG = `# 画像の資料

前の段落です。写真の上の段落です。

![赤と青](assets/sample.png)

後の段落です。写真の下の段落です。
`;

// 画像のある資料に移り、画像が読み込まれるまで待つ
async function openPicDoc(page: Page, app: RikaiApp) {
  await app.switchTopic(page, 'pic', '画像の資料', DOC_IMG, { 'sample.png': makePng(400, 240) });
  const img = page.locator('#article img');
  await expect(img).toHaveJSProperty('complete', true);
  await expect.poll(() => img.evaluate((e: HTMLImageElement) => e.naturalWidth)).toBe(400);
  await img.scrollIntoViewIfNeeded();
  return img;
}

// PNG の幅・高さ（IHDR）
function pngSize(file: string) {
  const b = fs.readFileSync(file);
  expect(b.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

// 入力欄のサムネイルの、(x, y)（0〜1）の画素の色
async function thumbPixel(thumb: Locator, fx: number, fy: number) {
  return thumb.evaluate(
    (img: HTMLImageElement, [x, y]) => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const g = c.getContext('2d') as CanvasRenderingContext2D;
      g.drawImage(img, 0, 0);
      const d = g.getImageData(Math.floor(c.width * (x as number)), Math.floor(c.height * (y as number)), 1, 1).data;
      return [d[0], d[1], d[2]] as number[];
    },
    [fx, fy],
  );
}

test.describe('範囲を選ぶ', () => {
  test('右下に浮かぶ「範囲を選ぶ」ボタン：スクロールしても同じ場所。押すと「やめる」、もう一度押すと戻る（F32）', async ({
    page,
    app,
  }) => {
    const u = ui(page);
    const paras = Array.from({ length: 30 }, (_, i) => `第${i + 1}段落の文章です。`);
    await app.switchTopic(page, 'long', '長い資料', `# 長い資料\n\n${paras.join('\n\n')}\n`);
    await expect(u.regbtn).toBeVisible();
    await expect(u.regbtn).toContainText('範囲を選ぶ');
    const doc = await box(u.doc);
    const b0 = await box(u.regbtn);
    expect(b0.x + b0.width).toBeGreaterThan(doc.x + doc.width - 80); // 右
    expect(b0.y + b0.height).toBeGreaterThan(doc.y + doc.height - 80); // 下
    await page.mouse.move(doc.x + 200, doc.y + 200);
    await page.mouse.wheel(0, 600);
    await expect.poll(() => u.docscroll.evaluate((e) => e.scrollTop)).toBeGreaterThan(300);
    const b1 = await box(u.regbtn);
    expect(Math.abs(b1.x - b0.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(b1.y - b0.y)).toBeLessThanOrEqual(1);

    await u.regbtn.click();
    await expect(u.regbtn).toContainText('やめる');
    await expect(u.regsel).toBeVisible();
    await u.regbtn.click();
    await expect(u.regbtn).toContainText('範囲を選ぶ');
    await expect(u.regsel).toBeHidden();
  });

  test('Esc・枠の外を押す・8px 未満の範囲では、やめる（F25）', async ({ page }) => {
    const u = ui(page);
    const art = await box(u.article);
    // Esc
    await u.regbtn.click();
    await expect(u.regsel).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(u.regsel).toBeHidden();
    await expect(u.regbtn).toContainText('範囲を選ぶ');
    // 枠の外（左の一覧）を押す
    await u.regbtn.click();
    await expect(u.regsel).toBeVisible();
    await page.mouse.click(40, 300);
    await expect(u.regsel).toBeHidden();
    // 8px 未満
    await u.regbtn.click();
    await dragBox(page, { x: art.x + 60, y: art.y + 80 }, { x: art.x + 64, y: art.y + 84 });
    await expect(u.regsel).toBeHidden();
    await expect(u.composer).toHaveCount(0);
    await expect(u.toast).toContainText('範囲が小さすぎます');
  });

  test('画像の一部をドラッグ → 入力欄・アクセントの破線の枠・切り出しの画像が付く → 追加 → pull に region と画像が届く（F25・F22・F24）', async ({
    page,
    app,
  }) => {
    const u = ui(page);
    const img = await openPicDoc(page, app);
    const ib = await box(img);
    await u.regbtn.click();
    await dragBox(
      page,
      { x: ib.x + ib.width * 0.25, y: ib.y + ib.height * 0.25 },
      { x: ib.x + ib.width * 0.75, y: ib.y + ib.height * 0.75 },
    );

    await expect(u.composer).toBeVisible();
    await expect(u.regsel).toBeHidden();
    await expect(u.regbtn).toContainText('範囲を選ぶ');
    // 範囲の画像（PNG）が、自動で付く：左が赤・右が青（元の画像の、正しい位置から切り出している）
    const thumb = u.composer.locator('.thumb img');
    await expect(thumb).toHaveCount(1);
    await expect(thumb).toHaveJSProperty('complete', true);
    const [r1, g1, b1] = await thumbPixel(thumb, 0.1, 0.5);
    expect(r1).toBeGreaterThan(g1 + 80);
    const [r2, g2, b2] = await thumbPixel(thumb, 0.9, 0.5);
    expect(b2).toBeGreaterThan(r2 + 80);
    expect(b1).toBeLessThan(120);
    expect(g2).toBeLessThan(120);
    // 入力中の枠（アクセントの破線）と、左の余白の丸「新」。枠は、ブロック全体の破線を重ねない
    const rb = u.badges.locator('.regionbox.pending');
    await expect(rb).toBeVisible();
    const rbb = await box(rb);
    expect(Math.abs(rbb.x - (ib.x + ib.width * 0.25))).toBeLessThanOrEqual(3);
    expect(Math.abs(rbb.y - (ib.y + ib.height * 0.25))).toBeLessThanOrEqual(3);
    expect(Math.abs(rbb.width - ib.width * 0.5)).toBeLessThanOrEqual(3);
    expect(Math.abs(rbb.height - ib.height * 0.5)).toBeLessThanOrEqual(3);
    await expect(u.bno).toHaveText(['新']);
    await expect(u.article.locator('.blk-pending')).toHaveCount(0);
    const nb = await box(u.bno.first());
    expect(nb.x + nb.width).toBeLessThanOrEqual((await box(u.article)).x + 40); // 丸は、記事の左の余白

    await fillAndAdd(page, '赤と青の境目は？');
    await expect(u.threads.first().locator('.quote')).toContainText('赤と青');
    await expect(u.bno).toHaveText(['1']);
    const placed = u.badges.locator('.regionbox:not(.pending)');
    await expect(placed).toHaveCount(1);
    const pb = await box(placed);
    expect(Math.abs(pb.x - rbb.x)).toBeLessThanOrEqual(2);
    expect(Math.abs(pb.width - rbb.width)).toBeLessThanOrEqual(2);
    await expect(u.threads.first().locator('.msg.user img')).toHaveCount(1); // カードにも、画像が出る

    await submitAll(page);
    const r = await app.nextRound();
    const item = r.items[0];
    const region = item.anchor.region;
    expect(region.x).toBeCloseTo(0.25, 1);
    expect(region.y).toBeCloseTo(0.25, 1);
    expect(region.w).toBeCloseTo(0.5, 1);
    expect(region.h).toBeCloseTo(0.5, 1);
    expect(item.anchor.label).toContain('赤と青');
    const imgs: string[] = item.new[0].images;
    expect(imgs).toHaveLength(1);
    const size = pngSize(imgs[0]); // 元の解像度（400x240）の半分
    expect(Math.abs(size.w - 200)).toBeLessThanOrEqual(3);
    expect(Math.abs(size.h - 120)).toBeLessThanOrEqual(3);
  });

  test('1 つの画像に、範囲を 2 つ：それぞれにマウスを置くと、それぞれのカードが光る（F22(2)・F25）', async ({
    page,
    app,
  }) => {
    const u = ui(page);
    const img = await openPicDoc(page, app);
    const ib = await box(img);
    const pick = async (x0: number, y0: number, x1: number, y1: number, text: string) => {
      await u.regbtn.click();
      await dragBox(
        page,
        { x: ib.x + ib.width * x0, y: ib.y + ib.height * y0 },
        { x: ib.x + ib.width * x1, y: ib.y + ib.height * y1 },
      );
      await expect(u.composer).toBeVisible();
      await fillAndAdd(page, text);
    };
    await pick(0.05, 0.05, 0.3, 0.4, '左上の範囲');
    await pick(0.6, 0.6, 0.95, 0.95, '右下の範囲');
    await expect(u.bno).toHaveText(['1', '2']);
    await expect(u.badges.locator('.regionbox')).toHaveCount(2);
    await page.mouse.move(ib.x + ib.width * 0.15, ib.y + ib.height * 0.2);
    await expect(u.threads.filter({ hasText: '左上の範囲' })).toHaveClass(/linked/);
    await expect(u.threads.filter({ hasText: '右下の範囲' })).not.toHaveClass(/linked/);
    await page.mouse.move(ib.x + ib.width * 0.8, ib.y + ib.height * 0.8);
    await expect(u.threads.filter({ hasText: '右下の範囲' })).toHaveClass(/linked/);
    await expect(u.threads.filter({ hasText: '左上の範囲' })).not.toHaveClass(/linked/);
  });

  test('範囲の枠に重なる画像を押す：コメントは選ばず、拡大表示が開く（ドックに、2 件のコメント）。ホバーで光るのは、これまでどおり（0.29.0）', async ({
    page,
    app,
  }) => {
    const u = ui(page);
    const img = await openPicDoc(page, app);
    const ib = await box(img);
    for (const [x0, y0, x1, y1, text] of [
      [0.05, 0.05, 0.3, 0.4, '左上の範囲'],
      [0.6, 0.6, 0.95, 0.95, '右下の範囲'],
    ] as const) {
      await u.regbtn.click();
      await dragBox(
        page,
        { x: ib.x + ib.width * x0, y: ib.y + ib.height * y0 },
        { x: ib.x + ib.width * x1, y: ib.y + ib.height * y1 },
      );
      await expect(u.composer).toBeVisible();
      await fillAndAdd(page, text);
    }
    await expect(u.badges.locator('.regionbox')).toHaveCount(2);
    await page.mouse.move(ib.x + ib.width * 0.15, ib.y + ib.height * 0.2);
    await expect(u.threads.filter({ hasText: '左上の範囲' })).toHaveClass(/linked/);
    await page.mouse.click(ib.x + ib.width * 0.15, ib.y + ib.height * 0.2); // 枠の上
    await expect(u.lightbox).toBeVisible();
    await expect(u.lightbox.locator('.fv-dock .thread')).toHaveCount(2);
    await page.keyboard.press('Escape');
    await expect(u.lightbox).toBeHidden();
    await page.mouse.click(ib.x + ib.width * 0.45, ib.y + ib.height * 0.5); // 枠の外
    await expect(u.lightbox).toBeVisible();
    await page.keyboard.press('Escape');
    // 画像を含まない文は、これまでどおり、押しても拡大しない
    await page.locator('#article p', { hasText: '写真の下の段落' }).click();
    await expect(u.lightbox).toBeHidden();
  });

  test('文・ブロックにまたがる範囲：見た目を写した画像が付く（白紙でない）（F25）', async ({ page, app }) => {
    const u = ui(page);
    await openPicDoc(page, app);
    const p1 = await box(page.locator('#article p').first());
    const p2 = await box(page.locator('#article p').last());
    const art = await box(u.article);
    await u.regbtn.click();
    await dragBox(page, { x: art.x + 10, y: p1.y + 2 }, { x: art.x + 420, y: p2.y + p2.height - 2 });
    await expect(u.composer).toBeVisible();
    const thumb = u.composer.locator('.thumb img');
    await expect(thumb).toHaveCount(1);
    await expect(thumb).toHaveJSProperty('complete', true);
    // 文字・画像が写っている：白でない画素が、ある。赤い部分（写真の左）も写っている
    const stats = await thumb.evaluate((img: HTMLImageElement) => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const g = c.getContext('2d') as CanvasRenderingContext2D;
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let dark = 0;
      let red = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i] < 128 && d[i + 1] < 128 && d[i + 2] < 128) dark++;
        if (d[i] > 150 && d[i + 1] < 100 && d[i + 2] < 100) red++;
      }
      return { dark, red };
    });
    expect(stats.dark).toBeGreaterThan(100);
    expect(stats.red).toBeGreaterThan(500);
    await fillAndAdd(page, 'まとめて見たい');
    await expect(u.threads.first().locator('.quote')).toContainText('範囲');
    await submitAll(page);
    const r = await app.nextRound();
    const region = r.items[0].anchor.region;
    expect(region.w).toBeGreaterThan(0.5);
    expect(region.h).toBeGreaterThan(1);
    const size = pngSize(r.items[0].new[0].images[0]);
    expect(size.w).toBeGreaterThan(400);
  });

  test('入力中の枠は、ドラッグで動かし、角・辺で大きさを変えられる。離すと画像を作り直す（F31(1)）', async ({
    page,
    app,
  }) => {
    const u = ui(page);
    const img = await openPicDoc(page, app);
    const ib = await box(img);
    await u.regbtn.click();
    await dragBox(
      page,
      { x: ib.x + ib.width * 0.2, y: ib.y + ib.height * 0.2 },
      { x: ib.x + ib.width * 0.6, y: ib.y + ib.height * 0.6 },
    );
    await expect(u.composer).toBeVisible();
    await u.composer.locator('textarea').fill('書きかけの文');
    const thumb = u.composer.locator('.thumb img');
    await expect(thumb).toHaveCount(1);
    const rb = u.badges.locator('.regionbox.pending');
    await expect(rb.locator('.rh')).toHaveCount(8); // 角 4・辺 4
    await settled(page);
    const src0 = await thumb.getAttribute('src');
    const b0 = await box(rb);

    // 動かす：つかんでいる間は、枠を描き直さない（同じ要素のまま）
    const handle = await rb.elementHandle();
    await page.mouse.move(b0.x + b0.width / 2, b0.y + b0.height / 2);
    await page.mouse.down();
    await page.mouse.move(b0.x + b0.width / 2 + 20, b0.y + b0.height / 2 + 10, { steps: 5 });
    await page.mouse.move(b0.x + b0.width / 2 + 40, b0.y + b0.height / 2 + 20, { steps: 5 });
    expect(await handle?.evaluate((e) => e.isConnected)).toBe(true);
    await page.mouse.up();
    await expect.poll(async () => thumb.getAttribute('src')).not.toBe(src0); // 画像を作り直した
    await expect(thumb).toHaveCount(1); // 前の画像は外れ、新しい画像だけ
    await expect(u.composer.locator('textarea')).toHaveValue('書きかけの文'); // 書きかけの文字は残る
    await expect(rb.locator('.rh')).toHaveCount(8);
    await expect.poll(async () => Math.abs((await box(rb)).x - (b0.x + 40))).toBeLessThanOrEqual(3);
    const b1 = await box(rb);
    expect(Math.abs(b1.y - (b0.y + 20))).toBeLessThanOrEqual(3);
    expect(Math.abs(b1.width - b0.width)).toBeLessThanOrEqual(2);

    // 大きさを変える：右下の角
    const src1 = await thumb.getAttribute('src');
    const se = await box(u.badges.locator('.regionbox.pending .rh-se'));
    await page.mouse.move(se.x + se.width / 2, se.y + se.height / 2);
    await page.mouse.down();
    await page.mouse.move(se.x + se.width / 2 + 15, se.y + se.height / 2 + 10, { steps: 5 });
    await page.mouse.up();
    await expect.poll(async () => thumb.getAttribute('src')).not.toBe(src1);
    await expect(rb.locator('.rh')).toHaveCount(8);
    await expect.poll(async () => Math.abs((await box(rb)).width - (b1.width + 15))).toBeLessThanOrEqual(3);
    const b2 = await box(rb);
    expect(Math.abs(b2.width - (b1.width + 15))).toBeLessThanOrEqual(3);
    expect(Math.abs(b2.height - (b1.height + 10))).toBeLessThanOrEqual(3);
    expect(Math.abs(b2.x - b1.x)).toBeLessThanOrEqual(2);

    // 調整したあとの範囲で、送れる
    await u.composer.getByRole('button', { name: 'コメントを追加' }).click();
    await expect(u.composer).toHaveCount(0);
    await submitAll(page);
    const r = await app.nextRound();
    const region = r.items[0].anchor.region;
    expect(region.x).toBeCloseTo((b2.x - ib.x) / ib.width, 1);
    expect(region.w).toBeCloseTo(b2.width / ib.width, 1);
    expect(r.items[0].new[0].images).toHaveLength(1);
  });

  test('枠は、本文の外へは出ない・最小の大きさがある。Esc でつかむのをやめると、元に戻る（F31(1)）', async ({
    page,
    app,
  }) => {
    const u = ui(page);
    const img = await openPicDoc(page, app);
    const ib = await box(img);
    await u.regbtn.click();
    await dragBox(
      page,
      { x: ib.x + ib.width * 0.3, y: ib.y + ib.height * 0.3 },
      { x: ib.x + ib.width * 0.6, y: ib.y + ib.height * 0.6 },
    );
    await expect(u.composer.locator('.thumb img')).toHaveCount(1);
    await settled(page);
    const rb = u.badges.locator('.regionbox.pending');
    const b0 = await box(rb);
    const art = await box(u.article);

    // 右の辺を、反対側より左へ：最小（12px）で止まる
    const e = await box(rb.locator('.rh-e'));
    await page.mouse.move(e.x + e.width / 2, e.y + e.height / 2);
    await page.mouse.down();
    await page.mouse.move(b0.x - 100, e.y + e.height / 2, { steps: 6 });
    await page.mouse.up();
    await expect.poll(async () => (await box(rb)).width).toBeLessThan(14);
    expect((await box(rb)).width).toBeGreaterThanOrEqual(11);

    // 動かして本文の外（右）へ：本文の中で止まる
    const b1 = await box(rb);
    await page.mouse.move(b1.x + b1.width / 2, b1.y + b1.height / 2);
    await page.mouse.down();
    await page.mouse.move(art.x + art.width + 300, b1.y + b1.height / 2, { steps: 6 });
    await page.mouse.up();
    await expect
      .poll(async () => {
        const b = await box(rb);
        return b.x + b.width;
      })
      .toBeLessThanOrEqual(art.x + art.width + 1);

    // Esc で、つかむのをやめる：枠は、入力欄の対象の位置へ戻る
    const b2 = await box(rb);
    await page.mouse.move(b2.x + b2.width / 2, b2.y + b2.height / 2);
    await page.mouse.down();
    await page.mouse.move(b2.x + b2.width / 2 - 60, b2.y + b2.height / 2 + 30, { steps: 5 });
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await expect.poll(async () => Math.abs((await box(rb)).x - b2.x)).toBeLessThanOrEqual(2);
    // 入力欄は、開いたまま
    await expect(u.composer).toBeVisible();
  });

  test('「やめる」で、枠・「新」・自動で付いた画像が消える（F25・F29(3)）', async ({ page, app }) => {
    const u = ui(page);
    const img = await openPicDoc(page, app);
    const ib = await box(img);
    await u.regbtn.click();
    await dragBox(page, { x: ib.x + 30, y: ib.y + 30 }, { x: ib.x + 200, y: ib.y + 150 });
    await expect(u.composer.locator('.thumb img')).toHaveCount(1);
    await expect(u.badges.locator('.regionbox.pending')).toBeVisible();
    await u.composer.getByRole('button', { name: 'やめる' }).click();
    await expect(u.composer).toHaveCount(0);
    await expect(u.badges.locator('.regionbox')).toHaveCount(0);
    await expect(u.bno).toHaveCount(0);
    // もう一度選ぶと、前の画像は引き継がれない
    await u.regbtn.click();
    await dragBox(page, { x: ib.x + 30, y: ib.y + 30 }, { x: ib.x + 200, y: ib.y + 150 });
    await expect(u.composer.locator('.thumb img')).toHaveCount(1);
  });

  test('添付の画像を押すと、同じ拡大表示（ズーム・移動）で大きく出る。見るだけ（ドック・範囲を選ぶ道具なし）。Esc・×・背景で閉じる（F31(2)・C1）', async ({
    page,
    app,
  }) => {
    const u = ui(page);
    const img = await openPicDoc(page, app);
    const ib = await box(img);
    await u.regbtn.click();
    await dragBox(page, { x: ib.x + 30, y: ib.y + 30 }, { x: ib.x + 250, y: ib.y + 180 });
    const thumb = u.composer.locator('.thumb img');
    await expect(thumb).toHaveCount(1);
    await expect(u.lightbox).toBeHidden();
    // サムネイルの高さは 72px
    const tb = await box(thumb);
    expect(tb.height).toBeGreaterThanOrEqual(60);
    await thumb.click();
    await expect(u.lightbox).toBeVisible();
    await expect(u.lightbox).toHaveAttribute('role', 'dialog');
    await expect(u.lightbox).toHaveAttribute('aria-label', '添付の画像（大きく）');
    const stageImg = u.lightbox.locator('.lb-stage img');
    await expect(stageImg).toBeVisible();
    await expect.poll(async () => (await box(stageImg)).height).toBeGreaterThan(tb.height * 1.5);
    // 本文の画像と同じ、拡大表示の道具：ズームイン・全体に合わせる・100%・×。見るだけ：ドックも、範囲・要素を選ぶ道具も、ない
    await expect(u.lightbox.getByRole('toolbar', { name: '拡大表示の操作' })).toBeVisible();
    await expect(u.lightbox.getByRole('button', { name: 'ズームイン' })).toBeVisible();
    await expect(u.lightbox.getByRole('button', { name: '全体に合わせる' })).toBeVisible();
    await expect(u.lightbox.locator('.fv-dock')).toHaveCount(0);
    await expect(u.lightbox.locator('.fv-tools')).toHaveCount(0);
    await expect(u.lightbox.locator('[data-tool="region"], [data-pick]')).toHaveCount(0);
    // ズームできる（ズームイン → 倍率が上がる）
    const pct = u.lightbox.locator('.lb-pct');
    const before = Number.parseInt((await pct.textContent()) ?? '0', 10);
    await u.lightbox.getByRole('button', { name: 'ズームイン' }).click();
    await expect.poll(async () => Number.parseInt((await pct.textContent()) ?? '0', 10)).toBeGreaterThan(before);
    // 画像の上を押しても、閉じない（旧：押すと閉じる）
    const sb = await box(stageImg);
    await page.mouse.click(sb.x + sb.width / 2, sb.y + sb.height / 2);
    await expect(u.lightbox).toBeVisible();
    const pages = page.context().pages().length;
    await page.keyboard.press('Escape');
    await expect(u.lightbox).toBeHidden();
    await expect(u.composer).toBeVisible(); // Esc で、入力欄までは閉じない
    // ×
    await thumb.click();
    await expect(u.lightbox).toBeVisible();
    await u.lightbox.getByRole('button', { name: '閉じる' }).click();
    await expect(u.lightbox).toBeHidden();
    // 背景（画像の外）
    await thumb.click();
    await expect(u.lightbox).toBeVisible();
    await u.lightbox.click({ position: { x: 8, y: 300 } });
    await expect(u.lightbox).toBeHidden();
    expect(page.context().pages().length).toBe(pages); // 別のタブは、開かない
  });
});

// html-app の枠は、別オリジンの隔離した iframe：範囲の画像の複製の中では、読み込まれず、空になる（地の色だけが写って、1 色になる）。
// 枠が答えないとき（時間切れ・不正）は、「実行できる枠（画像にできません）」の箱で表す（画面で見えている位置・大きさ）。枠が答えれば、枠自身が作った画像（F42）
test.describe('範囲の画像：html-app の枠', () => {
  const BT = '```';
  // F42：枠は、通常、自分の見た目を画像にして答える（htmlapp-writeback.spec.ts）。ここは、**答えない枠**（snapshot-req で、3.5 秒、固まる）：2 秒で、0.22.1 の「箱」に戻ることを確かめる
  const DOC_APP = `# 枠のある資料\n\n前の段落です。\n\n${BT}html-app height=200\n<p>枠の中の文字</p><button>押す</button>\n<script>window.addEventListener('message', function (e) { if (e.data && e.data.type === 'snapshot-req') { var t = Date.now(); while (Date.now() - t < 3500) {} } });</script>\n${BT}\n\n後の段落です。\n`;

  // 画像（サムネイル）の統計：いちばん多い色の割合・その色と違う画素の数・文字の色（地と、はっきり違う）の画素の数
  const stats = (thumb: Locator) =>
    thumb.evaluate((img: HTMLImageElement) => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const g = c.getContext('2d') as CanvasRenderingContext2D;
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      const count = new Map<number, number>();
      for (let i = 0; i < d.length; i += 4) {
        const k = ((d[i] as number) << 16) | ((d[i + 1] as number) << 8) | (d[i + 2] as number);
        count.set(k, (count.get(k) ?? 0) + 1);
      }
      const [top, n] = [...count.entries()].sort((a, b) => b[1] - a[1])[0] as [number, number];
      const lum = (k: number) => 0.2126 * ((k >> 16) & 255) + 0.7152 * ((k >> 8) & 255) + 0.0722 * (k & 255);
      let strong = 0; // いちばん多い色（地）と、明るさが 80 以上違う画素（箱の文字・点線）
      for (const [k, v] of count) if (Math.abs(lum(k) - lum(top)) >= 80) strong += v;
      return { total: c.width * c.height, topShare: n / (c.width * c.height), distinct: count.size, strong };
    });

  async function selectFrameRange(page: Page, width?: string) {
    const u = ui(page);
    if (width) await page.locator('#article .htmlapp .cap').first().locator(`button[data-width="${width}"]`).click();
    await page.waitForTimeout(1500); // 自動の高さの枠が、落ち着くまで
    await page.addStyleTag({ content: '#toast { visibility: hidden !important; }' });
    const f = page.locator('#article iframe.appframe').first();
    await f.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    const b = await box(f);
    const art = await box(u.article);
    await u.regbtn.click();
    // 枠の全体を含み、少し外（前後の段落）まで
    await dragBox(page, { x: art.x + 8, y: b.y - 6 }, { x: art.x + art.width - 8, y: b.y + b.height + 6 });
    await expect(u.composer).toBeVisible();
    const thumb = u.composer.locator('.thumb img');
    await expect(thumb).toHaveCount(1);
    await expect(thumb).toHaveJSProperty('complete', true);
    return thumb;
  }

  for (const scheme of ['light', 'dark'] as const) {
    test(`枠を含む範囲（${scheme}）：添付の画像が、1 色ではなく、「実行できる枠」の箱（文字・点線）が写っている`, async ({
      page,
      app,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await app.switchTopic(page, `fr-${scheme}`, '枠のある資料', DOC_APP);
      const thumb = await selectFrameRange(page);
      const st = await stats(thumb);
      // 1 色（枠が写らず、地の色だけ）ではない：地の色が、画像の大半でも、箱の文字・点線が、はっきりある
      expect(st.distinct, '色の数').toBeGreaterThan(10);
      expect(st.strong, '地と、はっきり違う画素（箱の文字・点線・段落の文字）').toBeGreaterThan(300);
      // 箱は、枠の位置・大きさ（枠は、本文の幅 × 200px）：箱の背景が、広い面積で、地と少し違う色になる
      expect(st.topShare).toBeLessThan(0.9);
    });
  }

  test('縮小表示（1280）の枠を含む範囲：箱は、画面で見えているとおりの位置・大きさ（縮小後）で写る', async ({
    page,
    app,
  }) => {
    await app.switchTopic(page, 'fr-scale', '枠のある資料', DOC_APP);
    const thumb = await selectFrameRange(page, '1280');
    const st = await stats(thumb);
    expect(st.distinct).toBeGreaterThan(10);
    expect(st.strong).toBeGreaterThan(300);
    expect(st.topShare).toBeLessThan(0.9);
    // 箱の位置：画像の中で、枠の縦の範囲（縮小後の高さ）に、箱の背景（地と違う色）の行がある
    const rows = await thumb.evaluate((img: HTMLImageElement) => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const g = c.getContext('2d') as CanvasRenderingContext2D;
      g.drawImage(img, 0, 0);
      const x = Math.floor(c.width * 0.9); // 右の方：文字のない所
      const d = g.getImageData(x, 0, 1, c.height).data;
      const first = (i: number) => `${d[i * 4]},${d[i * 4 + 1]},${d[i * 4 + 2]}`;
      const paper = first(0);
      let a = -1;
      let b = -1;
      for (let y = 0; y < c.height; y++)
        if (first(y) !== paper) {
          if (a < 0) a = y;
          b = y;
        }
      return { a, b, h: c.height };
    });
    expect(rows.a).toBeGreaterThan(0); // 前の段落の分、下にずれている
    expect(rows.b).toBeLessThan(rows.h - 1); // 後の段落の分、手前で終わる
    expect(rows.b - rows.a).toBeGreaterThan(40);
  });
});
