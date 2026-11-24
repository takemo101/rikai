// 整理フェーズ ③a（RIK-056・0.28.0）：名前の統一（拡大表示・AI に送る・状態の言葉）・html-app の枠の入口（見出しに統一）・進み具合は左の行だけ・枠の見出しの文字ボタン・
// 本文の上のバーが 1 行・1100px で左の一覧が閉じて始まる。実際の Chrome・本物のマウス・キー。資料は作り物。
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { DOC_BASIC, IMG_NAME, makePng } from './samples';
import { addTextComment, box, hoverBlock, submitAll, ui } from './ui';

const BT = '```';
const lines = (...l: string[]) => `${l.join('\n')}\n`;
const APP = lines(
  `${BT}html-app height=200`,
  '<button id="go">ログイン</button>',
  '<script>window.rikai.state({ a: 1 });</script>',
  BT,
);
const DOC_APP = `# 題\n\n最初の段落です。猫は朝に鳴きます。\n\n${APP}\n後の段落です。\n`;
const DOC_IMG = `# 画像の資料\n\n猫は朝に鳴きます。\n\n![猫の写真](assets/${IMG_NAME})\n\n後の段落です。\n`;

/** 画面に見える文字・読み上げの名前（aria-label・title・placeholder・alt）を、全部集める（本文〔資料の中身〕は、除く） */
async function labelsOf(page: Page): Promise<string> {
  return page.evaluate(() => {
    const out: string[] = [];
    const skip = (e: Element) => !!e.closest('#article, .msg .body');
    for (const e of document.querySelectorAll('[aria-label], [title], [placeholder]')) {
      if (skip(e)) continue;
      for (const a of ['aria-label', 'title', 'placeholder']) {
        const v = e.getAttribute(a);
        if (v) out.push(v);
      }
    }
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const el = n.parentElement;
      if (!el || skip(el) || el.closest('script, style')) continue;
      const t = (n.nodeValue ?? '').trim();
      if (t) out.push(t);
    }
    return out.join('\n');
  });
}
/** 旧い名前が、画面に残らない（英語の Submit・個別表示・旧い拡大／縮小／全体表示・AIの〔空白なし〕・AIの確認待ち） */
const OLD = /Submit|個別表示|拡大（＋）|縮小（−）|全体表示|AIの|確認待ち|送信する|AI に送信|送信しました/;
const expectNoOldNames = async (page: Page, where: string) => {
  const all = await labelsOf(page);
  expect(all.match(OLD)?.[0] ?? null, `${where} に、旧い名前が残っている`).toBeNull();
};

