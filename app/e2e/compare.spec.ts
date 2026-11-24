// 版を並べて比べる（F44）：左右 2 つの版を、ブロックごとの行で並べる（読み取り専用）。追加・変更・削除の強調と札・行の縦位置・html-app の枠（左右とも動く・独立・
// 比較用ツールバーで、幅・外観が左右そろう）・読み取り専用・開閉の漏れ・偽の知らせ・新しい版・狭い窓・ライト／ダーク・キーボード。実際の Chrome で確かめる。資料は、作り物。
import fs from 'node:fs';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { expect, type RikaiApp, test } from './fixtures';
import { addTextComment, clickToCount, hoverBlock, openComposerOnText, ui } from './ui';

const BT = '```';
const lines = (...l: string[]) => `${l.join('\n')}\n`;

const V1 = lines(
  '# 比較の資料',
  '',
  '導入の段落です。ここは、どの版でも同じです。',
  '',
  '## 食事',
  '',
  '猫は一日に三回、ごはんを食べます。水もたくさん飲みます。',
  '',
  '- 朝のごはんは七時です',
  '- 夜のごはんは十九時です',
  '',
  '## 睡眠',
  '',
  '猫は一日に十六時間ほど眠ります。日向でよく丸くなります。',
);
// v2：食事の段落を直す（三 → 四）・睡眠の段落をなくす・新しい段落を足す
const V2 = lines(
  '# 比較の資料',
  '',
  '導入の段落です。ここは、どの版でも同じです。',
  '',
  '## 食事',
  '',
  '猫は一日に四回、ごはんを食べます。水もたくさん飲みます。',
  '',
  '- 朝のごはんは七時です',
  '- 夜のごはんは十九時です',
  '',
  'おやつの時間は、午後三時と決まっています。',
  '',
  '## 睡眠',
);
// v3：食事の段落をもう一度直す（四 → 五）・最後に段落を足す
const V3 = lines(
  '# 比較の資料',
  '',
  '導入の段落です。ここは、どの版でも同じです。',
  '',
  '## 食事',
  '',
  '猫は一日に五回、ごはんを食べます。水もたくさん飲みます。',
  '',
  '- 朝のごはんは七時です',
  '- 夜のごはんは十九時です',
  '',
  'おやつの時間は、午後三時と決まっています。',
  '',
  '## 睡眠',
  '',
  '三つ目の版にだけある、最後の段落です。',
);

const DOC_ID = 'cmp';
const compare = (page: Page) => page.locator('#compare');
const row = (page: Page, status: string) => page.locator(`#compare .cmprow[data-status="${status}"]`);
const sel = (page: Page, side: 'left' | 'right') => page.locator(`[data-compare-select="${side}"]`);
const cell = (r: Locator, side: 'l' | 'r') => r.locator(`.cmp${side}`);

/** v1・v2・v3 を持つトピックを作って、最新版（v3）を開いた状態にする */
async function versions(page: Page, app: RikaiApp, docs: string[] = [V1, V2, V3]) {
  await app.switchTopic(page, DOC_ID, '比較', docs[0] as string);
  for (let i = 1; i < docs.length; i++) {
    await app.apply({ revisions: [{ page: 'root', markdown: docs[i] as string }] }, { topic: DOC_ID });
    await expect(page.locator('#docbar select option')).toHaveCount(i + 1);
  }
  await expect(page.locator('#docbar select')).toHaveValue(String(docs.length));
}
async function openCompare(page: Page) {
  await page.locator('#btn-compare').click();
  await expect(compare(page)).toBeVisible();
  await expect(compare(page).locator('.cmprow').first()).toBeVisible();
}
const boxOf = async (l: Locator) => {
  const b = await l.boundingBox();
  if (!b) throw new Error('boundingBox がありません');
  return b;
};

