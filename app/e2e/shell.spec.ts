// 画面の枠組み（F2・F15・F16・F21・F23・F34）：左の一覧の開閉・右の幅のドラッグと保存・複数トピックの切り替え・「終了」ダイアログ・サーバーが止まったときの表示
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { addTextComment, box, submitAll, ui } from './ui';

const uiState = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('rikai-ui') ?? '{}') as { sideOpen?: boolean; panelW?: number });

test.describe('画面の広さ（F23）', () => {
  test('「☰」で、左の一覧をしまう・出す。しまうと、本文の幅の上限が広がる。再読み込みしても残る（F23(1)(3)）', async ({
    page,
  }) => {
    const u = ui(page);
    await page.setViewportSize({ width: 1700, height: 900 });
    const btn = page.locator('#btn-side');
    await expect(btn).toHaveAttribute('aria-expanded', 'true');
    await expect(u.side).toBeVisible();
    const open = await box(u.article);
    expect(open.width).toBeLessThanOrEqual(762); // 本文の幅の上限は 760px

    await btn.click();
    await expect(btn).toHaveAttribute('aria-expanded', 'false');
    await expect.poll(async () => (await u.side.boundingBox())?.width ?? 0).toBeLessThan(5);
    await expect.poll(async () => (await box(u.article)).width).toBeGreaterThan(open.width + 100);
    expect((await box(u.article)).width).toBeLessThanOrEqual(922); // 920px まで
    expect((await uiState(page)).sideOpen).toBe(false);

    await page.reload();
    await u.article.locator('.blk').first().waitFor();
    await expect(btn).toHaveAttribute('aria-expanded', 'false');
    expect((await u.side.boundingBox())?.width ?? 0).toBeLessThan(5);

    await btn.click();
    await expect(btn).toHaveAttribute('aria-expanded', 'true');
    await expect(u.side).toBeVisible();
    expect((await uiState(page)).sideOpen).toBe(true);
  });

  test('右の幅：取っ手のドラッグ（左ボタンだけ）・矢印キー・ダブルクリックで変える。範囲は 280px〜。再読み込みしても残る（F23(2)(3)）', async ({
    page,
  }) => {
    const u = ui(page);
    const rz = page.locator('#panel-resizer');
    const width = async () => (await box(u.panel)).width;
    await expect(rz).toBeVisible();
    expect(Math.abs((await width()) - 380)).toBeLessThanOrEqual(1);

    // ドラッグ（本物のマウス）：左へ 100px → 480px
    const r = await box(rz);
    const cy = r.y + r.height / 2;
    await page.mouse.move(r.x + r.width / 2, cy);
    await page.mouse.down();
    await page.mouse.move(r.x + r.width / 2 - 50, cy, { steps: 5 });
    await page.mouse.move(r.x + r.width / 2 - 100, cy, { steps: 5 });
    await page.mouse.up();
    await expect.poll(width).toBeGreaterThan(477);
    expect(await width()).toBeLessThan(483);
    await expect(rz).toHaveAttribute('aria-valuemin', '280');
    expect(Number(await rz.getAttribute('aria-valuenow'))).toBe(Math.round(await width()));
    expect((await uiState(page)).panelW).toBe(Math.round(await width()));
    const saved = await width();

    // 再読み込みしても、残る
    await page.reload();
    await u.article.locator('.blk').first().waitFor();
    expect(Math.abs((await width()) - saved)).toBeLessThanOrEqual(1);

    // 右ボタンでは、変わらない
    const r2 = await box(rz);
    await page.mouse.move(r2.x + r2.width / 2, r2.y + 200);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(r2.x + r2.width / 2 - 120, r2.y + 200, { steps: 5 });
    await page.mouse.up({ button: 'right' });
    expect(Math.abs((await width()) - saved)).toBeLessThanOrEqual(1);

    // 矢印キー：左で広く（24px）・右で狭く
    await rz.focus();
    await page.keyboard.press('ArrowLeft');
    await expect.poll(width).toBeGreaterThan(saved + 22);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect.poll(width).toBeLessThan(saved - 22);

    // ダブルクリックで、もとの幅（380）
    await rz.dblclick();
    await expect.poll(width).toBeGreaterThan(378);
    expect(await width()).toBeLessThan(382);
    expect((await uiState(page)).panelW).toBe(380);
  });

  test('幅の範囲：最小は 280px。最大は、本文の領域が 360px 以上、残る幅まで（F23(2)）', async ({ page }) => {
    const u = ui(page);
    const rz = page.locator('#panel-resizer');
    const width = async () => (await box(u.panel)).width;
    const dragTo = async (x: number) => {
      const r = await box(rz);
      const cy = r.y + r.height / 2;
      await page.mouse.move(r.x + r.width / 2, cy);
      await page.mouse.down();
      await page.mouse.move(x, cy, { steps: 8 });
      await page.mouse.up();
    };
    await dragTo(1350); // 右の端まで
    await expect.poll(width).toBeLessThanOrEqual(281);
    expect(await width()).toBeGreaterThanOrEqual(279);
    await dragTo(5); // 左の端まで
    await expect.poll(width).toBeGreaterThan(700);
    const doc = await box(u.doc);
    expect(doc.width).toBeGreaterThanOrEqual(358);
    expect(doc.width).toBeLessThanOrEqual(364); // 左の一覧が開いているので、本文の領域は 360px まで
    expect(await width()).toBeLessThanOrEqual(0.7 * 1360 + 1);
  });

  test('窓が小さいとき、表示の幅だけ小さくなる。保存した幅は、書き換えない（F23(3)）', async ({ page }) => {
    const u = ui(page);
    const rz = page.locator('#panel-resizer');
    const r = await box(rz);
    await page.mouse.move(r.x + r.width / 2, r.y + 100);
    await page.mouse.down();
    await page.mouse.move(r.x + r.width / 2 - 220, r.y + 100, { steps: 6 });
    await page.mouse.up();
    await expect.poll(async () => (await uiState(page)).panelW).toBeGreaterThan(595);
    const saved = (await uiState(page)).panelW as number;
    await page.setViewportSize({ width: 900, height: 800 });
    await expect.poll(async () => (await box(u.panel)).width).toBeLessThan(saved - 50);
    expect((await uiState(page)).panelW).toBe(saved);
    await page.setViewportSize({ width: 1360, height: 900 });
    await expect.poll(async () => Math.round((await box(u.panel)).width)).toBe(saved);
  });
});

