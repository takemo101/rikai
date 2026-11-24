// 右パネルのカードの軽量化（P5）：返信欄の畳み・札「枠から」を外す・「資料を vN に更新」の最新だけ文字つき・小さい字と押す領域。実際の Chrome・本物のマウス・キー。資料・コメントは作り物。
import type { Locator, Page } from '@playwright/test';
import { expect, type RikaiApp, test } from './fixtures';
import { addTextComment, submitAll, ui } from './ui';

const DOC_V2 = `# 猫の観察日記

これは猫についての作り物の資料です。猫は朝によく鳴きます。

## 食事

猫は一日に四回、ごはんを食べます。水もたくさん飲みます。

## 睡眠

猫は一日に十六時間ほど眠ります。日向でよく丸くなります。
`;
const DOC_V3 = `${DOC_V2}\n（v3）新しい段落です。\n`;

const QUOTES = ['猫は朝によく鳴きます', '水もたくさん飲みます', '日向でよく丸くなります'] as const;

/** 3 枚のカード：全員に AI が返信し、資料は v2 になる。1 枚目だけ、もう 1 往復して、v3 になる（1 枚目の返信は 2 つ：古い v2・最新の v3） */
async function seed(page: Page, app: RikaiApp): Promise<string[]> {
  for (const [i, q] of QUOTES.entries()) await addTextComment(page, q, `コメント ${i + 1}`);
  await submitAll(page);
  const r = await app.nextRound();
  const tids: string[] = r.items.map((i: { thread: string }) => i.thread);
  await app.apply({
    round: r.round,
    revisions: [{ page: 'root', markdown: DOC_V2 }],
    replies: tids.map((t) => ({ thread: t, body: '資料を直しました。' })),
  });
  await expect(page.locator('#docbar select')).toHaveValue('2');
  // 1 枚目：追加の質問 → 2 回目の返信（v3）。番号順は本文の順なので、1 枚目は、いちばん上
  const first = ui(page).threads.first();
  await first.locator('textarea').fill('追加の質問');
  await first.getByRole('button', { name: '追加', exact: true }).click();
  await submitAll(page);
  const r2 = await app.nextRound();
  await app.apply({
    round: r2.round,
    revisions: [{ page: 'root', markdown: DOC_V3 }],
    replies: [{ thread: r2.items[0].thread, body: 'もう一度、直しました。' }],
  });
  await expect(page.locator('#docbar select')).toHaveValue('3');
  await page.reload(); // 選んでいるカードのない状態から（選びは、画面の一時の状態）
  await expect(ui(page).threads).toHaveCount(3);
  return tids;
}

const foot = (card: Locator) => card.locator('.th-foot');
const heightOf = async (loc: Locator): Promise<number> => ((await loc.boundingBox())?.height ?? 0) as number;

