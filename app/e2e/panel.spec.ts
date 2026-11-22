// 右のパネル（F14・F24・F29・F30・F33）：長い会話の折りたたみ・タブ（進行中・解決済み・すべて）・解決済みの 1 行・パネルの固定・画像の添付
import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, type RikaiApp, test } from './fixtures';
import { makePng } from './samples';
import { addTextComment, fillAndAdd, openComposerOnText, submitAll, ui } from './ui';

// 返信を 1 往復：ユーザーが返信して送り、AI が返信する（コマンドで）
async function replyCycle(page: Page, app: RikaiApp, userText: string, aiText: string) {
  const u = ui(page);
  const card = u.threads.first();
  await card.locator('textarea').last().fill(userText);
  await card.getByRole('button', { name: '返信を追加' }).click();
  await expect(card).toContainText(userText);
  await submitAll(page);
  const r = await app.nextRound();
  await app.apply({ round: r.round, replies: [{ thread: r.items[0].thread, body: aiText }] });
  await expect(card).toContainText(aiText);
  await card.locator('.th-head').click(); // 見た（「まだ見ていない AI の返信」ではなくなる）
}

test.describe('長い会話の折りたたみ（F29）', () => {
  test('古いやり取りを「これまでのやり取り（N 件）」にたたむ。押すと開き、描き直しても開いたまま。1 枚だけ見るときは、たたまない', async ({
    page,
    app,
  }) => {
    const u = ui(page);
    const card = u.threads.first();
    const older = card.locator('details.older, .older');
    await addTextComment(page, '猫は朝によく鳴きます', '一番目のコメント');
    await submitAll(page);
    const r = await app.nextRound();
    const tid: string = r.items[0].thread;
    await app.apply({ round: r.round, replies: [{ thread: tid, body: 'AI の一番目の返信' }] });
    await expect(card).toContainText('AI の一番目の返信');
    await card.locator('.th-head').click();
    await expect(older).toHaveCount(0); // 2 件：たたまない

    await replyCycle(page, app, '二番目の発言', 'AI の二番目の返信'); // 4 件：古い 2 件をたたむ
    await expect(older).toHaveCount(1);
    await expect(older.locator('summary')).toHaveText('これまでのやり取り（2 件）');

    await replyCycle(page, app, '三番目の発言', 'AI の三番目の返信'); // 6 件：古い 4 件
    await expect(older).toHaveCount(1);
    await expect(older.locator('summary')).toHaveText('これまでのやり取り（4 件）');
    // たたまない：最新の発言（ユーザー・AI）
    await expect(card.locator('.msg').filter({ hasText: '三番目の発言' })).toBeVisible();
    await expect(card.locator('.msg').filter({ hasText: 'AI の三番目の返信' })).toBeVisible();
    await expect(card.locator('.msg').filter({ hasText: '二番目の発言' })).toBeHidden();
    await expect(card.locator('.msg').filter({ hasText: '一番目のコメント' })).toBeHidden();

    // 押すと開く
    await older.locator('summary').click();
    await expect(card.locator('.msg').filter({ hasText: '一番目のコメント' })).toBeVisible();
    await expect(older.locator('.msg')).toHaveCount(4);
    // 描き直し（タブの切り替え）でも、開いたまま
    await page.locator('.tab', { hasText: 'すべて' }).click();
    await page.locator('.tab', { hasText: '進行中' }).click();
    await expect(card.locator('.msg').filter({ hasText: '一番目のコメント' })).toBeVisible();
    await older.locator('summary').click(); // 閉じる
    await expect(card.locator('.msg').filter({ hasText: '一番目のコメント' })).toBeHidden();

    // 未送信の発言は、たたまない。その分、たたむ範囲は広がる
    await card.locator('textarea').last().fill('四番目（未送信）の発言');
    await card.getByRole('button', { name: '返信を追加' }).click();
    await expect(card.locator('.msg').filter({ hasText: '四番目（未送信）の発言' })).toBeVisible();
    await expect(older.locator('summary')).toHaveText('これまでのやり取り（5 件）');

    // 番号を押して、そのカードだけを見る：古いやり取りも、たたまない
    await u.bno.first().click();
    await expect(page.locator('.solobar')).toBeVisible();
    await expect(older).toHaveCount(0);
    await expect(card.locator('.msg')).toHaveCount(7);
  });
});

