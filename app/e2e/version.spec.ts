// バージョンの表示（0.1.2）：左の一覧の下端に「v0.1.2」（title は「rikai v0.1.2」）・上のバーのロゴの title・終了したトピック（閲覧専用）の左の一覧。
// 左の一覧は、1100px 以下では、自動で隠れる（☰ のドロワー）：そこでも、確かめられる。上のバー（#top）・本文の上のバー・横スクロールを、増やさない。実際の Chrome。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { box, ui } from './ui';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const VERSION = (JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string }).version;

/** はみ出し：窓より広い・上のバーの中身が、バーより広い */
const overflow = (page: Page) =>
  page.evaluate(() => {
    const top = document.querySelector('#top') as HTMLElement;
    const side = document.querySelector('#side') as HTMLElement;
    return {
      page: document.documentElement.scrollWidth - window.innerWidth,
      top: top.scrollWidth - top.clientWidth,
      side: side.scrollWidth - side.clientWidth,
      topH: top.getBoundingClientRect().height,
    };
  });

test.describe('バージョンの表示', () => {
  test('広い窓：左の一覧の下端に、小さく「v<package.json の version>」（コピーできる文字・title は「rikai v…」）。上のバーのロゴの title も同じ', async ({
    page,
  }) => {
    const u = ui(page);
    const ver = u.side.locator('.side-ver');
    await expect(ver).toBeVisible();
    await expect(ver).toHaveText(`v${VERSION}`);
    await expect(ver).toHaveAttribute('title', `rikai v${VERSION}`);
    expect(await ver.evaluate((e) => e.childElementCount)).toBe(0); // 文字そのもの（textContent）
    expect(await ver.evaluate((e) => getComputedStyle(e).userSelect)).toBe('text');
    expect(await ver.evaluate((e) => Number.parseFloat(getComputedStyle(e).fontSize))).toBeLessThanOrEqual(12);
    // 一覧の下端：一覧の内側・ページの木より下
    const side = await box(u.side);
    const v = await box(ver);
    expect(v.y + v.height).toBeLessThanOrEqual(side.y + side.height);
    expect(v.y).toBeGreaterThan(side.y + side.height - 80);
    expect(v.y).toBeGreaterThan((await box(u.side.locator('.tree').last())).y);
    // 上のバーは、増えない：ロゴの title だけ
    await expect(u.top.locator('.brand')).toHaveAttribute('title', `rikai v${VERSION}`);
    await expect(u.top.locator('.brand')).toHaveText('rikai');
    await expect(u.top).not.toContainText(VERSION);
    expect(await overflow(page)).toEqual({ page: 0, top: 0, side: 0, topH: 44 });
  });

  test('窓 1360・1101・1100・901・900・560・420・360：はみ出さない（窓・上のバー・左の一覧）。1100 以下は、☰ のドロワーで、版が見える', async ({
    page,
  }) => {
    const u = ui(page);
    const ver = u.side.locator('.side-ver');
    for (const w of [1360, 1101, 1100, 901, 900, 560, 420, 360]) {
      await page.setViewportSize({ width: w, height: 800 });
      const auto = w <= 1100; // 自動で隠れる窓
      if (auto) {
        await expect(ver, `${w}px：一覧は、しまわれている`).toBeHidden();
        await page.locator('#btn-side').click();
      }
      await expect(ver, `${w}px`).toBeVisible();
      await expect(ver).toHaveText(`v${VERSION}`);
      const v = await box(ver);
      expect(v.x, `${w}px：窓の中`).toBeGreaterThanOrEqual(0);
      expect(v.x + v.width, `${w}px：窓の中`).toBeLessThanOrEqual(w);
      expect(await overflow(page), `${w}px`).toEqual({ page: 0, top: 0, side: 0, topH: 44 });
      if (auto) {
        await page.locator('#btn-side').click();
        await expect(ver).toBeHidden();
      }
    }
  });

  test('一覧が長いとき（トピックが多い・窓が低い）：一覧の中で、いちばん下までスクロールすると、最後の行の下に、版が出る（重ならない）', async ({
    page,
    app,
  }) => {
    const u = ui(page);
    for (let i = 0; i < 14; i++) await app.addTopic(`t${i}`, `資料 ${i}`, `# 資料 ${i}\n\n本文\n`);
    await page.setViewportSize({ width: 1360, height: 480 });
    await expect(u.side.locator('.topics li')).toHaveCount(15);
    await u.side.evaluate((e) => {
      e.scrollTop = e.scrollHeight;
    });
    const ver = u.side.locator('.side-ver');
    await expect(ver).toBeVisible();
    const v = await box(ver);
    const lastTopic = await box(u.side.locator('.topics li').last());
    const lastTree = await box(u.side.locator('.tree a').last());
    expect(v.y).toBeGreaterThanOrEqual(lastTopic.y + lastTopic.height);
    expect(v.y).toBeGreaterThanOrEqual(lastTree.y + lastTree.height);
    const side = await box(u.side);
    expect(v.y + v.height).toBeLessThanOrEqual(side.y + side.height);
    expect(await overflow(page)).toEqual({ page: 0, top: 0, side: 0, topH: 44 });
  });

  test('空の画面（トピックが 1 つもない。本文は空）：左の一覧に、版が出る', async ({ page, app }) => {
    const u = ui(page);
    fs.rmSync(path.join(app.root, '.rikai', 'demo'), { recursive: true, force: true });
    await page.evaluate(() => {
      location.hash = '#/';
    });
    await page.reload();
    await expect(u.side.locator('.topics li')).toHaveCount(0);
    await expect(page.locator('#article')).not.toContainText('猫'); // 本文は、空
    await expect(u.side.locator('.side-ver')).toHaveText(`v${VERSION}`);
    await expect(u.side.locator('.side-ver')).toBeVisible();
  });

  test('終了したトピック（閲覧専用）でも、版は、左の一覧の下端と、ロゴの title に出る（旧：全面の終了画面の左下。0.1.4 で、全面の画面は、なくなった）', async ({
    page,
  }) => {
    const u = ui(page);
    await u.end.click();
    await u.enddlg.getByRole('button', { name: '終了する' }).click();
    await expect(u.closedbar).toBeVisible();
    await expect(page.locator('#ended')).toHaveCount(0);
    await expect(u.side.locator('.side-ver')).toHaveText(`v${VERSION}`);
    await expect(u.side.locator('.side-ver')).toBeVisible();
    await expect(page.locator('#top .brand')).toHaveAttribute('title', `rikai v${VERSION}`);
  });
});