test.describe('版を並べて比べる', () => {
  test('既定：左 v2・右 v3。プルダウンで v1／v3 に変える：左右の本文がその版・追加／変更／削除の強調と札・行の縦位置が揃う', async ({
    page,
    app,
  }) => {
    await versions(page, app);
    await openCompare(page);
    await expect(sel(page, 'left')).toHaveValue('2');
    await expect(sel(page, 'right')).toHaveValue('3');
    await expect(page.locator('[data-side="left"] .cmptag')).toHaveText('過去の版');
    await expect(page.locator('[data-side="right"] .cmptag')).toHaveText('最新');
    await expect(compare(page)).toContainText('読み取り専用');
    await expect(compare(page)).toContainText('コメントは、最新版の本文で付けます');
    await expect(page.locator('#article')).toHaveCount(0); // 本文は、比べる画面と入れ替わる

    // v2 → v3：食事の段落が変わった（四 → 五）・最後の段落が増えた
    await expect(row(page, 'changed')).toHaveCount(1);
    await expect(row(page, 'added')).toHaveCount(1);
    await expect(row(page, 'removed')).toHaveCount(0);
    const changed = row(page, 'changed');
    await expect(cell(changed, 'l')).toContainText('一日に四回');
    await expect(cell(changed, 'r')).toContainText('一日に五回');
    await expect(cell(changed, 'l').locator('.cmpbadge')).toHaveText('変更前');
    await expect(cell(changed, 'r').locator('.cmpbadge')).toHaveText('変更後');
    const added = row(page, 'added');
    await expect(cell(added, 'r')).toContainText('三つ目の版にだけある');
    await expect(cell(added, 'r').locator('.cmpbadge')).toHaveText('追加');
    await expect(cell(added, 'l')).toHaveClass(/cmpgap/); // 空きは、空白（読み上げから外す）
    await expect(cell(added, 'l')).toHaveAttribute('aria-hidden', 'true');
    await expect(page.locator('#compare .cmpsum')).toHaveText('変更 1・追加 1・削除 0・同じ 7');
    // 色以外でも見分けられる：変更前・変更後で、背景が違う。同じ行は、背景なし
    const bg = (l: Locator) => l.evaluate((e) => getComputedStyle(e).backgroundColor);
    expect(await bg(cell(changed, 'l'))).not.toBe(await bg(cell(changed, 'r')));
    expect(await bg(cell(page.locator('#compare .cmprow[data-status="same"]').first(), 'l'))).toBe('rgba(0, 0, 0, 0)');

    // 左右の行の縦の位置・高さが揃う（すべての行）。スクロールの同期は、要らない
    for (const r of await page.locator('#compare .cmprow').all()) {
      const [l, rr] = [await boxOf(r.locator('.cmpl')), await boxOf(r.locator('.cmpr'))];
      expect(Math.abs(l.y - rr.y), 'top').toBeLessThan(1);
      expect(Math.abs(l.height - rr.height), 'height').toBeLessThan(1);
      expect(rr.x).toBeGreaterThan(l.x + l.width - 1); // 右の欄は、左の欄の右
    }
    // 文字の差分：開くと、削除と追加の文字
    const diff = cell(changed, 'r').locator('details.diffbox');
    await diff.locator('summary').click();
    await expect(diff.locator('del')).toHaveText('四');
    await expect(diff.locator('ins')).toHaveText('五');

    // 左を v1 に：v1 → v3（変更・追加 2・削除 1）。左は v1 の本文
    await sel(page, 'left').selectOption('1');
    await expect(page.locator('[data-side="left"] .cmptag')).toHaveText('過去の版');
    await expect(cell(row(page, 'changed'), 'l')).toContainText('一日に三回');
    await expect(cell(row(page, 'changed'), 'r')).toContainText('一日に五回');
    await expect(page.locator('#compare .cmpsum')).toHaveText('変更 1・追加 2・削除 1・同じ 6');
    const removed = row(page, 'removed');
    await expect(removed).toHaveCount(1);
    await expect(cell(removed, 'l')).toContainText('十六時間ほど眠ります');
    await expect(cell(removed, 'l').locator('.cmpbadge')).toHaveText('削除');
    await expect(cell(removed, 'r')).toHaveClass(/cmpgap/);
    await expect(row(page, 'added')).toHaveCount(2);
    // 削除は、追加より先（同じ場所：削除 → 追加）・右の順を保つ
    const order = await page
      .locator('#compare .cmprow')
      .evaluateAll((rs) => rs.map((r) => (r as HTMLElement).dataset.status));
    expect(order.indexOf('removed')).toBeLessThan(order.lastIndexOf('added'));
    for (const r of await page.locator('#compare .cmprow').all()) {
      const [l, rr] = [await boxOf(r.locator('.cmpl')), await boxOf(r.locator('.cmpr'))];
      expect(Math.abs(l.y - rr.y)).toBeLessThan(1);
    }

    // 右を v1 に（同じ版を左右に）：差分なし。左を v3・右を v1（向きを逆に）：左から右への変更
    await sel(page, 'right').selectOption('1');
    await expect(compare(page)).toContainText('同じ版を、左右に選んでいます');
    await expect(row(page, 'same')).toHaveCount(await page.locator('#compare .cmprow').count());
    await sel(page, 'left').selectOption('3');
    await expect(cell(row(page, 'changed'), 'l')).toContainText('一日に五回');
    await expect(cell(row(page, 'changed'), 'r')).toContainText('一日に三回');
    await expect(row(page, 'removed')).toHaveCount(2); // 左（v3）にだけある 2 つ
    await expect(row(page, 'added')).toHaveCount(1); // 右（v1）にだけある睡眠の段落

    // 選んだ版は、最新（v3）まで・v1 から。プルダウンは、最新から順に
    await expect(sel(page, 'left').locator('option')).toHaveText(['v3（最新）', 'v2', 'v1']);
  });

  test('開閉：ボタン・Esc・「閉じる」。閉じると、通常の本文に戻る（コメント欄も戻る）。フォーカスはボタンへ。キーボードだけで開ける・版を選べる', async ({
    page,
    app,
  }) => {
    const u = ui(page);
    await versions(page, app);
    const btn = page.locator('#btn-compare');
    await expect(btn).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#docbar select')).toBeVisible(); // 近くにある
    // キーボード：フォーカスして Enter
    await btn.focus();
    await page.keyboard.press('Enter');
    await expect(compare(page)).toBeVisible();
    await expect(btn).toHaveAttribute('aria-pressed', 'true');
    await expect(sel(page, 'left')).toBeFocused(); // 開いたら、左の版へ
    await expect(page.getByLabel('左の版')).toBeVisible();
    await expect(page.getByLabel('右の版')).toBeVisible();
    // 比べている間は、右のコメントを隠して、本文を広く使う
    await expect(u.panel).toBeHidden();
    // Esc で閉じる（フォーカスは、ボタンへ）
    await page.keyboard.press('Escape');
    await expect(compare(page)).toHaveCount(0);
    await expect(u.article.locator('h1')).toHaveText('比較の資料');
    await expect(btn).toBeFocused();
    await expect(u.panel).toBeVisible();
    // 「閉じる」・ボタン（もう一度押す）でも閉じる
    await btn.click();
    await expect(compare(page)).toBeVisible();
    await page.getByRole('button', { name: '閉じる（Esc）' }).click();
    await expect(compare(page)).toHaveCount(0);
    await btn.click();
    await btn.click();
    await expect(compare(page)).toHaveCount(0);
    // 開いたまま、別のページ（子ページ）へ移ると、閉じる
    await app.apply(
      { pages: [{ id: 'sub', title: '子', parent: 'root', markdown: '# 子\n\n本文です。\n' }] },
      { topic: DOC_ID },
    );
    await btn.click();
    await expect(compare(page)).toBeVisible();
    await page.evaluate(() => {
      location.hash = '#/cmp/sub';
    });
    await expect(compare(page)).toHaveCount(0);
    await expect(u.article.locator('h1')).toHaveText('子');
  });

  // 旧：破線の押せないボタンを出し、押すと理由のトースト（F44 (1)）。比べる相手がないので、出さない（RIK-055。UX の分析 P8）
  test('版が 1 つのページ：「並べて比べる」を出さない（版の選択も出ない）。版が 2 つになると、出る', async ({
    page,
    app,
  }) => {
    await expect(page.locator('#btn-compare')).toHaveCount(0);
    await expect(page.locator('#docbar select')).toHaveCount(0);
    await expect(compare(page)).toHaveCount(0);
    await expect(ui(page).article).toBeVisible();
    await app.apply({ revisions: [{ page: 'root', markdown: '# 猫の観察日記\n\n直した本文です。\n' }] }); // 既定のトピック（demo）
    await expect(page.locator('#btn-compare')).toBeVisible();
  });

  test('いま過去の版（v2）を見ているとき：左 v1・右 v2 で開く', async ({ page, app }) => {
    await versions(page, app);
    await page.locator('#docbar select').selectOption('2');
    await expect(page).toHaveURL(/#\/cmp\/root\/v2$/);
    await openCompare(page);
    await expect(sel(page, 'left')).toHaveValue('1');
    await expect(sel(page, 'right')).toHaveValue('2');
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/#\/cmp\/root\/v2$/); // 見ていた版に戻る
  });

  test('変更のある所だけ見る：同じブロックが、件数つきの折りたたみになる。開けば、見える。戻すと、すべて', async ({
    page,
    app,
  }) => {
    await versions(page, app);
    await openCompare(page);
    const total = await page.locator('#compare .cmprow').count();
    await page.getByLabel('変更のある所だけ見る').check();
    const groups = page.locator('#compare details.cmpgroup');
    await expect(groups.first()).toBeVisible();
    await expect(groups.first().locator('summary')).toContainText('変更のないブロック');
    // 変更・追加の行は、見えたまま。同じ行は、折りたたまれて、見えない
    await expect(row(page, 'changed')).toBeVisible();
    await expect(row(page, 'added')).toBeVisible();
    await expect(page.locator('#compare .cmprow[data-status="same"]').first()).toBeHidden();
    await groups.first().locator('summary').click();
    await expect(page.locator('#compare .cmprow[data-status="same"]').first()).toBeVisible();
    await page.getByLabel('変更のある所だけ見る').uncheck();
    await expect(groups).toHaveCount(0);
    await expect(page.locator('#compare .cmprow')).toHaveCount(total);
  });

  test('片方の版が取れない：その欄にエラー（再読み込み）・もう一方は出る。再読み込みで、直る', async ({
    page,
    app,
  }) => {
    await versions(page, app);
    await app.open(page, '#/cmp/root'); // 読み直す：v1 は、まだ取っていない（取った版は、覚えている）
    let fail = true;
    await page.route('**/api/page/cmp/root/1', (route) =>
      fail
        ? route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({ ok: false, error: '内部エラー' }),
          })
        : route.continue(),
    );
    await openCompare(page);
    await sel(page, 'left').selectOption('1');
    const err = page.locator('[data-side="left"] [role="alert"]');
    await expect(err).toContainText('v1 を読み込めませんでした');
    await expect(cell(page.locator('#compare .cmprow').first(), 'r')).toContainText('比較の資料'); // 右は、出ている
    await expect(page.locator('#compare .cmpl:not(.cmpgap)')).toHaveCount(0);
    await expect(page.locator('#compare .cmpsum')).toHaveCount(0); // 比べた結果ではない
    fail = false;
    await err.getByRole('button', { name: '再読み込み' }).click();
    await expect(err).toHaveCount(0);
    await expect(page.locator('#compare .cmpsum')).toBeVisible();
    await expect(cell(row(page, 'changed'), 'l')).toContainText('一日に三回');
  });

  test('50 版・大きな本文（200KB 級）：開ける・版を替えられる。読み込み中は、前の表示のまま（busy）', async ({
    page,
    app,
  }) => {
    test.setTimeout(120_000);
    // 100 段落ごとに、版の番号が入る（ほかは、版をまたいで同じ）。約 250KB
    const big = (n: number) =>
      lines(
        '# 大きな資料',
        '',
        ...Array.from(
          { length: 4000 },
          (_, i) => `第 ${i + 1} 段落です。猫は ${i % 7} 回、鳴きます。${i % 100 ? '' : `版 ${n}。`}`,
        ).flatMap((p) => [p, '']),
      );
    expect(Buffer.byteLength(big(2))).toBeGreaterThan(200_000);
    await app.switchTopic(page, DOC_ID, '大きい', '# 大きな資料\n\n最初の版です。\n');
    // 50 版を作る。CLI の標準入力（パイプ）は、250KB を、確実には渡せない（EAGAIN）ので、版のファイルを、作り物として、直に置く
    const dir = path.join(app.root, '.rikai', DOC_ID);
    for (let v = 2; v <= 50; v++) fs.writeFileSync(path.join(dir, 'pages', 'root', `v${v}.md`), big(v));
    const metaFile = path.join(dir, 'meta.json');
    const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
    meta.pages.root.versions = 50;
    meta.rev += 1;
    fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2));
    await expect(page.locator('#docbar select option')).toHaveCount(50, { timeout: 30_000 });
    await openCompare(page);
    await expect(sel(page, 'left').locator('option')).toHaveCount(50);
    await expect(sel(page, 'right')).toHaveValue('50');
    await expect(page.locator('#compare .cmpsum')).toHaveText('変更 40・追加 0・削除 0・同じ 3961', {
      timeout: 30_000,
    });
    expect(await page.locator('#compare .cmprow').count()).toBe(4001);
    // 版を替える：読み込み中は、前の表示のまま（busy）・読み込めたら、替わる。最初の版（小さい）との比較も
    await sel(page, 'left').selectOption('7');
    await expect(page.locator('#compare .cmpsum')).toHaveText('変更 40・追加 0・削除 0・同じ 3961', {
      timeout: 30_000,
    });
    await sel(page, 'left').selectOption('1');
    await expect(page.locator('#compare .cmpsum')).toContainText('追加', { timeout: 30_000 });
    await expect(page.locator('#compare .cmpgrid')).not.toHaveClass(/loading/);
    await expect(compare(page)).toHaveAttribute('aria-busy', 'false');
  });
});

