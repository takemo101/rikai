// 画面の枠組み（F2・F15・F16・F21・F23・F34）：左の一覧の開閉・右の幅のドラッグと保存・複数トピックの切り替え・「終了」ダイアログ・サーバーが止まったときの表示
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { addTextComment, box, submitAll, ui } from './ui';

const uiState = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('rikai-ui') ?? '{}') as { sideOpen?: boolean; panelW?: number });

test.describe('画面の広さ（F23）', () => {
  test('左の一覧の開閉ボタンで、左の一覧をしまう・出す。しまうと、本文の幅の上限が広がる。再読み込みしても残る（F23(1)(3)）', async ({
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

// 狭い窓（RIK-040）：〜900px は、右の幅の下限を 220px に下げ、本文の領域に 400px を残す。〜1100px は、左の一覧を、自動で隠す（保存した値は、書き換えない。0.28.0：旧は 788px 未満）。
// 1100px 以下で、右の幅が既定（380）のままなら、細い既定（280）で始まる（本文を広く：1100px で 820px・900px で 620px。旧：490px・400px）
test.describe('狭い窓（〜900px）', () => {
  const BT = '```';
  const DOC = `# 狭い窓\n\n猫は朝によく鳴きます。長い文の途中に、折り返しの確認のための言葉を、いくつも並べて、本文の列の幅を測ります。\n\n二つ目の段落です。\n\n${BT}js\nconst meals = 3;\n${BT}\n\n最後の段落です。\n`;
  const asks = [
    {
      type: 'single_choice',
      question: '何を食べますか',
      options: [
        { id: 'a', label: 'カリカリ', detail: '乾いたもの' },
        { id: 'b', label: '魚' },
      ],
      allowOther: true,
    },
    { type: 'scale', question: '理解度', min: 1, max: 5, minLabel: 'ぜんぜん', maxLabel: 'よく分かった' },
    { type: 'yes_no', question: 'もう一度、確かめますか' },
    { type: 'scale', question: '七段の目盛り', min: 1, max: 7, minLabel: '低い', maxLabel: '高い' }, // 段の多い目盛りは、折り返して、はみ出さない
    { type: 'scale', question: '十段の目盛り', min: 1, max: 10 },
  ];

  // 右のパネルの、横のはみ出し：パネルの外へ出ている要素・自分の幅より広い中身（切れている文字）の一覧
  const overflow = (page: Page) =>
    page.evaluate(() => {
      const panel = document.querySelector('#threads') as HTMLElement;
      const pr = panel.getBoundingClientRect();
      const out: string[] = [];
      for (const e of panel.querySelectorAll('*')) {
        if (e.closest('svg') && e.tagName !== 'svg') continue;
        const b = e.getBoundingClientRect();
        const cs = getComputedStyle(e);
        if (b.width < 1 || b.height < 1 || cs.visibility === 'hidden') continue;
        const name = `${e.tagName.toLowerCase()}.${String((e as HTMLElement).className).slice(0, 24)}`;
        if (b.right > pr.right + 0.5 || b.left < pr.left - 0.5) out.push(`外へ：${name}`);
        if (cs.display !== 'inline' && e.scrollWidth > e.clientWidth + 1 && e.clientWidth > 0)
          out.push(`切れる：${name}（${e.scrollWidth}>${e.clientWidth}）`);
      }
      return [...new Set(out)];
    });
  const seedThreads = async (
    page: Page,
    app: {
      switchTopic: (page: Page, slug: string, title: string, md: string) => Promise<unknown>;
      apply: (b: unknown, o?: { topic?: string }) => Promise<unknown>;
    },
  ) => {
    await app.switchTopic(page, 'nr', '狭い窓', DOC);
    await app.apply(
      {
        threads: [
          {
            page: 'root',
            anchor: { quote: '猫は朝によく鳴きます' },
            body: '朝の確認です。**太字**と `code`。',
            ask: asks[0],
          },
          { page: 'root', anchor: { quote: '二つ目の段落です' }, body: '確認です。', ask: asks[1] },
          { page: 'root', anchor: { quote: '最後の段落です' }, body: '確認です。', ask: asks[2] },
          { page: 'root', anchor: { quote: 'const meals' }, body: '目盛りの確認です。', ask: asks[3] },
          { page: 'root', anchor: { quote: '長い文の途中' }, body: '目盛りの確認です。', ask: asks[4] },
        ],
      },
      { topic: 'nr' },
    );
    await expect(ui(page).threads).toHaveCount(5);
  };

  for (const [width, side, docMin] of [
    [900, true, 400],
    [800, true, 400],
    [800, false, 400],
    [1101, true, 400], // 1101px から、左の一覧が、本文の列の横に並ぶ（本文は 491px）。0.28.0：旧は 788px から
    [1100, true, 400], // 1100px 以下は、左の一覧を、自動で隠す（本文は 820px）
    [788, true, 400],
    [700, true, 400],
    [600, true, 300],
    [600, false, 300],
  ] as const) {
    test(`${width}px・左の一覧を${side ? '開く（保存）' : 'しまう（保存）'}：本文の領域が ${docMin}px 以上・右のパネルは 220px 以上・横にはみ出さない・ページも、横にスクロールしない`, async ({
      page,
      app,
    }) => {
      const u = ui(page);
      await seedThreads(page, app);
      await page.evaluate((o) => localStorage.setItem('rikai-ui', JSON.stringify({ sideOpen: o, links: true })), side);
      await page.setViewportSize({ width, height: 800 });
      await page.reload();
      await u.article.locator('.blk').first().waitFor();
      await expect(u.threads).toHaveCount(5);
      const doc = await box(u.doc);
      expect(doc.width, `${width}px：本文の領域`).toBeGreaterThanOrEqual(docMin - 1);
      const panelW = (await box(u.panel)).width;
      expect(panelW, `${width}px：右のパネル`).toBeGreaterThanOrEqual(219);
      expect(await overflow(page), `${width}px：パネルのはみ出し`).toEqual([]);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
        'ページの横スクロール',
      ).toBeLessThanOrEqual(0);
      // タブの文字が切れない（名前は、そのまま）
      for (const name of ['未解決', '解決済み', 'すべて'])
        await expect(page.locator('.tab', { hasText: name })).toBeVisible();
      const broken = await page.evaluate(() =>
        [...document.querySelectorAll('.tab')]
          .filter((t) => {
            const range = document.createRange();
            range.selectNodeContents(t.firstChild as Node);
            return range.getClientRects().length > 1; // ラベルが、2 行に割れている
          })
          .map((t) => t.textContent),
      );
      expect(broken, 'タブの名前が、途中で折り返さない').toEqual([]);
      // 右のパネルが 280px より狭いとき：タブの件数は、名前の下（縦積み）・返信の入力欄は、高さ 96px 以上（placeholder が切れない）
      if (panelW < 279) {
        const stacked = await page.evaluate(() =>
          [...document.querySelectorAll('.tab')].map((t) => {
            const range = document.createRange();
            range.selectNodeContents(t.firstChild as Node);
            const label = range.getBoundingClientRect();
            const n = (t.querySelector('.n') as HTMLElement).getBoundingClientRect();
            return n.top >= label.bottom - 1;
          }),
        );
        expect(stacked, '件数は、名前の下').toEqual([true, true, true]);
        await u.threads.first().locator('.th-head').click(); // 返信欄は、選んでいないカードでは 1 行に畳まれている（P5）：選ぶと開いて、96px 以上
        const h = await u.threads
          .first()
          .locator('textarea')
          .first()
          .evaluate((e) => e.getBoundingClientRect().height);
        expect(h, '返信の入力欄の高さ').toBeGreaterThanOrEqual(95);
      }
      // 本文の丸（番号）は、本文の列の中に見える
      await expect(page.locator('#badges .bno').first()).toBeVisible();
    });
  }

  // 意図した変更：自動で隠す境界は、700/701px から、788px（168 + 220 + 400）に、さらに 0.28.0 で、1100px 以下に変えた（半画面で、本文が読める幅を残すため）。
  // 隠している間は、☰ で、本文の上に重ねて（ドロワー）出す：本文・パネルの幅は、変わらない（400px 前後でも、本文の列が、つぶれない）
  for (const width of [400, 500, 600, 788, 1100]) {
    test(`${width}px：☰ で、左の一覧が、本文の上に重なる（本文・右のパネルの幅は、変わらない）。Esc・外を押す・☰ で、しまう。保存した sideOpen は、そのまま`, async ({
      page,
    }) => {
      const u = ui(page);
      const btn = page.locator('#btn-side');
      await page.evaluate(() => localStorage.setItem('rikai-ui', JSON.stringify({ sideOpen: true, links: true })));
      await page.setViewportSize({ width, height: 800 });
      await page.reload();
      await u.article.locator('.blk').first().waitFor();
      await expect(btn).toHaveAttribute('aria-expanded', 'false');
      expect((await u.side.boundingBox())?.width ?? 0).toBeLessThan(5);
      const doc0 = await box(u.doc);
      const art0 = await box(u.article);
      const panel0 = await box(u.panel);
      await btn.click();
      await expect(btn).toHaveAttribute('aria-expanded', 'true');
      await expect.poll(async () => (await u.side.boundingBox())?.width ?? 0).toBeGreaterThan(150);
      const side = await box(u.side);
      expect(side.x, '一覧は、窓の左端').toBeLessThanOrEqual(1);
      expect(await u.side.evaluate((e) => getComputedStyle(e).position)).toBe('absolute');
      expect(await box(u.doc), '本文の領域は、変わらない').toEqual(doc0);
      expect((await box(u.article)).width, '本文の列は、つぶれない').toBe(art0.width);
      expect((await box(u.panel)).width).toBe(panel0.width);
      expect((await uiState(page)).sideOpen).toBe(true); // 保存した値は、書き換わらない
      // Esc でしまう
      await page.keyboard.press('Escape');
      await expect(btn).toHaveAttribute('aria-expanded', 'false');
      expect((await u.side.boundingBox())?.width ?? 0).toBeLessThan(5);
      // 外（本文）を押すと、しまう。一覧の中を押しても、しまわない
      await btn.click();
      await expect(btn).toHaveAttribute('aria-expanded', 'true');
      await u.side.locator('.topics').click({ position: { x: 5, y: 2 }, force: true });
      await expect(btn).toHaveAttribute('aria-expanded', 'true');
      await u.docscroll
        .click({ position: { x: Math.max(side.width + 6, 200) - 0, y: 300 }, force: true })
        .catch(() => undefined);
      await page.mouse.click(Math.min(width - 4, side.width + 10), 400);
      await expect(btn).toHaveAttribute('aria-expanded', 'false');
      // ☰ で、しまう
      await btn.click();
      await expect(btn).toHaveAttribute('aria-expanded', 'true');
      await btn.click();
      await expect(btn).toHaveAttribute('aria-expanded', 'false');
      expect((await uiState(page)).sideOpen).toBe(true);
    });
  }

  test('1101px 以上は、☰ で、保存する（本文の列の横に並べる）。窓を広げると、保存した開閉に戻る（F23(3)）', async ({
    page,
  }) => {
    const u = ui(page);
    const btn = page.locator('#btn-side');
    await page.evaluate(() => localStorage.setItem('rikai-ui', JSON.stringify({ sideOpen: true, links: true })));
    await page.setViewportSize({ width: 1101, height: 800 });
    await page.reload();
    await u.article.locator('.blk').first().waitFor();
    await expect(btn).toHaveAttribute('aria-expanded', 'true');
    expect(await u.side.evaluate((e) => getComputedStyle(e).position)).not.toBe('absolute');
    await btn.click();
    await expect(btn).toHaveAttribute('aria-expanded', 'false');
    expect((await uiState(page)).sideOpen).toBe(false);
    await page.setViewportSize({ width: 1400, height: 800 });
    await expect(btn).toHaveAttribute('aria-expanded', 'false'); // 保存した「しまう」のまま
    await btn.click();
    await expect(btn).toHaveAttribute('aria-expanded', 'true');
    await expect.poll(async () => (await u.side.boundingBox())?.width ?? 0).toBeGreaterThan(150);
  });

  test('回帰：600px で ☰（重ねて出す）→ 1200px に広げて ☰（しまう：保存）→ 600px に戻しても、左の一覧は、勝手に出てこない', async ({
    page,
  }) => {
    const u = ui(page);
    const btn = page.locator('#btn-side');
    const rz = page.locator('#panel-resizer');
    // 窓の大きさを変えたら、画面が、その大きさで描き直されるのを待つ（右の幅の上限は、窓の大きさと、左の一覧の出し方で決まる）
    const resize = async (width: number, max: number) => {
      await page.setViewportSize({ width, height: 800 });
      await expect(rz).toHaveAttribute('aria-valuemax', String(max));
    };
    await resize(600, 220);
    await btn.click();
    await expect(btn).toHaveAttribute('aria-expanded', 'true');
    await resize(1200, 610); // 保存した「開く」：本文の列の横に並ぶ（1200 − 230 − 360）
    await expect(btn).toHaveAttribute('aria-expanded', 'true');
    await btn.click();
    await expect(btn).toHaveAttribute('aria-expanded', 'false');
    expect((await uiState(page)).sideOpen).toBe(false);
    await resize(600, 220);
    await expect(btn).toHaveAttribute('aria-expanded', 'false');
    expect((await u.side.boundingBox())?.width ?? 0).toBeLessThan(5);
    // ☰ を押さずに、広げて、戻すだけでも、重ねた一覧は、勝手に出てこない
    await btn.click();
    await expect(btn).toHaveAttribute('aria-expanded', 'true');
    await resize(1300, 909); // 保存した「しまう」（自動で隠す窓を出る：1101px 以上）：窓の 70%（1300 × 0.7 = 909.99… の切り捨て）。1300 − 360 = 940 より小さい
    await resize(600, 220);
    await expect(btn).toHaveAttribute('aria-expanded', 'false');
    expect((await u.side.boundingBox())?.width ?? 0).toBeLessThan(5);
  });

  test('境界（1100px）を、1px ずつ：本文は、どこでも 400px 以上・右のパネルは 220px 以上。1100 以下は左の一覧が隠れ、1101 から並ぶ（本文は 820px → 491px）', async ({
    page,
  }) => {
    const u = ui(page);
    for (let w = 1092; w <= 1110; w++) {
      await page.setViewportSize({ width: w, height: 800 });
      await expect.poll(async () => (await box(u.doc)).width, { message: `${w}px：本文` }).toBeGreaterThanOrEqual(399);
      expect((await box(u.panel)).width, `${w}px：パネル`).toBeGreaterThanOrEqual(219);
      await expect
        .poll(() => u.side.evaluate((e) => e.getBoundingClientRect().width > 5), {
          message: `${w}px：左の一覧が並ぶか`,
        })
        .toBe(w >= 1101);
    }
  });

  test('900px は狭い窓の規則・901px は広い窓の規則（本文の最小 400 / 360・右の下限 220 / 280）', async ({ page }) => {
    const u = ui(page);
    const rz = page.locator('#panel-resizer');
    await page.setViewportSize({ width: 900, height: 800 });
    await expect(rz).toHaveAttribute('aria-valuemin', '220');
    await expect.poll(async () => (await box(u.doc)).width).toBeGreaterThanOrEqual(399);
    const at900 = (await box(u.doc)).width;
    await page.setViewportSize({ width: 901, height: 800 });
    await expect(rz).toHaveAttribute('aria-valuemin', '280');
    // 0.28.0：901px も、左の一覧は隠れる（1100px 以下）。右の幅は細い既定の 280：本文は 621px
    await expect.poll(async () => (await box(u.doc)).width).toBeGreaterThanOrEqual(at900 - 5);
  });

  test('回帰：保存 380・800px で ← を 1 回 → 保存は、380 のまま。1200px に戻すと、パネルは 380（280 に縮まない）', async ({
    page,
  }) => {
    const u = ui(page);
    await page.setViewportSize({ width: 800, height: 800 });
    const rz = page.locator('#panel-resizer');
    await expect(rz).toHaveAttribute('aria-valuemax', '400'); // 狭い窓の表示になってから（800 − 0（左の一覧は隠れる）− 400。旧：232）
    await expect.poll(async () => Math.round((await box(u.panel)).width)).toBe(280); // 既定のままなら、細い既定
    await rz.focus();
    await page.keyboard.press('ArrowRight');
    await expect.poll(async () => (await box(u.panel)).width).toBeLessThanOrEqual(257);
    expect((await uiState(page)).panelW).toBeUndefined(); // 何も保存しない
    await page.setViewportSize({ width: 1200, height: 800 });
    await expect.poll(async () => Math.round((await box(u.panel)).width)).toBe(380);
    expect((await uiState(page)).panelW).toBeUndefined();
  });

  test('保存した幅は、書き換えない：狭い窓で、表示の幅だけ狭くなり、窓を広げると、元の幅に戻る。取っ手の範囲は、狭い窓の下限（220）・上限', async ({
    page,
  }) => {
    const u = ui(page);
    const rz = page.locator('#panel-resizer');
    const width = async () => (await box(u.panel)).width;
    // 600px を、保存する（広い窓で、ドラッグ）
    const r = await box(rz);
    await page.mouse.move(r.x + r.width / 2, r.y + 100);
    await page.mouse.down();
    await page.mouse.move(r.x + r.width / 2 - 220, r.y + 100, { steps: 6 });
    await page.mouse.up();
    await expect.poll(async () => (await uiState(page)).panelW).toBeGreaterThan(595);
    const saved = (await uiState(page)).panelW as number;
    for (const w of [800, 600, 900, 1000]) {
      await page.setViewportSize({ width: w, height: 800 });
      await expect.poll(async () => (await uiState(page)).panelW).toBe(saved);
    }
    await page.setViewportSize({ width: 800, height: 800 });
    await expect.poll(width).toBeLessThanOrEqual(401); // 本文に 400px を残す（左の一覧は、隠れる）
    expect((await box(u.doc)).width).toBeGreaterThanOrEqual(399);
    expect((await uiState(page)).panelW).toBe(saved);
    await page.setViewportSize({ width: 1360, height: 900 });
    await expect.poll(async () => Math.round(await width())).toBe(saved);

    // 取っ手：800px。下限 220・上限（400）
    await page.setViewportSize({ width: 800, height: 800 });
    await expect(rz).toHaveAttribute('aria-valuemin', '220');
    await expect(rz).toHaveAttribute('aria-valuemax', '400');
    const drag = async (x: number) => {
      const b = await box(rz);
      await page.mouse.move(b.x + b.width / 2, b.y + 100);
      await page.mouse.down();
      await page.mouse.move(x, b.y + 100, { steps: 8 });
      await page.mouse.up();
    };
    await drag(790); // 右の端まで：下限
    await expect.poll(width).toBeLessThanOrEqual(221);
    expect(await width()).toBeGreaterThanOrEqual(219);
    await drag(5); // 左の端まで：上限（本文に 400px）
    await expect.poll(width).toBeGreaterThan(390);
    expect(await width()).toBeLessThanOrEqual(401);
    expect((await box(u.doc)).width).toBeGreaterThanOrEqual(399);
    // 矢印キー：下限を下回らない
    await rz.focus();
    for (let i = 0; i < 9; i++) await page.keyboard.press('ArrowRight');
    await expect.poll(width).toBeLessThanOrEqual(221);
    expect(await width()).toBeGreaterThanOrEqual(219);
    expect((await uiState(page)).panelW).toBe(saved); // 狭い窓の取っ手は、保存した幅を書き換えない
    // 広い窓（901px〜）の下限は、これまでどおり 280
    await page.setViewportSize({ width: 901, height: 800 });
    await expect(rz).toHaveAttribute('aria-valuemin', '280');
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

  test('AI に送った後で AI の返信待ちのトピックに「待ち」。解決の数が、左の一覧に出る（0.28.0：上のバーには出さない）（F15・F21）', async ({
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
    await expect(u.top).toContainText('AI の返信待ち');
    await expect(u.side.locator('.topics li', { hasText: 'もう一つの資料' })).not.toContainText('待ち');
    const r = await app.nextRound();
    await app.apply({ round: r.round, replies: [{ thread: r.items[0].thread, body: '返信です。' }] });
    await expect(mine).not.toContainText('待ち');
    await expect(u.top).not.toContainText('AI の返信待ち');
    await u.threads.first().getByRole('button', { name: '解決', exact: true }).click();
    await expect(mine).toContainText('1/1');
    await expect(u.top).not.toContainText('解決 1/1'); // 進み具合は、左のトピック行だけ
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
    await expect(u.closedbar).toHaveCount(0);
    expect((await app.poll('demo', 1)).status).toBe('timeout');

    // 終了する：全面の終了画面では覆わない（0.1.4・F54）。同じ画面のまま、上に帯が出て、閲覧専用になる。ほかに開いているトピックへは、左の一覧から移る
    await u.end.click();
    await u.enddlg.getByRole('button', { name: '終了する' }).click();
    await expect(u.closedbar).toBeVisible();
    await expect(u.closedbar).toContainText('このトピックはレビューを終了しています（閲覧専用・コメントできません）');
    await expect(page.locator('#ended')).toHaveCount(0);
    await expect(u.article).toContainText('猫は朝によく鳴きます');
    await expect(u.end).toHaveCount(0);
    expect((await app.poll('demo', 3)).status).toBe('closed');
    // 左の一覧から、ほかのトピックへ移ると、帯が消える
    await u.side.locator('.topics li', { hasText: 'もう一つの資料' }).locator('a').click();
    await expect(u.closedbar).toHaveCount(0);
    await expect(u.top.locator('#top-title')).toHaveText('もう一つの資料');
    await expect(u.side.locator('.topics li', { hasText: '猫の観察日記' })).toContainText('終了');
    expect(native).toEqual([]); // ブラウザの confirm などは、出ていない
  });

  test('ほかに開いているトピックがなくても、終了したトピックは、そのまま見られる（F54。旧：「このタブは閉じて構いません」の全面の画面）', async ({
    page,
  }) => {
    const u = ui(page);
    const native = watchDialogs(page);
    await u.end.click();
    await u.enddlg.getByRole('button', { name: '終了する' }).click();
    await expect(u.closedbar).toBeVisible();
    await expect(page.locator('#ended')).toHaveCount(0);
    await expect(u.article).toContainText('猫は朝によく鳴きます');
    expect(native).toEqual([]);
  });

  test('未送信のコメントは、終了しても残る。開き直すと見える（F16・F2）', async ({ page, app }) => {
    const u = ui(page);
    await app.addTopic('second', 'もう一つの資料', '# もう一つの資料\n\n二番目のトピックの本文です。\n');
    await app.cli(['open', 'demo', '--no-open']);
    await addTextComment(page, '猫は朝によく鳴きます', '残るコメント');
    await u.end.click();
    await u.enddlg.getByRole('button', { name: '終了する' }).click();
    await expect(u.closedbar).toBeVisible();
    // 未送信は AI に届かない：poll は closed
    expect((await app.poll('demo', 3)).status).toBe('closed');
    // 開き直す（rikai open）：帯が消え、コメントが残っている
    await app.cli(['open', 'demo', '--no-open']);
    await page.reload();
    await expect(u.closedbar).toHaveCount(0);
    await expect(u.threads).toHaveCount(1);
    await expect(u.threads.first()).toContainText('残るコメント');
    await expect(u.submit).toHaveText('AI に送る（1）');
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
