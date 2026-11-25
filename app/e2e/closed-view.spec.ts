// 終了したトピックの閲覧（0.1.4・F54）：終了しても、全面の画面で覆わず、本文・ページ・版・並べて比べる・拡大表示・コメントのスレッドを読める。
// 書く入口（コメント・範囲・要素・枠・拡大のドック・返信・追加・解決・再開・回答・編集・削除・添付・AI に送る・終了）は、すべてない。サーバーも、書き込みを断る（409）。
// 終了した直後も、同じ画面のまま、閲覧専用になる。`rikai open <topic> --view` は、開き直さずに見る。実際の Chrome で確かめる。資料・コメントは、作り物。
import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, type Json, type RikaiApp, test } from './fixtures';
import { makePng } from './samples';
import { addTextComment, dragSelect, hoverBlock, submitAll, ui } from './ui';

const BT = '```';
const DOC = `# 閲覧の確認

猫は朝によく鳴きます。この段落に、コメントを付けます。

![小さな画像](assets/small.png)

${BT}html-app
<button id="b">押す</button>
${BT}

別の段落です。夜は静かです。
`;
const DOC_V2 = DOC.replace('夜は静かです。', '夜は静かです。追記の一文です。');
const ASK = { type: 'yes_no', question: '猫は夜行性ですか' } as const;
const SLUG = 'cv';
const READ_ONLY = 'このトピックはレビューを終了しています（閲覧専用・コメントできません）';

/** 書く入口の名前（見えていて、押せるボタンの名前に、これが入ってはいけない）。タブ・状態の切り替えの名前（「解決済み」）は、読む操作なので、別に除く。
 *  「コメントの印を隠す」（0.1.7。印の表示の切り替え）も、読む操作：「コメント」を含むが、何も書かない（閲覧専用でも、使えるのが正しい：hide-marks.spec.ts） */
const WRITE_NAME =
  /(?!コメントの印を隠す)(?:コメント|追加|解決|再開|返信|編集|削除|回答を保存|取り消す|答える|範囲を選ぶ|要素を選ぶ|画像を付ける|添付|AI に送る|終了|はい|いいえ)/;

async function seed(page: Page, app: RikaiApp): Promise<{ tid: string }> {
  await page.setViewportSize({ width: 1360, height: 900 });
  await app.switchTopic(page, SLUG, '閲覧の確認', DOC, { 'small.png': makePng(120, 60) });
  await expect.poll(() => page.locator('#article img').evaluate((i) => (i as HTMLImageElement).complete)).toBe(true);
  const u = ui(page);
  // 1 件目：送って、AI が返信（質問つき）。2 件目：未送信の下書きのまま
  await addTextComment(page, '猫は朝によく鳴きます', '最初のコメント');
  await submitAll(page);
  const r = await app.nextRound(SLUG);
  const tid = r.items[0].thread as string;
  await app.apply({ round: r.round, replies: [{ thread: tid, body: 'AI の返信です。', ask: ASK }] }, { topic: SLUG });
  await expect(u.panel).toContainText('AI の返信です。');
  await addTextComment(page, '夜は静かです', '未送信の下書き');
  // 版を足す（v2）・子ページ
  await app.apply({ revisions: [{ page: 'root', markdown: DOC_V2 }] }, { topic: SLUG });
  await expect(page.locator('#docbar select option')).toHaveCount(2);
  await app.apply(
    { pages: [{ id: 'sub', title: '子ページ', parent: 'root', markdown: '# 子\n\n子の本文です。\n' }] },
    { topic: SLUG },
  );
  await expect(u.side.locator('.tree a', { hasText: '子ページ' })).toBeVisible();
  return { tid };
}

/** 画面の「終了」→「終了する」。同じ画面に留まる */
async function endViaUi(page: Page): Promise<void> {
  const u = ui(page);
  await u.end.click();
  await u.enddlg.getByRole('button', { name: '終了する' }).click();
  await expect(u.closedbar).toBeVisible();
}