test.describe('複数のトピック（F15・F21）', () => {
  test('左の一覧で、トピックを切り替えられる。現在のトピックが強調される（F15）', async ({ page, app }) => {
    const u = ui(page);
    await app.addTopic('second', 'もう一つの資料', '# もう一つの資料\n\n二番目のトピックの本文です。\n');
    const items = u.side.locator('.topics li');
    await expect(items).toHaveCount(2);
    await expect(items.filter({ hasText: '猫の観察日記' })).toHaveClass(/cur/);
    await items.filter({ hasText: 'もう一つの資料' }).getByRole('link').click();
    await expect(u.top.locator('#top-title')).toHaveText('もう一つの資料');
    await expect(u.article).toContainText('二番目のトピックの本文です');
    await expect(items.filter({ hasText: 'もう一つの資料' })).toHaveClass(/cur/);
    await expect(items.filter({ hasText: '猫の観察日記' })).not.toHaveClass(/cur/);
    await page.goBack();
    await expect(u.top.locator('#top-title')).toHaveText('猫の観察日記');
    await expect(u.article).toContainText('猫は朝によく鳴きます');
  });

  test('Submit 済みで AI の返信待ちのトピックに「待ち」。解決の数が、左の一覧と上のバーに出る（F15・F21）', async ({
    page,
    app,
  }) => {
    const u = ui(page);
    await app.addTopic('second', 'もう一つの資料', '# もう一つの資料\n\n二番目のトピックの本文です。\n');
    const mine = u.side.locator('.topics li', { hasText: '猫の観察日記' });
    await expect(mine).toBeVisible();
    // スレッドがなければ、数は出ない
    await expect(mine).not.toContainText('0/0');
    await addTextComment(page, '猫は朝によく鳴きます', '待ちの確認');
    await expect(mine).toContainText('0/1');
    await expect(mine).not.toContainText('待ち');
    await submitAll(page);
    await expect(mine).toContainText('待ち');
    await expect(u.top).toContainText('AIの返信待ち');
    await expect(u.side.locator('.topics li', { hasText: 'もう一つの資料' })).not.toContainText('待ち');
    const r = await app.nextRound();
    await app.apply({ round: r.round, replies: [{ thread: r.items[0].thread, body: '返信です。' }] });
    await expect(mine).not.toContainText('待ち');
    await expect(u.top).not.toContainText('AIの返信待ち');
    await u.threads.first().getByRole('button', { name: '理解できた（解決）' }).click();
    await expect(mine).toContainText('1/1');
    await expect(u.top).toContainText('解決 1/1');
  });
});

