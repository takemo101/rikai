// 整理フェーズ ③b（RIK-057）：C1 添付の画像も、同じ拡大表示（ステージだけ・見るだけ）／C2 「前の版からの変更を表示」と「並べて比べる」を、上のバーの 1 つの切り替え（通常｜変更を重ねる｜並べて比べる）に／
// C3 比べる画面を開いても、入力欄・スレッドの選択は、控えず、そのまま持つ。実際の Chrome・本物のマウス・キー。資料は作り物。
import type { Locator, Page } from '@playwright/test';
import { expect, type RikaiApp, test } from './fixtures';
import { IMG_NAME, makePng } from './samples';
import { box, openComposerOnText, ui } from './ui';

const DOC_IMG = `# 画像の資料\n\n猫は朝に鳴きます。\n\n![猫の写真](assets/${IMG_NAME})\n\n後の段落です。\n`;
const ASSETS = { [IMG_NAME]: makePng(600, 300) };
const lbx = (page: Page) => page.locator('#lightbox');
const dock = (page: Page) => page.locator('#lightbox .fv-dock');
const dockComposer = (page: Page) => page.locator('#lightbox .fv-dock .thread.composer');

/** 画像を、入力欄の貼り付け（paste）・ドロップ（drop）で付ける（本物のクリップボード・ドラッグは、使えない：入力欄のイベントを、実際に発火する） */
async function attach(textarea: Locator, how: 'paste' | 'drop', w: number) {
  const b64 = makePng(w, w).toString('base64');
  await textarea.evaluate(
    (ta, [data, kind]) => {
      const dt = new DataTransfer();
      dt.items.add(
        new File([Uint8Array.from(atob(data as string), (ch) => ch.charCodeAt(0))], `${kind}.png`, {
          type: 'image/png',
        }),
      );
      ta.dispatchEvent(
        kind === 'paste'
          ? new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
          : new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }),
      );
    },
    [b64, how],
  );
}

async function openDoc(page: Page, app: RikaiApp) {
  await page.setViewportSize({ width: 1360, height: 900 });
  await app.switchTopic(page, 'p3b', '添付の拡大', DOC_IMG, ASSETS);
  await expect.poll(() => page.locator('#article img').evaluate((i) => (i as HTMLImageElement).complete)).toBe(true);
}

/** 拡大表示が、見るだけの添付の画像として開いている：ステージ・ズームの道具・×。ドックも、範囲・要素を選ぶ道具も、ない */
async function expectAttachmentZoom(page: Page) {
  await expect(lbx(page)).toBeVisible();
  await expect(lbx(page)).toHaveAttribute('aria-label', '添付の画像（大きく）');
  await expect(lbx(page)).not.toHaveClass(/fv/);
  await expect(lbx(page).locator('.lb-stage img')).toBeVisible();
  await expect(lbx(page).getByRole('toolbar', { name: '拡大表示の操作' })).toBeVisible();
  await expect(lbx(page).getByRole('button', { name: 'ズームイン' })).toBeVisible();
  await expect(lbx(page).getByRole('button', { name: '全体に合わせる' })).toBeVisible();
  await expect(lbx(page).getByRole('button', { name: '閉じる' })).toBeVisible();
  await expect(lbx(page).locator('.fv-dock, .fv-tools, [data-tool="region"], [data-pick]')).toHaveCount(0);
}