test.describe('タブと解決済みの 1 行（F33）', () => {
  // AI 起点のスレッドを 3 つ（本文の 3 か所）。1 番目を解決する
  async function seed(page: Page, app: RikaiApp) {
    await app.apply({
      threads: [
        { page: 'root', anchor: { quote: '猫は朝によく鳴きます' }, body: '朝についての確認です。' },
        { page: 'root', anchor: { quote: '水もたくさん飲みます' }, body: '水についての確認です。' },
        { page: 'root', anchor: { quote: '日向でよく丸くなります' }, body: '日向についての確認です。' },
      ],
    });
    await expect(ui(page).threads).toHaveCount(3);
  }
  const tab = (page: Page, n: string) => page.locator('.tab', { hasText: n });

  test('進行中・解決済み・すべて：それぞれの数と、表示するもの（既定は進行中）', async ({ page, app }) => {
    const u = ui(page);
    await seed(page, app);
    await expect(tab(page, '進行中')).toHaveAttribute('aria-selected', 'true');
    await expect(tab(page, '進行中')).toHaveText('進行中3');
    await u.threads.filter({ hasText: '朝についての確認' }).getByRole('button', { name: '理解できた（解決）' }).click();
    await expect(tab(page, '進行中')).toHaveText('進行中2');
    await expect(tab(page, '解決済み')).toHaveText('解決済み1');
    await expect(tab(page, 'すべて')).toHaveText('すべて3');

    // 進行中：解決済みは、出ない
    await expect(u.threads).toHaveCount(2);
    await expect(page.locator('.donerow')).toHaveCount(0);
    // 解決済み：1 行だけ
    await tab(page, '解決済み').click();
    await expect(tab(page, '解決済み')).toHaveAttribute('aria-selected', 'true');
    await expect(u.threads).toHaveCount(0);
    await expect(page.locator('.donerow')).toHaveCount(1);
    // すべて：両方
    await tab(page, 'すべて').click();
    await expect(u.threads).toHaveCount(2);
    await expect(page.locator('.donerow')).toHaveCount(1);
    // 解決済みの丸は、番号が残り、色が変わる
    await expect(u.bno).toHaveText(['1', '2', '3']);
  });

  test('解決済みの 1 行：番号・対象のはじめ・最後の発言のはじめ。押すとカードが開き、「一覧の 1 行に戻す」で戻る（F33(2)）', async ({
    page,
    app,
  }) => {
    const u = ui(page);
    await seed(page, app);
    await u.threads.filter({ hasText: '朝についての確認' }).getByRole('button', { name: '理解できた（解決）' }).click();
    await tab(page, '解決済み').click();
    const row = page.locator('.donerow');
    await expect(row).toContainText('1');
    await expect(row).toContainText('猫は朝によく鳴きます');
    await expect(row).toContainText('AI：朝についての確認です。');
    await row.click();
    await expect(u.threads).toHaveCount(1);
    await expect(u.threads.first().getByRole('button', { name: '再開する' })).toBeVisible();
    await expect(page.getByRole('button', { name: '一覧の 1 行に戻す' })).toBeVisible();
    await page.getByRole('button', { name: '一覧の 1 行に戻す' }).click();
    await expect(u.threads).toHaveCount(0);
    await expect(row).toHaveCount(1);
  });

  test('本文の、解決済みの文の強調を押すと、一覧の中で、そのカードが開く（F33(2)）', async ({ page, app }) => {
    const u = ui(page);
    await seed(page, app);
    await u.threads.filter({ hasText: '朝についての確認' }).getByRole('button', { name: '理解できた（解決）' }).click();
    await expect(tab(page, '解決済み')).toHaveText('解決済み1');
    await expect(u.threads).toHaveCount(2); // 進行中
    await u.article.locator('mark', { hasText: '猫は朝によく鳴きます' }).click();
    await expect(tab(page, 'すべて')).toHaveAttribute('aria-selected', 'true'); // 進行中のままでは見えないので、すべてへ
    await expect(u.threads.filter({ hasText: '朝についての確認' })).toBeVisible();
  });

  test('入力欄は、解決済みのタブでも出る。追加すると、進行中へ戻る（F22(3)・F33）', async ({ page, app }) => {
    const u = ui(page);
    await seed(page, app);
    await u.threads.filter({ hasText: '朝についての確認' }).getByRole('button', { name: '理解できた（解決）' }).click();
    await tab(page, '解決済み').click();
    await openComposerOnText(page, 'ごはんを食べます');
    await expect(u.composer).toBeVisible();
    await expect(page.locator('.donerow')).toHaveCount(1);
    await fillAndAdd(page, '解決済みのタブから追加');
    await expect(tab(page, '進行中')).toHaveAttribute('aria-selected', 'true');
    await expect(u.threads.filter({ hasText: '解決済みのタブから追加' })).toBeVisible();
  });

  test('見出し・タブは、スクロールしても、パネルの上に固定される（F33(2)）', async ({ page, app }) => {
    const u = ui(page);
    const paras = Array.from({ length: 14 }, (_, i) => `第${i + 1}の段落です。`);
    await app.switchTopic(page, 'many', '長い資料', `# 長い資料\n\n${paras.join('\n\n')}\n`);
    await app.apply({
      threads: paras.map((p) => ({ page: 'root', anchor: { quote: p }, body: `${p}についての確認です。` })),
    });
    await expect(u.threads).toHaveCount(14);
    const head = u.panel.locator('.side-h').first();
    const tabs = tab(page, '進行中');
    const p0 = (await u.panel.boundingBox()) as { y: number; height: number };
    const h0 = (await head.boundingBox()) as { y: number };
    const t0 = (await tabs.boundingBox()) as { y: number };
    await page.mouse.move(1200, p0.y + 300);
    await page.mouse.wheel(0, 1500);
    await expect.poll(() => u.panel.evaluate((e) => e.scrollTop)).toBeGreaterThan(800);
    const h1 = (await head.boundingBox()) as { y: number };
    const t1 = (await tabs.boundingBox()) as { y: number };
    expect(Math.abs(h1.y - h0.y)).toBeLessThanOrEqual(2); // 見出しも
    expect(Math.abs(t1.y - t0.y)).toBeLessThanOrEqual(2); // タブも、上端のまま
    expect(t1.y).toBeLessThan(p0.y + 120);
    // 1 枚だけ見る帯も、同じ
    await u.bno.nth(13).click();
    await expect(page.locator('.solobar')).toBeVisible();
    const s = (await page.locator('.solobar').boundingBox()) as { y: number };
    expect(s.y).toBeLessThan(p0.y + 120);
  });
});