/** 見えていて、押せる（無効でない）ボタンと、書ける欄（入力・テキストエリア・編集できる要素）の名前を、画面の全体（拡大表示・ダイアログを含む）から集める */
async function enabledControls(page: Page): Promise<{ buttons: string[]; fields: string[] }> {
  return page.evaluate(() => {
    const visible = (e: Element): boolean => {
      const r = e.getBoundingClientRect();
      const st = getComputedStyle(e);
      return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && !e.closest('[hidden], [inert]');
    };
    const name = (e: Element): string =>
      (e.getAttribute('aria-label') || e.textContent || '').trim() || e.getAttribute('title') || '';
    const roots = [document.querySelector('#app'), document.querySelector('#lightbox')].filter(Boolean) as Element[];
    const buttons: string[] = [];
    const fields: string[] = [];
    for (const root of roots) {
      for (const e of root.querySelectorAll('button, [role="button"], a.btnlink, label.opt, label.attach')) {
        if (!visible(e) || (e as HTMLButtonElement).disabled || e.getAttribute('role') === 'tab') continue;
        if (e.id === 'btn-notify') continue; // 通知のベル：「返信などを、通知します」の説明の語が、名前に入る（書く入口ではない）
        buttons.push(name(e));
      }
      for (const e of root.querySelectorAll('textarea, input, [contenteditable="true"], [contenteditable=""]')) {
        if (!visible(e) || (e as HTMLInputElement).disabled || (e as HTMLInputElement).readOnly) continue;
        if (e.closest('#compare') && e.getAttribute('type') === 'checkbox') continue; // 並べて比べる画面の表示の切り替え（読む操作）
        fields.push(`${e.tagName.toLowerCase()}[${e.getAttribute('type') ?? ''}]#${e.id}.${e.className}`);
      }
    }
    return { buttons, fields };
  });
}

/** 書く入口が、どこにもない（ボタンの名前を見て、1 つずつ確かめる）。`#btn-submit` は、あっても、無効 */
async function expectNoWriteEntries(page: Page, where: string): Promise<void> {
  const { buttons, fields } = await enabledControls(page);
  const bad = buttons.filter((n) => WRITE_NAME.test(n));
  expect(bad, `${where}：書く入口のボタン`).toEqual([]);
  expect(fields, `${where}：書ける欄（入力・テキストエリア）`).toEqual([]);
  await expect(ui(page).submit).toBeDisabled();
  await expect(ui(page).end).toHaveCount(0);
  await expect(ui(page).regbtn).toBeHidden();
  await expect(ui(page).composer).toHaveCount(0);
}

