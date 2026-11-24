// 資料とコメントのループ（F1〜F8・F14・F21）：資料を開く → 文を選んでコメント → AI に送る → CLI の pull に届く → apply で返信 → 返信 → 解決
import { expect, test } from './fixtures';
import { addTextComment, openComposerOnText, submitAll, ui } from './ui';

test.describe('コメントのループ', () => {
  test('資料が開く：題名・本文・左の一覧・上のバー（F1・F2・F15）', async ({ page }) => {
    const u = ui(page);
    await expect(u.top.locator('#top-title')).toHaveText('猫の観察日記');
    await expect(u.article.locator('h1')).toHaveText('猫の観察日記');
    await expect(u.article.locator('table')).toBeVisible();
    await expect(u.side).toContainText('猫の観察日記');
    // 合言葉は、URL に残らない
    expect(page.url()).not.toContain('?t=');
    // コメントがなければ、AI に送る は押せない
    await expect(u.submit).toBeDisabled();
  });

  test('文を選んでコメント → 下書き → AI に送る（キャンセル・メモ）→ pull に届く（F3・F5・F6・F7）', async ({
    page,
    app,
  }) => {
    const u = ui(page);
    await addTextComment(page, '猫は朝によく鳴きます', 'なぜ朝に鳴くのですか');

    // 下書き：カード・番号・「未送信」・AI に送る の件数。まだ AI には届かない
    await expect(u.threads).toHaveCount(1);
    await expect(u.threads.first().locator('.quote')).toContainText('猫は朝によく鳴きます');
    await expect(u.threads.first()).toContainText('未送信');
    await expect(u.bno).toHaveText(['1']);
    await expect(u.submit).toHaveText('AI に送る（1）');
    expect((await app.pull()).status).toBe('none');
    expect((await app.status()).unsentInBrowser).toBe(1);

    // 下書きは、サーバーに保存される（ページを開き直しても残る）
    await page.reload();
    await expect(u.threads).toHaveCount(1);
    await expect(u.submit).toHaveText('AI に送る（1）');

    // ダイアログ：件数・キャンセルでは送らない
    await u.submit.click();
    await expect(u.submitdlg).toBeVisible();
    await expect(u.submitdlg).toContainText('1 件');
    await u.submitdlg.getByRole('button', { name: 'キャンセル' }).click();
    await expect(u.submitdlg).toBeHidden();
    expect((await app.pull()).status).toBe('none');

    // 全体へのメモをつけて送る
    await submitAll(page, '全体のメモです');
    await expect(u.toast).toContainText('第1回として AI に送りました');
    await expect(u.submit).toBeDisabled();
    await expect(u.top).toContainText('AI の返信待ち');

    const r = await app.nextRound();
    expect(r.round).toBe(1);
    expect(r.overallNote).toBe('全体のメモです');
    expect(r.items).toHaveLength(1);
    expect(r.items[0].anchor.quote).toBe('猫は朝によく鳴きます');
    expect(r.items[0].anchor.prefix.length).toBeLessThanOrEqual(32);
    expect(r.items[0].new[0]).toMatchObject({ author: 'user', kind: 'comment', text: 'なぜ朝に鳴くのですか' });
    expect(r.pages.root.version).toBe(1);

    // 同じ round は、apply まで、何度でも出る（pending のまま残る）
    expect((await app.pull()).round).toBe(1);
    expect((await app.poll()).status).toBe('feedback');
  });

  test('apply で返信 → 画面に返信 → 追加 → 解決 → タブと数（F8・F14・F21・F33）', async ({ page, app }) => {
    const u = ui(page);
    await addTextComment(page, '猫は朝によく鳴きます', '朝に鳴く理由は？');
    await submitAll(page);
    const r1 = await app.nextRound();
    const tid = r1.items[0].thread;

    // AI の返信が、画面に出る（「AI の返信」の札）
    const res = await app.apply({ round: 1, replies: [{ thread: tid, body: '朝はお腹がすくからです。' }] });
    expect(res.ok).toBe(true);
    await expect(u.threads.first().locator('.msg.ai')).toContainText('朝はお腹がすくからです。');
    await expect(u.threads.first()).toContainText('AI の返信');
    expect((await app.pull()).status).toBe('none'); // handled になった

    // 返信の「追加」（下書き）→ AI に送る → followup として届く
    await u.threads.first().locator('textarea').fill('では夜は？');
    await u.threads.first().getByRole('button', { name: '追加', exact: true }).click();
    await expect(u.threads.first().locator('.msg.user').last()).toContainText('では夜は？');
    await expect(u.submit).toHaveText('AI に送る（1）');
    await submitAll(page);
    const r2 = await app.nextRound();
    expect(r2.round).toBe(2);
    expect(r2.items[0].new[0]).toMatchObject({ kind: 'followup', text: 'では夜は？' });
    expect(JSON.stringify(r2.items[0].history)).toContain('朝はお腹がすくからです。');
    await app.apply({ round: 2, replies: [{ thread: tid, body: '夜は静かです。' }] });
    await expect(u.threads.first().locator('.msg.ai').last()).toContainText('夜は静かです。');

    // 解決：タブの数・1 行・上のバーの数
    await expect(u.side.locator('li.cur .chip.small').first()).toHaveText('0/1'); // 進み具合は、左のトピック行だけ（0.28.0）
    await u.threads.first().getByRole('button', { name: '解決', exact: true }).click();
    const tab = (name: string) => page.locator('.tab', { hasText: name });
    await expect(tab('未解決')).toHaveText('未解決0');
    await expect(tab('解決済み')).toHaveText('解決済み1');
    await expect(tab('すべて')).toHaveText('すべて1');
    await expect(u.side.locator('li.cur .chip.small').first()).toHaveText('1/1'); // 進み具合は、左のトピック行だけ（0.28.0）
    await expect(u.panel).toContainText('未解決のコメントは、ありません。');
    await expect(u.submit).toHaveText('AI に送る（1）');
    await tab('解決済み').click();
    await expect(page.locator('.donerow')).toHaveCount(1);

    // 解決は、次の AI に送る で AI に届く
    await submitAll(page);
    const r3 = await app.nextRound();
    expect(r3.items[0].userMarked).toBe('resolved');

    // 再開：解決の数が減る
    await page.locator('.donerow').click();
    await u.threads.first().getByRole('button', { name: '再開する' }).click();
    await expect(u.side.locator('li.cur .chip.small').first()).toHaveText('0/1'); // 進み具合は、左のトピック行だけ（0.28.0）
    await expect(tab('未解決')).toHaveText('未解決1');
  });

  test('コメントの追加が成功して、直後の取り直しだけ失敗しても、二重に保存されない（取り直しが届けば、入力欄が閉じる）', async ({
    page,
    app,
  }) => {
    const u = ui(page);
    await openComposerOnText(page, '猫は朝によく鳴きます');
    await u.composer.locator('textarea').fill('一度だけ');
    let block = true;
    await page.route('**/api/topic/**', (route) => (block ? route.abort() : route.continue()));
    await u.composer.getByRole('button', { name: 'コメントを追加' }).click();
    await expect(u.composer.locator('textarea')).toHaveValue(''); // 保存できた：書きかけは消える
    await expect(u.toast).toBeHidden();
    await u.composer.getByRole('button', { name: 'コメントを追加' }).click(); // 何も、送らない
    block = false;
    await expect(u.composer).toHaveCount(0); // 次のポーリングで追いつく
    await expect(u.threads).toHaveCount(1);
    expect((await app.status()).unsentInBrowser).toBe(1);
  });

  test('編集・削除は、送るまで（F5）', async ({ page }) => {
    const u = ui(page);
    await addTextComment(page, '猫は朝によく鳴きます', '最初の文');
    const card = u.threads.first();
    await card.getByRole('button', { name: '編集' }).click();
    await card.locator('textarea').first().fill('直した文');
    await card.getByRole('button', { name: '保存' }).click();
    await expect(card).toContainText('直した文');
    await card.getByRole('button', { name: '削除' }).click();
    await expect(u.threads).toHaveCount(0);
    await expect(u.submit).toBeDisabled();
  });

  test('送るものがなければ AI に送る できない（F6）', async ({ page, app }) => {
    const u = ui(page);
    await expect(u.submit).toBeDisabled();
    expect((await app.pull()).status).toBe('none');
    await addTextComment(page, '猫は一日に三回', '三回の根拠');
    await expect(u.submit).toBeEnabled();
  });
});
