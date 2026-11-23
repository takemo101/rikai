// 本文でコメントの対象を選ぶ（F3・F4・F22・F27・F29(2)・F33(3)）：
// 文を選んで「コメント」・ブロックにマウスを置いてバー・番号の丸とカードの対応・お互いの光り・番号で 1 枚だけ見る
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { addTextComment, dragSelect, fillAndAdd, hoverBlock, openComposerOnText, ui } from './ui';

// 本文の中の文字の、画面の座標（範囲の矩形）
async function rangeRect(page: Page, needle: string) {
  return page.evaluate((n) => {
    const root = document.querySelector('#article') as Element;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = w.nextNode(); node; node = w.nextNode()) {
      const i = (node.nodeValue ?? '').indexOf(n);
      if (i < 0) continue;
      const r = document.createRange();
      r.setStart(node, i);
      r.setEnd(node, i + n.length);
      const b = (r.getClientRects()[0] as DOMRect).toJSON();
      return b as { left: number; top: number; right: number; bottom: number; width: number; height: number };
    }
    throw new Error('文字がありません');
  }, needle);
}

test.describe('文・ブロックの選択', () => {
  test('文を選ぶと、選んだ文の上に「コメント」が出る。押すと入力欄が開き、対象が、アクセントの破線になる（F3・F22(3)・F27）', async ({
    page,
  }) => {
    const u = ui(page);
    await expect(u.actbar).toBeHidden();
    await dragSelect(page, '猫は朝によく鳴きます');
    await expect(u.actbar).toBeVisible();
    await expect(u.actComment).toHaveText('コメント');
    const sel = await rangeRect(page, '猫は朝によく鳴きます');
    const bar = (await u.actbar.boundingBox()) as { y: number; height: number };
    expect(bar.y + bar.height).toBeLessThanOrEqual(sel.top + 2); // 選んだ文の上

    await u.actComment.click();
    await expect(u.actbar).toBeHidden();
    await expect(u.composer).toBeVisible();
    await expect(u.composer.locator('textarea')).toBeFocused();
    await expect(u.composer.locator('.quote')).toContainText('猫は朝によく鳴きます');
    // 入力中：本文の対象は、アクセント（青）の破線、番号の丸は「新」
    await expect(u.bno).toHaveText(['新']);
    const mark = u.article.locator('mark.pending');
    await expect(mark).toHaveText('猫は朝によく鳴きます');
    const st = await mark.evaluate((e) => {
      const cs = getComputedStyle(e);
      return { style: cs.outlineStyle, color: cs.outlineColor };
    });
    const [r, , b] = (st.color.match(/\d+/g) ?? []).map(Number) as [number, number, number];
    expect(st.style).toBe('dashed');
    expect(b).toBeGreaterThan(r + 60); // 青系（コメントの付いた文の、黄色の強調ではない）

    // やめる：強調・「新」が消える（F22(4)）
    await u.composer.getByRole('button', { name: 'やめる' }).click();
    await expect(u.composer).toHaveCount(0);
    await expect(u.article.locator('mark.pending')).toHaveCount(0);
    await expect(u.bno).toHaveCount(0);
  });

  test('選択を外すと、文のバーが消える（F27）', async ({ page }) => {
    const u = ui(page);
    await dragSelect(page, '猫は朝によく鳴きます');
    await expect(u.actbar).toBeVisible();
    await page.mouse.click(5, 450); // 余白（左の一覧）を押す＝選択が外れる
    await expect(u.actbar).toBeHidden();
  });

  test('ブロックにマウスを置くと、そのブロックの右上にバーが出る。押すとそのブロックへのコメント（F4・F27）', async ({
    page,
  }) => {
    const u = ui(page);
    const cases: Array<{ sel: string; label: RegExp | string }> = [
      { sel: '#article p:has-text("猫は一日に三回")', label: /猫は一日に三回/ },
      { sel: '#article h2:has-text("食事")', label: /食事/ },
      { sel: '#article li:has-text("朝のごはん")', label: /朝のごはん/ },
      { sel: '#article table', label: '表' },
      { sel: '#article pre', label: 'コード' },
    ];
    for (const c of cases) {
      const block = page.locator(c.sel).first();
      await hoverBlock(page, block);
      await expect(u.actbar).toBeVisible();
      const art = (await u.article.boundingBox()) as { x: number; width: number };
      const blk = (await block.boundingBox()) as { y: number; height: number };
      const bar = (await u.actbar.boundingBox()) as { x: number; y: number; width: number; height: number };
      expect(bar.x + bar.width).toBeLessThanOrEqual(art.x + art.width + 1); // 右上（本文の右端まで）
      expect(bar.y).toBeLessThan(blk.y + blk.height); // ブロックの上寄り
      expect(bar.y).toBeGreaterThanOrEqual(blk.y - 40);
      await u.actComment.click();
      await expect(u.composer).toBeVisible();
      await expect(u.composer.locator('.quote')).toContainText(c.label);
      await u.composer.getByRole('button', { name: 'やめる' }).click();
      await expect(u.composer).toHaveCount(0);
    }
  });

  test('入力欄を開いている間は、ブロックのバーが出ない。閉じると出る（F29(2)）', async ({ page }) => {
    const u = ui(page);
    await openComposerOnText(page, '猫は朝によく鳴きます');
    await hoverBlock(page, page.locator('#article table'));
    await expect(u.actbar).toBeHidden();
    await hoverBlock(page, page.locator('#article pre'));
    await expect(u.actbar).toBeHidden();
    await u.composer.getByRole('button', { name: 'やめる' }).click();
    await hoverBlock(page, page.locator('#article table'));
    await expect(u.actbar).toBeVisible();
  });

  test('番号：本文の順につき、本文の丸とカードが対応する。丸は同じ見た目・同じ位置（F22(1)）', async ({ page }) => {
    const u = ui(page);
    // 書いた順は、本文の順と逆（睡眠 → 表 → 冒頭の文）
    await addTextComment(page, '日向でよく丸くなります', '睡眠のコメント');
    await hoverBlock(page, page.locator('#article table'));
    await u.actComment.click();
    await fillAndAdd(page, '表のコメント');
    await addTextComment(page, '猫は朝によく鳴きます', '冒頭のコメント');

    await expect(u.bno).toHaveText(['1', '2', '3']);
    // カードの並びも、本文の順（冒頭 → 表 → 睡眠）。番号は、カードにも付く
    await expect(u.threads).toHaveCount(3);
    await expect(u.threads.nth(0)).toContainText('冒頭のコメント');
    await expect(u.threads.nth(1)).toContainText('表のコメント');
    await expect(u.threads.nth(2)).toContainText('睡眠のコメント');
    for (const [i, n] of ['1', '2', '3'].entries()) await expect(u.threads.nth(i).locator('.no')).toHaveText(n);

    // 丸は、文・ブロックのどちらも、同じ大きさ・同じ左の位置（記事の左の余白）
    const boxes = await u.bno.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()));
    const art = (await u.article.boundingBox()) as { x: number };
    for (const b of boxes) {
      expect(b.right).toBeLessThanOrEqual(art.x + 40);
      expect(Math.abs(b.left - boxes[0].left)).toBeLessThanOrEqual(8);
      expect(Math.abs(b.width - boxes[0].width)).toBeLessThanOrEqual(1);
      expect(Math.abs(b.height - boxes[0].height)).toBeLessThanOrEqual(1);
    }
    // 丸の縦の位置は、対象の上端（文は、最初の行の高さ）にそろう
    const textTop = (await rangeRect(page, '猫は朝によく鳴きます')).top;
    const b1 = (await u.bno.nth(0).boundingBox()) as { y: number; height: number };
    expect(Math.abs(b1.y + b1.height / 2 - (textTop + 12))).toBeLessThanOrEqual(24);
    const tableTop = ((await page.locator('#article table').boundingBox()) as { y: number }).y;
    const b2 = (await u.bno.nth(1).boundingBox()) as { y: number };
    expect(Math.abs(b2.y - tableTop)).toBeLessThanOrEqual(24);
    // 丸が丸い（角の丸め）
    expect(
      await u.bno.first().evaluate((e) => parseFloat(getComputedStyle(e).borderTopLeftRadius)),
    ).toBeGreaterThanOrEqual(8);

    // 解決すると、丸の色が変わる（青 → 灰色）
    const before = await u.bno.nth(0).evaluate((e) => getComputedStyle(e).backgroundColor);
    await u.threads.nth(0).getByRole('button', { name: '解決', exact: true }).click();
    await expect(page.locator('.tab', { hasText: '解決済み' })).toHaveText('解決済み1');
    await expect(u.bno).toHaveCount(3);
    const after = await u.bno.nth(0).evaluate((e) => getComputedStyle(e).backgroundColor);
    expect(after).not.toBe(before);
  });

  test('カードにマウスを置くと本文の対象が、本文の丸に置くとカードが光る（F22(2)）', async ({ page }) => {
    const u = ui(page);
    await addTextComment(page, '猫は朝によく鳴きます', '一つ目');
    await addTextComment(page, '日向でよく丸くなります', '二つ目');
    await expect(u.bno).toHaveText(['1', '2']);
    await page.mouse.move(5, 5);
    await expect(page.locator('#article .linked, #badges .linked, .thread.linked')).toHaveCount(0);

    // カード → 本文の対象（と丸）
    await u.threads.nth(1).hover();
    await expect(u.threads.nth(1)).toHaveClass(/linked/);
    await expect(u.threads.nth(0)).not.toHaveClass(/linked/);
    await expect(u.article.locator('.linked')).toHaveText('日向でよく丸くなります');
    await expect(u.bno.nth(1)).toHaveClass(/linked/);
    await expect(u.bno.nth(0)).not.toHaveClass(/linked/);
    await page.mouse.move(5, 5);
    await expect(u.article.locator('.linked')).toHaveCount(0);

    // 本文の丸 → カード
    await u.bno.nth(0).hover();
    await expect(u.threads.nth(0)).toHaveClass(/linked/);
    await expect(u.threads.nth(1)).not.toHaveClass(/linked/);
    await page.mouse.move(5, 5);
    await expect(u.threads.nth(0)).not.toHaveClass(/linked/);
  });

  test('本文の丸に置いたとき、見えない所のカードは、見える所まで動く（F22(2)）', async ({ page, app }) => {
    const u = ui(page);
    const paras = Array.from({ length: 12 }, (_, i) => `第${i + 1}段落の文章です。`);
    await app.switchTopic(page, 'many', '長い資料', `# 長い資料\n\n${paras.join('\n\n')}\n`);
    await app.apply(
      {
        threads: paras.map((p) => ({ page: 'root', anchor: { quote: p }, body: `${p}への確認です。` })),
      },
      { topic: 'many' },
    );
    await expect(u.bno).toHaveCount(12);
    const last = u.threads.nth(11);
    await expect(last).toBeAttached();
    const inPanel = async () => {
      const p = (await u.panel.boundingBox()) as { y: number; height: number };
      const b = (await last.boundingBox()) as { y: number; height: number };
      return b.y >= p.y - 1 && b.y + b.height <= p.y + p.height + 1;
    };
    expect(await inPanel()).toBe(false);
    await u.bno.nth(11).hover();
    await expect.poll(inPanel).toBe(true);
    await expect(last).toHaveClass(/linked/);
  });

  test('番号を押すと、そのカードだけを見られる。「すべてのコメントに戻る」で戻る（F33(3)）', async ({ page }) => {
    const u = ui(page);
    await addTextComment(page, '猫は朝によく鳴きます', '一つ目');
    await addTextComment(page, '日向でよく丸くなります', '二つ目');
    await addTextComment(page, '猫は一日に三回', '三つ目');
    await expect(u.threads).toHaveCount(3);

    await u.bno.nth(1).click();
    const solobar = page.locator('.solobar');
    await expect(solobar).toBeVisible();
    await expect(solobar).toContainText('2 番のコメントだけを表示中');
    await expect(solobar.getByRole('button', { name: 'すべてのコメントに戻る' })).toBeVisible();
    await expect(u.threads).toHaveCount(1);
    await expect(u.threads.first()).toContainText('三つ目'); // 本文の順で 2 番は「猫は一日に三回」
    await expect(page.locator('.tabs, .tab')).toHaveCount(0); // 切り替えは、出ない

    await solobar.getByRole('button', { name: 'すべてのコメントに戻る' }).click();
    await expect(solobar).toHaveCount(0);
    await expect(u.threads).toHaveCount(3);

    // 本文の強調を押しても、そのカードが選ばれる（solo ではない）
    await u.article.locator('mark', { hasText: '日向でよく丸くなります' }).click();
    await expect(u.threads.filter({ hasText: '二つ目' })).toHaveClass(/active/);
    await expect(u.threads).toHaveCount(3);
  });
});
