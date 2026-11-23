// 版と差分・コメントの追従・子ページ（F11・F12・F13）：apply で新しい版 → 差分（緑の線・凡例・「前の版との差分」）・版の選択・コメントが版をまたいで付いてくる・子ページ
import type { Locator, Page } from '@playwright/test';
import { expect, type RikaiApp, test } from './fixtures';
import { DOC_BASIC } from './samples';
import { addTextComment, dragSelect, fillAndAdd, hoverBlock, submitAll, ui } from './ui';

// v2：食事の段落を直す（三 → 四）・段落を足す・表を直す・睡眠の段落をなくす（日向…のコメントの文が消える）
const DOC_V2 = DOC_BASIC.replace('一日に三回', '一日に四回')
  .replace('\n- 夜のごはんは十九時です\n', '\n- 夜のごはんは十九時です\n\n新しい段落：おやつの時間も決まっています。\n')
  .replace('| 夜 | ウェット |', '| 夜 | ウェットとおやつ |')
  .replace('\n猫は一日に十六時間ほど眠ります。日向でよく丸くなります。\n', '\n');

// 緑の線：色が、緑に近い（g が r・b より大きい）影・右の枠。実装の方法（box-shadow・border）には、よらない
async function greenEdge(loc: Locator) {
  return loc.evaluate((e) => {
    const cs = getComputedStyle(e);
    const rgbs =
      [cs.boxShadow, cs.borderRightWidth !== '0px' ? cs.borderRightColor : ''].join(' ').match(/rgba?\([^)]*\)/g) ?? [];
    return rgbs.some((c) => {
      const [r, g, b] = (c.match(/[\d.]+/g) ?? []).map(Number) as [number, number, number];
      return g > r + 20 && g > b + 10;
    });
  });
}

// 3 つのコメント（文・表・睡眠の文）を v1 に付けて送り、v2 を apply する。v2 の画面を開いた状態で返す
async function reviseToV2(page: Page, app: RikaiApp) {
  const u = ui(page);
  await addTextComment(page, '猫は朝によく鳴きます', '朝のコメント');
  await hoverBlock(page, page.locator('#article table'));
  await u.actComment.click();
  await fillAndAdd(page, '表のコメント');
  await addTextComment(page, '日向でよく丸くなります', '睡眠のコメント');
  await submitAll(page);
  const r = await app.nextRound();
  const tids: string[] = r.items.map((i: { thread: string }) => i.thread);
  await app.apply({
    round: r.round,
    revisions: [{ page: 'root', markdown: DOC_V2 }],
    replies: tids.map((t) => ({ thread: t, body: '資料を直しました。' })),
  });
  await expect(u.toast).toContainText('資料が v2 に更新されました');
  await expect(page.locator('#docbar select')).toHaveValue('2');
}

