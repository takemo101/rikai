// 範囲の枠：画面の下の遅延読み込みの画像（読み込み前は、高さがない）。読み込み後に、画像の枠に重なる
import type { Page } from '@playwright/test';
import { expect, type RikaiApp, test } from './fixtures';
import { makePng } from './samples';
import { ui } from './ui';

const RECT = { x: 0.25, y: 0.2, w: 0.25, h: 0.3 };
const paras = Array.from({ length: 40 }, (_, i) => `第${i + 1}段落の長めの文章です。画像より上に、高さを作ります。`);
const DOC = `# 遅延する画像\n\n${paras.join('\n\n')}\n\n## 1. 画像\n\n![図](assets/big.png)\n\n後の段落です。\n`;

async function postRegion(page: Page, app: RikaiApp, text: string) {
  const info = await page.evaluate(() => {
    const b = document.querySelector('#article .blk:has(img)') as HTMLElement;
    return { id: b.dataset.bid, hash: b.dataset.bhash };
  });
  const r = await page.request.post(`${app.origin}/api/comment`, {
    headers: { Origin: app.origin },
    data: {
      topic: 'lazy',
      page: 'root',
      version: 1,
      anchor: {
        blockId: info.id,
        blockHash: info.hash,
        blockTag: 'P',
        blockText: '図',
        quote: '',
        prefix: '',
        suffix: '',
        label: '範囲：画像',
        rect: RECT,
      },
      text,
      images: [],
    },
  });
  expect(r.status()).toBe(200);
}

// 枠と画像の、ビューポートでの矩形
const measure = (page: Page) =>
  page.evaluate(() => {
    const img = document.querySelector('#article img') as HTMLImageElement;
    const ir = img.getBoundingClientRect();
    const rb = document.querySelector('#badges .regionbox') as HTMLElement | null;
    const br = rb?.getBoundingClientRect();
    return {
      complete: img.complete,
      nw: img.naturalWidth,
      img: { x: ir.x, y: ir.y, w: ir.width, h: ir.height },
      box: br ? { x: br.x, y: br.y, w: br.width, h: br.height } : null,
    };
  });

test.describe('範囲の枠：遅延読み込みの画像', () => {
  test('画面の下・読み込みが遅い画像：読み込み後に、枠が、画像の比率の位置に重なる（読み込み前の寸法のまま、残らない）', async ({
    page,
    app,
  }) => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    await page.route('**/asset/lazy/big.png', async (route) => {
      await gate;
      await route.continue();
    });
    await app.addTopic('lazy', '遅延', DOC);
    app.writeAsset('big.png', makePng(600, 900), 'lazy');
    await app.open(page, '#/lazy/root');
    await expect(page.locator('#article img')).toHaveCount(1);
    await postRegion(page, app, '範囲 1');
    await expect(ui(page).threads).toHaveCount(1);
    // 画像まで、スクロールする（読み込み前：高さがない）
    await page.locator('#article img').evaluate((e) => e.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(500);
    const before = await measure(page);
    expect(before.complete).toBe(false);
    expect(before.box).toBeNull(); // 読み込み前は、枠を出さない（高さのない基準に、枠を重ねない）
    release();
    await expect.poll(async () => (await measure(page)).nw).toBeGreaterThan(0);
    await expect
      .poll(async () => {
        const m = await measure(page);
        if (!m.box || m.img.h < 100) return 'pending';
        const ex = {
          x: m.img.x + RECT.x * m.img.w,
          y: m.img.y + RECT.y * m.img.h,
          w: RECT.w * m.img.w,
          h: RECT.h * m.img.h,
        };
        const d = Math.max(
          Math.abs(m.box.x - ex.x),
          Math.abs(m.box.y - ex.y),
          Math.abs(m.box.w - ex.w),
          Math.abs(m.box.h - ex.h),
        );
        return d <= 2 ? 'ok' : `diff ${d.toFixed(1)} ${JSON.stringify(m)}`;
      })
      .toBe('ok');
  });
});
