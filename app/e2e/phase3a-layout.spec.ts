// 整理フェーズ ③a のレビュー指摘（0.28.0）：本文の上のバーが、右のパネルを広げても隠れない・版が 1 つのページでは出ない・拡大表示（html-app）の道具の帯で、閉じる（×）が上の行の右端に残る・
// 枠の見出しが、狭い枠でも 2 段（説明＋道具の 1 行）に収まる・取っ手でちょうど 380px にしても、1100px 以下で 280px に戻らない。実際の Chrome・本物のマウス。資料は作り物。
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { DOC_BASIC } from './samples';
import { box, ui } from './ui';

const BT = '```';
const APP = `${BT}html-app height=200\n<button id="go">ログイン</button>\n<script>window.rikai.state({ a: 1 });</script>\n${BT}\n`;
const DOC_APP = `# 題\n\n最初の段落です。\n\n${APP}\n後の段落です。\n`;

/** 取っ手を、本物のマウスで、右のパネルの幅が `w` になる所まで、ドラッグする（上限を超える分は、上限で止まる） */
async function dragPanel(page: Page, w: number): Promise<void> {
  const vw = page.viewportSize()?.width ?? 0;
  const b = await box(page.locator('#panel-resizer'));
  const y = b.y + b.height / 2;
  await page.mouse.move(b.x + b.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(vw - w, y, { steps: 6 });
  await page.mouse.up();
}

const panelW = async (page: Page): Promise<number> => Math.round((await box(ui(page).panel)).width);

test.describe('本文の上のバー（#docbar）：右のパネルを広げても、中身が本文の列からはみ出さない（隠れない）', () => {
  /** バーの中身（子）が、本文の列（#doc）の中に収まっているか。収まらなければ、折り返している（高さが増える） */
  const measure = (page: Page) =>
    page.evaluate(() => {
      const bar = document.querySelector('#docbar') as HTMLElement;
      const doc = document.querySelector('#doc') as HTMLElement;
      const d = doc.getBoundingClientRect();
      let right = Number.NEGATIVE_INFINITY;
      let left = Number.POSITIVE_INFINITY;
      for (const c of Array.from(bar.children)) {
        const r = c.getBoundingClientRect();
        if (r.width === 0) continue;
        right = Math.max(right, r.right);
        left = Math.min(left, r.left);
      }
      return {
        h: Math.round(bar.getBoundingClientRect().height),
        scroll: bar.scrollWidth,
        client: bar.clientWidth,
        over: Math.round((right - d.right) * 10) / 10,
        under: Math.round((d.left - left) * 10) / 10,
      };
    });

  test('窓 1360・1280・1440 × パネル 380・480・600・800 × 最新版（変更の札）・過去の版・子ページ：scrollWidth ≤ clientWidth・どの子も本文の右端以内。広いときは 1 行（40px）', async ({
    page,
    app,
  }) => {
    test.setTimeout(180_000);
    const u = ui(page);
    await app.switchTopic(page, 'dbw', 'バー', DOC_BASIC);
    await app.apply({
      pages: [{ id: 'sub', title: '詳しい子ページ', parent: 'root', markdown: '# 子\n\n本文です。\n' }],
    });
    await app.apply({ revisions: [{ page: 'root', markdown: DOC_BASIC.replace('三回', '四回') }] });
    await app.apply({ revisions: [{ page: 'root', markdown: DOC_BASIC.replace('三回', '五回') }] });
    await expect(page.locator('#docbar select option')).toHaveCount(3);
    const wrapped: string[] = [];
    for (const vw of [1360, 1280, 1440]) {
      await page.setViewportSize({ width: vw, height: 900 });
      for (const pw of [380, 480, 600, 800]) {
        await dragPanel(page, pw);
        for (const [name, hash, marker] of [
          ['最新版', '#/dbw/root', '.stats'],
          ['過去の版', '#/dbw/root/v2', '.pastver'],
          ['子ページ', '#/dbw/sub', '.crumbs'],
        ] as const) {
          await page.evaluate((h) => {
            location.hash = h;
          }, hash);
          await expect(u.docbar.locator(marker)).toBeVisible();
          if (name === '過去の版') await expect(u.docbar.getByRole('link', { name: '最新版へ' })).toBeVisible();
          const m = await measure(page);
          const where = `窓 ${vw}・パネル ${pw}（実際 ${await panelW(page)}）・${name}`;
          expect(m.scroll, `${where}：scrollWidth ≤ clientWidth`).toBeLessThanOrEqual(m.client);
          expect(m.over, `${where}：右端が、本文の列からはみ出している`).toBeLessThanOrEqual(0.5);
          expect(m.under, `${where}：左端が、本文の列からはみ出している`).toBeLessThanOrEqual(0.5);
          if (m.h > 48) wrapped.push(`${where}:${m.h}`);
          // 本文の列が十分なとき（窓 1360・パネル 380 など）は、1 行
          if (pw === 380 && vw >= 1360) expect(m.h, `${where}：1 行`).toBeLessThanOrEqual(48);
        }
      }
    }
    // 足りないときは、折り返している（隠れていない）：パネルを最大まで広げた窓は、折り返す
    expect(
      wrapped.some((s) => s.startsWith('窓 1360・パネル 800')),
      wrapped.join('\n'),
    ).toBe(true);
  });

  test('版が 1 つの、子でないページ：#docbar は出さない（高さ 0）。版が 2 つになると出る。子ページでは、版が 1 つでも、パンくずが出る', async ({
    page,
    app,
  }) => {
    const u = ui(page);
    await app.switchTopic(page, 'dbe', '空のバー', DOC_BASIC);
    await expect(u.docbar).toBeHidden();
    expect(await u.docbar.boundingBox()).toBeNull();
    await expect(u.docbar).toHaveAttribute('hidden', '');
    // 本文は、上端から始まる（空の帯を挟まない）
    expect(Math.round((await box(u.docscroll)).y - (await box(u.doc)).y)).toBe(0);
    await app.apply({ pages: [{ id: 'sub', title: '子', parent: 'root', markdown: '# 子\n\n本文です。\n' }] });
    await page.evaluate(() => {
      location.hash = '#/dbe/sub';
    });
    await expect(u.docbar).toBeVisible();
    await expect(u.docbar.locator('.crumbs')).toContainText('子');
    await page.evaluate(() => {
      location.hash = '#/dbe/root';
    });
    await expect(u.docbar).toBeHidden();
    await app.apply({ revisions: [{ page: 'root', markdown: `${DOC_BASIC}\n追記です。\n` }] });
    await expect(u.docbar).toBeVisible();
    await expect(u.docbar.locator('select')).toBeVisible();
  });
});

test.describe('拡大表示（html-app）の道具の帯：閉じる（×）は、いつも上の行の右端。帯は、狭い窓でも、低い', () => {
  test('窓 1360・1100・1000・900・760：× は、帯の上の行・右端。道具は、× に重ならず、帯の中。幅 5 つ・外観・要素を選ぶ・範囲を選ぶは、押せて、名前が残る', async ({
    page,
    app,
  }) => {
    test.setTimeout(120_000);
    const u = ui(page);
    await app.switchTopic(page, 'zb', '帯', DOC_APP);
    await page.waitForTimeout(1500);
    const heights: string[] = [];
    for (const vw of [1360, 1100, 1000, 900, 760]) {
      await page.setViewportSize({ width: vw, height: 800 });
      await page.locator('#article .htmlapp .cap [data-focus-open]').click();
      const tools = u.lightbox.locator('.fv-appbar .fv-tools');
      await expect(tools.locator('[data-width]')).toHaveCount(5);
      const m = await page.evaluate(() => {
        const bar = document.querySelector('#lightbox .fv-appbar') as HTMLElement;
        const br = bar.getBoundingClientRect();
        const x = (bar.querySelector('.close') as HTMLElement).getBoundingClientRect();
        const t = (bar.querySelector('.fv-tools') as HTMLElement).getBoundingClientRect();
        const first = (bar.querySelector('.fv-tools button') as HTMLElement).getBoundingClientRect();
        return {
          barH: Math.round(br.height),
          closeTop: Math.round(x.top - br.top),
          closeRight: Math.round(br.right - x.right),
          toolsRight: Math.round(t.right),
          closeLeft: Math.round(x.left),
          firstTop: Math.round(first.top - br.top),
        };
      });
      heights.push(`${vw}:${m.barH}`);
      expect(m.closeTop, `${vw}px：× が、上の行にない`).toBeLessThanOrEqual(24);
      expect(m.closeTop, `${vw}px：× が、道具の最初の行と、同じ高さにない`).toBeLessThanOrEqual(m.firstTop + 2);
      expect(m.closeRight, `${vw}px：× が、帯の右端にない`).toBeLessThanOrEqual(24);
      expect(m.toolsRight, `${vw}px：道具が、× に重なる`).toBeLessThanOrEqual(m.closeLeft);
      // 帯は、道具が 2 行になっても（本文の枠との幅の注記つき）、90px 以内。広い窓では、1 行
      expect(m.barH, `${vw}px：帯の高さ`).toBeLessThanOrEqual(vw >= 1360 ? 62 : 90);
      // 名前（読み上げ）・押す数は、そのまま
      await expect(tools.getByRole('button', { name: /^要素を選ぶ/ })).toBeVisible();
      await expect(tools.getByRole('button', { name: '範囲を選ぶ' })).toBeVisible();
      await expect(tools.locator('[data-frame-mode]')).toHaveAttribute('aria-label', /^枠の外観：/);
      await expect(tools.locator('[data-width="375"]')).toHaveAttribute(
        'aria-label',
        '枠の幅：スマートフォン（375px）',
      );
      await expect(tools.locator('[data-pick]')).toHaveText('要素を選ぶ'); // 文字は、DOM に残る（アイコンだけの窓でも）
      if (vw <= 900) {
        expect((await box(tools.locator('[data-pick]'))).width, `${vw}px：要素を選ぶは、アイコンだけ`).toBeLessThan(40);
        expect((await box(tools.locator('[data-tool="region"]'))).width).toBeLessThan(40);
      }
      await tools.locator('[data-tool="region"]').click(); // 1 回で、範囲を選ぶ
      await expect(tools.locator('[data-tool="region"]')).toHaveAttribute('aria-pressed', 'true');
      await page.keyboard.press('Escape');
      await expect(tools.locator('[data-tool="region"]')).toHaveAttribute('aria-pressed', 'false');
      await page.keyboard.press('Escape');
      await expect(u.lightbox).toBeHidden();
    }
    expect(heights.length).toBe(5);
  });
});

test.describe('枠の見出し：狭い枠でも、道具が 1 行（説明＋道具の 2 段）に収まる', () => {
  test('枠の幅 746・600・420・300：道具は、420 以上で 1 行（「この枠にコメント」も同じ行）・300 でも 2 行まで。見出しの高さ。名前・押す数は、そのまま', async ({
    page,
    app,
  }) => {
    await app.switchTopic(page, 'cap', '見出し', DOC_APP);
    await page.waitForTimeout(1500);
    const cap = page.locator('#article .htmlapp .cap');
    const m = (w: number) =>
      page.evaluate((w) => {
        const boxEl = document.querySelector('#article .htmlapp') as HTMLElement;
        boxEl.style.width = `${w}px`;
        const c = boxEl.querySelector('.cap') as HTMLElement;
        const cr = c.getBoundingClientRect();
        const mids: number[] = [];
        let right = 0;
        for (const b of Array.from(c.querySelectorAll('button'))) {
          const r = b.getBoundingClientRect();
          mids.push(r.top + r.height / 2);
          right = Math.max(right, r.right);
        }
        // 行：縦の中心が、10px より離れたら、別の行（同じ行でも、ボタンの高さの違いで、数 px ずれる）
        mids.sort((a, b) => a - b);
        const rows = 1 + mids.filter((y, i) => i > 0 && y - (mids[i - 1] as number) > 10).length;
        return { w: Math.round(cr.width), h: Math.round(cr.height), rows, over: Math.round(right - cr.right) };
      }, w);
    const rows: string[] = [];
    for (const [w, maxRows, maxH] of [
      [746, 1, 56],
      [600, 1, 56],
      [420, 1, 80],
      [300, 2, 104],
    ] as const) {
      const r = await m(w);
      rows.push(`${w}:${r.h}px/${r.rows}行`);
      expect(r.rows, `枠 ${w}px：ボタンの行`).toBeLessThanOrEqual(maxRows);
      expect(r.h, `枠 ${w}px：見出しの高さ`).toBeLessThanOrEqual(maxH);
      expect(r.over, `枠 ${w}px：右にはみ出す`).toBeLessThanOrEqual(0);
    }
    // 名前（読み上げ）・文字は、DOM にある。狭いとき（300）は、アイコンだけ
    const pick = cap.locator('[data-pick]');
    await expect(pick).toHaveText('要素を選ぶ');
    await expect(pick).toHaveAttribute('aria-label', /^要素を選ぶ/);
    await expect(cap.locator('[data-focus-open]')).toHaveText('拡大表示');
    await expect(cap.locator('[data-focus-open]')).toHaveAttribute('aria-label', '拡大表示');
    await expect(cap.locator('[data-frame-mode]')).toHaveAttribute('aria-label', /^枠の外観：/);
    expect((await box(pick)).width, '300px：要素を選ぶは、アイコンだけ').toBeLessThan(40);
    expect((await box(cap.getByRole('button', { name: 'この枠にコメント' }))).width).toBeGreaterThan(60); // 文字のまま
    // 広いとき（746）は、文字が出る
    await page.evaluate(() => {
      (document.querySelector('#article .htmlapp') as HTMLElement).style.width = '746px';
    });
    expect((await box(pick)).width, '746px：要素を選ぶは、文字つき').toBeGreaterThan(60);
    // 押す数は、同じ：幅は 1 回・外観は 1 回
    await cap.locator('[data-width="375"]').click();
    await expect(cap.locator('[data-width="375"]')).toHaveAttribute('aria-pressed', 'true');
    await cap.locator('[data-frame-mode]').click();
    await expect(cap.locator('[data-frame-mode]')).toHaveAttribute('data-frame-mode', 'dark');
    expect(rows.length).toBe(4);
  });

  test('実際に、右のパネルを 600 に広げた窓（1360px。枠は 414px 前後）：道具は 1 行・見出しは 71px 以内（旧：3 段・119px）', async ({
    page,
    app,
  }) => {
    await app.switchTopic(page, 'cap2', '見出し', DOC_APP);
    await page.waitForTimeout(1500);
    await page.setViewportSize({ width: 1360, height: 900 });
    await dragPanel(page, 600);
    const cap = page.locator('#article .htmlapp .cap');
    await expect.poll(async () => Math.round((await box(cap)).width)).toBeLessThan(480);
    const b = await box(cap);
    expect(b.height, `枠 ${Math.round(b.width)}px の見出し`).toBeLessThanOrEqual(75);
    const mids = await cap
      .locator('button')
      .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top + e.getBoundingClientRect().height / 2));
    expect(Math.max(...mids) - Math.min(...mids), 'ボタンは、1 行').toBeLessThanOrEqual(10);
  });
});