test.describe('返信欄の畳み', () => {
  test('選んでいないカードは 1 行（「返信…」）・ボタンは出ない。見出しを押す 1 回で、3 行とボタンが出る。別のカードを選ぶと移る（クリック数は増えない）', async ({
    page,
    app,
  }) => {
    await seed(page, app);
    const cards = ui(page).threads;
    for (let i = 0; i < 3; i++) {
      expect(await heightOf(foot(cards.nth(i)))).toBeLessThan(45); // 以前は 100px
      await expect(cards.nth(i).locator('textarea')).toHaveAttribute('placeholder', '返信…');
      await expect(foot(cards.nth(i)).locator('button')).toHaveCount(0);
    }
    await cards.nth(1).locator('.th-head').click(); // この 1 回だけ
    await expect(cards.nth(1).locator('textarea')).toHaveAttribute(
      'placeholder',
      /返信・追加の質問（⌘\/Ctrl\+Enter で追加/,
    );
    expect(await heightOf(cards.nth(1).locator('textarea'))).toBeGreaterThan(60); // 3 行
    await expect(cards.nth(1).getByRole('button', { name: '追加', exact: true })).toBeVisible();
    await expect(cards.nth(1).getByRole('button', { name: '解決', exact: true })).toBeVisible();
    await expect(cards.nth(1).getByRole('button', { name: '画像を付ける' })).toBeVisible();
    expect(await heightOf(foot(cards.nth(0)))).toBeLessThan(45); // ほかは、畳んだまま
    await cards.nth(2).locator('.th-head').click();
    await expect(foot(cards.nth(1)).locator('button')).toHaveCount(0); // 移った
    await expect(cards.nth(2).getByRole('button', { name: '解決', exact: true })).toBeVisible();
  });

  test('畳んだ欄を押す（1 回）と、選んで・開いて・そのまま入力できる。書きかけのカードは、選んでいなくても開いたまま。タブを替えても、残る。消すと畳む', async ({
    page,
    app,
  }) => {
    await seed(page, app);
    const cards = ui(page).threads;
    await cards.nth(0).locator('textarea').click();
    await page.keyboard.type('書きかけです');
    await expect(cards.nth(0).locator('textarea')).toHaveValue('書きかけです');
    await cards.nth(1).locator('.th-head').click(); // ほかのカードを選ぶ
    await expect(cards.nth(1).getByRole('button', { name: '解決', exact: true })).toBeVisible();
    // 書きかけのカード：開いたまま（見える・値は残る）
    await expect(cards.nth(0).locator('textarea')).toHaveValue('書きかけです');
    expect(await heightOf(cards.nth(0).locator('textarea'))).toBeGreaterThan(60);
    await expect(cards.nth(0).getByRole('button', { name: '追加', exact: true })).toBeVisible();
    // 描き直し（タブの切り替え）でも
    await page.locator('.tab', { hasText: 'すべて' }).click();
    await page.locator('.tab', { hasText: '未解決' }).click();
    await expect(cards.nth(0).locator('textarea')).toHaveValue('書きかけです');
    await expect(cards.nth(0).getByRole('button', { name: '追加', exact: true })).toBeVisible();
    // 消して、ほかのカードを選ぶと、畳む
    await cards.nth(0).locator('textarea').fill('');
    await cards.nth(2).locator('.th-head').click();
    await expect(foot(cards.nth(0)).locator('button')).toHaveCount(0);
    expect(await heightOf(foot(cards.nth(0)))).toBeLessThan(45);
  });

  test('キーボード：畳んだ欄へ Tab で届き（名前つき）、入ると開く。続けて Tab で、画像・追加・解決へ。Ctrl+Enter で追加できる', async ({
    page,
    app,
  }) => {
    await seed(page, app);
    const cards = ui(page).threads;
    // 読み上げ：畳んでいても、3 つとも、名前つきの入力欄として見つかる
    await expect(page.getByRole('textbox', { name: '返信・追加の質問' })).toHaveCount(3);
    // 1 枚目の、最後の、フォーカスできるもの（資料の更新のリンク）から、Tab
    await cards.nth(0).locator('a.btnlink').last().focus();
    await page.keyboard.press('Tab');
    const ta = cards.nth(0).locator('textarea');
    await expect(ta).toBeFocused();
    await expect(cards.nth(0).getByRole('button', { name: '追加', exact: true })).toBeVisible(); // 入ると開く
    await page.keyboard.press('Tab');
    await expect(cards.nth(0).getByRole('button', { name: '画像を付ける' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(cards.nth(0).getByRole('button', { name: '追加', exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(cards.nth(0).getByRole('button', { name: '解決', exact: true })).toBeFocused();
    await expect(cards.nth(0).getByRole('button', { name: '追加', exact: true })).toBeVisible(); // ボタンにいるあいだも、畳まない
    // Ctrl+Enter：追加（下書きの発言になる）
    await ta.click();
    await page.keyboard.type('キーボードで追加');
    await page.keyboard.press('Control+Enter');
    await expect(cards.nth(0)).toContainText('キーボードで追加');
    await expect(ta).toHaveValue('');
  });

  test('質問（ask）のカード・解決済みのカード：壊れない。質問の答える欄は、返信欄が畳まれていても、いつも見える。解決済みは、返信欄なし（再開する）', async ({
    page,
    app,
  }) => {
    await app.apply({
      threads: [
        {
          page: 'root',
          anchor: { quote: '猫は朝によく鳴きます' },
          body: '確認です。',
          ask: {
            type: 'single_choice',
            question: 'どれが好き？',
            options: [
              { id: 'a', label: '魚' },
              { id: 'b', label: '肉' },
            ],
            allowOther: false,
          },
        },
        { page: 'root', anchor: { quote: '水もたくさん飲みます' }, body: '二つ目です。' },
      ],
    });
    const cards = ui(page).threads;
    await expect(cards).toHaveCount(2);
    const ask = cards.nth(0);
    await expect(ask.getByLabel('魚')).toBeVisible(); // 返信欄が畳まれていても、答える欄は、いつも出ている
    expect(await heightOf(foot(ask))).toBeLessThan(45);
    await ask.getByLabel('魚').check();
    await ask.getByRole('button', { name: '回答を保存' }).click();
    await expect(ask).toContainText('保存済み（未送信）');
    // 解決：選ぶ → 解決 → 解決済みの 1 行 → 開く → 再開する（返信欄はない）
    await cards.nth(1).locator('.th-head').click();
    await cards.nth(1).getByRole('button', { name: '解決', exact: true }).click();
    await expect(cards).toHaveCount(1);
    await page.locator('.tab', { hasText: '解決済み' }).click();
    await page.locator('.donerow').click();
    const open = page.locator('#threads .rowopen .thread');
    await expect(open.getByRole('button', { name: '再開する' })).toBeVisible();
    await expect(open.locator('textarea')).toHaveCount(0);
  });
});

test.describe('札「枠から」・資料の更新', () => {
  const ANCHOR = {
    blockId: 'b0',
    blockHash: '',
    blockTag: 'DIV',
    blockText: '',
    quote: '',
    prefix: '',
    suffix: '',
    label: '枠から：button',
  };
  const PICK = {
    selector: 'button.primary',
    tag: 'button',
    text: 'ログイン',
    rect: { x: 24, y: 312, w: 320, h: 40 },
    styles: { color: 'rgb(255, 255, 255)' },
    frame: { w: 634, h: 400 },
  };

  test('枠から取った情報のコメント：見出しの行に札「枠から」は出ない。引用の行と情報の行は、そのまま。左の線（data-from-frame）も残る', async ({
    page,
    app,
  }) => {
    const r = await app.http('/api/comment', {
      method: 'POST',
      auth: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        topic: 'demo',
        page: 'root',
        version: 1,
        anchor: ANCHOR,
        text: '色を変えたい',
        frameMeta: { pick: PICK },
      }),
    });
    expect(r.status).toBe(200);
    await page.reload();
    const card = ui(page).threads.first();
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute('data-from-frame', '');
    await expect(card.locator('.fromframe')).toHaveCount(0); // 札は、どこにもない
    expect((await card.locator('.th-head .chip').allTextContents()).join('')).not.toContain('枠から'); // 見出しの札に、「枠から」はない
    await expect(card.locator('.quote')).toHaveText('枠から：button'); // 引用の行
    await expect(card.locator('.framemeta')).toContainText('要素を選びました（button・x:24 y:312 w:320 h:40）'); // 情報の行
    await card.locator('.fm-toggle').click();
    await expect(card.locator('.fm-body')).toContainText('button.primary'); // 開くと、メタデータ（これまでどおり）
  });

  test('最新の更新だけ「資料を vN に更新」「vN を見る」。古い更新は `↻vN` の小さなリンク（名前は残る。押すとその版へ）', async ({
    page,
    app,
  }) => {
    await seed(page, app);
    const card1 = ui(page).threads.nth(0);
    const card2 = ui(page).threads.nth(1);
    // 1 枚目：返信は 2 つ（v2・v3）。緑の札は、最新の 1 つだけ
    await expect(card1.locator('.chip.ok')).toHaveCount(1);
    await expect(card1.locator('.chip.ok')).toHaveText('資料を v3 に更新');
    await expect(card1.getByRole('link', { name: 'v3 を見る' })).toBeVisible();
    const old = card1.getByRole('link', { name: '資料を v2 に更新した版を見る' });
    await expect(old).toHaveText('v2');
    expect(await heightOf(old)).toBeGreaterThanOrEqual(24); // 押す領域
    // 2 枚目：返信は 1 つ（v2）：これまでどおり文字つき（最新の更新が、これだから）
    await expect(card2.locator('.chip.ok')).toHaveText('資料を v2 に更新');
    await expect(card2.locator('a.rev-old')).toHaveCount(0);
    // 押すと、その版へ
    await old.click();
    await expect(page).toHaveURL(/#\/demo\/root\/v2$/);
    await expect(ui(page).docbar.locator('.pastver')).toContainText('過去の版 v2');
  });
});

test.describe('小さい字・押す領域', () => {
  test('カードの札・版・AI の名前は 12px 以上（番号の印 .no は、そのまま 11px）。リンク・ラジオの行・「これまでのやり取り」は、押す領域が 24px 以上', async ({
    page,
    app,
  }) => {
    // 古い質問（答えずに進んだ）・折りたたみ（2 件以上の古いやり取り）・版の札を持つカードを作る
    await seed(page, app);
    const card1 = ui(page).threads.nth(0);
    await card1.locator('.th-head').click();
    for (let i = 0; i < 2; i++) {
      await card1.locator('textarea').fill(`もう一往復 ${i}`);
      await card1.getByRole('button', { name: '追加', exact: true }).click();
      await submitAll(page);
      const r = await app.nextRound();
      await app.apply({ round: r.round, replies: [{ thread: r.items[0].thread, body: `返信 ${i}` }] });
      await expect(card1).toContainText(`返信 ${i}`);
    }
    await app.apply({
      threads: [
        {
          page: 'root',
          anchor: { quote: '日向でよく丸くなります' },
          body: '質問です。',
          ask: {
            type: 'single_choice',
            question: 'どれ？',
            options: [
              { id: 'a', label: '魚' },
              { id: 'b', label: '肉' },
            ],
            allowOther: false,
          },
        },
      ],
    });
    await expect(ui(page).threads).toHaveCount(4);
    const panel = ui(page).panel;
    const sizes = await panel.evaluate((root) => {
      const pick = (sel: string): string[] => [...root.querySelectorAll(sel)].map((e) => getComputedStyle(e).fontSize);
      return { chips: pick('.chip.small'), who: pick('.msg.ai .who'), no: pick('.th-head .no') };
    });
    expect(sizes.chips.length).toBeGreaterThan(0);
    expect(sizes.who.length).toBeGreaterThan(0);
    for (const s of [...sizes.chips, ...sizes.who]) expect(Number.parseFloat(s)).toBeGreaterThanOrEqual(12);
    for (const s of sizes.no) expect(s).toBe('11px'); // 番号の印は、触らない
    // 押す領域（高さ）：ラジオの行・資料の更新のリンク・「これまでのやり取り」
    const targets = panel.locator('.opt, a.btnlink, button.link, .older > summary');
    const n = await targets.count();
    expect(n).toBeGreaterThanOrEqual(4);
    for (let i = 0; i < n; i++) {
      const el = targets.nth(i);
      if (!(await el.isVisible())) continue;
      expect(await heightOf(el), (await el.textContent()) ?? '').toBeGreaterThanOrEqual(24);
    }
    await expect(panel.locator('.older > summary')).toBeVisible();
  });
});
