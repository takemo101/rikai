// 「いま、誰の番か」（F39）：上のバーの `#turn`・左の一覧の印・カードの札・タブのタイトル。
// コメントなし（印なし）→ 未送信 → AI に送った後（AI の返信待ち）→ AI の返信と質問（あなたの番）→ 回答・解決（すべて解決）。
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { addTextComment, box, submitAll, ui } from './ui';

const turn = (page: Page) => page.locator('#turn');
const mine = (page: Page) => ui(page).side.locator('.topics li', { hasText: '猫の観察日記' });
const ASK = {
  type: 'single_choice',
  question: '何を食べますか',
  options: [
    { id: 'a', label: 'カリカリ' },
    { id: 'b', label: '魚' },
  ],
  allowOther: false,
} as const;

/** コメントを 1 つ付けて、AI に送って、AI が返信する前の状態にする */
async function submitted(
  page: Page,
  app: { nextRound: () => Promise<{ round: number; items: { thread: string }[] }> },
) {
  await addTextComment(page, '猫は朝によく鳴きます', '朝に鳴く理由は？');
  await submitAll(page);
  await expect(turn(page)).toContainText('AI の返信待ち');
  return app.nextRound();
}

test.describe('いま、誰の番か（F39）', () => {
  test('コメントがなければ、印は出ない。タイトルは、題と rikai だけ', async ({ page }) => {
    await expect(turn(page)).toHaveCount(0);
    await expect(page).toHaveTitle('猫の観察日記 | rikai');
    await expect(mine(page).locator('.turn-mark, .chip.wait')).toHaveCount(0);
  });

  // 意図した変更（0.28.0）：上のバーの札に、未送信の形（「未送信 n 件 → Submit」。隣のボタンに focus を移すだけ）は、出さない。未送信の数は「AI に送る（n）」のボタンが持つ（輪つき）。
  // 札は、未送信を除いた状態（未解決だけなら、札なし：下書きだけの間は、札で言うことがない）
  test('未送信：札（#turn）には出さない。「AI に送る（n）」に数と輪。タイトル・左の一覧・カードの札には、残る', async ({
    page,
  }) => {
    const u = ui(page);
    await addTextComment(page, '猫は朝によく鳴きます', '朝に鳴く理由は？');
    await expect(turn(page)).toHaveCount(0);
    await expect(u.top).not.toContainText('未送信');
    await expect(u.submit).toHaveText('AI に送る（1）');
    await expect(u.submit).toHaveClass(/attn/);
    expect(await u.submit.evaluate((e) => getComputedStyle(e).boxShadow)).not.toBe('none');
    await expect(page).toHaveTitle('未送信 1 件 | 猫の観察日記 | rikai');
    await expect(mine(page).locator('.chip.draft')).toHaveAttribute(
      'aria-label',
      /未送信 1 件。「AI に送る」で送ります/,
    );
    await expect(u.threads.first().locator('.th-head .chip.draft')).toHaveText('未送信');
  });

  test('AI に送った後：「AI の返信待ち」（灰色）・コピーのボタン・タイトル・左の一覧の「待ち」・カードの「AI の返信待ち」の札', async ({
    page,
    app,
  }) => {
    const u = ui(page);
    await submitted(page, app);
    await expect(turn(page)).toHaveClass(/waiting-ai/);
    await expect(turn(page).getByRole('button')).toHaveCount(0); // 押して移る先は、ない
    await expect(u.submit).not.toHaveClass(/attn/);
    await expect(page).toHaveTitle('AI の返信待ち | 猫の観察日記 | rikai');
    await expect(mine(page)).toContainText('AI の返信待ち');
    await expect(u.top.getByRole('button', { name: 'コピー' })).toBeVisible();
    await expect(u.threads.first().locator('.th-head .chip.aiwait')).toHaveText('AI の返信待ち');
    // 返信を待つ間に、新しいコメントを付ける：札は、そのまま「AI の返信待ち」（1 つ）。未送信は、ボタンの数・タイトル（旧：未送信の札が先に出て、返信待ちの札が並んだ）
    await addTextComment(page, '日向でよく丸くなります', '日向は暖かいから？');
    await expect(turn(page)).toHaveClass(/waiting-ai/);
    await expect(turn(page)).not.toContainText('未送信');
    await expect(u.top.locator('.chip.wait')).toHaveCount(0);
    await expect(u.submit).toHaveText('AI に送る（1）');
    await expect(page).toHaveTitle('未送信 1 件 | 猫の観察日記 | rikai');
  });

  test('AI の返信と質問：「あなたの番（AI の返信 1・未回答の質問 1）」・タイトルの (2)・左の一覧の印・カードは「未回答の質問」の 1 つ（「AI の返信」と重ねない）', async ({
    page,
    app,
  }) => {
    const u = ui(page);
    const r = await submitted(page, app);
    await app.apply({
      round: r.round,
      replies: [{ thread: r.items[0]?.thread, body: '朝はお腹がすくからです。', ask: ASK }],
    });
    await expect(turn(page)).toHaveClass(/your-turn/);
    await expect(turn(page)).toContainText('あなたの番 1'); // 数は、スレッドの数（返信に質問が付いていても 1）
    await expect(turn(page)).not.toContainText('AI の返信'); // 内訳は、見える文字でなく、title・aria-label
    await expect(turn(page).getByRole('button')).toHaveAttribute('aria-label', /（AI の返信 1・未回答の質問 1）/);
    await expect(turn(page).getByRole('button')).toHaveAttribute('title', /（AI の返信 1・未回答の質問 1）/);
    await expect(page).toHaveTitle('(1) あなたの番 | 猫の観察日記 | rikai');
    await expect(mine(page).locator('.chip.yours')).toHaveAttribute('aria-label', 'あなたの番');
    await expect(mine(page)).not.toContainText('AI の返信待ち');
    await expect(u.threads.first().locator('.th-head .chip.yours')).toHaveText('未回答の質問');
    await expect(u.threads.first().locator('.th-head')).not.toContainText('AI の返信');
    await expect(u.top).not.toContainText('AI の返信待ち');
  });

  test('押すと、最初の項目へ：AI の新着返信のあるカード → 次の新着 → 未回答の質問。見たら、内訳が減る（title・aria-label）', async ({
    page,
    app,
  }) => {
    const u = ui(page);
    await app.apply({
      threads: [
        { page: 'root', anchor: { quote: '猫は朝によく鳴きます' }, body: '一つ目の返信です。' },
        { page: 'root', anchor: { quote: '日向でよく丸くなります' }, body: '二つ目の返信です。', ask: ASK },
      ],
    });
    await expect(u.threads).toHaveCount(2);
    const btn = turn(page).getByRole('button');
    await expect(turn(page)).toContainText('あなたの番 2'); // 2 スレッド
    await expect(btn).toHaveAttribute('aria-label', /（AI の返信 2・未回答の質問 1）/);
    await expect(page).toHaveTitle(/^\(2\) あなたの番/);
    await btn.click();
    await expect(u.threads.first()).toHaveClass(/active/);
    await expect(btn).toHaveAttribute('aria-label', /（AI の返信 1・未回答の質問 1）/); // 1 つ目を見た
    await btn.click();
    await expect(u.threads.nth(1)).toHaveClass(/active/);
    // もう新着はない：質問が残っている → その質問のカード
    await expect(btn).toHaveAttribute('aria-label', /（未回答の質問 1）/);
    await expect(turn(page)).toContainText('あなたの番 1');
    await u.threads.first().click({ position: { x: 5, y: 5 } });
    await btn.click();
    await expect(u.threads.nth(1)).toHaveClass(/active/);
    // 質問に答えた（保存）：未送信
    await u.threads.nth(1).getByLabel('魚').check();
    await u.threads.nth(1).getByRole('button', { name: '回答を保存' }).click();
    await expect(u.submit).toHaveText('AI に送る（1）'); // 未送信は、ボタンの数
  });

  // 意図した変更：「あなたの番」は、AI の新着返信か未回答の質問があるときだけ。読んで答えたあと、未解決だけが残るなら、灰色の「未解決 n」
  test('未解決だけ：すべて読んで答えると、青の「あなたの番」が消えて、灰色の「未解決 n」になる（タイトル・左の一覧も）。押すと、最初の未解決へ', async ({
    page,
    app,
  }) => {
    const u = ui(page);
    const r = await submitted(page, app);
    await app.apply({ round: r.round, replies: [{ thread: r.items[0]?.thread, body: '返信です。' }] });
    await expect(turn(page)).toHaveClass(/your-turn/);
    await expect(page).toHaveTitle('(1) あなたの番 | 猫の観察日記 | rikai');
    await turn(page).getByRole('button').click(); // 読んだ
    await expect(turn(page)).toHaveClass(/open/);
    await expect(turn(page)).not.toHaveClass(/your-turn/);
    await expect(turn(page)).toContainText('未解決 1');
    await expect(page).toHaveTitle('未解決 1 | 猫の観察日記 | rikai'); // (n) なし
    await expect(mine(page).locator('.chip.aiwait[aria-label="未解決 1"]')).toBeVisible();
    await expect(mine(page).locator('.chip.yours')).toHaveCount(0);
    await u.threads.first().click({ position: { x: 5, y: 5 } });
    await turn(page).getByRole('button').click();
    await expect(u.threads.first()).toHaveClass(/active/);
  });

  test('件数だけが変わっても、aria-live の中の文字は、変わらない（読み上げ直さない）。件数は、ボタンの名前に（あなたの番）', async ({
    page,
    app,
  }) => {
    await app.apply({
      threads: [
        { page: 'root', anchor: { quote: '猫は朝によく鳴きます' }, body: '一つ目の返信です。' },
        { page: 'root', anchor: { quote: '日向でよく丸くなります' }, body: '二つ目の返信です。' },
      ],
    });
    await expect(turn(page)).toContainText('あなたの番 2');
    const sr = turn(page).locator('.turn-sr');
    const before = await sr.textContent();
    expect(before).toBe('状態：あなたの番');
    await turn(page).getByRole('button').click(); // 1 つ読んだ：件数が 1 つ減る
    await expect(turn(page)).toContainText('あなたの番 1');
    expect(await sr.textContent()).toBe(before); // 状態の名前は、件数を含まない
    expect(await sr.textContent()).not.toMatch(/\d/);
    await expect(turn(page).getByRole('button')).toHaveAttribute('aria-label', /あなたの番 1/);
    await expect(turn(page).locator('.turn-t')).toHaveAttribute('aria-hidden', 'true'); // 見える文字は、読み上げの外
  });

  test('未送信の数が変わっても、「AI に送る」のボタン名だけが変わる（札の読み上げは、動かない）', async ({ page }) => {
    const u = ui(page);
    await addTextComment(page, '猫は朝によく鳴きます', '一つ目');
    await expect(u.submit).toHaveText('AI に送る（1）');
    await addTextComment(page, '日向でよく丸くなります', '二つ目');
    await expect(u.submit).toHaveText('AI に送る（2）');
    await expect(turn(page)).toHaveCount(0);
  });

  test('ほかのページのスレッド：押すと、まず、いまのページの新着・もう一度で、子ページへ移り、そのスレッドが選ばれる', async ({
    page,
    app,
  }) => {
    const u = ui(page);
    await app.apply({
      pages: [
        {
          id: 'detail',
          title: '詳細ページ',
          parent: 'root',
          markdown: '# 詳細ページ\n\n子ページの本文です。猫の詳しい話です。\n',
        },
      ],
      threads: [
        { page: 'root', anchor: { quote: '猫は朝によく鳴きます' }, body: '本編の返信です。' },
        { page: 'detail', anchor: { quote: '猫の詳しい話です' }, body: '子ページの返信です。' },
      ],
    });
    await expect(u.threads).toHaveCount(1); // 本編のスレッドだけ
    await expect(turn(page)).toContainText('あなたの番 2'); // トピック全体：2 スレッド
    const btn = turn(page).getByRole('button');
    await btn.click();
    await expect(u.threads.first()).toHaveClass(/active/);
    expect(page.url()).not.toContain('/detail');
    await btn.click(); // 本編の新着は、読んだ：次は、子ページ
    await expect(page).toHaveURL(/#\/[^/]+\/detail/);
    await expect(u.threads).toHaveCount(1);
    await expect(u.threads.first()).toContainText('子ページの返信です。');
    await expect(u.threads.first()).toHaveClass(/active/);
    await expect(turn(page)).toHaveClass(/open/); // どちらも読んだ：未解決だけ
  });

  test('質問に答えて・解決して・AI に送る → AI が処理すると「すべて解決」（緑）・タイトル・左の一覧の CircleCheck', async ({
    page,
    app,
  }) => {
    const u = ui(page);
    const r = await submitted(page, app);
    await app.apply({
      round: r.round,
      replies: [{ thread: r.items[0]?.thread, body: '朝はお腹がすくからです。', ask: ASK }],
    });
    await expect(turn(page)).toContainText('あなたの番');
    await u.threads.first().getByLabel('魚').check();
    await u.threads.first().getByRole('button', { name: '回答を保存' }).click();
    await u.threads.first().getByRole('button', { name: '解決', exact: true }).click();
    await expect(u.submit).toHaveText('AI に送る（2）'); // 回答と解決：未送信は、ボタンの数
    await submitAll(page);
    await expect(turn(page)).toContainText('AI の返信待ち');
    const r2 = await app.nextRound();
    await app.apply({ round: r2.round, replies: [] });
    await expect(turn(page)).toHaveClass(/done/);
    await expect(turn(page)).toContainText('すべて解決');
    await expect(page).toHaveTitle('すべて解決 | 猫の観察日記 | rikai');
    await expect(mine(page).locator('.chip.ok[aria-label="すべて解決"]')).toBeVisible();
    await expect(u.threads).toHaveCount(0);
  });

  test('複数のトピック：別のトピックの印（あなたの番・待ち）は、一覧の要約だけで決まる。開いているトピックは、上のバーと同じ', async ({
    page,
    app,
  }) => {
    const u = ui(page);
    // 別のトピック（AI 起点のスレッド＝あなたの番）
    await app.cli(['new', 'other', '--title', '別の資料'], '# 別の資料\n\n本文です。\n');
    await app.apply({ threads: [{ page: 'root', body: '確認です。', ask: ASK }] }, { topic: 'other' });
    const other = u.side.locator('.topics li', { hasText: '別の資料' });
    await expect(other.locator('.chip.yours')).toHaveAttribute('aria-label', 'あなたの番'); // 内訳なし
    await expect(other).not.toContainText('（');
    // 開いているトピックで、AI に送った後
    await addTextComment(page, '猫は朝によく鳴きます', '待ちの確認');
    await submitAll(page);
    await expect(mine(page)).toContainText('AI の返信待ち');
    await expect(turn(page)).toContainText('AI の返信待ち');
    await expect(other.locator('.chip.yours')).toBeVisible();
    // 別のトピックを開く：そのトピックの状態が、上のバーに出る。元のトピックは、「待ち」のまま
    await other.getByRole('link').click();
    await expect(turn(page)).toContainText('あなたの番');
    await expect(page).toHaveTitle(/^\(1\) あなたの番 \| 別の資料/);
    await expect(mine(page)).toContainText('AI の返信待ち');
  });

  test('タイトルは、題を文字のまま入れる（HTML として解釈しない）。40 字に切る', async ({ page, app }) => {
    await app.switchTopic(page, 'tt', '<b>太字</b> & 題', '# x\n\n本文\n');
    await expect(page).toHaveTitle('<b>太字</b> & 題 | rikai');
    const long = 'あ'.repeat(60);
    await app.switchTopic(page, 'tl', long, '# y\n\n本文\n');
    await expect(page).toHaveTitle(`${'あ'.repeat(39)}… | rikai`);
    // 絵文字（サロゲートペア）が、40 字の境にかかっても、半分に割れない
    await app.switchTopic(page, 'te', `${'あ'.repeat(38)}😀😀😀`, '# z\n\n本文\n');
    await expect(page).toHaveTitle(`${'あ'.repeat(38)}😀… | rikai`);
  });

  test('SSE：apply のあと、500ms 以内に、#turn が変わる', async ({ page, app }) => {
    const r = await submitted(page, app);
    await expect(turn(page)).toContainText('AI の返信待ち');
    await app.apply({ round: r.round, replies: [{ thread: r.items[0]?.thread, body: '返信です。' }] });
    await expect(turn(page)).toContainText('あなたの番', { timeout: 500 });
  });

  test('ライト・ダーク：#turn の文字のコントラストが 4.5:1 以上（あなたの番・未解決・AI の返信待ち・すべて解決）', async ({
    page,
    app,
  }) => {
    const ratio = (el: Page) =>
      el.evaluate(() => {
        const parse = (c: string): number[] => (c.match(/[\d.]+/g) ?? []).map(Number);
        const lin = (v: number) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
        const lum = (c: number[]) =>
          0.2126 * lin(c[0] as number) + 0.7152 * lin(c[1] as number) + 0.0722 * lin(c[2] as number);
        const base = parse(getComputedStyle(document.getElementById('top') as Element).backgroundColor);
        const btn = document.querySelector('#turn .turn-btn') as Element;
        const cs = getComputedStyle(btn);
        const bgc = parse(cs.backgroundColor);
        const a = bgc.length > 3 ? (bgc[3] as number) : 1;
        const bg = [0, 1, 2].map((i) => (bgc[i] as number) * a + (base[i] as number) * (1 - a));
        const fg = parse(cs.color);
        const [l1, l2] = [lum(fg), lum(bg)];
        return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      });
    const check = async (label: string) => {
      for (const scheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme: scheme });
        expect(await ratio(page), `${scheme}：${label}`).toBeGreaterThanOrEqual(4.5);
      }
      await page.emulateMedia({ colorScheme: 'light' });
    };
    const u = ui(page);
    await addTextComment(page, '猫は朝によく鳴きます', '朝に鳴く理由は？');
    await submitAll(page);
    await expect(turn(page)).toContainText('AI の返信待ち');
    await check('AI の返信待ち');
    const r = await app.nextRound();
    await app.apply({ round: r.round, replies: [{ thread: r.items[0]?.thread, body: '返信です。' }] });
    await expect(turn(page)).toContainText('あなたの番');
    await check('あなたの番');
    await turn(page).getByRole('button').click(); // 読んだ：未解決だけ（灰色）
    await expect(turn(page)).toHaveClass(/open/);
    await check('未解決');
    await u.threads.first().getByRole('button', { name: '解決', exact: true }).click();
    await submitAll(page);
    const r2 = await app.nextRound();
    await app.apply({ round: r2.round, replies: [] });
    await expect(turn(page)).toContainText('すべて解決');
    await check('すべて解決');
  });

  test('上のバー：1100・1000・950・901・900・800px でも、#top-status は AI に送る に重ならない（進み具合のチップが、先に縮む）。狭い窓（900・700・420px）：#turn は、はみ出さない（狭いと、アイコンだけ）', async ({
    page,
    app,
  }) => {
    const r = await submitted(page, app); // AI の返信待ち（ヒント・コピーのボタンが出る）
    const status = page.locator('#top-status');
    const overlaps = async (w: number, label: string) => {
      const t = await box(status);
      const s = await box(ui(page).submit);
      expect(t.x + t.width, `${w}px・${label}：#top-status は AI に送る に重ならない`).toBeLessThanOrEqual(s.x + 1);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
        `${w}px・${label}：横スクロール`,
      ).toBeLessThanOrEqual(0);
    };
    for (const w of [1360, 1100, 1000, 950, 901, 900, 800]) {
      await page.setViewportSize({ width: w, height: 800 });
      await expect(turn(page)).toBeVisible();
      await overlaps(w, 'AI の返信待ち');
    }
    await app.apply({ round: r.round, replies: [{ thread: r.items[0]?.thread, body: '返信です。', ask: ASK }] });
    await expect(turn(page)).toContainText('あなたの番');
    for (const w of [1360, 1100, 1000, 950, 901, 900, 800]) {
      await page.setViewportSize({ width: w, height: 800 });
      await overlaps(w, 'あなたの番');
      // 「#turn」は、縮めない（進み具合のチップが、先に縮む）
      const t = await box(turn(page));
      expect(t.width, `${w}px：#turn の幅`).toBeGreaterThan(60);
    }
    for (const w of [900, 700, 420]) {
      await page.setViewportSize({ width: w, height: 800 });
      await expect(turn(page)).toBeVisible();
      const t = await box(turn(page));
      const s = await box(ui(page).submit);
      expect(t.x, `${w}px：左`).toBeGreaterThanOrEqual(0);
      expect(t.x + t.width, `${w}px：AI に送る と重ならない`).toBeLessThanOrEqual(s.x + 1);
      if (w <= 560) await expect(turn(page).locator('.turn-t')).toBeHidden();
      await expect(turn(page).getByRole('button')).toHaveAccessibleName(/あなたの番/);
    }
  });
});