// ============================================================================
test.describe('C1：添付の画像も、同じ拡大表示（見るだけ）', () => {
  for (const how of ['paste', 'drop'] as const) {
    test(`右のパネル：${how === 'paste' ? '貼り付け' : 'ドラッグ'}で付けた画像（入力欄のサムネイル）と、送った添付（カード）の、どちらを押しても、同じ拡大表示が開く`, async ({
      page,
      app,
    }) => {
      const u = ui(page);
      await openDoc(page, app);
      await openComposerOnText(page, '猫は朝に鳴きます');
      const ta = u.composer.locator('textarea');
      await ta.fill('添付つきのコメント');
      await attach(ta, how, 100);
      const thumb = u.composer.locator('.thumb img');
      await expect(thumb).toHaveCount(1);
      await thumb.click();
      await expectAttachmentZoom(page);
      await expect.poll(async () => (await box(lbx(page).locator('.lb-stage img'))).height).toBeGreaterThan(100);
      await page.keyboard.press('Escape'); // Esc
      await expect(lbx(page)).toBeHidden();
      await expect(u.composer).toBeVisible(); // 入力欄は、閉じない
      await expect(ta).toHaveValue('添付つきのコメント');
      await thumb.click();
      await expectAttachmentZoom(page);
      await lbx(page).getByRole('button', { name: '閉じる' }).click(); // ×
      await expect(lbx(page)).toBeHidden();
      // 追加 → カードの、送った（添付の）画像
      await u.composer.getByRole('button', { name: 'コメントを追加' }).click();
      await expect(u.threads).toHaveCount(1);
      const sent = u.threads.first().locator('.msg .imgs img');
      await expect(sent).toHaveCount(1);
      await sent.click();
      await expectAttachmentZoom(page);
      await lbx(page).click({ position: { x: 8, y: 400 } }); // 背景
      await expect(lbx(page)).toBeHidden();
      // 閉じたら、本文の拡大表示（ドックつき）が、開いていない：添付の拡大は、ドックなしの 1 段だけ
      await expect(dock(page)).toHaveCount(0);
    });
  }

  test('拡大表示（ドックつき）の中：ドックの入力欄のサムネイルと、ドックのカードの添付の画像を押すと、同じ拡大表示が、その上に開く。閉じると（Esc・×・背景）、ドックつきの拡大表示へ戻る。書きかけは、そのまま', async ({
    page,
    app,
  }) => {
    const u = ui(page);
    await openDoc(page, app);
    const entry = page.locator('#article img');
    await entry.click(); // 本文の画像：ドックつきの拡大表示
    await expect(lbx(page)).toHaveClass(/fv/);
    await dock(page).getByRole('button', { name: 'この対象全体にコメント' }).click();
    await expect(dockComposer(page)).toBeVisible();
    const ta = dockComposer(page).locator('textarea');
    await ta.fill('ドックで書いたコメント');
    await attach(ta, 'paste', 100);
    const thumb = dockComposer(page).locator('.thumb img');
    await expect(thumb).toHaveCount(1);

    // サムネイルを押す：同じ拡大表示が、上に重なる（ドックつきではない）
    await thumb.click();
    await expectAttachmentZoom(page);
    await expect(lbx(page).locator('.lb-stage img')).toHaveAttribute('src', /\/asset\//);
    // Esc（1 回）：添付だけ閉じて、ドックつきの拡大表示へ戻る。書きかけの文・サムネイルは、そのまま
    await page.keyboard.press('Escape');
    await expect(lbx(page)).toHaveClass(/fv/);
    await expect(dock(page)).toBeVisible();
    await expect(ta).toHaveValue('ドックで書いたコメント');
    await expect(thumb).toHaveCount(1);
    // ×
    await thumb.click();
    await expectAttachmentZoom(page);
    await lbx(page).getByRole('button', { name: '閉じる' }).click();
    await expect(lbx(page)).toHaveClass(/fv/);
    await expect(ta).toHaveValue('ドックで書いたコメント');
    // 背景
    await thumb.click();
    await expectAttachmentZoom(page);
    await lbx(page).click({ position: { x: 8, y: 400 } });
    await expect(lbx(page)).toHaveClass(/fv/);

    // 追加：ドックのカードの、送った（添付の）画像
    await dockComposer(page).getByRole('button', { name: 'コメントを追加' }).click();
    const card = page.locator('#lightbox .fv-dock .thread:not(.composer)');
    await expect(card).toHaveCount(1);
    const sent = card.locator('.msg .imgs img');
    await expect(sent).toHaveCount(1);
    await sent.click();
    await expectAttachmentZoom(page);
    await page.keyboard.press('Escape');
    await expect(lbx(page)).toHaveClass(/fv/);
    await expect(card).toHaveCount(1);
    // もう一度 Esc：ドックつきの拡大表示も閉じる。フォーカスは、本文の画像の入口へ
    await page.keyboard.press('Escape');
    await expect(lbx(page)).toBeHidden();
    await expect(u.threads).toHaveCount(1);
  });

  test('ドックつきの拡大表示の中の添付の画像を開いても、背後の拡大表示のズーム・範囲の状態を、壊さない：閉じたあと、範囲を選ぶ道具が使える', async ({
    page,
    app,
  }) => {
    await openDoc(page, app);
    await page.locator('#article img').click();
    await expect(lbx(page)).toHaveClass(/fv/);
    await dock(page).getByRole('button', { name: 'この対象全体にコメント' }).click();
    const ta = dockComposer(page).locator('textarea');
    await attach(ta, 'drop', 100);
    await expect(dockComposer(page).locator('.thumb img')).toHaveCount(1);
    await dockComposer(page).locator('.thumb img').click();
    await expectAttachmentZoom(page);
    await page.keyboard.press('Escape');
    await expect(lbx(page)).toHaveClass(/fv/);
    const region = page.locator('#lightbox .fv-tools [data-tool="region"]');
    await expect(region).toBeEnabled();
    await region.click();
    await expect(region).toHaveAttribute('aria-pressed', 'true');
  });
});

// ============================================================================
const V1 = '# 変更の資料\n\n導入の段落です。\n\n猫は一日に三回、ごはんを食べます。\n\n終わりの段落です。\n';
const V2 = V1.replace('三回', '四回');
const V3 = V1.replace('三回', '五回').replace('終わりの段落です。', '終わりの段落です。\n\n三つ目の版の段落です。');

async function versions(page: Page, app: RikaiApp) {
  await page.setViewportSize({ width: 1360, height: 900 });
  await app.switchTopic(page, 'p3c', '変更の見せ方', V1);
  for (const [i, md] of [V2, V3].entries()) {
    await app.apply({ revisions: [{ page: 'root', markdown: md }] }, { topic: 'p3c' });
    await expect(page.locator('#docbar select option')).toHaveCount(i + 2);
  }
  await expect(page.locator('#docbar select')).toHaveValue('3');
}
const seg = (page: Page, mode: 'normal' | 'overlay' | 'side') => page.locator(`#docbar [data-mode="${mode}"]`);
const pressed = async (page: Page) => {
  const out: string[] = [];
  for (const m of ['normal', 'overlay', 'side'] as const)
    if ((await seg(page, m).count()) && (await seg(page, m).getAttribute('aria-pressed')) === 'true') out.push(m);
  return out;
};

test.describe('C2：変更の見せ方の切り替え（通常｜変更を重ねる｜並べて比べる）', () => {
  test('1 つの入口：旧「前の版からの変更を表示」のチェックと「並べて比べる」のボタンは、もうない。どの切り替えも 1 クリック。並べて比べる画面の中からも、同じ切り替えで戻れる', async ({
    page,
    app,
  }) => {
    const u = ui(page);
    await versions(page, app);
    await expect(page.getByLabel('前の版からの変更を表示')).toHaveCount(0);
    await expect(u.docbar.locator('input[type="checkbox"]')).toHaveCount(0);
    await expect(u.docbar.getByRole('group', { name: '変更の見せ方' })).toBeVisible();
    await expect(u.docbar.locator('.modeseg button')).toHaveText(['通常', '変更を重ねる', '並べて比べる']);
    expect(await pressed(page)).toEqual(['overlay']); // 既定：変更を重ねる（旧：チェックが入っている）
    await expect(u.article.locator('.blk.changed')).not.toHaveCount(0);

    // 重ねる → 並べて比べる（1 クリック）
    await seg(page, 'side').click();
    await expect(page.locator('#compare')).toBeVisible();
    expect(await pressed(page)).toEqual(['side']);
    await expect(u.docbar.getByRole('group', { name: '変更の見せ方' })).toBeVisible(); // 比べる画面でも、切り替えが残る
    // 並べて比べる → 通常（1 クリック）
    await seg(page, 'normal').click();
    await expect(page.locator('#compare')).toHaveCount(0);
    expect(await pressed(page)).toEqual(['normal']);
    await expect(u.article.locator('.blk.changed')).toHaveCount(0);
    // 通常 → 変更を重ねる（1 クリック）
    await seg(page, 'overlay').click();
    expect(await pressed(page)).toEqual(['overlay']);
    await expect(u.article.locator('.blk.changed')).not.toHaveCount(0);
    // 並べて比べる → 変更を重ねる（1 クリック）
    await seg(page, 'side').click();
    await expect(page.locator('#compare')).toBeVisible();
    await seg(page, 'overlay').click();
    await expect(page.locator('#compare')).toHaveCount(0);
    expect(await pressed(page)).toEqual(['overlay']);
    await expect(u.article.locator('.blk.changed')).not.toHaveCount(0);
    // 押している「並べて比べる」を、もう一度：閉じる（旧：同じボタンで閉じる）。開く前の見せ方（変更を重ねる）へ
    await seg(page, 'side').click();
    await seg(page, 'side').click();
    await expect(page.locator('#compare')).toHaveCount(0);
    expect(await pressed(page)).toEqual(['overlay']);
    // Esc で閉じても、同じ。フォーカスは、「並べて比べる」へ
    await seg(page, 'side').click();
    await expect(page.locator('#compare')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#compare')).toHaveCount(0);
    await expect(seg(page, 'side')).toBeFocused();
    expect(await pressed(page)).toEqual(['overlay']);
  });

  test('キーボード：Tab で、版の選択から、3 つのボタンへ。Enter・Space で切り替わる', async ({ page, app }) => {
    await versions(page, app);
    await page.locator('#docbar select').focus();
    await page.keyboard.press('Tab');
    await expect(seg(page, 'normal')).toBeFocused();
    await page.keyboard.press('Space');
    expect(await pressed(page)).toEqual(['normal']);
    await page.keyboard.press('Tab');
    await expect(seg(page, 'overlay')).toBeFocused();
    await page.keyboard.press('Enter');
    expect(await pressed(page)).toEqual(['overlay']);
    await page.keyboard.press('Tab');
    await expect(seg(page, 'side')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#compare')).toBeVisible();
    await expect(page.locator('[data-compare-select="left"]')).toBeFocused(); // 開いたら、左の版の選択へ（比べる画面の、これまでどおり）
  });

  test('v1 を見ているとき：「変更を重ねる」は出ない（前の版がない）。「通常」と「並べて比べる」は、ある', async ({
    page,
    app,
  }) => {
    await versions(page, app);
    await page.locator('#docbar select').selectOption('1');
    await expect(seg(page, 'overlay')).toHaveCount(0);
    await expect(page.locator('#docbar .modeseg button')).toHaveText(['通常', '並べて比べる']);
    expect(await pressed(page)).toEqual(['normal']);
    await seg(page, 'side').click();
    await expect(page.locator('#compare')).toBeVisible();
    await expect(page.locator('[data-compare-select="left"]')).toHaveValue('1');
    await expect(page.locator('[data-compare-select="right"]')).toHaveValue('2'); // 既定の組：v1 を見ていれば、左 v1・右 v2
  });

  test('版が 1 つのページでは、切り替えは出ない。2 つになると、出る', async ({ page, app }) => {
    await page.setViewportSize({ width: 1360, height: 900 });
    await app.switchTopic(page, 'p3d', '一つだけ', V1);
    await expect(ui(page).docbar).toBeHidden();
    await expect(page.locator('#docbar .modeseg')).toHaveCount(0);
    await app.apply({ revisions: [{ page: 'root', markdown: V2 }] }, { topic: 'p3d' });
    await expect(page.locator('#docbar .modeseg')).toBeVisible();
  });

  test('1 行に収まる（1360px・右のコメント 380）。最新版では、切り替えは、並べて比べる画面に替わっても、本文の列の右の端から、同じ位置にある。過去の版の警告・件数・版の選択との関係も、壊さない', async ({
    page,
    app,
  }) => {
    const u = ui(page);
    await versions(page, app);
    const h = async () => (await box(u.docbar)).height;
    expect(await h()).toBeLessThanOrEqual(48);
    // 切り替えの右の端から、本文の列（#docbar）の右の端までの距離（比べている間は、右のコメントが隠れて、列が広がる：距離で比べる）
    const gap = async () => {
      const b = await box(seg(page, 'side'));
      const d = await box(u.docbar);
      return Math.round(d.x + d.width - (b.x + b.width));
    };
    const before = await gap();
    await seg(page, 'side').click();
    await expect(page.locator('#compare')).toBeVisible();
    expect(Math.abs((await gap()) - before)).toBeLessThanOrEqual(1); // 列の右の端から、同じ位置（押したボタンが、動かない）
    expect(await h()).toBeLessThanOrEqual(48);
    await seg(page, 'normal').click();
    await expect(page.locator('#compare')).toHaveCount(0);
    // 過去の版：警告・最新版へ・件数・切り替えが、そろって 1 行（件数の札は、変更を重ねているときに出る）
    await page.locator('#docbar select').selectOption('2');
    await expect(u.docbar.locator('.pastver')).toContainText('過去の版 v2（コメントは最新版で）');
    await seg(page, 'overlay').click(); // 過去の版でも、重ねるは、1 クリック
    await expect(u.article.locator('.blk.changed')).not.toHaveCount(0);
    await expect(u.docbar.locator('.stats')).toContainText('変更 ');
    await expect(u.docbar.locator('.stats .legend-swatch')).toBeVisible(); // 重ねているときだけ、凡例
    expect(await h()).toBeLessThanOrEqual(48);
    await seg(page, 'side').click();
    await expect(page.locator('#compare')).toBeVisible();
    await expect(page.locator('[data-compare-select="right"]')).toHaveValue('2'); // いま見ている版が、右
  });
});

// ============================================================================
test.describe('C3：比べる画面を開いても、入力欄・スレッドの選択は、控えず、そのまま持つ（見える動きは、変わらない）', () => {
  test('入力中のコメント：比べる画面を開く（切り替えの 1 クリック）→ 右のコメント欄は隠れる → 切り替えの 1 クリックで戻ると、同じ対象・同じ文・本文の強調も、そのまま', async ({
    page,
    app,
  }) => {
    const u = ui(page);
    await versions(page, app);
    await openComposerOnText(page, '猫は一日に五回、ごはんを食べます');
    const ta = u.composer.locator('textarea');
    await ta.fill('書きかけのコメント');
    await seg(page, 'side').click();
    await expect(page.locator('#compare')).toBeVisible();
    await expect(u.panel).toBeHidden(); // 右のコメント欄は、隠れる
    await seg(page, 'overlay').click(); // 比べる画面の中から、1 クリックで、通常の本文へ
    await expect(page.locator('#compare')).toHaveCount(0);
    await expect(u.composer).toBeVisible();
    await expect(ta).toHaveValue('書きかけのコメント');
    await expect(u.article.locator('.blk-pending, mark.hl.pending').first()).toBeVisible();
    await u.composer.getByRole('button', { name: 'コメントを追加' }).click();
    await expect(u.threads).toHaveCount(1);
    await expect(u.article.locator('mark.hl').first()).toContainText('猫は一日に五回、ごはんを食べます'); // 元の対象に付いた
  });

  test('比べている間に新しい版が届く：対象が新しい版にもあれば、同じ文のまま続けられる（比べないときと同じ道）。対象がなくなれば、別の対象に付けず、「対象を失った下書き」へ', async ({
    page,
    app,
  }) => {
    const u = ui(page);
    await versions(page, app);
    await openComposerOnText(page, '猫は一日に五回、ごはんを食べます');
    await u.composer.locator('textarea').fill('書きかけ A');
    await seg(page, 'side').click();
    await expect(page.locator('#compare')).toBeVisible();
    await app.apply(
      { revisions: [{ page: 'root', markdown: V3.replace('導入の段落です。', '新しい導入です。') }] },
      { topic: 'p3c' },
    );
    await expect(page.locator('[data-newer]')).toBeVisible();
    await seg(page, 'normal').click();
    await expect(page.locator('#compare')).toHaveCount(0);
    await expect(u.article).toContainText('新しい導入です');
    await expect(u.composer.locator('textarea')).toHaveValue('書きかけ A'); // 対象が残っているので、続けられる
    await expect(page.locator('[data-lost-draft]')).toHaveCount(0);
    // 対象がなくなる版
    await seg(page, 'side').click();
    await expect(page.locator('#compare')).toBeVisible();
    await app.apply(
      { revisions: [{ page: 'root', markdown: V3.replace('一日に五回', '毎日、六度') }] },
      { topic: 'p3c' },
    );
    await expect(page.locator('[data-newer]')).toBeVisible();
    await seg(page, 'overlay').click();
    await expect(page.locator('#compare')).toHaveCount(0);
    await expect(u.article).toContainText('毎日、六度');
    await expect(u.composer).toHaveCount(0);
    await expect(page.locator('[data-lost-draft] .lostdraft-text')).toHaveText('書きかけ A');
  });
});
