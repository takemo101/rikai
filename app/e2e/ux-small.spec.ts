// 画面の小さな直し（RIK-055。UX の分析 P8・P10）：最初の 5 分・トースト・名前（aria）・排他のモード。実際の Chrome・本物のマウス・キー。資料は作り物。
import { expect, test } from './fixtures';
import { DOC_BASIC } from './samples';
import { addTextComment, box, dragBox, settled, submitAll, ui } from './ui';

const BT = '```';
const lines = (...l: string[]) => `${l.join('\n')}\n`;
const APP = lines(
  `${BT}html-app height=200`,
  '<button id="go">ログイン</button>',
  '<script>window.rikai.state({ a: 1 });</script>',
  BT,
);
const DOC = `# 題\n\n最初の段落です。\n\n${APP}\n後の段落です。\n`;

test.describe('範囲を選ぶ と 要素を選ぶ は、同時に ON にならない', () => {
  test('要素を選んでいる間に「範囲を選ぶ」を押すと、要素の選択は止まる', async ({ page, app }) => {
    await app.switchTopic(page, 'ex1', '排他', DOC);
    await page.waitForTimeout(1200);
    const u = ui(page);
    const pick = page.locator('#article .htmlapp .cap button[data-pick]');
    await pick.click();
    await expect(pick).toHaveAttribute('aria-pressed', 'true');
    await u.regbtn.click();
    await expect(u.regbtn).toHaveText('やめる');
    await expect(pick).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#article .htmlapp .cap [role="status"]')).toHaveText('');
  });

  test('範囲を選んでいる間に、キーボードで「要素を選ぶ」を押すと、範囲の選択は止まる', async ({ page, app }) => {
    await app.switchTopic(page, 'ex2', '排他', DOC);
    await page.waitForTimeout(1200);
    const u = ui(page);
    const pick = page.locator('#article .htmlapp .cap button[data-pick]');
    await u.regbtn.click();
    await expect(u.regbtn).toHaveText('やめる');
    await pick.focus();
    await page.keyboard.press('Enter'); // 本物のマウスでは、範囲の重ねが枠を覆うので届かない：キーボードだけの経路
    await expect(pick).toHaveAttribute('aria-pressed', 'true');
    await expect(u.regbtn).toHaveText('範囲を選ぶ');
    await expect(u.regsel).toBeHidden();
  });
});

test.describe('P8 最初の 5 分', () => {
  test('Submit が押せない理由：コメントなし → 未送信あり（押せる）→ 送信後（AI の返信待ち）→ AI の返信後（あなたの番）。title・読み上げの説明で言う', async ({
    page,
    app,
  }) => {
    await app.switchTopic(page, 'p8a', '最初の 5 分', DOC_BASIC);
    const u = ui(page);
    // コメントなし：押せない。理由
    await expect(u.submit).toBeDisabled();
    await expect(u.submit).toHaveAttribute(
      'title',
      /送るものがありません。本文の文を選んで、コメントを書くと、送れます/,
    );
    await expect(u.submit).toHaveAccessibleDescription(/コメントを書くと、送れます/);
    await expect(page.locator('#submit-wrap')).toHaveAttribute('title', /コメントを書くと、送れます/);
    // 未送信あり：押せる。理由は、消える
    await addTextComment(page, '猫は朝によく鳴きます', 'これは何ですか？');
    await expect(u.submit).toBeEnabled();
    await expect(u.submit).not.toHaveAttribute('title');
    await expect(u.submit).not.toHaveAttribute('aria-describedby');
    // 送信後：AI の返信待ち
    await submitAll(page);
    await expect(u.submit).toBeDisabled();
    await expect(u.submit).toHaveAttribute('title', /AI の返信を待っています/);
    // AI が返信：あなたの番（未送信のものがない）
    await app.nextRound();
    await app.apply({ replies: [{ thread: 't1', body: '返信です。' }] });
    await expect(page.locator('#turn')).toContainText('あなたの番');
    await expect(u.submit).toHaveAttribute('title', /未送信のものがありません/);
  });

  test('「Claude Code 以外は…」：初めての待ちだけ、見える文字。再読み込み・次の待ちでは出ない（コピーのボタンの title に、同じ案内）', async ({
    page,
    app,
  }) => {
    await app.switchTopic(page, 'p8b', '案内', DOC_BASIC);
    const u = ui(page);
    const hint = page.locator('#top-status .hint');
    await addTextComment(page, '猫は朝によく鳴きます', '1 回目');
    await submitAll(page);
    await expect(hint).toHaveText('Claude Code 以外は「rikai に送りました」と伝えてください');
    // 再読み込み：待ちは続くが、見える文字は出ない
    await page.reload();
    await u.article.locator('.blk').first().waitFor();
    await expect(page.locator('#top-status')).toContainText('AIの返信待ち');
    await expect(hint).toHaveCount(0);
    const copy = page.locator('#top-status').getByRole('button', { name: 'コピー' });
    await expect(copy).toHaveAttribute('title', /Claude Code 以外は「rikai に送りました」と伝えてください/);
    // AI の返信 → 2 回目の送信・待ち：出ない
    await app.nextRound();
    await app.apply({ replies: [{ thread: 't1', body: '返信' }] });
    await expect(page.locator('#top-status')).not.toContainText('AIの返信待ち');
    await page.locator('#threads .thread:not(.composer)').first().locator('textarea').fill('続き');
    await page.locator('#threads .thread:not(.composer)').first().getByRole('button', { name: '追加' }).click();
    await submitAll(page);
    await expect(page.locator('#top-status')).toContainText('AIの返信待ち');
    await expect(hint).toHaveCount(0);
  });

  test('コメントのない最初の説明：要点の 2 行だけ見え、ほかの付け方は畳んである（開くと、範囲）', async ({
    page,
    app,
  }) => {
    await app.switchTopic(page, 'p8c', '空', DOC_BASIC);
    const empty = page.locator('#threads .empty');
    await expect(empty.locator(':scope > p')).toHaveCount(2);
    await expect(empty).toContainText('本文の文を選ぶと「コメント」が出ます。');
    const more = empty.locator('details.empty-more');
    await expect(more).not.toHaveAttribute('open', '');
    await expect(more.locator('p')).toBeHidden();
    const closed = await box(empty);
    await more.locator('summary').click();
    await expect(more.locator('p')).toContainText('範囲を選ぶ');
    expect((await box(empty)).height).toBeGreaterThan(closed.height);
    expect(closed.height, '畳んだ状態の高さ（旧は、1 段落 4 行ほど）').toBeLessThan(90);
  });

  test('版が 1 つのページ：「並べて比べる」を出さない。2 版になると、出る', async ({ page, app }) => {
    await app.switchTopic(page, 'p8d', '版', DOC_BASIC);
    await expect(page.locator('#btn-compare')).toHaveCount(0);
    await app.apply({ revisions: [{ page: 'root', markdown: `${DOC_BASIC}\n追記です。\n` }] });
    await expect(page.locator('#btn-compare')).toBeVisible();
  });
});