// ---- html-app ----

// 2 つの版で、ボタンの置き場所が違う枠：ボタンを押すと、数が増える。幅で、色が変わる（@media）。画面の配色への対応を示す（<meta name="color-scheme">）：ダークも効く
const APP = (pos: 'left' | 'right', name: string, extra = '') =>
  lines(
    `${BT}html-app height=150`,
    '<meta name="color-scheme" content="light dark">',
    '<style>',
    'body{margin:0}',
    `#b{position:absolute;top:10px;${pos}:10px}`,
    '#n{position:absolute;top:50px;left:10px}',
    '#m{position:absolute;top:90px;left:10px;margin:0;color:rgb(1,2,3)}',
    '@media (max-width:500px){#m{color:rgb(7,8,9)}}',
    '</style>',
    `<button id="b">押す</button><span id="n">0</span><p id="m">${name}</p>`,
    '<script>',
    "var c = 0; document.getElementById('b').onclick = function () { c++; document.getElementById('n').textContent = String(c); };",
    extra,
    '</script>',
    BT,
  );
const APP_DOC = (v: number, pos: 'left' | 'right', extra = '') =>
  `# 枠の比較 v${v}\n\n共通の段落です。\n\n${APP(pos, `枠 v${v}`, extra)}`;

const fr = (page: Page, side: 'l' | 'r') => page.frameLocator(`#compare .cmp${side} iframe.appframe`).first();
const iframeOf = (page: Page, side: 'l' | 'r') => page.locator(`#compare .cmp${side} iframe.appframe`).first();
// 枠の文書の読み込み（スクリプトの実行まで）が終わるまで待つ：要素が見えた直後は、ボタンの処理が、まだ付いていないことがある
const loaded = (page: Page, side: 'l' | 'r') =>
  expect
    .poll(() =>
      fr(page, side)
        .locator('html')
        .evaluate(() => document.readyState),
    )
    .toBe('complete');
const frameWidthOf = (page: Page, side: 'l' | 'r') =>
  fr(page, side)
    .locator('html')
    .evaluate(() => window.innerWidth);
const scaleOf = (l: Locator) =>
  l.evaluate((e) => Number(/scale\(([^)]+)\)/.exec((e as HTMLElement).style.transform)?.[1] ?? 1));
const bodyBg = (page: Page, side: 'l' | 'r') =>
  fr(page, side)
    .locator('body')
    .evaluate((e) => getComputedStyle(e).backgroundColor);

// 自動の高さでない枠（height=150）は、すぐに、安定する
async function appVersions(page: Page, app: RikaiApp, extraL = '', extraR = '') {
  await app.switchTopic(page, DOC_ID, '枠の比較', APP_DOC(1, 'left', extraL));
  await app.apply({ revisions: [{ page: 'root', markdown: APP_DOC(2, 'right', extraR) }] }, { topic: DOC_ID });
  await expect(page.locator('#docbar select option')).toHaveCount(2);
}