test.describe('名前の統一：画面に、旧い名前が残らない', () => {
  test('上のバー・左の一覧・本文・カード・入力欄・ダイアログ・トースト・送信後の待ち・AI の返信（質問つき）・拡大表示・枠の見出し・比べる画面を巡る', async ({
    page,
    app,
  }) => {
    app.writeAsset(IMG_NAME, makePng(60, 40));
    await app.switchTopic(page, 'nm', '名前', `${DOC_IMG}\n${APP}\n`, { [IMG_NAME]: makePng(60, 40) });
    await page.waitForTimeout(1500);
    const u = ui(page);
    await expectNoOldNames(page, '最初の画面');
    await expect(u.submit).toHaveText('AI に送る');
    // コメント：入力欄・追加後のカード
    await addTextComment(page, '猫は朝に鳴きます', '鳴くのはなぜ？');
    await expectNoOldNames(page, '未送信のカード');
    await expect(u.submit).toHaveText('AI に送る（1）');
    // 送信ダイアログ・トースト・待ち
    await u.submit.click();
    await expect(u.submitdlg).toBeVisible();
    await expectNoOldNames(page, '送信ダイアログ');
    await expect(u.submitdlg.getByRole('heading')).toHaveText('AI に送る');
    await expect(u.submitdlg.getByRole('button', { name: 'AI に送る' })).toBeVisible();
    await u.submitdlg.getByRole('button', { name: 'AI に送る' }).click();
    await expect(u.toast).toHaveText('第1回として AI に送りました');
    await expectNoOldNames(page, 'トースト・待ち');
    await expect(page.locator('#turn')).toContainText('AI の返信待ち');
    // AI の返信（質問つき）：あなたの番・カードの札
    await app.nextRound();
    await app.apply({
      replies: [
        { thread: 't1', body: '朝は、おなかが空くからです。', ask: { type: 'yes_no', question: '納得できましたか？' } },
      ],
    });
    await expect(page.locator('#turn')).toContainText('あなたの番');
    await expectNoOldNames(page, 'AI の返信（質問つき）');
    await expect(u.threads.first().locator('.th-head .chip.yours')).toHaveText('未回答の質問');
    // 拡大表示（画像）：ズームの名前
    await u.article.locator('img').first().scrollIntoViewIfNeeded();
    await u.article.locator('img').first().click();
    await expect(u.lightbox).toBeVisible();
    await expectNoOldNames(page, '拡大表示（画像）');
    await expect(u.lightbox.getByRole('button', { name: 'ズームイン' })).toBeVisible();
    await expect(u.lightbox.getByRole('button', { name: 'ズームアウト' })).toBeVisible();
    await expect(u.lightbox.getByRole('button', { name: '全体に合わせる' })).toBeVisible();
    await expect(u.lightbox.getByRole('toolbar', { name: '拡大表示の操作' })).toBeVisible();
    await expect(u.lightbox.getByRole('button', { name: '拡大' })).toHaveCount(0); // 「拡大」（ズームの旧名）は、残らない
    await page.keyboard.press('Escape');
    // 拡大表示（html-app の枠）
    await page.locator('#article .htmlapp .cap [data-focus-open]').click();
    await expect(u.lightbox).toBeVisible();
    await expectNoOldNames(page, '拡大表示（枠）');
    await expect(u.lightbox.getByRole('toolbar', { name: '拡大表示の操作' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expectNoOldNames(page, '枠の見出し');
    // 終了ダイアログ
    await u.end.click();
    await expectNoOldNames(page, '終了ダイアログ');
    await page.keyboard.press('Escape');
  });

  test('版を並べて比べる画面・過去の版・変更の表示：旧い名前がない', async ({ page, app }) => {
    await app.switchTopic(page, 'nm2', '版', DOC_BASIC);
    await app.apply({ revisions: [{ page: 'root', markdown: `${DOC_BASIC}\n追記です。\n` }] });
    await expect(page.locator('#btn-compare')).toBeVisible();
    await expectNoOldNames(page, 'v2');
    await page.locator('#docbar select').selectOption('1');
    await expectNoOldNames(page, '過去の版');
    await page.locator('#btn-compare').click();
    await expect(page.locator('#compare')).toBeVisible();
    await expectNoOldNames(page, '比べる画面');
  });
});

test.describe('html-app の枠：入口は、見出しに 1 つにそろう', () => {
  test('枠の上にマウスを置いても、入口のバー（拡大表示・コメント）は出ない。画像・文には、出る。見出しの 3 つは、キーボードで届く', async ({
    page,
    app,
  }) => {
    await app.switchTopic(page, 'en', '入口', DOC_APP);
    await page.waitForTimeout(1500);
    const u = ui(page);
    // 文：バーが出る
    await hoverBlock(page, u.article.locator('p', { hasText: '最初の段落です' }));
    await expect(u.actbar).toBeVisible();
    await expect(u.actbar.getByRole('button')).toHaveText(['コメント']); // 文のブロックは、拡大表示なし
    // 枠：出ない（枠の中を通っても）
    const f = await box(page.locator('#article iframe.appframe'));
    await page.mouse.move(f.x + f.width / 2, f.y + f.height / 2, { steps: 6 });
    await page.waitForTimeout(600);
    await expect(u.actbar).toBeHidden();
    await expect(u.actbar.locator('#act-zoom')).toHaveCount(0);
    // 見出しの入口：この枠にコメント・要素を選ぶ・拡大表示（見える文字と名前）
    const cap = page.locator('#article .htmlapp .cap');
    await expect(cap.getByRole('button', { name: 'この枠にコメント' })).toBeVisible();
    await expect(cap.getByRole('button', { name: /^要素を選ぶ/ })).toBeVisible();
    await expect(cap.getByRole('button', { name: '拡大表示' })).toBeVisible();
    // キーボードだけで：Tab で順に届く（幅 5・外観・要素・拡大表示・この枠にコメント）。拡大表示は Enter で開く
    await cap.locator('[data-width]').first().focus();
    const order: string[] = [];
    for (let i = 0; i < 9; i++) {
      order.push(await page.evaluate(() => (document.activeElement as HTMLElement).textContent?.trim() ?? ''));
      await page.keyboard.press('Tab');
    }
    expect(order).toEqual([
      '375',
      '768',
      '1280',
      '1920',
      '自動',
      'ライト',
      '要素を選ぶ',
      '拡大表示',
      'この枠にコメント',
    ]);
    await cap.getByRole('button', { name: '拡大表示' }).focus();
    await page.keyboard.press('Enter');
    await expect(u.lightbox).toBeVisible();
    await page.keyboard.press('Escape');
    // コメントの入口は、3 つ（見出しの「この枠にコメント」・「要素を選ぶ」・右下の「範囲を選ぶ」）：見出しの「この枠にコメント」で、入力欄が開く
    await cap.getByRole('button', { name: 'この枠にコメント' }).click();
    await expect(u.composer).toBeVisible();
    await expect(u.composer.locator('.quote')).toHaveText('実行できる枠');
  });

  test('画像のブロックでは、バーに「拡大表示」と「コメント」が出る（旧：「拡大」）', async ({ page, app }) => {
    await app.switchTopic(page, 'en2', '画像', DOC_IMG, { [IMG_NAME]: makePng(60, 40) });
    const u = ui(page);
    await hoverBlock(
      page,
      u.article.locator('p', { hasText: '猫の写真' }).or(u.article.locator('img').first()).first(),
    );
    await expect(u.actbar.getByRole('button')).toHaveText(['拡大表示', 'コメント']);
    await u.actbar.getByRole('button', { name: '拡大表示' }).click();
    await expect(u.lightbox).toBeVisible();
  });
});

test.describe('進み具合・未送信は、上のバーでなく、左の行とボタンの数で', () => {
  test('上のバーに、解決 n/m・回答・「未送信 n 件」の札はない。左のトピック行に n/m。「AI に送る（n）」に数（0 のときは数なし）', async ({
    page,
    app,
  }) => {
    await app.switchTopic(page, 'pg', '進み具合', DOC_BASIC);
    const u = ui(page);
    await expect(u.submit).toHaveText('AI に送る');
    await addTextComment(page, '猫は朝によく鳴きます', '1 件目');
    await addTextComment(page, '猫は一日に三回', '2 件目');
    await expect(u.submit).toHaveText('AI に送る（2）');
    await expect(u.submit).toHaveClass(/attn/);
    await expect(u.top).not.toContainText('解決');
    await expect(u.top).not.toContainText('未送信');
    await expect(u.top).not.toContainText('→');
    // 左の行：解決 0/2・title に説明
    const row = u.side.locator('li.cur');
    await expect(row.locator('.chip.small').first()).toHaveText('0/2');
    await expect(row.locator('.chip.small').first()).toHaveAttribute('title', /解決 0\/2/);
    // 未送信の印は、左の行・カードにも残る（変えない）
    await expect(u.threads.first().locator('.th-head')).toContainText('未送信');
    await submitAll(page);
    await expect(u.submit).toHaveText('AI に送る');
    await expect(u.top).not.toContainText('解決');
  });
});

test.describe('枠の見出し：文字のボタン（クリック数は同じ）', () => {
  test('幅は数字・自動（aria-pressed）。1 回押すと、幅が変わる。外観は現在の状態の文字で、1 回押すと反対。要素を選ぶ・拡大表示は、アイコン＋文字', async ({
    page,
    app,
  }) => {
    await app.switchTopic(page, 'cp', '見出し', DOC_APP);
    await page.waitForTimeout(1500);
    const cap = page.locator('#article .htmlapp .cap');
    const w = (n: string) => cap.locator(`[data-width="${n}"]`);
    await expect(cap.locator('[data-width]')).toHaveText(['375', '768', '1280', '1920', '自動']);
    await expect(cap.locator('[data-width]')).toHaveCount(5);
    await expect(cap.locator('button svg')).toHaveCount(3); // 外観・要素を選ぶ・拡大表示だけ。幅は、数字だけ
    await expect(w('auto')).toHaveAttribute('aria-pressed', 'true');
    const iframe = page.locator('#article iframe.appframe');
    const before = (await box(iframe)).width;
    await w('375').click(); // 1 回
    await expect(w('375')).toHaveAttribute('aria-pressed', 'true');
    await expect(w('auto')).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(async () => (await box(iframe)).width).toBeLessThan(before);
    await expect(iframe).toHaveCSS('width', '375px');
    // 名前に、見える文字を含める
    await expect(w('375')).toHaveAttribute('aria-label', '枠の幅：スマートフォン（375px）');
    await expect(w('auto')).toHaveAttribute('aria-label', '枠の幅：自動（本文の幅いっぱい）');
    await w('auto').click();
    await expect(w('auto')).toHaveAttribute('aria-pressed', 'true');
    // 外観：現在の状態が文字。1 回で反対
    const mode = cap.locator('[data-frame-mode]');
    await expect(mode).toHaveText('ライト');
    await expect(mode).toHaveAttribute('aria-label', '枠の外観：ライト。押すと、ダークにします');
    await mode.click();
    await expect(mode).toHaveText('ダーク');
    await expect(mode).toHaveAttribute('data-frame-mode', 'dark');
    await expect(mode).toHaveAttribute('aria-label', '枠の外観：ダーク。押すと、ライトにします');
    // 要素を選ぶ（押すと aria-pressed）・拡大表示
    const pick = cap.locator('[data-pick]');
    await expect(pick).toHaveText('要素を選ぶ');
    await pick.click();
    await expect(pick).toHaveAttribute('aria-pressed', 'true');
    await pick.click();
    await expect(pick).toHaveAttribute('aria-pressed', 'false');
    await expect(cap.locator('[data-focus-open]')).toHaveText('拡大表示');
  });

  test('比べる画面の枠の見出し（同じ幅・外観の部品）：文字のボタンで、左右そろえて切り替わる。拡大表示の中の枠の見出しも、文字のボタン', async ({
    page,
    app,
  }) => {
    await app.switchTopic(page, 'cp2', '比較', DOC_APP);
    await app.apply({ revisions: [{ page: 'root', markdown: `${DOC_APP}\n追記です。\n` }] });
    await page.waitForTimeout(1500);
    await page.locator('#btn-compare').click();
    const bar = page.locator('#compare .cmptools');
    await expect(bar.locator('[data-width]')).toHaveText(['375', '768', '1280', '1920', '自動']);
    await bar.locator('[data-width="768"]').click();
    await expect(bar.locator('[data-width="768"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(bar.locator('[data-frame-mode]')).toHaveText(/ライト|ダーク/);
    await page.keyboard.press('Escape');
    // 拡大表示の中
    await page.locator('#article .htmlapp .cap [data-focus-open]').click();
    const tools = ui(page).lightbox.locator('.fv-tools');
    await expect(tools.locator('[data-width]')).toHaveText(['375', '768', '1280', '1920', '自動']);
    await tools.locator('[data-width="375"]').click();
    await expect(tools.locator('[data-width="375"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(tools.locator('[data-pick]')).toHaveText('要素を選ぶ');
  });
});

test.describe('本文の上のバー（#docbar）は、本文の列が十分なら 1 行（足りなければ折り返す：phase3a-layout.spec.ts）', () => {
  const oneRow = async (page: Page, where: string) => {
    const h = (await box(ui(page).docbar)).height;
    expect(h, `${where}：#docbar の高さ（1 行は 40〜46px）`).toBeLessThanOrEqual(48);
  };

  test('最新版（変更を表示・凡例あり）・変更を表示しない・過去の版（警告あり）・v1（版の選択なし：バーなし）・子ページ（パンくず）：1360px で、どれも 1 行', async ({
    page,
    app,
  }) => {
    await page.setViewportSize({ width: 1360, height: 900 });
    await app.switchTopic(page, 'db', 'バー', DOC_BASIC);
    await expect(ui(page).docbar).toBeHidden(); // v1 だけ・子でない：中身がないので、出さない（高さ 0）
    await expect(page.locator('#btn-compare')).toHaveCount(0);
    await app.apply({ revisions: [{ page: 'root', markdown: DOC_BASIC.replace('三回', '四回') }] });
    await app.apply({ revisions: [{ page: 'root', markdown: DOC_BASIC.replace('三回', '五回') }] });
    const u = ui(page);
    await expect(page.locator('#docbar select option')).toHaveCount(3); // 2 つの版が、画面に届くまで待つ（通知で届く）
    await expect(page.locator('#docbar select')).toHaveValue('3');
    // 変更を表示している（既定）：凡例（件数の札の頭の、色の見本）
    await expect(u.docbar.locator('.stats .legend-swatch')).toBeVisible();
    await expect(u.docbar.locator('.stats')).toHaveAttribute('title', /右端の緑の線：前の版から変えたところ/);
    await oneRow(page, '最新版・凡例あり');
    // 変更を重ねない（通常）：凡例は、出ない
    await u.docbar.locator('[data-mode="normal"]').click();
    await expect(u.docbar.locator('.stats .legend-swatch')).toHaveCount(0);
    await oneRow(page, '通常（変更を重ねない）');
    await u.docbar.locator('[data-mode="overlay"]').click();
    // 過去の版：警告（短い文・全文は title）・最新版へ。警告は、過去の版のときだけ
    await expect(u.docbar.locator('.pastver')).toHaveCount(0);
    await u.docbar.locator('select').selectOption('2');
    await expect(u.docbar.locator('.pastver')).toContainText('過去の版 v2（コメントは最新版で）');
    await expect(u.docbar.locator('.pastver')).toHaveAttribute('title', /コメントは、最新版にだけ付けられます/);
    await expect(u.docbar.getByRole('link', { name: '最新版へ' })).toBeVisible();
    await oneRow(page, '過去の版');
    // 変更の見せ方（通常｜変更を重ねる｜並べて比べる）の切り替えは、過去の版でも残る
    await expect(u.docbar.locator('#btn-compare')).toBeVisible();
    await expect(u.docbar.locator('[data-mode="overlay"]')).toBeVisible();
    // 子ページ：パンくずが出る（ルートでは出ない）
    await expect(u.docbar.locator('.crumbs')).toHaveCount(0);
  });

  test('パンくずは、子ページのときだけ。そのときも、1 行', async ({ page, app }) => {
    await page.setViewportSize({ width: 1360, height: 900 });
    await app.switchTopic(page, 'db2', '子', DOC_BASIC);
    await app.apply({
      pages: [{ id: 'sub', title: '詳しい子ページ', parent: 'root', markdown: '# 子\n\n本文です。\n' }],
    });
    await page.evaluate(() => {
      location.hash = '#/db2/sub';
    });
    const u = ui(page);
    await expect(u.docbar.locator('.crumbs')).toContainText('詳しい子ページ');
    expect((await box(u.docbar)).height).toBeLessThanOrEqual(48);
  });
});

test.describe('狭い窓：1100px 以下で、左の一覧は閉じて始まる（本文を広く）', () => {
  test('1100px：左の一覧は隠れ（☰ で重ねて出せる）・右のパネルは細い既定（280）・本文は 800px 以上。1101px からは、左の一覧が並ぶ', async ({
    page,
    app,
  }) => {
    await app.switchTopic(page, 'nw', '狭い窓', DOC_BASIC);
    const u = ui(page);
    const widths = async () => ({
      doc: Math.round((await box(u.doc)).width),
      panel: Math.round((await box(u.panel)).width),
      sideVisible: await u.side.evaluate(
        (e) => getComputedStyle(e).visibility !== 'hidden' && e.getBoundingClientRect().width > 0,
      ),
    });
    await page.setViewportSize({ width: 1100, height: 800 });
    await expect(page.locator('#btn-side')).toHaveAttribute('aria-expanded', 'false');
    const w1100 = await widths();
    expect(w1100.sideVisible).toBe(false);
    expect(w1100.panel).toBe(280);
    expect(w1100.doc).toBe(820); // 旧：490
    // ☰ で、本文の上に重ねて出る（ドロワー）。本文・右のパネルの幅は、変わらない
    await page.locator('#btn-side').click();
    await expect(u.side).toBeVisible();
    expect((await widths()).doc).toBe(820);
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 900, height: 800 });
    const w900 = await widths();
    expect(w900.sideVisible).toBe(false);
    expect(w900.doc).toBe(620); // 旧：400
    await page.setViewportSize({ width: 1101, height: 800 });
    await expect(page.locator('#btn-side')).toHaveAttribute('aria-expanded', 'true');
    const w1101 = await widths();
    expect(w1101.sideVisible).toBe(true);
    expect(w1101.panel).toBe(380);
  });
});