test.describe('右のコメントの幅：取っ手でちょうど 380px にしても、1100px 以下で 280px に戻らない（印で見分ける）', () => {
  test('窓 1000px：既定は 280。取っ手を 380 まで動かすと、途中で跳ねず（窓の右端からの距離のまま）、離しても・読み込み直しても 380。ダブルクリックで、既定（280）に戻り、印が消える', async ({
    page,
    app,
  }) => {
    const u = ui(page);
    await app.switchTopic(page, 'pw', '幅', DOC_BASIC);
    await page.setViewportSize({ width: 1000, height: 800 });
    await expect.poll(() => panelW(page)).toBe(280);
    const b = await box(page.locator('#panel-resizer'));
    const y = b.y + b.height / 2;
    await page.mouse.move(b.x + b.width / 2, y);
    await page.mouse.down();
    // 広い方から、狭い方へ。380 を通る瞬間も、幅は、窓の右端からの距離のとおり（旧：379 → 380 の間で、100px 跳ねた）
    const seen: number[] = [];
    for (const w of [440, 420, 400, 390, 381, 380, 379, 360]) {
      await page.mouse.move(1000 - w, y);
      await expect.poll(() => panelW(page)).toBe(w);
      seen.push(await panelW(page));
    }
    expect(seen).toEqual([440, 420, 400, 390, 381, 380, 379, 360]);
    await page.mouse.move(1000 - 380, y); // ちょうど 380 で離す
    await expect.poll(() => panelW(page)).toBe(380);
    await page.mouse.up();
    await expect.poll(() => panelW(page)).toBe(380);
    const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('rikai-ui') ?? '{}'));
    expect(await saved()).toMatchObject({ panelW: 380, panelUser: true });
    // 読み込み直しても、380（印つきで保存）
    await page.reload();
    await u.article.locator('.blk').first().waitFor();
    await expect.poll(() => panelW(page)).toBe(380);
    // ダブルクリック：もとの幅（既定）。印が消える：1000px では、細い既定の 280
    await page.locator('#panel-resizer').dblclick();
    await expect.poll(() => panelW(page)).toBe(280);
    expect(await saved()).toMatchObject({ panelW: 380, panelUser: false });
    // 広い窓へ：既定は 380
    await page.setViewportSize({ width: 1360, height: 800 });
    await expect.poll(() => panelW(page)).toBe(380);
  });

  test('古い保存（380・印なし）は、既定のまま：1000px で 280・1360px で 380。380 以外の古い保存（450）は、そのまま', async ({
    page,
    app,
  }) => {
    const u = ui(page);
    await app.switchTopic(page, 'pw2', '幅', DOC_BASIC);
    const reloadWith = async (ui: Record<string, unknown>, width: number) => {
      await page.setViewportSize({ width, height: 800 });
      await page.evaluate((v) => localStorage.setItem('rikai-ui', JSON.stringify(v)), ui);
      await page.reload();
      await u.article.locator('.blk').first().waitFor();
    };
    await reloadWith({ sideOpen: true, panelW: 380, links: true, theme: 'system', notify: false }, 1000);
    await expect.poll(() => panelW(page)).toBe(280);
    await reloadWith({ sideOpen: true, panelW: 380, links: true, theme: 'system', notify: false }, 1360);
    await expect.poll(() => panelW(page)).toBe(380);
    await reloadWith({ sideOpen: true, panelW: 450, links: true, theme: 'system', notify: false }, 1000);
    await expect.poll(() => panelW(page)).toBe(450);
    await reloadWith(
      { sideOpen: true, panelW: 380, panelUser: true, links: true, theme: 'system', notify: false },
      1000,
    );
    await expect.poll(() => panelW(page)).toBe(380);
  });
});