test.describe('html-app の枠（比較）', () => {
  test('左 v1・右 v2：ボタンの位置が違う 2 つの枠が、どちらも動く（クリックで、それぞれ独立）。枠は、読み取り専用（個別のツールバーなし）', async ({
    page,
    app,
  }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await appVersions(page, app);
    await openCompare(page);
    await expect(sel(page, 'left')).toHaveValue('1');
    await expect(sel(page, 'right')).toHaveValue('2');
    await expect(page.locator('#compare iframe.appframe')).toHaveCount(2);
    const L = fr(page, 'l');
    const R = fr(page, 'r');
    await expect(L.locator('#m')).toHaveText('枠 v1'); // 左は v1 の枠・右は v2 の枠
    await expect(R.locator('#m')).toHaveText('枠 v2');
    // 隔離：sandbox は allow-scripts だけ。src は、左が v1・右が v2
    const sandbox = await page
      .locator('#compare iframe.appframe')
      .evaluateAll((els) => els.map((e) => e.getAttribute('sandbox')));
    expect(sandbox).toEqual(['allow-scripts', 'allow-scripts']);
    const src = await page
      .locator('#compare iframe.appframe')
      .evaluateAll((els) => els.map((e) => e.getAttribute('src')?.replace(/\?.*/, '')));
    expect(src).toEqual(['/appframe/cmp/root/1/0', '/appframe/cmp/root/2/0']);
    // ボタンの配置が、違う（左の枠は左寄り・右の枠は右寄り）
    const bx = (f: typeof L) =>
      f.locator('#b').evaluate((e) => ({ x: e.getBoundingClientRect().x, w: window.innerWidth }));
    const lb = await bx(L);
    const rb = await bx(R);
    expect(lb.x).toBeLessThan(20);
    expect(rb.x).toBeGreaterThan(rb.w / 2);
    // 独立：左を 3 回・右を 1 回
    await loaded(page, 'l');
    await loaded(page, 'r');
    for (let i = 1; i <= 3; i++) await clickToCount(L.locator('#b'), L.locator('#n'), i);
    await expect(L.locator('#n')).toHaveText('3');
    await expect(R.locator('#n')).toHaveText('0');
    await clickToCount(R.locator('#b'), R.locator('#n'), 1);
    await expect(R.locator('#n')).toHaveText('1');
    await expect(L.locator('#n')).toHaveText('3');
    // 個別の枠のツールバー・要素を選ぶ・拡大表示・「この枠にコメント」は、ない。比較用ツールバーは、1 つ
    await expect(page.locator('#compare .htmlapp .cap button')).toHaveCount(0);
    await expect(page.locator('#compare .apptools, #compare [data-pick], #compare [data-focus-open]')).toHaveCount(0);
    await expect(page.locator('#compare .cmptools')).toHaveCount(1);
    await expect(page.locator('#compare .cmptools')).toContainText('左右で共有しません');
    // ソース（左右で違う）は、見られる
    await page.locator('#compare .cmpl details.appsrc summary').click();
    await expect(page.locator('#compare .cmpl details.appsrc pre')).toContainText('left:10px');
    await page.locator('#compare .cmpr details.appsrc summary').click();
    await expect(page.locator('#compare .cmpr details.appsrc pre')).toContainText('right:10px');
  });

  test('比較用ツールバー：幅 375 → 左右とも 375（@media が効く）・768・1920（縮小表示も同じ）・自動。ライト／ダークも、左右同じ', async ({
    page,
    app,
  }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await appVersions(page, app);
    await openCompare(page);
    const tb = page.locator('#compare .cmptools');
    const w = (n: string) => tb.locator(`button[data-width="${n}"]`);
    const avail = async () => (await boxOf(page.locator('#compare .cmpl .appview').first())).width;
    const availR = async () => (await boxOf(page.locator('#compare .cmpr .appview').first())).width;
    expect(await avail()).toBeGreaterThan(400);
    expect(Math.abs((await avail()) - (await availR()))).toBeLessThan(1);
    // 最初は、自動（本文の幅いっぱい）。@media (max-width: 500px) は、本文の幅（約 490px）で効く
    await expect.poll(() => frameWidthOf(page, 'l')).toBeCloseTo(await avail(), 0);
    // 375
    await w('375').click();
    await expect(w('375')).toHaveAttribute('aria-pressed', 'true');
    for (const s of ['l', 'r'] as const) {
      await expect.poll(async () => (await boxOf(iframeOf(page, s))).width).toBeCloseTo(375, 0);
      expect(await frameWidthOf(page, s)).toBe(375);
      await expect
        .poll(() =>
          fr(page, s)
            .locator('#m')
            .evaluate((e) => getComputedStyle(e).color),
        )
        .toBe('rgb(7, 8, 9)'); // @media (max-width: 500px)
    }
    // 768：本文より広い（約 490px）：その幅で計算して、縮小して見せる。左右同じ
    await w('768').click();
    await expect(w('768')).toHaveAttribute('aria-pressed', 'true');
    const full = await avail();
    for (const s of ['l', 'r'] as const) {
      await expect.poll(() => frameWidthOf(page, s)).toBe(768);
      await expect
        .poll(async () => (await boxOf(iframeOf(page, s))).width)
        .toBeCloseTo(768 * Math.max(0.5, full / 768), 0);
      expect(await scaleOf(iframeOf(page, s))).toBeCloseTo(Math.max(0.5, full / 768), 3);
    }
    // 1920：縮小は、下限 50%。左右とも、置き場が横にスクロールできる
    await w('1920').click();
    for (const s of ['l', 'r'] as const) {
      await expect.poll(() => frameWidthOf(page, s)).toBe(1920);
      expect(await scaleOf(iframeOf(page, s))).toBeCloseTo(0.5, 3);
      expect(
        await page
          .locator(`#compare .cmp${s} .appview`)
          .first()
          .evaluate((e) => e.scrollWidth > e.clientWidth + 0.5),
      ).toBe(true);
      // 縮小しても、枠の中のボタンは押せる（縮小表示の座標）
      await fr(page, s).locator('#b').scrollIntoViewIfNeeded();
    }
    expect(await page.locator('#docscroll').evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true); // ページ全体は、横にスクロールしない
    // 自動に戻る：左右とも
    await w('auto').click();
    for (const s of ['l', 'r'] as const) {
      await expect.poll(() => frameWidthOf(page, s)).toBeCloseTo(full, 0);
      expect(await iframeOf(page, s).evaluate((e) => [e.style.width, e.style.transform])).toEqual(['', '']);
    }
    // ライト／ダーク：左右同じ。枠の中も（対応を示した枠）
    const mode = tb.locator('button[data-frame-mode]');
    await expect(mode).toHaveAttribute('data-frame-mode', 'light');
    expect(await bodyBg(page, 'l')).toBe(await bodyBg(page, 'r'));
    await mode.click();
    await expect(mode).toHaveAttribute('data-frame-mode', 'dark');
    for (const s of ['l', 'r'] as const) {
      await expect(iframeOf(page, s)).toHaveAttribute('data-mode', 'dark');
      await expect.poll(() => bodyBg(page, s)).toBe('rgb(9, 9, 11)');
    }
    await mode.click();
    for (const s of ['l', 'r'] as const) {
      await expect(iframeOf(page, s)).toHaveAttribute('data-mode', 'light');
      await expect.poll(() => bodyBg(page, s)).not.toBe('rgb(9, 9, 11)');
    }
    // 状態は、共有しない：幅を変えても、数は、それぞれ
    await loaded(page, 'l');
    await clickToCount(fr(page, 'l').locator('#b'), fr(page, 'l').locator('#n'), 1);
    await w('375').click();
    await expect.poll(() => frameWidthOf(page, 'r')).toBe(375);
    await expect(fr(page, 'l').locator('#n')).toHaveText('1'); // 幅の変更で、再読み込みされない
    await expect(fr(page, 'r').locator('#n')).toHaveText('0');
  });

  test('版を替えても（新しい枠）、比較用ツールバーの選び（幅・外観）が、左右の新しい枠にも効く。画面の外観が変わると、枠だけの外観は解ける', async ({
    page,
    app,
  }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await appVersions(page, app);
    await app.apply({ revisions: [{ page: 'root', markdown: APP_DOC(3, 'left') }] }, { topic: DOC_ID });
    await expect(page.locator('#docbar select option')).toHaveCount(3);
    await openCompare(page);
    await expect(sel(page, 'left')).toHaveValue('2');
    const tb = page.locator('#compare .cmptools');
    await tb.locator('button[data-width="375"]').click();
    await tb.locator('button[data-frame-mode]').click();
    await sel(page, 'left').selectOption('1');
    await expect(fr(page, 'l').locator('#m')).toHaveText('枠 v1');
    for (const s of ['l', 'r'] as const) {
      await expect.poll(async () => (await boxOf(iframeOf(page, s))).width).toBeCloseTo(375, 0);
      await expect(iframeOf(page, s)).toHaveAttribute('data-mode', 'dark');
    }
    await expect(tb.locator('button[data-width="375"]')).toHaveAttribute('aria-pressed', 'true');
    // 画面の外観が変わる：対応を示した枠は、画面に従う（枠だけの外観は、解く）
    await page.emulateMedia({ colorScheme: 'dark' });
    for (const s of ['l', 'r'] as const) await expect(iframeOf(page, s)).toHaveAttribute('data-mode', 'dark');
    await page.waitForTimeout(400); // 画面の外観の変化が、画面に届くまで（見た目は、すでにダーク）。すぐ戻すと、変化がなかったことになる
    await page.emulateMedia({ colorScheme: 'light' });
    for (const s of ['l', 'r'] as const) await expect(iframeOf(page, s)).toHaveAttribute('data-mode', 'light');
    await expect(tb.locator('button[data-frame-mode]')).toHaveAttribute('data-frame-mode', 'light');
  });

  test('読み取り専用：文の選択・ブロックへのマウス・画像を押す・枠で、コメント・範囲選択・拡大表示の入口が出ない。右のコメント欄は隠れる。開閉で、下書きが増えない', async ({
    page,
    app,
  }) => {
    const u = ui(page);
    const doc = (v: number) =>
      `# 読み取り専用 v${v}\n\n選んでみる段落です。版 ${v}。\n\n![図](assets/pic.png)\n\n${APP(v === 1 ? 'left' : 'right', `枠 v${v}`)}`;
    await app.switchTopic(page, DOC_ID, '読み取り専用', doc(1), { 'pic.png': Buffer.from('iVBORw0KGgo=', 'base64') });
    await app.apply({ revisions: [{ page: 'root', markdown: doc(2) }] }, { topic: DOC_ID });
    await expect(page.locator('#docbar select option')).toHaveCount(2);
    await addTextComment(page, '選んでみる段落です', '既存の下書き');
    await expect(u.threads).toHaveCount(1);
    await openCompare(page);
    await expect(u.panel).toBeHidden();
    await expect(u.regbtn).toBeHidden();
    // 文を、本物のマウスで選ぶ：入口のバーは、出ない
    const t = page.locator('#compare .cmpr p', { hasText: '選んでみる段落です' });
    const b = await boxOf(t);
    await page.mouse.move(b.x + 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + 120, b.y + b.height / 2, { steps: 5 });
    await page.mouse.up();
    expect(await page.evaluate(() => (getSelection()?.toString() ?? '').length)).toBeGreaterThan(2); // 選べてはいる（文字として）
    await expect(u.actbar).toBeHidden();
    await hoverBlock(page, t);
    await expect(u.actbar).toBeHidden();
    // 画像を押しても、拡大表示は開かない。枠のブロックにマウスを置いても、入口は出ない
    const img = page.locator('#compare .cmpr img').first();
    await img.click({ force: true });
    await expect(u.lightbox).toBeHidden();
    await hoverBlock(page, page.locator('#compare .cmpr .htmlapp').first());
    await expect(u.actbar).toBeHidden();
    // コメントの印・番号・範囲の枠は、出ない
    await expect(u.bno).toHaveCount(0);
    await expect(page.locator('#compare mark.hl, #compare .blk-thread, #compare [data-focus-entry]')).toHaveCount(0);
    expect(await page.locator('#compare [data-bid]').count()).toBeGreaterThan(0); // 比較のために、ブロックには印がある（が、入口は、ここにない）
    // 範囲を選ぶボタンのキーボード操作もない
    await expect(page.locator('#regbtn')).toBeHidden();
    // 開閉：既存の下書きは、そのまま。増えない
    await page.keyboard.press('Escape');
    await expect(compare(page)).toHaveCount(0);
    await expect(u.threads).toHaveCount(1);
    await expect(u.composer).toHaveCount(0);
    await expect(page.locator('#btn-submit')).toContainText('AI に送る');
  });

  test('枠の中にフォーカスがあっても、Esc で閉じる（枠から届く Esc の知らせ）', async ({ page, app }) => {
    await appVersions(page, app);
    await openCompare(page);
    await expect(fr(page, 'r').locator('#m')).toHaveText('枠 v2');
    await loaded(page, 'r');
    await clickToCount(fr(page, 'r').locator('#b'), fr(page, 'r').locator('#n'), 1); // フォーカスは、枠の中（親の Esc は、届かない）
    await expect(fr(page, 'r').locator('#n')).toHaveText('1');
    await page.keyboard.press('Escape');
    await expect(compare(page)).toHaveCount(0);
    await expect(ui(page).article).toBeVisible();
  });

  test('開閉 50 回（版の切り替えを挟んで）：iframe・リスナー・DOM が増えない。閉じると、枠は残らない', async ({
    page,
    app,
  }) => {
    test.setTimeout(240_000);
    await appVersions(page, app);
    await page.waitForTimeout(500);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    const metric = async () => {
      await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
      const { metrics } = await cdp.send('Performance.getMetrics');
      const get = (n: string) => metrics.find((m) => m.name === n)?.value ?? 0;
      return {
        listeners: get('JSEventListeners'),
        nodes: get('Nodes'),
        frames: await page.evaluate(() => document.querySelectorAll('iframe').length),
      };
    };
    const cycle = async () => {
      await page.locator('#btn-compare').click();
      await expect(page.locator('#compare iframe.appframe')).toHaveCount(2);
      // 版を替える（枠が、作り直される）
      await sel(page, 'left').selectOption('2');
      await expect(fr(page, 'l').locator('#m')).toHaveText('枠 v2');
      await expect(page.locator('#compare iframe.appframe')).toHaveCount(2);
      await sel(page, 'left').selectOption('1');
      await expect(fr(page, 'l').locator('#m')).toHaveText('枠 v1');
      await page.keyboard.press('Escape');
      await expect(compare(page)).toHaveCount(0);
      await expect(page.locator('#compare')).toHaveCount(0);
      await expect(page.locator('iframe.appframe')).toHaveCount(1); // 通常の本文の枠だけ（比較の枠は、解放されている）
    };
    for (let i = 0; i < 4; i++) await cycle();
    const base = await metric();
    for (let i = 0; i < 50; i++) await cycle();
    const after = await metric();
    expect(after.frames).toBe(base.frames);
    expect(after.frames).toBe(1);
    expect(after.listeners - base.listeners).toBeLessThanOrEqual(12);
    expect(after.nodes - base.nodes).toBeLessThanOrEqual(80);
  });

  test('左の枠が、偽の pick・state・snapshot・resize を洪水で送る：右の枠・親（コメント・画面）に影響しない。比較は開いたまま', async ({
    page,
    app,
  }) => {
    const u = ui(page);
    const EVIL = [
      "var XSS = { __rikai: 1, type: 'pick', selector: 'a[href=\"javascript:alert(1)\"]', tag: 'a', text: '<img src=x onerror=window.__xss=1>', rect: { x: 1, y: 2, w: 3, h: 4 }, styles: { color: 'red' }, frame: { w: 10, h: 10 } };",
      "var ST = { __rikai: 1, type: 'state', json: JSON.stringify({ hostile: true }) };",
      "var SN = { __rikai: 1, type: 'snapshot', id: 'a'.repeat(12), png: null };",
      "var RS = { __rikai: 1, type: 'resize', height: 2400 };",
      "setInterval(function () { for (var i = 0; i < 30; i++) [XSS, ST, SN, RS].forEach(function (m) { parent.postMessage(m, '*'); }); }, 30);",
    ].join('\n');
    // 右の枠（v2）は、自動の高さ（height なし）：左が、右の高さを動かせないことを確かめる
    const rightApp = lines(
      `${BT}html-app`,
      '<button id="b">押す</button><span id="n">0</span>',
      '<script>var c=0;document.getElementById("b").onclick=function(){c++;document.getElementById("n").textContent=String(c)}</script>',
      BT,
    );
    await app.switchTopic(page, DOC_ID, '偽の知らせ', `# 偽 v1\n\n本文です。\n\n${APP('left', '枠 v1', EVIL)}`);
    await app.apply(
      { revisions: [{ page: 'root', markdown: `# 偽 v2\n\n本文です。\n\n${rightApp}` }] },
      { topic: DOC_ID },
    );
    await expect(page.locator('#docbar select option')).toHaveCount(2);
    await page.evaluate(() => {
      (window as unknown as { __xss?: number }).__xss = 0;
    });
    await openCompare(page);
    await expect(page.locator('#compare iframe.appframe')).toHaveCount(2);
    await expect(fr(page, 'r').locator('#n')).toHaveText('0');
    await loaded(page, 'r');
    await expect(iframeOf(page, 'r')).not.toHaveAttribute('height', '200'); // 自動の高さが、落ち着く（最初の高さは 200）
    const h0 = await iframeOf(page, 'r').getAttribute('height');
    await page.waitForTimeout(2500); // 洪水
    // 親：下書き・トースト・入力欄・拡大表示が、増えない。比較は、開いたまま（Esc は、枠が代わりに押せない）
    await expect(u.composer).toHaveCount(0);
    await expect(u.toast).toBeHidden();
    await expect(u.lightbox).toBeHidden();
    await expect(compare(page)).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBe(0);
    // 右の枠：動く・高さは、左が動かせない・状態は、そのまま
    await clickToCount(fr(page, 'r').locator('#b'), fr(page, 'r').locator('#n'), 1);
    await expect(fr(page, 'r').locator('#n')).toHaveText('1');
    expect(await iframeOf(page, 'r').getAttribute('height')).toBe(h0);
    // 閉じても、下書きは、できていない
    await page.keyboard.press('Escape');
    await expect(compare(page)).toHaveCount(0);
    await expect(u.threads).toHaveCount(0);
    await expect(u.composer).toHaveCount(0);
    await expect(u.article).toBeVisible();
  });

  test('新しい版が増える（rikai apply）：比較は壊れない。選んだ版を保つ・「最新」の札が移る・案内が出る・枠は作り直されない。右を最新にできる', async ({
    page,
    app,
  }) => {
    await appVersions(page, app);
    await openCompare(page);
    await expect(page.locator('[data-side="right"] .cmptag')).toHaveText('最新');
    await expect(fr(page, 'l').locator('#m')).toHaveText('枠 v1');
    await loaded(page, 'l'); // 読み込みが終わってから押す
    await clickToCount(fr(page, 'l').locator('#b'), fr(page, 'l').locator('#n'), 1);
    await expect(fr(page, 'l').locator('#n')).toHaveText('1');
    await page
      .locator('#compare iframe.appframe')
      .first()
      .evaluate((e) => {
        (e as unknown as { __mark?: number }).__mark = 1;
      });
    await app.apply({ revisions: [{ page: 'root', markdown: APP_DOC(3, 'left') }] }, { topic: DOC_ID });
    await expect(page.locator('[data-side="right"] .cmptag')).toHaveText('過去の版');
    await expect(sel(page, 'left')).toHaveValue('1');
    await expect(sel(page, 'right')).toHaveValue('2');
    await expect(sel(page, 'right').locator('option')).toHaveText(['v3（最新）', 'v2', 'v1']);
    await expect(page.locator('[data-newer]')).toContainText('新しい版 v3 が届きました');
    // 枠は、そのまま（状態が、最初に戻らない）
    expect(
      await page
        .locator('#compare iframe.appframe')
        .first()
        .evaluate((e) => (e as unknown as { __mark?: number }).__mark),
    ).toBe(1);
    await expect(fr(page, 'l').locator('#n')).toHaveText('1');
    await expect(compare(page)).toBeVisible();
    await page.getByRole('button', { name: '右を v3 にする' }).click();
    await expect(sel(page, 'right')).toHaveValue('3');
    await expect(fr(page, 'r').locator('#m')).toHaveText('枠 v3');
    await expect(page.locator('[data-side="right"] .cmptag')).toHaveText('最新');
    await expect(page.locator('[data-newer]')).toHaveCount(0);
  });
});