test.describe('P10 小さな束', () => {
  test('トースト：読み上げの入れ物が、いつもある。通常は role なし・エラーは role="alert"。位置は「範囲を選ぶ」と重ならない', async ({
    page,
    app,
  }) => {
    await app.switchTopic(page, 'p10a', 'トースト', DOC_BASIC);
    const u = ui(page);
    await expect(page.locator('#toast-region')).toHaveAttribute('aria-live', 'polite');
    await expect(u.toast).toBeHidden();
    // エラー：範囲が小さすぎる
    await u.regbtn.click();
    const a = await box(u.article);
    await dragBox(page, { x: a.x + 40, y: a.y + 60 }, { x: a.x + 43, y: a.y + 63 });
    await expect(u.toast).toContainText('範囲が小さすぎます。ドラッグで、範囲を選んでください');
    await expect(u.toast).toHaveClass(/err/);
    await expect(u.toast).toHaveAttribute('role', 'alert');
    await expect(page.locator('#toast-region')).toHaveAttribute('aria-live', 'off');
    const t = await box(u.toast);
    const r = await box(u.regbtn);
    const overlap = !(t.x + t.width <= r.x || r.x + r.width <= t.x || t.y + t.height <= r.y || r.y + r.height <= t.y);
    expect(overlap, 'トーストと「範囲を選ぶ」の重なり').toBe(false);
    // 通常：資料の更新
    await app.apply({ revisions: [{ page: 'root', markdown: `${DOC_BASIC}\n追記です。\n` }] });
    await expect(u.toast).toContainText('資料が v2 に更新されました');
    await expect(u.toast).not.toHaveClass(/err/);
    await expect(u.toast).not.toHaveAttribute('role', 'alert');
    await expect(page.locator('#toast-region')).toHaveAttribute('aria-live', 'polite');
  });

  test('関連の線のボタン：名前は「関連の線」のまま。状態は aria-pressed と title（いま：オン／オフ）で言う', async ({
    page,
    app,
  }) => {
    await app.switchTopic(page, 'p10b', '線', DOC_BASIC);
    await addTextComment(page, '猫は朝によく鳴きます', '線のテスト');
    const b = page.getByRole('button', { name: '関連の線', exact: true });
    await expect(b).toHaveAttribute('aria-pressed', 'true');
    await expect(b).toHaveAttribute('title', /いま：オン/);
    await b.click();
    await expect(b).toHaveAttribute('aria-pressed', 'false');
    await expect(b).toHaveAttribute('title', /いま：オフ/);
  });

  test('位置の名前（範囲：枠…）は、カード・入力欄で、1 行に収まる。全文は title。保存されるラベルは、そのまま', async ({
    page,
    app,
  }) => {
    await app.switchTopic(page, 'p10c', '名前', `# 題\n\n前の段落です。\n\n${APP}\n後の段落です。\n`);
    await page.waitForTimeout(1500);
    const u = ui(page);
    await u.regbtn.click();
    const f = await box(page.locator('#article iframe.appframe').first());
    await dragBox(page, { x: f.x + 10, y: f.y + 10 }, { x: f.x + 160, y: f.y + 90 });
    await expect(u.composer).toBeVisible();
    await settled(page);
    const q = u.composer.locator('.quote');
    await expect(q).toHaveClass(/qlabel/);
    const full = (await q.getAttribute('title')) ?? '';
    expect(full).toContain('範囲：');
    const m = await q.evaluate((e) => {
      const cs = getComputedStyle(e);
      return {
        h: e.getBoundingClientRect().height,
        line: parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.5,
        over: e.scrollWidth > e.clientWidth,
      };
    });
    expect(m.h, '1 行の高さ').toBeLessThan(m.line * 1.6);
    await u.composer.locator('textarea').fill('枠の範囲');
    await u.composer.getByRole('button', { name: 'コメントを追加' }).click();
    const card = u.threads.first().locator('.quote');
    await expect(card).toHaveClass(/qlabel/);
    expect((await card.evaluate((e) => e.getBoundingClientRect().height)) < m.line * 1.6).toBe(true);
    // 保存されるラベルは、全文のまま（表示だけ、1 行）
    await submitAll(page);
    const r = await app.nextRound();
    expect(r.items[0].anchor.label.startsWith('範囲：')).toBe(true);
    expect(r.items[0].anchor.label.length).toBeGreaterThan(30);
  });
});