test.describe('画像の添付（F24）', () => {
  const png = (w: number, h: number, name = 'a.png') => ({ name, mimeType: 'image/png', buffer: makePng(w, h) });

  async function composer(page: Page) {
    await openComposerOnText(page, '猫は朝によく鳴きます');
    return ui(page).composer;
  }
  // 「画像を付ける」を、本物のマウスで押し、ファイル選択で渡す
  async function pickFiles(
    page: Page,
    scope: ReturnType<Page['locator']>,
    files: Array<{ name: string; mimeType: string; buffer: Buffer }>,
  ) {
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      scope.getByRole('button', { name: '画像を付ける' }).click(),
    ]);
    await chooser.setFiles(files);
  }

  test('ファイル選択で付く・サムネイル・「×」で外せる。同じ画像は 1 つ（F24）', async ({ page }) => {
    const c = await composer(page);
    await expect(c.getByRole('button', { name: '画像を付ける' })).toBeVisible();
    await pickFiles(page, c, [png(40, 30)]);
    const thumb = c.locator('.thumb img');
    await expect(thumb).toHaveCount(1);
    await expect(thumb).toHaveAttribute('src', /\/asset\/demo\/c-[0-9a-f]{16}\.png$/);
    await expect(thumb).toHaveJSProperty('complete', true);
    expect(await thumb.evaluate((e: HTMLImageElement) => e.naturalWidth)).toBe(40);
    await pickFiles(page, c, [png(40, 30)]); // 同じ画像
    await expect(thumb).toHaveCount(1);
    await pickFiles(page, c, [png(50, 30, 'b.png')]);
    await expect(thumb).toHaveCount(2);
    await c.locator('.thumb .x').first().click();
    await expect(thumb).toHaveCount(1);
  });

  test('貼り付け・ドラッグ＆ドロップで付く（F24）', async ({ page }) => {
    const c = await composer(page);
    const b64 = makePng(30, 30).toString('base64');
    const make = (name: string) =>
      `new File([Uint8Array.from(atob('${b64}'), (ch) => ch.charCodeAt(0))], '${name}', { type: 'image/png' })`;
    // 貼り付け（クリップボードに、画像だけがある）
    await c.locator('textarea').evaluate((ta, mk) => {
      const dt = new DataTransfer();
      dt.items.add(new Function(`return ${mk}`)());
      ta.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, make('paste.png'));
    await expect(c.locator('.thumb img')).toHaveCount(1);
    // ドロップ（別の画像）
    const b64b = makePng(31, 31).toString('base64');
    await c.locator('textarea').evaluate((ta, data) => {
      const dt = new DataTransfer();
      dt.items.add(
        new File([Uint8Array.from(atob(data), (ch) => ch.charCodeAt(0))], 'drop.png', { type: 'image/png' }),
      );
      ta.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    }, b64b);
    await expect(c.locator('.thumb img')).toHaveCount(2);
  });

  test('形式・大きさ・枚数のエラー：画像は付かず、メッセージが出る（F24）', async ({ page }) => {
    const u = ui(page);
    // 1 つずつ、新しい入力欄・新しいメッセージで確かめる（前のメッセージと、区別するため）
    const attempt = async (files: Array<{ name: string; mimeType: string; buffer: Buffer }>) => {
      await page.reload();
      await u.article.locator('.blk').first().waitFor();
      const c = await composer(page);
      await pickFiles(page, c, files);
      return c.locator('.thumb img');
    };
    // 画像でない（申告が text/plain）
    let thumbs = await attempt([{ name: 'a.txt', mimeType: 'text/plain', buffer: Buffer.from('ただの文字') }]);
    await expect(u.toast).toContainText('png・jpeg・gif・webp だけ');
    await expect(thumbs).toHaveCount(0);
    // 申告は PNG でも、中身が違う（先頭のバイトで見分ける）
    thumbs = await attempt([
      { name: 'fake.png', mimeType: 'image/png', buffer: Buffer.from('これは画像ではありません') },
    ]);
    await expect(u.toast).toContainText('png・jpeg・gif・webp だけ');
    await expect(thumbs).toHaveCount(0);
    // SVG は受けない（スクリプトを持てる）
    thumbs = await attempt([
      {
        name: 'a.svg',
        mimeType: 'image/svg+xml',
        buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
      },
    ]);
    await expect(u.toast).toContainText('png・jpeg・gif・webp だけ');
    await expect(thumbs).toHaveCount(0);
    // 5MB を超える
    const big = Buffer.concat([makePng(10, 10), Buffer.alloc(5.2 * 1024 * 1024)]);
    thumbs = await attempt([{ name: 'big.png', mimeType: 'image/png', buffer: big }]);
    await expect(u.toast).toContainText('5MB まで');
    await expect(thumbs).toHaveCount(0);
    // 5 枚目は付かない（4 枚まで）
    thumbs = await attempt([
      png(20, 20, '1.png'),
      png(21, 20, '2.png'),
      png(22, 20, '3.png'),
      png(23, 20, '4.png'),
      png(24, 20, '5.png'),
    ]);
    await expect(u.toast).toContainText('4 枚まで');
    await expect(thumbs).toHaveCount(4);
  });

  test('文字なしで、画像だけでも送れる。pull に、画像のファイルの絶対パスが届き、カードの画像を押すと大きく出る（F24・F31(2)）', async ({
    page,
    app,
  }) => {
    const u = ui(page);
    const c = await composer(page);
    // 文字も画像もなければ、追加できない
    await c.getByRole('button', { name: 'コメントを追加' }).click();
    await expect(c).toBeVisible();
    await pickFiles(page, c, [png(60, 40)]);
    await expect(c.locator('.thumb img')).toHaveCount(1);
    await c.getByRole('button', { name: 'コメントを追加' }).click();
    await expect(u.composer).toHaveCount(0);
    const card = u.threads.first();
    await expect(card.locator('.msg.user img')).toHaveCount(1);
    await submitAll(page);
    const r = await app.nextRound();
    const images: string[] = r.items[0].new[0].images;
    expect(images).toHaveLength(1);
    expect(path.isAbsolute(images[0])).toBe(true);
    expect(path.basename(images[0])).toMatch(/^c-[0-9a-f]{16}\.png$/);
    expect(fs.readFileSync(images[0]).subarray(1, 4).toString()).toBe('PNG');
    expect(r.items[0].new[0].text ?? '').toBe('');
    // 送ったあと：カードの中の画像を押すと、画面の中に大きく出る
    await card.locator('.msg.user img').click();
    await expect(u.lightbox).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(u.lightbox).toBeHidden();
  });

  test('返信の入力欄にも、画像を付けられる。返信の history にも、画像が残る（F24）', async ({ page, app }) => {
    const u = ui(page);
    await app.apply({ threads: [{ page: 'root', body: '確認です。' }] });
    const card = u.threads.first();
    await pickFiles(page, card, [png(60, 40)]);
    await expect(card.locator('.th-foot .thumb img')).toHaveCount(1);
    await card.locator('textarea').fill('画像つきの返信');
    await card.getByRole('button', { name: '返信を追加' }).click();
    await expect(card.locator('.msg.user img')).toHaveCount(1);
    await expect(card.locator('.th-foot .thumb img')).toHaveCount(0); // 入力欄は空に戻る
    await submitAll(page);
    const r = await app.nextRound();
    expect(r.items[0].new[0].kind).toBe('followup');
    expect(r.items[0].new[0].images).toHaveLength(1);
    await app.apply({ round: r.round, replies: [{ thread: r.items[0].thread, body: '見ました。' }] });
  });

  test('⌘/Ctrl＋Enter でコメントを追加できる（F5）', async ({ page }) => {
    const u = ui(page);
    const c = await composer(page);
    await c.locator('textarea').fill('キーボードで追加');
    await c.locator('textarea').press('Control+Enter');
    await expect(u.composer).toHaveCount(0);
    await expect(u.threads.first()).toContainText('キーボードで追加');
  });
});