test.describe('終了（F16・F34）', () => {
  // ブラウザの confirm・alert・prompt は、使わない（出たら、記録して、閉じる）
  const watchDialogs = (page: Page) => {
    const seen: string[] = [];
    page.on('dialog', (d) => {
      seen.push(d.type());
      void d.dismiss();
    });
    return seen;
  };

  test('「終了」→ 画面の中のダイアログ → キャンセルでは終わらない。「終了する」で終わり、poll が closed を返す（F16・F34）', async ({
    page,
    app,
  }) => {
    const u = ui(page);
    const native = watchDialogs(page);
    await app.addTopic('second', 'もう一つの資料', '# もう一つの資料\n\n二番目のトピックの本文です。\n');
    await app.cli(['open', 'demo', '--no-open']);
    await expect(u.enddlg).toBeHidden();
    await u.end.click();
    await expect(u.enddlg).toBeVisible();
    await expect(u.enddlg).toContainText('レビューを終了します');
    await expect(u.enddlg).toContainText('未送信のコメントは残りますが、AI には届きません。');
    // キャンセル
    await u.enddlg.getByRole('button', { name: 'キャンセル' }).click();
    await expect(u.enddlg).toBeHidden();
    await expect(u.ended).toBeHidden();
    expect((await app.poll('demo', 1)).status).toBe('timeout');

    // 終了する：全面の表示。ほかに開いているトピックへのリンクがある
    await u.end.click();
    await u.enddlg.getByRole('button', { name: '終了する' }).click();
    await expect(u.ended).toBeVisible();
    await expect(u.ended).toContainText('このトピックのレビューを終了しました');
    await expect(u.ended).toContainText('ほかに、開いているトピックがあります');
    expect((await app.poll('demo', 3)).status).toBe('closed');
    // リンクで移ると、表示が消える
    await u.ended.getByRole('link', { name: 'もう一つの資料' }).click();
    await expect(u.ended).toBeHidden();
    await expect(u.top.locator('#top-title')).toHaveText('もう一つの資料');
    await expect(u.side.locator('.topics li', { hasText: '猫の観察日記' })).toContainText('終了');
    expect(native).toEqual([]); // ブラウザの confirm などは、出ていない
  });

  test('ほかに開いているトピックがなければ「このタブは閉じて構いません」（F16）', async ({ page }) => {
    const u = ui(page);
    const native = watchDialogs(page);
    await u.end.click();
    await u.enddlg.getByRole('button', { name: '終了する' }).click();
    await expect(u.ended).toBeVisible();
    await expect(u.ended).toContainText('このタブは閉じて構いません');
    expect(native).toEqual([]);
  });

  test('未送信のコメントは、終了しても残る。開き直すと見える（F16・F2）', async ({ page, app }) => {
    const u = ui(page);
    await app.addTopic('second', 'もう一つの資料', '# もう一つの資料\n\n二番目のトピックの本文です。\n');
    await app.cli(['open', 'demo', '--no-open']);
    await addTextComment(page, '猫は朝によく鳴きます', '残るコメント');
    await u.end.click();
    await u.enddlg.getByRole('button', { name: '終了する' }).click();
    await expect(u.ended).toBeVisible();
    // 未送信は AI に届かない：poll は closed
    expect((await app.poll('demo', 3)).status).toBe('closed');
    // 開き直す（rikai open）：終了の表示が消え、コメントが残っている
    await app.cli(['open', 'demo', '--no-open']);
    await page.reload();
    await expect(u.ended).toBeHidden();
    await expect(u.threads).toHaveCount(1);
    await expect(u.threads.first()).toContainText('残るコメント');
    await expect(u.submit).toHaveText('Submit (1)');
  });
});

test.describe('サーバーが止まったとき', () => {
  test('「サーバーに接続できません」と出る。画面は、そのまま残る', async ({ page, app }) => {
    const u = ui(page);
    await expect(u.top).not.toContainText('サーバーに接続できません');
    await app.stopServer();
    await expect(u.top).toContainText('サーバーに接続できません', { timeout: 15_000 });
    await expect(u.article).toContainText('猫は朝によく鳴きます');
  });
});