// ---- 窓・外観 ----

// 文字のコントラスト：比べる画面の、見えている文字ごとに、色と、背景の比（親 → 子の順に、背景を重ねる）。AA（4.5）に届かないものの一覧
const contrastFailures = (page: Page) =>
  page.evaluate(() => {
    type C = [number, number, number, number];
    const parse = (c: string): C | null => {
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const p = (m[1] as string)
        .split(/[ ,/]+/)
        .filter(Boolean)
        .map(Number);
      return [p[0] as number, p[1] as number, p[2] as number, p[3] ?? 1];
    };
    const lin = (v: number) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    const luminance = (r: C) => 0.2126 * lin(r[0]) + 0.7152 * lin(r[1]) + 0.0722 * lin(r[2]);
    const over = (f: C, b: C): C =>
      [0, 1, 2].map((i) => (f[i] as number) * f[3] + (b[i] as number) * (1 - f[3])).concat(1) as C;
    const backdropOf = (el: Element): C => {
      const chain: Element[] = [];
      for (let e: Element | null = el; e; e = e.parentElement) chain.unshift(e);
      let acc: C = [255, 255, 255, 1];
      for (const e of chain) {
        const bg = parse(getComputedStyle(e).backgroundColor);
        if (bg && bg[3] > 0) acc = over(bg, acc);
      }
      return acc;
    };
    const out: string[] = [];
    const root = document.querySelector('#compare') as Element;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const t = (n.nodeValue || '').trim();
      const el = n.parentElement;
      if (!t || !el || el.closest('svg, iframe, [hidden], option')) continue;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (r.width < 2 || r.height < 2 || cs.visibility === 'hidden' || cs.display === 'none') continue;
      const fg = parse(cs.color);
      if (!fg) continue;
      const bg = backdropOf(el);
      const text = over(fg, bg);
      const [l1, l2] = [luminance(text), luminance(bg)];
      const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      if (ratio < 4.5)
        out.push(`${el.tagName.toLowerCase()}.${String(el.className)} 「${t.slice(0, 12)}」${ratio.toFixed(2)}:1`);
    }
    return out;
  });