test.describe('終了したトピックの閲覧（F54）', () => {
  test('「終了」を押した直後：同じ画面のまま、閲覧専用になる（全面の終了画面は出ない）。状態・タブのタイトル・「AI に送る」の理由は、保たれる', async ({
    page,
    app,
  }) => {
    const u = ui(page);
    await seed(page, app);
    const hash = await page.evaluate(() => location.hash);
    // 終了の前：書く入口が、ふつうにある。未送信が 1 件
    await expect(u.submit).toHaveText('AI に送る（1）');
    await expect(u.end).toBeVisible();
    const topH = (await u.top.boundingBox())?.height;
    await endViaUi(page);
    expect(await page.evaluate(() => location.hash)).toBe(hash); // 同じ場所
    await expect(page.locator('#ended')).toHaveCount(0);
    await expect(u.closedbar).toHaveText(READ_ONLY);
    await expect(u.article).toContainText('猫は朝によく鳴きます'); // 本文は、そのまま見える
    await expect(u.top.locator('#top-title')).toHaveText('閲覧の確認');
    await expect(u.threads).toHaveCount(2); // コメントのスレッドも、そのまま
    // 「AI に送る」：未送信があっても、押せない。理由は、これまでと同じ文
    await expect(u.submit).toBeDisabled();
    await expect(u.submit).toHaveText('AI に送る');
    await expect(page.locator('#submit-wrap')).toHaveAttribute('title', 'このトピックは、終了しています');
    await expect(page.locator('#submit-why')).toHaveText('このトピックは、終了しています');
    // タブのタイトル：終了の前後で、状態の語は付かない（題だけ）。左の一覧：終了の印
    await expect(page).toHaveTitle('閲覧の確認 | rikai');
    await expect(u.side.locator('li.cur')).toContainText('終了');
    // 上のバーの高さは、変わらない（帯は、上のバーの外）
    expect((await u.top.boundingBox())?.height).toBe(topH);
    expect((await app.poll(SLUG, 3)).status).toBe('closed');
    await expectNoWriteEntries(page, '終了した直後');
    // 開き直す（rikai open）：帯が消え、入口が戻る
    await app.cli(['open', SLUG, '--no-open']);
    await expect(u.closedbar).toHaveCount(0);
    await expect(u.end).toBeVisible();
    await expect(u.submit).toHaveText('AI に送る（1）');
    await expect(u.submit).toBeEnabled();
    await dragSelect(page, '別の段落です');
    await expect(u.actComment).toBeVisible();
  });

  test('読む操作は、動く：ページ・版の切り替え・並べて比べる・変更の見せ方・拡大表示・スレッドの選択・タブ・関連の線・Markdown を保存。書く入口は、どこにもない（列挙して確かめる）', async ({
    page,
    app,
  }) => {
    const u = ui(page);
    const { tid } = await seed(page, app);
    await endViaUi(page);
    await expectNoWriteEntries(page, '最新版（v2）');

    // 画面の中の、ボタンの名前の一覧（実際の画面で、何があるか）：書く入口が、1 つも入っていないことを、上で確かめた
    const { buttons } = await enabledControls(page);
    expect(buttons.length, '読む操作のボタンは、ある').toBeGreaterThan(8);

    // スレッド：選ぶ・タブ・関連の線・質問と回答（見るだけ）・過去のやり取り
    const card = u.threads.filter({ hasText: 'AI の返信です。' });
    await card.locator('.th-head').click();
    await expect(page.locator(`#threads .thread.active[data-tid="${tid}"]`)).toHaveCount(1);
    await expect(card.locator('.ask')).toContainText('猫は夜行性ですか');
    await expect(card.locator('.ask input, .ask button')).toHaveCount(2); // はい・いいえ：どちらも、押せない
    for (const b of await card.locator('.ask button').all()) await expect(b).toBeDisabled();
    await expect(card.locator('.th-foot')).toHaveCount(0); // 返信欄・追加・解決は、ない
    await page.getByRole('tab', { name: /すべて/ }).click();
    await expect(page.getByRole('tab', { name: /すべて/ })).toHaveAttribute('aria-selected', 'true');
    await page.locator('#links-toggle').click();
    await expect(page.locator('#links-toggle')).toHaveAttribute('aria-pressed', 'false');
    await page.locator('#links-toggle').click();
    // 未送信の下書きは、見える（編集・削除は、ない）
    const draft = u.threads.filter({ hasText: '未送信の下書き' });
    await expect(draft).toBeVisible();
    await expect(draft.getByRole('button', { name: /編集|削除/ })).toHaveCount(0);

    // 本文の入口：文を選んでも、ブロックにマウスを置いても、「コメント」は出ない
    await dragSelect(page, '別の段落です');
    await page.waitForTimeout(300);
    await expect(u.actbar).toBeHidden();
    await hoverBlock(page, page.locator('#article .blk', { hasText: '別の段落です' }).first());
    await page.waitForTimeout(300);
    await expect(u.actbar).toBeHidden();
    await expect(u.actComment).toHaveCount(0);

    // 画像：マウスを置くと「拡大表示」だけ（コメントは、ない）。押すと拡大表示。ドックは、読むだけ
    const imgBlk = page.locator('#article .blk', { has: page.locator('img') }).first();
    await hoverBlock(page, imgBlk);
    await expect(page.locator('#act-zoom')).toBeVisible();
    await expect(u.actComment).toHaveCount(0);
    await page.locator('#act-zoom').click();
    await expect(u.lightbox).toBeVisible();
    await expect(u.lightbox.locator('.fv-dock')).toContainText(READ_ONLY);
    await expect(u.lightbox.locator('.fv-dock')).toContainText('ここでは、読めます');
    await expect(u.lightbox.getByRole('button', { name: /範囲を選ぶ|コメント(?!の印を隠す)/ })).toHaveCount(0); // 「コメントの印を隠す」は、読む操作（印の表示の切り替え）
    await expect(u.lightbox.getByRole('toolbar', { name: 'コメントの道具' })).toHaveCount(0);
    await expectNoWriteEntries(page, '拡大表示（画像）');
    await page.keyboard.press('Escape');
    await expect(u.lightbox).toBeHidden();

    // html-app の枠：幅・外観・拡大表示は使える。「この枠にコメント」「要素を選ぶ」は、ない
    const cap = page.locator('#article .htmlapp .cap');
    await expect(cap.locator('[data-width]').first()).toBeVisible();
    await expect(cap.locator('[data-pick]')).toHaveCount(0);
    await expect(cap.getByRole('button', { name: 'この枠にコメント' })).toHaveCount(0);
    await cap.locator('[data-focus-open]').click();
    await expect(u.lightbox).toBeVisible();
    await expect(u.lightbox.locator('[data-pick]')).toHaveCount(0);
    await expectNoWriteEntries(page, '拡大表示（html-app の枠）');
    await page.keyboard.press('Escape');
    await expect(u.lightbox).toBeHidden();

    // 変更の見せ方：変更を重ねる・並べて比べる（もとの読み取り専用）・通常
    const overlay = page.locator('#btn-changes');
    await overlay.click();
    const first = await overlay.getAttribute('aria-pressed'); // 既定の状態は、設定（localStorage）による：押すたびに、入れ替わる
    await overlay.click();
    expect(await overlay.getAttribute('aria-pressed')).not.toBe(first);
    await page.locator('#btn-compare').click();
    await expect(page.locator('#compare')).toBeVisible();
    await expectNoWriteEntries(page, '並べて比べる');
    await page.locator('#btn-compare').click();
    await expect(page.locator('#compare')).toHaveCount(0);
    await page.getByRole('button', { name: '通常', exact: true }).click();

    // 版：過去の版へ切り替え（過去の版の警告は、ふつうどおり）。ページ：子ページへ
    await page.locator('#docbar select').selectOption('1');
    await expect(page.locator('#docbar .pastver')).toBeVisible();
    await expect(u.closedbar).toBeVisible();
    await expectNoWriteEntries(page, '過去の版（v1）');
    await page.getByRole('link', { name: '最新版へ' }).click();
    await u.side.locator('.tree a', { hasText: '子ページ' }).click();
    await expect(u.article).toContainText('子の本文です。');
    await expect(u.closedbar).toBeVisible();
    await expectNoWriteEntries(page, '子ページ');
    await u.side.locator('.tree a', { hasText: '閲覧の確認' }).click();

    // Markdown を保存：落ちる
    const dl = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Markdown を保存' }).click();
    const file = await (await dl).path();
    expect(fs.readFileSync(file, 'utf8')).toBe(DOC_V2);
    // 左の一覧：ほかのトピックへ移って、戻れる（終了したトピックも、開ける）
    await app.addTopic('other', '別の資料', '# 別の資料\n\n別の本文です。\n');
    await page.evaluate(() => {
      location.hash = '#/other/root';
    });
    await expect(u.top.locator('#top-title')).toHaveText('別の資料');
    await expect(u.closedbar).toHaveCount(0);
    await expect(u.end).toBeVisible(); // 開いているトピックは、ふつうの画面
    const closedLi = u.side.locator('.topics li', { hasText: '閲覧の確認' });
    await expect(closedLi).toContainText('終了');
    await expect(u.side.locator('.topics li', { hasText: '別の資料' })).not.toContainText('終了');
    await closedLi.locator('a').click();
    await expect(u.closedbar).toBeVisible();
    await expect(u.article).toContainText('猫は朝によく鳴きます');
  });

  test('サーバーは、書き込みを断る（curl 相当で、直接 POST）：comment・reply・answer・edit・delete・resolve・submit・attach は 409。end は、もう一度でも、エラーにならない。読み取りは通る', async ({
    page,
    app,
  }) => {
    const { tid } = await seed(page, app);
    const before = await app.status(SLUG);
    const th = JSON.parse((await app.http(`/api/topic/${SLUG}`, { auth: true })).body);
    const q = th.threads.flatMap((t: Json) => t.messages).find((m: Json) => m.ask) as Json;
    const mine = th.threads.flatMap((t: Json) => t.messages).find((m: Json) => m.author === 'user' && !m.sent) as Json;
    const draftThread = th.threads.find((t: Json) => t.messages.some((m: Json) => m.id === mine.id)) as Json;
    await endViaUi(page);
    const post = (name: string, body: object) =>
      app.http(`/api/${name}`, {
        method: 'POST',
        auth: true,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    const png = makePng(8, 8).toString('base64');
    const topic = SLUG;
    const cases: Array<[string, object]> = [
      ['comment', { topic, page: 'root', version: 2, anchor: null, text: 'x' }],
      ['reply', { topic, thread: tid, text: 'x' }],
      ['answer', { topic, thread: tid, msg: q.id, answer: { value: true } }],
      ['edit', { topic, thread: draftThread.id, msg: mine.id, text: 'y' }],
      ['delete', { topic, thread: draftThread.id, msg: mine.id }],
      ['resolve', { topic, thread: tid, resolved: true }],
      ['submit', { topic }],
      ['attach', { topic, data: png }],
    ];
    for (const [name, body] of cases) {
      const r = await post(name, body);
      expect(r.status, name).toBe(409);
      expect(JSON.parse(r.body)).toMatchObject({ ok: false });
      expect(JSON.parse(r.body).error, name).toContain('終了しています');
    }
    expect((await post('end', { topic })).status).toBe(200); // もう一度の end：エラーにしない
    expect((await app.http(`/api/topic/${SLUG}`, { auth: true })).status).toBe(200);
    // 何も変わっていない（未送信の数・スレッド・round）
    const after = await app.status(SLUG);
    expect(after.unsentInBrowser).toBe(before.unsentInBrowser);
    expect(after.pendingRounds).toEqual(before.pendingRounds);
    expect(fs.readdirSync(path.join(app.root, '.rikai', SLUG, 'assets'))).toEqual(['small.png']);
    await expect(ui(page).closedbar).toBeVisible();
    await expect(ui(page).threads).toHaveCount(2);
  });

  test('窓 1360・1100・420 × ライト・ダーク：帯は、はみ出さず、文字が読める。上のバー・本文の上のバーは、押し出されない（1 行のまま）', async ({
    page,
    app,
  }) => {
    const u = ui(page);
    await seed(page, app);
    const lum = (c: string) => {
      const [r, g, b] = (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number) as [number, number, number];
      const f = (v: number) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const heights: Record<string, { top: number; docbar: number }> = {};
    for (const w of [1360, 1100, 420]) {
      await page.setViewportSize({ width: w, height: 900 });
      await expect(u.closedbar).toHaveCount(0);
      heights[w] = {
        top: (await u.top.boundingBox())?.height ?? 0,
        docbar: (await page.locator('#docbar').boundingBox())?.height ?? 0,
      };
    }
    await page.setViewportSize({ width: 1360, height: 900 });
    await endViaUi(page);
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      for (const w of [1360, 1100, 420]) {
        await page.setViewportSize({ width: w, height: 900 });
        await expect(u.closedbar).toBeVisible();
        const bar = (await u.closedbar.boundingBox()) as { x: number; width: number; height: number };
        const doc = (await u.doc.boundingBox()) as { x: number; width: number };
        const label = `${w}px・${scheme}`;
        expect(bar.x, label).toBeGreaterThanOrEqual(doc.x - 1);
        expect(bar.x + bar.width, label).toBeLessThanOrEqual(Math.min(doc.x + doc.width, w) + 1);
        expect(await u.closedbar.evaluate((e) => e.scrollWidth <= e.clientWidth + 1), `${label}：はみ出さない`).toBe(
          true,
        );
        // 本文の列が狭い窓（420px：本文の列は 200px 前後）では、折り返して、数行になる（横にはみ出さない）。広い窓では、1 行
        if (w >= 1100) expect(bar.height, `${label}：1 行`).toBeLessThan(40);
        else expect(bar.height, `${label}：折り返しても、薄い`).toBeLessThanOrEqual(120);
        // 上のバー・本文の上のバーは、押し出されない（高さが、終了の前と同じ）
        expect((await u.top.boundingBox())?.height, `${label}：上のバー`).toBe(heights[w]?.top);
        expect(
          await u.top.evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
          `${label}：上のバーは、はみ出さない`,
        ).toBe(true);
        // 文字の読みやすさ（AA）
        const c = await u.closedbar.evaluate((e) => ({
          ink: getComputedStyle(e).color,
          bg: getComputedStyle(e).backgroundColor,
        }));
        const [a, b] = [lum(c.ink), lum(c.bg)];
        expect((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05), `${label}：コントラスト`).toBeGreaterThanOrEqual(4.5);
        // 状態の札・「AI に送る」は、窓の中にあり、重ならない
        const sub = (await u.submit.boundingBox()) as { x: number; width: number };
        expect(sub.x + sub.width, `${label}：AI に送る`).toBeLessThanOrEqual(w);
      }
    }
    // 本文の上のバー（#docbar）：帯が足されても、同じ高さ（終了の前と同じ）。広い窓では、1 行
    await page.setViewportSize({ width: 1360, height: 900 });
    expect((await page.locator('#docbar').boundingBox())?.height).toBe(heights[1360]?.docbar);
  });

  test('rikai open <topic> --view：終了のまま、閲覧専用で開く（meta.closed は、変わらない）。フラグなしの open は、これまでどおり、開き直す', async ({
    page,
    app,
  }) => {
    const u = ui(page);
    await seed(page, app);
    await endViaUi(page);
    const metaFile = path.join(app.root, '.rikai', SLUG, 'meta.json');
    const closed = () => JSON.parse(fs.readFileSync(metaFile, 'utf8')).closed;
    expect(closed()).toBe(true);
    const r = await app.cli(['open', SLUG, '--view', '--no-open']);
    expect(r.code).toBe(0);
    expect(closed(), '--view は、終了のまま').toBe(true);
    expect((await app.poll(SLUG, 2)).status).toBe('closed');
    // 出した URL で開く：閲覧専用で、中身が見える
    await page.goto(`${r.json.url}`);
    await expect(u.closedbar).toBeVisible();
    await expect(u.article).toContainText('猫は朝によく鳴きます');
    await expectNoWriteEntries(page, 'open --view で開いた画面');
    // フラグなし：開き直す
    await app.cli(['open', SLUG, '--no-open']);
    expect(closed()).toBe(false);
    await expect(u.closedbar).toHaveCount(0);
  });

  test('サーバーの寿命：すべて閉じても、開いたタブがある間は、終わらない。タブを閉じて、待ちが過ぎると、終わる。開いているトピックができると、終わらない', async ({
    page,
    app,
  }) => {
    test.setTimeout(90_000);
    const IDLE = 2500;
    await app.cli(['stop']);
    process.env.RIKAI_IDLE_MS = String(IDLE); // 子プロセス（サーバー）が、読む
    try {
      const opened = await app.cli(['open', 'demo', '--no-open']);
      const info = () =>
        JSON.parse(fs.readFileSync(path.join(app.root, '.rikai', '.server.json'), 'utf8')) as { pid: number };
      const pid = info().pid;
      const alive = () => {
        try {
          process.kill(pid, 0);
          return true;
        } catch {
          return false;
        }
      };
      await page.goto(opened.json.url);
      await page.locator('#article .blk').first().waitFor();
      await endViaUi(page);
      await page.waitForTimeout(IDLE * 3); // 旧は 800ms で終わった。いまは、タブ（変更の通知の接続）がある間は、終わらない
      expect(alive(), 'タブが開いている').toBe(true);
      await expect(ui(page).closedbar).toBeVisible();
      await expect(ui(page).article).toContainText('猫は朝によく鳴きます');
      // 開いているトピックができる：タブを閉じても、終わらない
      await app.cli(['new', 'second', '--title', '二つ目'], '# 二つ目\n\n本文。\n');
      await app.cli(['open', 'second', '--no-open']);
      await page.close();
      await new Promise((r) => setTimeout(r, IDLE * 3));
      expect(alive(), '開いているトピックがある間は、タブがなくても、終わらない').toBe(true);
      // すべて閉じる（画面なしで、API）：待ちが過ぎると、終わる
      const j = JSON.parse(fs.readFileSync(path.join(app.root, '.rikai', '.server.json'), 'utf8')) as {
        port: number;
        token: string;
      };
      const end = await fetch(`http://127.0.0.1:${j.port}/api/end`, {
        method: 'POST',
        headers: { 'x-rikai-token': j.token, 'content-type': 'application/json' },
        body: JSON.stringify({ topic: 'second' }),
      });
      expect(end.status).toBe(200);
      for (let i = 0; i < 100 && alive(); i++) await new Promise((r) => setTimeout(r, 100));
      expect(alive(), 'すべて閉じて、タブもなく、待ちが過ぎた').toBe(false);
    } finally {
      delete process.env.RIKAI_IDLE_MS;
    }
  });
});