test.describe('版と差分', () => {
  test('新しい版：版の選択・差分（変更・追加・なくなったブロック）・凡例・件数・緑の線（F11）', async ({
    page,
    app,
  }) => {
    const u = ui(page);
    await reviseToV2(page, app);
    const select = page.locator('#docbar select');
    await expect(select.locator('option')).toHaveText(['v2（最新）', 'v1']);
    const chk = page.getByLabel('前の版からの変更を表示');
    await expect(chk).toBeChecked();
    await expect(u.docbar).toContainText('変更 2・追加 1・削除 1');
    await expect(u.docbar).toContainText('右端の緑の線：前の版から変えたところ');

    // 変更・追加のブロックに、印。変わらないブロックには、ない
    await expect(u.article.locator('.blk.changed')).toHaveCount(3);
    await expect(u.article.locator('.blk.changed.added')).toHaveCount(1);
    await expect(u.article.locator('.blk.changed.added')).toContainText('新しい段落');
    expect(await greenEdge(u.article.locator('.blk.changed.added'))).toBe(true);
    expect(await greenEdge(u.article.locator('p.changed', { hasText: '一日に四回' }))).toBe(true);
    expect(await greenEdge(u.article.locator('h1'))).toBe(false);
    expect(await greenEdge(u.article.locator('p', { hasText: '猫は朝によく鳴きます' }))).toBe(false);

    // 変更の下の折りたたみ「前の版との差分」：追加・削除された文字
    const diffs = u.article.locator('details', { has: page.locator('summary', { hasText: '前の版との差分' }) });
    await expect(diffs).toHaveCount(2);
    await diffs.first().locator('summary').click();
    await expect(diffs.first().locator('del')).toHaveText('三');
    await expect(diffs.first().locator('ins')).toHaveText('四');
    // なくなったブロックは、本文の最後に、折りたたみで
    const removed = u.article.locator('details', {
      has: page.locator('summary', { hasText: '前の版からなくなったブロック (1)' }),
    });
    await removed.locator('summary').click();
    await expect(removed.locator('del')).toContainText('日向でよく丸くなります');
    expect(await u.article.evaluate((a) => (a.lastElementChild as Element).textContent)).toContain(
      '前の版からなくなったブロック',
    );

    // 差分の文字から選び始めても、コメントの入口は出ない
    const d = (await diffs.first().locator('.diff').boundingBox()) as { x: number; y: number; height: number };
    await page.mouse.move(d.x + 2, d.y + d.height / 2);
    await page.mouse.down();
    await page.mouse.move(d.x + 90, d.y + d.height / 2, { steps: 5 });
    await page.mouse.up();
    await expect(u.actbar).toBeHidden();

    // 切り替え：消える・戻る
    await chk.uncheck();
    await expect(u.article.locator('.blk.changed')).toHaveCount(0);
    await expect(u.article.locator('summary')).toHaveCount(0);
    await expect(u.docbar).not.toContainText('右端の緑の線');
    await chk.check();
    await expect(u.article.locator('.blk.changed')).toHaveCount(3);

    // AI の返信に「資料を v2 に更新」と、その版へのリンク
    const msg = u.threads.first().locator('.msg.ai');
    await expect(msg).toContainText('資料を v2 に更新');
    await expect(msg.getByRole('link', { name: 'v2 を見る' })).toBeVisible();
  });

  test('過去の版：「過去の版」の表示・コメントは付けられない・差分はない（v1）。最新版へ戻れる（F11）', async ({
    page,
    app,
  }) => {
    const u = ui(page);
    await reviseToV2(page, app);
    await page.locator('#docbar select').selectOption('1');
    await expect(page).toHaveURL(/#\/demo\/root\/v1$/);
    await expect(u.docbar).toContainText('過去の版 v1 を表示中');
    await expect(u.article.locator('p', { hasText: '一日に三回' })).toBeVisible(); // v1 の本文
    await expect(u.article.locator('.blk.changed')).toHaveCount(0); // v1 には差分がない
    await expect(page.getByLabel('前の版からの変更を表示')).toHaveCount(0);
    await expect(u.regbtn).toBeHidden(); // 範囲を選ぶボタンは、最新版だけ
    // v1 では、3 つのコメントが、すべて本文の中で見つかる
    await expect(u.bno).toHaveText(['1', '2', '3']);

    // 文を選んでも、ブロックにマウスを置いても、入口のバーは出ない
    await dragSelect(page, '猫は朝によく鳴きます');
    await expect(u.actbar).toBeHidden();
    await hoverBlock(page, page.locator('#article table'));
    await expect(u.actbar).toBeHidden();

    await u.docbar.getByRole('link', { name: '最新版へ' }).click();
    await expect(page).toHaveURL(/#\/demo\/root$/);
    await expect(page.locator('#docbar select')).toHaveValue('2');
  });

  test('コメントは、版が変わっても付いてくる（位置の追従・近い内容のブロック・見つからない文）（F12）', async ({
    page,
    app,
  }) => {
    const u = ui(page);
    await reviseToV2(page, app);
    // 文のコメント：v2 でも、同じ文に付く。付けた版（v1）の札が出る
    const morning = u.threads.filter({ hasText: '朝のコメント' });
    await expect(u.article.locator('mark', { hasText: '猫は朝によく鳴きます' })).toBeVisible();
    await expect(morning.locator('.chip', { hasText: 'v1' })).toBeVisible();
    // 表のコメント：内容が少し変わった表に、推定で付く（印）
    const table = u.threads.filter({ hasText: '表のコメント' });
    await expect(table).toContainText('近い内容のブロックに表示');
    // 睡眠のコメント：文が消えた
    const sleep = u.threads.filter({ hasText: '睡眠のコメント' });
    await expect(sleep).toContainText('修正で文が変わりました');
    await expect(sleep.locator('.no')).toHaveCount(0); // 本文の中にないので、番号はない
    await expect(u.bno).toHaveText(['1', '2']); // 見つかる 2 つだけ
    // 見つからなくても、スレッドは、パネルに残る（返信できる）
    await expect(sleep.getByRole('button', { name: '追加', exact: true })).toBeVisible();
  });

  test('付けた版より前の版には、そのコメントは出ない（「後の版のコメント」）。最新でない版（v2）にも、差分が出る（F11・F12）', async ({
    page,
    app,
  }) => {
    const u = ui(page);
    await reviseToV2(page, app);
    // v2 で、新しいコメントを付けて、送る。AI は v3 に直す
    await addTextComment(page, '新しい段落：おやつの時間も決まっています', 'v2 で付けたコメント');
    await submitAll(page);
    const r = await app.nextRound();
    await app.apply({
      round: r.round,
      revisions: [{ page: 'root', markdown: `${DOC_V2}\n最後に足した段落です。\n` }],
      replies: r.items.map((i: { thread: string }) => ({ thread: i.thread, body: '直しました。' })),
    });
    await expect(page.locator('#docbar select')).toHaveValue('3');

    // v1 を見る：v2 のコメントは、「後の版のコメント」で、本文には印がない
    await page.locator('#docbar select').selectOption('1');
    const later = u.threads.filter({ hasText: 'v2 で付けたコメント' });
    await expect(later).toContainText('後の版のコメント');
    await expect(u.bno).toHaveText(['1', '2', '3']); // v1 のコメントだけ

    // v2（最新ではない）：前の版（v1）との差分が出る
    await page.locator('#docbar select').selectOption('2');
    await expect(u.docbar).toContainText('過去の版 v2 を表示中');
    await expect(u.docbar).toContainText('変更 2・追加 1・削除 1');
    await expect(page.getByLabel('前の版からの変更を表示')).toBeChecked();
    await expect(u.article.locator('.blk.changed')).toHaveCount(3);
    await expect(later).not.toContainText('後の版のコメント');

    // v3（最新）：差分は v2 との比較（最後の段落だけ）
    await page.locator('#docbar select').selectOption('3');
    await expect(u.docbar).toContainText('変更 0・追加 1・削除 0');
    await expect(u.article.locator('.blk.changed')).toHaveCount(1);
  });
});

test.describe('子ページ', () => {
  const CHILD = '# 詳細ページ\n\n子ページの本文です。猫の詳しい話です。\n';
  async function withChild(page: Page, app: RikaiApp) {
    await addTextComment(page, '猫は朝によく鳴きます', '詳しく知りたい');
    await submitAll(page);
    const r = await app.nextRound();
    await app.apply({
      round: r.round,
      pages: [{ id: 'detail', title: '詳細ページ', parent: 'root', markdown: CHILD }],
      replies: [{ thread: r.items[0].thread, body: '詳しくは[こちら](page:detail)です。', page: 'detail' }],
    });
  }

  test('返信の「詳しく見る」カードとリンクから、子ページへ移れる。パンくず・左のページ一覧で戻れる（F13）', async ({
    page,
    app,
  }) => {
    const u = ui(page);
    await withChild(page, app);
    const card = u.threads.first().locator('a.pagecard');
    await expect(card).toContainText('詳しく見る');
    await expect(card).toContainText('詳細ページ');
    // 左のページ一覧：本編と子ページ
    await expect(u.side.locator('.tree').first()).toContainText('猫の観察日記');
    await expect(u.side.locator('.tree').first()).toContainText('詳細ページ');
    await expect(u.side.locator('.tree').first()).toContainText('v1');

    await card.click();
    await expect(page).toHaveURL(/#\/demo\/detail$/);
    await expect(u.article.locator('h1')).toHaveText('詳細ページ');
    const crumbs = u.docbar.locator('.crumbs');
    await expect(crumbs).toContainText('猫の観察日記');
    await expect(crumbs.locator('.sep svg')).toHaveCount(1); // 区切りは、アイコン（›）
    await expect(crumbs).toContainText('詳細ページ');
    await expect(u.threads).toHaveCount(0); // 子ページには、まだコメントがない

    // 子ページも、コメントを持つ：左の一覧に、未解決の数
    await addTextComment(page, '子ページの本文です', '子ページへのコメント');
    await expect(u.side.locator('.tree a', { hasText: '詳細ページ' }).locator('.badge')).toHaveText('1');
    await expect(u.bno).toHaveText(['1']);

    // パンくずで戻る → 本編のコメントだけ。Markdown のリンクで、また子ページへ
    await crumbs.getByRole('link', { name: '猫の観察日記' }).click();
    await expect(page).toHaveURL(/#\/demo\/root$/);
    await expect(u.threads).toHaveCount(1);
    await expect(u.threads.first()).toContainText('詳しく知りたい');
    await u.threads.first().locator('a.pagelink', { hasText: 'こちら' }).click();
    await expect(page).toHaveURL(/#\/demo\/detail$/);
    await expect(u.threads.first()).toContainText('子ページへのコメント');

    // 左の一覧で、本編へ
    await u.side.locator('.tree a', { hasText: '猫の観察日記' }).click();
    await expect(page).toHaveURL(/#\/demo\/root$/);
  });

  test('左のページの木：子・孫は、段をなして並ぶ（左端が、右へずれる）', async ({ page, app }) => {
    const u = ui(page);
    await withChild(page, app);
    await app.apply({
      pages: [{ id: 'grand', title: '孫ページ', parent: 'detail', markdown: '# 孫ページ\n\n孫の本文です。\n' }],
    });
    const left = async (title: string) => {
      const link = u.side.locator('.tree a', { hasText: title });
      await expect(link).toBeVisible();
      return ((await link.boundingBox()) as { x: number }).x;
    };
    const [root, child, grand] = [await left('猫の観察日記'), await left('詳細ページ'), await left('孫ページ')];
    expect(child).toBeGreaterThan(root + 8);
    expect(grand).toBeGreaterThan(child + 8);
  });

  test('子ページも版を持つ：apply の revisions で v2 になり、左の一覧の版が変わる（F11・F13）', async ({
    page,
    app,
  }) => {
    const u = ui(page);
    await withChild(page, app);
    await app.apply({ revisions: [{ page: 'detail', markdown: `${CHILD}\n増やした段落です。\n` }] });
    await expect(u.side.locator('.tree a', { hasText: '詳細ページ' })).toContainText('v2');
    await expect(u.side.locator('.tree a', { hasText: '猫の観察日記' })).toContainText('v1');
    await u.side.locator('.tree a', { hasText: '詳細ページ' }).click();
    await expect(u.article).toContainText('増やした段落です');
    await expect(page.locator('#docbar select')).toHaveValue('2');
  });
});