test.describe('窓・外観', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(`${scheme}：札（追加・変更前・変更後・削除）・状態の背景・折りたたみ・文字の差分が、読める（AA）。色だけに頼らない`, async ({
      page,
      app,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await versions(page, app);
      await openCompare(page);
      await sel(page, 'left').selectOption('1');
      await expect(row(page, 'removed')).toHaveCount(1);
      await row(page, 'changed').locator('.cmpr details.diffbox summary').click();
      expect(await contrastFailures(page)).toEqual([]);
      await page.getByLabel('変更のある所だけ見る').check();
      await expect(page.locator('#compare details.cmpgroup').first()).toBeVisible();
      expect(await contrastFailures(page)).toEqual([]);
      // 状態の背景は、ページの地と違う（強調が、見える）
      const paper = await page.locator('#docscroll').evaluate((e) => getComputedStyle(e).backgroundColor);
      const tint = await row(page, 'removed')
        .locator('.cmpl')
        .evaluate((e) => getComputedStyle(e).backgroundColor);
      expect(tint).not.toBe(paper);
      expect(tint).not.toBe('rgba(0, 0, 0, 0)');
    });
  }

  test('狭い窓（420px・700px：760px 未満）：左右ではなく、上下に並ぶ（札で、どちらの版か分かる）。横にスクロールしない。広い窓（800px 以上）は、左右', async ({
    page,
    app,
  }) => {
    await versions(page, app);
    await page.setViewportSize({ width: 420, height: 800 });
    await openCompare(page);
    for (const width of [420, 700]) {
      await page.setViewportSize({ width, height: 800 });
      const r = row(page, 'changed');
      await expect(r).toBeVisible();
      const [l, rr] = [await boxOf(cell(r, 'l')), await boxOf(cell(r, 'r'))];
      expect(rr.y, `${width}px：右は、左の下`).toBeGreaterThanOrEqual(l.y + l.height - 1);
      expect(Math.abs(rr.x - l.x), `${width}px：左端が揃う`).toBeLessThan(2);
      await expect(cell(r, 'l').locator('.cmpside')).toBeVisible();
      await expect(cell(r, 'l').locator('.cmpside')).toHaveText('左 v2');
      await expect(cell(r, 'r').locator('.cmpside')).toHaveText('右 v3');
      // 追加の行：空白の欄は、出さない
      await expect(cell(row(page, 'added'), 'l')).toBeHidden();
      expect(
        await page.locator('#docscroll').evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
        `${width}px：横スクロールなし`,
      ).toBe(true);
      // 版の選択・ボタンが、画面の中に収まる
      for (const side of ['left', 'right'] as const) {
        const b = await boxOf(sel(page, side));
        expect(b.x + b.width).toBeLessThanOrEqual(width + 1);
      }
      const close = await boxOf(page.getByRole('button', { name: '閉じる（Esc）' }));
      expect(close.x + close.width).toBeLessThanOrEqual(width + 1);
    }
    await page.setViewportSize({ width: 820, height: 800 });
    const r = row(page, 'changed');
    const [l, rr] = [await boxOf(cell(r, 'l')), await boxOf(cell(r, 'r'))];
    expect(Math.abs(rr.y - l.y)).toBeLessThan(1);
    expect(rr.x).toBeGreaterThan(l.x + l.width - 1);
    await expect(cell(r, 'l').locator('.cmpside')).toBeHidden();
  });

  test('狭い窓（420px）の html-app：左右の枠が、上下に並ぶ。幅 375 を選ぶと、両方 375（本文より狭ければ、縮小）', async ({
    page,
    app,
  }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await appVersions(page, app);
    await page.setViewportSize({ width: 420, height: 800 });
    await openCompare(page);
    const tb = page.locator('#compare .cmptools');
    await tb.locator('button[data-width="375"]').click();
    for (const s of ['l', 'r'] as const) {
      await expect.poll(() => frameWidthOf(page, s)).toBe(375);
      await expect
        .poll(() =>
          fr(page, s)
            .locator('#m')
            .evaluate((e) => getComputedStyle(e).color),
        )
        .toBe('rgb(7, 8, 9)');
    }
    await expect // 右は、左の下（幅を変えた直後は、配置が落ち着くまで、読み直す）
      .poll(
        async () =>
          (await boxOf(iframeOf(page, 'r'))).y -
          (await boxOf(iframeOf(page, 'l'))).y -
          (await boxOf(iframeOf(page, 'l'))).height,
      )
      .toBeGreaterThanOrEqual(-1);
    await expect.poll(() => page.locator('#docscroll').evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
    await loaded(page, 'r');
    // 下にある枠は、押す前に、スクロールで動く：負荷が高いと、動いている最中の 1 回目の押下が、枠に届かないことがある（人は、押し直す）。数が増えるまで、押し直す
    await expect(async () => {
      if ((await fr(page, 'r').locator('#n').textContent()) === '0')
        await fr(page, 'r').locator('#b').click({ timeout: 2000 });
      await expect(fr(page, 'r').locator('#n')).toHaveText('1', { timeout: 2000 });
    }).toPass({ timeout: 15_000 });
    await expect(fr(page, 'l').locator('#n')).toHaveText('0');
  });
});

// ---- 開く前の状態の復元・種類の変更・安全・全面の書き換え ----

test.describe('比べる画面：開く前の状態・差分の見え方', () => {
  test('入力中のコメント：開いても、入力欄・文はそのまま（右のコメント欄が隠れるだけ）。閉じると、同じ対象・同じ文で続けられる。送ると、元の段落のコメントになる', async ({
    page,
    app,
  }) => {
    const u = ui(page);
    await versions(page, app);
    await openComposerOnText(page, '猫は一日に五回、ごはんを食べます');
    await u.composer.locator('textarea').fill('書きかけのコメントです');
    await openCompare(page);
    await expect(u.composer).toBeHidden(); // 比べている間は、右のコメント欄ごと、隠れている（入力欄の対象・文は、そのまま持っている）
    await page.keyboard.press('Escape');
    await expect(compare(page)).toHaveCount(0);
    await expect(u.composer).toBeVisible();
    await expect(u.composer.locator('textarea')).toHaveValue('書きかけのコメントです');
    await expect(u.article.locator('.blk-pending, mark.hl.pending').first()).toBeVisible(); // 本文の対象の強調も、戻る
    await u.composer.getByRole('button', { name: 'コメントを追加' }).click();
    await expect(u.composer).toHaveCount(0);
    await expect(u.threads).toHaveCount(1);
    await expect(u.article.locator('mark.hl').first()).toContainText('猫は一日に五回、ごはんを食べます'); // 元の対象に付いた
    await expect(u.threads.first()).toContainText('書きかけのコメントです');
  });

  test('比べている間に新しい版が届き、対象が新しい版にもあるとき：その対象で、同じ文のまま戻る。送ると、元の段落のコメントになる', async ({
    page,
    app,
  }) => {
    const u = ui(page);
    await versions(page, app);
    await openComposerOnText(page, '猫は一日に五回、ごはんを食べます');
    await u.composer.locator('textarea').fill('書きかけ A');
    await openCompare(page);
    await app.apply(
      { revisions: [{ page: 'root', markdown: `${V3}\n新しい版で足した段落です。\n` }] },
      { topic: DOC_ID },
    );
    await expect(page.locator('[data-newer]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(compare(page)).toHaveCount(0);
    await expect(u.article).toContainText('新しい版で足した段落です');
    await expect(u.composer).toBeVisible();
    await expect(u.composer.locator('textarea')).toHaveValue('書きかけ A');
    await expect(page.locator('[data-lost-draft]')).toHaveCount(0);
    await u.composer.getByRole('button', { name: 'コメントを追加' }).click();
    await expect(u.threads).toHaveCount(1);
    await expect(u.article.locator('mark.hl').first()).toContainText('猫は一日に五回、ごはんを食べます');
  });

  test('新しい版に対象がなくなったとき：別の対象に付けない（次に別の段落で開いた入力欄は、空）。知らせて、「対象を失った下書き」に残す（コピー・破棄）', async ({
    page,
    app,
  }) => {
    const u = ui(page);
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await versions(page, app);
    await openComposerOnText(page, '猫は一日に五回、ごはんを食べます');
    await u.composer.locator('textarea').fill('書きかけ A');
    await openCompare(page);
    await app.apply(
      { revisions: [{ page: 'root', markdown: V3.replace('一日に五回', '毎日、六度') }] },
      { topic: DOC_ID },
    );
    await expect(page.locator('[data-newer]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(compare(page)).toHaveCount(0);
    await expect(u.article).toContainText('毎日、六度');
    await expect(u.composer).toHaveCount(0); // 入力欄は、閉じたまま
    await expect(u.toast).toContainText(
      '書きかけのコメントの対象が、新しい版でなくなりました。文は、下書きとして残しています',
    );
    const lost = page.locator('[data-lost-draft]');
    await expect(lost).toBeVisible();
    await expect(lost).toContainText('対象を失った下書き');
    await expect(lost.locator('.lostdraft-text')).toHaveText('書きかけ A');
    // 別の段落で、入力欄を開く：前の文は、入っていない（別の対象に付かない）
    await openComposerOnText(page, '導入の段落です');
    await expect(u.composer.locator('textarea')).toHaveValue('');
    await expect(lost).toBeVisible(); // 失った下書きは、そのまま
    await u.composer.getByRole('button', { name: 'やめる' }).click();
    // コピー（利用者の操作）・破棄
    await lost.getByRole('button', { name: 'コピー' }).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('書きかけ A');
    await lost.getByRole('button', { name: '破棄' }).click();
    await expect(lost).toHaveCount(0);
  });

  test('スクロール位置：開く前の位置（366px 前後）へ、閉じたあと、戻る', async ({ page, app }) => {
    const long = (n: number) =>
      lines(
        '# 長い資料',
        '',
        ...Array.from({ length: 60 }, (_, i) => `第 ${i + 1} 段落です。版 ${n}。猫は眠ります。`).flatMap((p) => [
          p,
          '',
        ]),
      );
    await versions(page, app, [long(1), long(2), long(3)]);
    const top = () => page.locator('#docscroll').evaluate((e) => e.scrollTop);
    await page.locator('#docscroll').evaluate((e) => {
      e.scrollTop = 366;
    });
    await expect.poll(top).toBe(366);
    await openCompare(page);
    await page.keyboard.press('Escape');
    await expect(compare(page)).toHaveCount(0);
    await expect(ui(page).article.locator('h1')).toBeVisible();
    await expect.poll(top).toBeGreaterThan(360);
    expect(Math.abs((await top()) - 366)).toBeLessThanOrEqual(2);
    // 位置が範囲外になっていても（本文が短くなった）、収まる：最大を超えない
    await page.locator('#docscroll').evaluate((e) => {
      e.scrollTop = e.scrollHeight;
    });
    const max = await top();
    await openCompare(page);
    await page.keyboard.press('Escape');
    await expect(compare(page)).toHaveCount(0);
    await expect.poll(top).toBeLessThanOrEqual(max);
    await expect.poll(top).toBeGreaterThan(max - 3);
  });

  test('スクロール位置：戻したあと、すぐに利用者がスクロールしたら、巻き戻さない', async ({ page, app }) => {
    const long = (n: number) =>
      lines(
        '# 長い資料',
        '',
        ...Array.from({ length: 60 }, (_, i) => `第 ${i + 1} 段落です。版 ${n}。猫は眠ります。`).flatMap((p) => [
          p,
          '',
        ]),
      );
    await versions(page, app, [long(1), long(2), long(3)]);
    await page.locator('#docscroll').evaluate((e) => {
      e.scrollTop = 366;
    });
    await openCompare(page);
    // 閉じた直後に、スクロールする（戻す処理の、2 フレーム後の置き直しより、前に）
    await page.evaluate(() => {
      const sc = document.getElementById('docscroll') as HTMLElement;
      const mo = new MutationObserver(() => {
        if (!document.getElementById('article')) return;
        mo.disconnect();
        const iv = setInterval(() => {
          if (Math.abs(sc.scrollTop - 366) < 2) {
            sc.scrollTop = 1500; // 戻った直後に、利用者が動かした
            clearInterval(iv);
          }
        }, 1);
        setTimeout(() => clearInterval(iv), 3000);
      });
      mo.observe(sc, { childList: true, subtree: true });
    });
    await page.keyboard.press('Escape');
    await expect(compare(page)).toHaveCount(0);
    await page.waitForTimeout(600);
    expect(await page.locator('#docscroll').evaluate((e) => e.scrollTop)).toBeGreaterThan(1000); // 366 に、巻き戻らない
  });

  test('種類だけが変わったブロック（段落 → 見出し・箇条書き → 番号つき・段落 → 引用）：「変更前」「変更後」になり、種類の変化が書かれる。F11 の「前の版からの変更」でも、変更', async ({
    page,
    app,
  }) => {
    const A = lines('# 題', '', '概要です。', '', '- 項目 A', '- 項目 B', '', '注意です。');
    const B = lines('# 題', '', '## 概要です。', '', '1. 項目 A', '2. 項目 B', '', '> 注意です。');
    await versions(page, app, [A, B]);
    // F11（通常の表示）：変更として出る（見出し・番号つき・引用の 3 か所 + 項目 2 つ）
    await expect(ui(page).docbar).toContainText('変更 4');
    await openCompare(page);
    await expect(page.locator('#compare .cmpsum')).toHaveText('変更 4・追加 0・削除 0・同じ 1');
    await expect(row(page, 'changed')).toHaveCount(4);
    await expect(cell(row(page, 'changed').first(), 'l').locator('.cmpbadge')).toHaveText('変更前');
    const notes = page.locator('#compare .cmpr details.diffbox');
    await notes.first().locator('summary').click();
    await expect(notes.first().locator('.diffnote')).toHaveText('ブロックの種類が変わりました：p → h2');
    await notes.nth(1).locator('summary').click();
    await expect(notes.nth(1).locator('.diffnote')).toHaveText(
      'ブロックの種類が変わりました：箇条書き → 番号つきの並び',
    );
    await notes.nth(3).locator('summary').click();
    await expect(notes.nth(3).locator('.diffnote')).toHaveText('ブロックの種類が変わりました：p → blockquote');
  });

  test('文字の差分は、文字として描く：HTML を含む文が、タグにならない（img・script が増えない・window.__xss が動かない）', async ({
    page,
    app,
  }) => {
    const evil = '`<img src=x onerror=window.__xss=1>` と `<script>window.__xss=1</script>`';
    await versions(page, app, [`# 題\n\n前の文：${evil}\n`, `# 題\n\n後の文：${evil}\n`]);
    await openCompare(page);
    const d = row(page, 'changed').locator('.cmpr details.diffbox');
    await d.locator('summary').click();
    await expect(d.locator('.diff')).toContainText('<img src=x onerror=window.__xss=1>');
    await expect(d.locator('.diff')).toContainText('<script>window.__xss=1</script>');
    await expect(d.locator('.diff img, .diff script, .diff [onerror]')).toHaveCount(0);
    await expect(compare(page).locator('script, img[src="x"]')).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  });

  test('変更が多すぎる（対応づけの予算を超える）：上部に案内。追加と削除として並ぶ。ふつうの比較では、出ない', async ({
    page,
    app,
  }) => {
    const many = (tag: string) =>
      lines(...Array.from({ length: 150 }, (_, i) => `${tag} の ${i} 番目の段落です。`).flatMap((p) => [p, '']));
    await versions(page, app, [many('前'), many('後')]);
    await openCompare(page);
    await expect(page.locator('[data-limited]')).toHaveText(
      '変更が多すぎて、対応づけていません（追加と削除として並べています）',
    );
    await expect(page.locator('#compare .cmpsum')).toHaveText('変更 0・追加 150・削除 150・同じ 0');
    await app.apply(
      { revisions: [{ page: 'root', markdown: many('後').replace('0 番目', '0 番目の、直した') }] },
      { topic: DOC_ID },
    );
    await sel(page, 'right').selectOption('3'); // v2 → v3：1 か所だけの変更
    await sel(page, 'left').selectOption('2');
    await expect(page.locator('[data-limited]')).toHaveCount(0);
    await expect(page.locator('#compare .cmpsum')).toContainText('変更 1');
  });
});

test('外への通信が出ない・合言葉が URL に残らない（比較を開いても）', async ({ page, app }) => {
  await appVersions(page, app);
  await openCompare(page);
  await expect(page.locator('#compare iframe.appframe')).toHaveCount(2);
  await page.waitForTimeout(500);
  expect(app.external).toEqual([]);
  expect(page.url()).not.toContain('t=');
});
