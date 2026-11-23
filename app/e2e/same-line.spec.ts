// 同じ行に、複数のコメントがあるとき：番号の丸は、1 つの行に収め（折り返さない）、横に重ねる。5 つまで並べ、それより多いときは「+N」にまとめる。
// 線は、同じ行の始点をずらし、同じ x まで引き出してから S 字に入るので、交差しない（F35）。
import type { Page } from '@playwright/test';
import { expect, type RikaiApp, test } from './fixtures';
import { ui } from './ui';

const WORDS = ['語一', '語二', '語三', '語四', '語五', '語六', '語七'];
// 1 行に収まる、短い語（1 つの段落・1 行）
const DOC = `# 同じ行\n\n${WORDS.map((w) => `${w}の文`).join('、')}。\n\n次の段落です。\n`;

async function openRow(page: Page, app: RikaiApp, n: number) {
  await page.setViewportSize({ width: 1700, height: 2000 }); // 6 枚のカードが、すべて、見える高さ。丸を 5 つ並べられる幅
  await app.switchTopic(page, 'row', '同じ行', DOC);
  await app.apply(
    {
      threads: WORDS.slice(0, n).map((w) => ({
        page: 'root',
        anchor: { quote: `${w}の文` },
        body: `${w}の確認です。`,
      })),
    },
    { topic: 'row' },
  );
  await expect(ui(page).threads).toHaveCount(n);
  await expect(ui(page).bno).toHaveCount(n);
  await expect(page.locator('#links path[data-tid]')).toHaveCount(n);
  await page.mouse.move(5, 5);
}

const box = (page: Page, sel: string) =>
  page.evaluate((s) => {
    const e = document.querySelector(s) as HTMLElement;
    const r = e.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  }, sel);

// 見えている丸（`.bno`。「+N」にまとめて隠れたものは、除く）
const visibleBadges = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('#badges .bno')]
      .map((e) => ({ text: e.textContent, r: e.getBoundingClientRect() }))
      .filter((b) => b.r.width > 0)
      .map((b) => ({ text: b.text, left: b.r.left, top: b.r.top, right: b.r.right, bottom: b.r.bottom })),
  );

type P = { x: number; y: number };
// 線を、細かく（0.5px ごと）サンプリングして、折れ線にする。急な S 字（縦に長く、横に短い）で、粗い折れ線が、近い線と、偽の交差をしないように
const polylines = (page: Page): Promise<P[][]> =>
  page.evaluate(() =>
    [...document.querySelectorAll<SVGPathElement>('#links path[data-tid]')].map((p) => {
      const len = p.getTotalLength();
      const n = Math.min(6000, Math.ceil(len / 0.5));
      return Array.from({ length: n + 1 }, (_, i) => {
        const q = p.getPointAtLength((len * i) / n);
        return { x: q.x, y: q.y };
      });
    }),
  );

// 線が落ち着く（描き直しが、続けて 3 回、同じ）まで待つ：再読み込み・窓の大きさの変更・スクロールのあと
const settledLinks = async (page: Page) => {
  let last = '';
  let same = 0;
  for (let i = 0; i < 60 && same < 3; i++) {
    await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
    const sig = await page.evaluate(() =>
      [...document.querySelectorAll('#links path[data-tid]')].map((p) => p.getAttribute('d')).join('|'),
    );
    same = sig === last ? same + 1 : 0;
    last = sig;
  }
};

const cross = (a: P, b: P, c: P, d: P): boolean => {
  const o = (p: P, q: P, r: P) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0; // 端点が離れた、本当の交差
};
const crossings = (lines: P[][]): number => {
  let n = 0;
  for (let i = 0; i < lines.length; i++)
    for (let j = i + 1; j < lines.length; j++) {
      const [A, B] = [lines[i] as P[], lines[j] as P[]];
      for (let a = 0; a + 1 < A.length; a++) {
        const [p, q] = [A[a] as P, A[a + 1] as P];
        const [lo, hi] = [Math.min(p.y, q.y) - 1, Math.max(p.y, q.y) + 1];
        for (let b = 0; b + 1 < B.length; b++) {
          const [r, t] = [B[b] as P, B[b + 1] as P];
          if (Math.max(r.y, t.y) < lo || Math.min(r.y, t.y) > hi) continue;
          if (cross(p, q, r, t)) n++;
        }
      }
    }
  return n;
};

test.describe('同じ行の、複数のコメント', () => {
  for (const n of [2, 3, 5, 6]) {
    test(`${n} 件：丸は、その行の中に収まり（折り返さない）・記事の左 40px 以内。${n > 5 ? '「+N」にまとめる。' : '「+N」はない。'}線は、交差しない`, async ({
      page,
      app,
    }) => {
      await openRow(page, app, n);
      const row = await box(page, '#article p:not(h1)'); // 1 行の段落
      const art = await box(page, '#article');
      const scroller = await box(page, '#docscroll');
      const shown = await visibleBadges(page);
      expect(shown.length).toBe(Math.min(n, n > 5 ? 4 : n));
      for (const b of shown) {
        expect(b.top, `${b.text}：行の上`).toBeGreaterThanOrEqual(row.top - 1);
        expect(b.bottom, `${b.text}：行の下`).toBeLessThanOrEqual(row.bottom + 1);
        expect(b.right, `${b.text}：記事の左 40px 以内`).toBeLessThanOrEqual(art.left + 40);
        expect(b.left, `${b.text}：見える範囲の左`).toBeGreaterThanOrEqual(scroller.left);
      }
      expect(new Set(shown.map((b) => Math.round(b.top))).size, '同じ高さ（1 つの行）').toBe(1);
      // 重なっていても、数字は、左から右へ、順に並ぶ
      expect(shown.map((b) => b.text)).toEqual(WORDS.slice(0, shown.length).map((_, i) => String(i + 1)));
      const more = page.locator('#badges .bno-more');
      if (n > 5) {
        await expect(more).toHaveCount(1);
        await expect(more).toHaveText(`+${n - 4}`);
      } else {
        await expect(more).toHaveCount(0);
      }
      // 線は、n 本。交差しない
      const lines = await polylines(page);
      expect(lines).toHaveLength(n);
      expect(crossings(lines), '線の交差').toBe(0);
    });
  }

  test('「+N」：マウスを置くと、まとめた丸が開き、押せる（押すと、そのカードだけを見る）。置いた丸は、手前に出る', async ({
    page,
    app,
  }) => {
    await openRow(page, app, 6);
    const more = page.locator('#badges .bno-more');
    expect((await visibleBadges(page)).length).toBe(4);
    await more.hover();
    // まとめた丸が、行の下のポップオーバーに開く（並べている丸は、そのまま）。ポップオーバーは、本文の見える範囲の中
    await expect
      .poll(async () => (await visibleBadges(page)).map((b) => b.text))
      .toEqual(['1', '2', '3', '4', '5', '6']);
    const scroller = await box(page, '#docscroll');
    const row = await box(page, '#article p:not(h1)');
    for (const b of (await visibleBadges(page)).slice(4)) {
      expect(b.left).toBeGreaterThanOrEqual(scroller.left);
      expect(b.right).toBeLessThanOrEqual(scroller.right);
      expect(b.top, 'ポップオーバーは、行の下').toBeGreaterThan(row.bottom - 4);
    }
    // 開いた丸は、押せる：6 を押す → 6 番だけを見る（マウスを置いたまま）
    await page.locator('#badges .bno', { hasText: /^6$/ }).click();
    await expect(page.locator('.solobar')).toBeVisible();
    await expect(ui(page).threads).toHaveCount(1);
    await expect(ui(page).threads.first()).toContainText('語六');
    await page.getByRole('button', { name: 'すべてのコメントに戻る' }).click();
    // 「+N」を押す：まとめた分の、いちばん小さい番号（5）のカード
    await page.locator('#badges .bno-more').click();
    await expect(ui(page).threads).toHaveCount(1);
    await expect(ui(page).threads.first()).toContainText('語五');
    await page.getByRole('button', { name: 'すべてのコメントに戻る' }).click();
    // 重なった丸は、マウスを置くと、手前（z-index）に出る
    await page.mouse.move(5, 5);
    const z = await page.evaluate(() => {
      const els = [...document.querySelectorAll<HTMLElement>('#badges .bno')].filter(
        (e) => e.getBoundingClientRect().width > 0,
      );
      return els.map((e) => getComputedStyle(e).zIndex);
    });
    expect(z.every((v) => v === 'auto' || v === '0')).toBe(true);
    await page.locator('#badges .bno', { hasText: /^2$/ }).hover();
    expect(await page.locator('#badges .bno', { hasText: /^2$/ }).evaluate((e) => getComputedStyle(e).zIndex)).toBe(
      '3',
    );
  });

  test('カードにマウスを置くと、その丸（まとめた分は「+N」）が光る', async ({ page, app }) => {
    await openRow(page, app, 6);
    await ui(page).threads.nth(5).locator('.th-head').hover(); // 6 番：まとめられている
    await expect(page.locator('#badges .bno-more')).toHaveClass(/linked/);
    await ui(page).threads.nth(1).locator('.th-head').hover();
    await expect(page.locator('#badges .bno-more')).not.toHaveClass(/linked/);
    await expect(page.locator('#badges .bno', { hasText: /^2$/ })).toHaveClass(/linked/);
  });

  test('折り返す長い段落（複数行の中に、複数のコメント）・窓の幅を変えても、丸は、各行の中に収まり、線は、交差しない', async ({
    page,
    app,
  }) => {
    await page.setViewportSize({ width: 1360, height: 2000 });
    const long = WORDS.map((w) => `${w}の文`)
      .join('、')
      .repeat(4);
    await app.switchTopic(page, 'wrap2', '折り返し', `# 折り返し\n\n${long}。\n`);
    const threads = ['語一の文', '語三の文', '語五の文', '語七の文', '語二の文'].map((q) => ({
      page: 'root',
      anchor: { quote: q },
      body: `${q}の確認です。`,
    }));
    await app.apply({ threads }, { topic: 'wrap2' });
    await expect(ui(page).threads).toHaveCount(5);
    for (const w of [1360, 1000, 800]) {
      await page.setViewportSize({ width: w, height: 2000 });
      await page.evaluate(
        () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
      );
      const p = await box(page, '#article p:not(h1)');
      for (const b of await visibleBadges(page)) {
        expect(b.top).toBeGreaterThanOrEqual(p.top - 1);
        expect(b.bottom).toBeLessThanOrEqual(p.bottom + 1);
      }
      expect(crossings(await polylines(page)), `幅 ${w}：線の交差`).toBe(0); // 全部の線の、総当たり
    }
  });
});

// ---- 桁数の多い丸・狭い窓のポップオーバー・全部の線の交差 ----

// 丸の数字（テキスト）の、実際の幅（Range の矩形）
const textBox = (page: Page, sel: string) =>
  page.evaluate((s) => {
    const els = [...document.querySelectorAll<HTMLElement>(s)].filter((e) => e.getBoundingClientRect().width > 0);
    return els.map((e) => {
      const r = document.createRange();
      r.selectNodeContents(e);
      const t = r.getBoundingClientRect();
      const b = e.getBoundingClientRect();
      return {
        text: e.textContent,
        top: Math.round(b.top),
        left: b.left,
        right: b.right,
        tl: t.left,
        tr: t.right,
        w: b.width,
      };
    });
  }, sel);

test.describe('丸の桁数・ポップオーバー・全部の線', () => {
  for (const width of [1700, 1360]) {
    test(`2 桁・3 桁の番号も、重ねても、数字が隠れない。幅は、見積り（18・24・31）と一致し、左端は、本文の左より、はみ出さない（窓 ${width}px）`, async ({
      page,
      app,
    }) => {
      await page.setViewportSize({ width, height: 2000 });
      const many = Array.from({ length: 108 }, (_, i) => `段${i + 1}`);
      const doc = `# 桁数\n\n${many.slice(0, 96).join('\n\n')}\n\n${WORDS.map((w) => `${w}の文`)
        .slice(0, 4)
        .join('、')}。\n`;
      await app.switchTopic(page, 'dig', '桁数', doc);
      const quotes = [...many.slice(0, 96), ...WORDS.slice(0, 4).map((w) => `${w}の文`)];
      await app.apply(
        { threads: quotes.map((q) => ({ page: 'root', anchor: { quote: q }, body: `${q}の確認です。` })) },
        { topic: 'dig' },
      );
      await expect(ui(page).bno).toHaveCount(quotes.length);
      // 末尾の行（97〜100：2 桁・3 桁の丸）へ
      await page.evaluate(() => {
        const sc = document.querySelector('#docscroll') as HTMLElement;
        sc.scrollTop = sc.scrollHeight;
      });
      await page.mouse.move(5, 5);
      await expect.poll(async () => (await visibleBadges(page)).map((b) => b.text)).toContain('96');
      const boxes = [...(await textBox(page, '#badges .bno')), ...(await textBox(page, '#badges .bno-more'))];
      const scroller = await box(page, '#docscroll');
      const wide = boxes.filter((b) => (b.text ?? '').length >= 2);
      expect(wide.length).toBeGreaterThanOrEqual(3);
      // 幅は、文字数で決まり、見積り（layout.ts の badgeWidth）と一致する：実測と、ずれない
      for (const b of boxes) {
        const expected = [18, 24, 31, 38][Math.min(4, (b.text ?? '').length) - 1] as number;
        expect(Math.abs(b.w - expected), `${b.text}：幅 ${b.w}（見積り ${expected}）`).toBeLessThanOrEqual(0.5);
        expect(b.left, `${b.text}：左端は、本文の左より、出ない`).toBeGreaterThanOrEqual(scroller.left - 0.5);
      }
      // 数字は、自分の丸の中に収まり、次の丸（重なっている）に、かからない
      for (const b of boxes) {
        expect(b.tl, `${b.text}：左`).toBeGreaterThanOrEqual(b.left);
        expect(b.tr, `${b.text}：右`).toBeLessThanOrEqual(b.right);
      }
      for (const row of new Set(boxes.map((b) => b.top))) {
        const sorted = boxes.filter((b) => b.top === row).sort((a, b) => a.left - b.left);
        for (let i = 0; i + 1 < sorted.length; i++) {
          const [b, next] = [sorted[i], sorted[i + 1]];
          if (b && next && next.left < b.right)
            expect(b.tr, `${b.text}：次の丸（${next.text}）に、隠れない`).toBeLessThanOrEqual(next.left - 1);
        }
      }
    });
  }

  test('狭い窓（800px）：「+N」にマウスを置くと、ポップオーバーが開く。丸は、本文の見える範囲の中で、押せる', async ({
    page,
    app,
  }) => {
    await page.setViewportSize({ width: 800, height: 2000 });
    await app.switchTopic(page, 'nar', '狭い', `# 狭い\n\n${WORDS.join('')}です。\n`);
    await app.apply(
      { threads: WORDS.map((w) => ({ page: 'root', anchor: { quote: w }, body: `${w}の確認です。` })) },
      { topic: 'nar' },
    );
    await expect(ui(page).bno).toHaveCount(7);
    const more = page.locator('#badges .bno-more');
    await expect(more).toHaveCount(1);
    const scroller = await box(page, '#docscroll');
    // 並べている丸は、見える範囲の左より、はみ出さない
    for (const b of await visibleBadges(page)) expect(b.left, `${b.text}`).toBeGreaterThanOrEqual(scroller.left - 0.5);
    const before = (await visibleBadges(page)).length;
    await more.hover();
    await expect.poll(async () => (await visibleBadges(page)).length).toBe(7);
    for (const b of await visibleBadges(page)) {
      expect(b.left, `${b.text}：左`).toBeGreaterThanOrEqual(scroller.left);
      expect(b.right, `${b.text}：右`).toBeLessThanOrEqual(scroller.right);
    }
    expect((await visibleBadges(page)).length).toBeGreaterThan(before);
    // マウスを、「+N」から、ポップオーバーの丸へ移しても、閉じない。押すと、そのカードだけを見る
    const last = page.locator('#badges .bno-pop .bno').last();
    await last.click();
    await expect(page.locator('.solobar')).toBeVisible();
    await expect(ui(page).threads).toHaveCount(1);
  });

  // 同じ行に 3 件・2 件、別の行に 1 件・長く折り返す段落に 6 件：全部の線の、総当たり
  async function openMix(page: Page, app: RikaiApp, width: number, panelW?: number) {
    await page.setViewportSize({ width, height: 2000 });
    const long = Array.from({ length: 3 }, () => WORDS.map((w) => `${w}の文`).join('、')).join('、');
    const doc = `# 混在\n\n${WORDS.slice(0, 3)
      .map((w) => `${w}の文`)
      .join('、')}。\n\n単独の文です。\n\n${WORDS.slice(3, 5)
      .map((w) => `${w}の文`)
      .join('、')}。\n\n${long}。\n`;
    await app.switchTopic(page, 'mix', '混在', doc);
    if (panelW) {
      await page.evaluate(
        (w) => localStorage.setItem('rikai-ui', JSON.stringify({ sideOpen: true, panelW: w, links: true })),
        panelW,
      );
      await page.reload();
      await ui(page).article.locator('.blk').first().waitFor();
    }
    const quotes = [
      ...WORDS.slice(0, 3).map((w) => `${w}の文`),
      '単独の文です',
      ...WORDS.slice(3, 5).map((w) => `${w}の文`),
    ];
    // 長い段落：同じ語が 3 回出る。最初の出現に付く
    quotes.push('語一の文、語二の文', '語四の文、語五の文、語六の文', '語七の文');
    await app.apply(
      { threads: quotes.map((q) => ({ page: 'root', anchor: { quote: q }, body: `${q}の確認です。` })) },
      { topic: 'mix' },
    );
    await expect(ui(page).threads).toHaveCount(quotes.length);
    await page.mouse.move(5, 5);
    await settledLinks(page);
  }

  for (const [width, panelW] of [
    [1700, undefined],
    [1700, 300],
    [1700, 560],
  ] as const) {
    test(`全部の線が、交差しない：同じ行も、隣の行も（窓 ${width}px・パネル ${panelW ?? '既定'}px）。本文をスクロールしても`, async ({
      page,
      app,
    }) => {
      await openMix(page, app, width, panelW);
      const n = (await polylines(page)).length;
      expect(n).toBeGreaterThanOrEqual(4);
      expect(crossings(await polylines(page)), '線の交差').toBe(0);
      // 本文を、少しずつスクロール：見える線だけを引く。どの位置でも、交差しない
      for (const top of [60, 140, 260]) {
        await page.evaluate((t) => {
          (document.querySelector('#docscroll') as HTMLElement).scrollTop = t;
        }, top);
        await page.evaluate(
          () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
        );
        expect(crossings(await polylines(page)), `スクロール ${top}：線の交差`).toBe(0);
      }
    });
  }
});

// ---- ポップオーバー（隣接・下端）・引き出し線（文字を貫かない・薄い点線） ----

// 「+N」から、ポップオーバーの丸まで、12 段階で、マウスを動かす：どの段階でも、開いたまま（まず、ポップオーバーへ下り〔3 段階〕、そこから、丸へ〔9 段階〕）
async function walkToPopover(page: Page) {
  const more = page.locator('#badges .bno-more').first();
  await more.hover();
  const target = page.locator('#badges .bbadge:hover .bno-pop .bno').last();
  await expect(target).toBeVisible();
  const [a, b, pop] = await Promise.all([
    more.boundingBox(),
    target.boundingBox(),
    page.locator('#badges .bbadge:hover .bno-pop').boundingBox(),
  ]);
  const mid = (r: { x: number; y: number; width: number; height: number } | null) => ({
    x: (r as { x: number; width: number }).x + (r as { width: number }).width / 2,
    y: (r as { y: number; height: number }).y + (r as { height: number }).height / 2,
  });
  const [from, to] = [mid(a), mid(b)];
  const p = pop as { y: number; height: number };
  // ポップオーバーの、いちばん近い縁の内側（行の下なら上辺の 4px 下・行の上なら下辺の 4px 上）
  const edgeY = to.y > from.y ? p.y + 4 : p.y + p.height - 4;
  const path = [
    ...[1, 2, 3].map((i) => ({ x: from.x, y: from.y + ((edgeY - from.y) * i) / 3 })),
    ...Array.from({ length: 9 }, (_, i) => ({
      x: from.x + ((to.x - from.x) * (i + 1)) / 9,
      y: edgeY + ((to.y - edgeY) * (i + 1)) / 9,
    })),
  ];
  for (const [i, pt] of path.entries()) {
    await page.mouse.move(pt.x, pt.y);
    await expect(page.locator('#badges .bbadge:hover .bno-pop'), `段階 ${i + 1}`).toBeVisible();
  }
  return target;
}

test.describe('ポップオーバーと引き出し線', () => {
  for (const width of [1920, 1360, 800]) {
    test(`「+N」から、ポップオーバーの丸へ、マウスを動かしても、閉じない。押せる（窓 ${width}px）`, async ({
      page,
      app,
    }) => {
      await page.setViewportSize({ width, height: 1000 });
      await app.switchTopic(page, 'pop', 'ポップ', `# ポップ\n\n${WORDS.join('')}です。\n`);
      await app.apply(
        { threads: WORDS.map((w) => ({ page: 'root', anchor: { quote: w }, body: `${w}の確認です。` })) },
        { topic: 'pop' },
      );
      await expect(ui(page).bno).toHaveCount(7);
      await expect(page.locator('#badges .bno-more')).toHaveCount(1);
      const target = await walkToPopover(page);
      // ポップオーバーは、「+N」の右端にそろい（隣接）、本文の見える範囲の中
      const [pop, more, sc] = await Promise.all([
        box(page, '#badges .bno-pop'),
        box(page, '#badges .bno-more'),
        box(page, '#docscroll'),
      ]);
      expect(pop.left).toBeGreaterThanOrEqual(sc.left + 3);
      expect(pop.right).toBeGreaterThanOrEqual(more.right - 1);
      expect(pop.top - more.bottom, '「+N」の下に、すきまなし').toBeLessThanOrEqual(2);
      await target.click();
      await expect(page.locator('.solobar')).toBeVisible();
      await expect(ui(page).threads).toHaveCount(1);
    });
  }

  test('窓 600px：丸が「+N」だけでも、ポップオーバーへ移れて、押せる', async ({ page, app }) => {
    await page.setViewportSize({ width: 600, height: 1000 });
    const chars = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
    await app.switchTopic(page, 'p6', '狭い', `# 狭い\n\n${chars.join('')}です。\n`);
    await app.apply(
      { threads: chars.map((c) => ({ page: 'root', anchor: { quote: c }, body: `${c}の確認です。` })) },
      { topic: 'p6' },
    );
    await expect(ui(page).bno).toHaveCount(chars.length);
    const more = page.locator('#badges .bno-more');
    expect(await more.count()).toBeGreaterThanOrEqual(1);
    const sc = await box(page, '#docscroll');
    const target = await walkToPopover(page);
    const pop = await box(page, '#badges .bbadge:hover .bno-pop');
    expect(pop.left).toBeGreaterThanOrEqual(sc.left + 3);
    expect(pop.right).toBeLessThanOrEqual(sc.right + 1);
    await target.click();
    await expect(page.locator('.solobar')).toBeVisible();
  });

  test('本文の下端の行（下端から 30px）：ポップオーバーは、行の上に開く。見える範囲の中で、押せる', async ({
    page,
    app,
  }) => {
    await page.setViewportSize({ width: 1360, height: 900 });
    const filler = Array.from({ length: 30 }, (_, i) => `余白の段落 ${i + 1} です。`).join('\n\n');
    const row = WORDS.map((w) => `${w}の文`).join('、');
    await app.switchTopic(page, 'bot', '下端', `# 下端\n\n${filler}\n\n${row}。\n\n${filler}\n`);
    await app.apply(
      { threads: WORDS.map((w) => ({ page: 'root', anchor: { quote: `${w}の文` }, body: `${w}の確認です。` })) },
      { topic: 'bot' },
    );
    await expect(ui(page).bno).toHaveCount(7);
    // 行が、本文の下端から 30px のところに来るまで、スクロール
    await page.evaluate(() => {
      const sc = document.querySelector('#docscroll') as HTMLElement;
      const bd = document.querySelector('#badges .bbadge') as HTMLElement;
      const delta = bd.getBoundingClientRect().bottom - (sc.getBoundingClientRect().bottom - 30);
      sc.scrollTop += delta;
    });
    await page.mouse.move(5, 5);
    await expect(page.locator('#badges .bno-more')).toHaveCount(1);
    const sc = await box(page, '#docscroll');
    const more = await box(page, '#badges .bno-more');
    expect(sc.bottom - more.bottom).toBeLessThan(40);
    await page.locator('#badges .bno-more').hover();
    const pop = page.locator('#badges .bno-pop').first();
    await expect(pop).toBeVisible();
    await expect(pop).toHaveClass(/up/);
    const pb = await box(page, '#badges .bno-pop');
    expect(pb.bottom).toBeLessThanOrEqual(sc.bottom);
    expect(pb.top).toBeGreaterThanOrEqual(sc.top);
    expect(more.top - pb.bottom, '行の上に、隣接').toBeLessThanOrEqual(2);
    // 押せる（上へ動かして）
    const target = await walkToPopover(page);
    await target.click();
    await expect(page.locator('.solobar')).toBeVisible();
  });

  test('引き出し線は、文字を貫かない：コード（pre）・表のセル・箇条書き・見出し・段落で、行間を通る。次の行にも、かからない', async ({
    page,
    app,
  }) => {
    await page.setViewportSize({ width: 1500, height: 1400 });
    const doc = [
      '# 引き出し',
      '段落の語甲と、続きの文字がずっと続きます。',
      '## 見出しの語乙',
      '- 箇条の語丙と続きの文字\n- 次の箇条の文字',
      '| 項目 | 内容 |\n| --- | --- |\n| 行 | 表の語戊と続きの値 |',
      '```\nconst a = 1; // 語丁の行 と続き\nconst b = 2; // 次の行\n```',
    ].join('\n\n');
    await app.switchTopic(page, 'lead', '引き出し', doc);
    const quotes = ['語甲', '語乙', '語丙', '語戊', '語丁'];
    await app.apply(
      { threads: quotes.map((q) => ({ page: 'root', anchor: { quote: q }, body: `${q}の確認です。` })) },
      { topic: 'lead' },
    );
    await expect(ui(page).threads).toHaveCount(quotes.length);
    await settledLinks(page);
    const r = await page.evaluate((qs) => {
      const out: { q: string; y: number; blockTop: number; textBottom: number; nextTop: number | null }[] = [];
      for (const q of qs) {
        const mark = [...document.querySelectorAll<HTMLElement>('#article mark.hl')].find((m) =>
          (m.textContent ?? '').includes(q),
        ) as HTMLElement;
        const tid = mark.dataset.tid as string;
        const d = document.querySelector(`#links path[data-tid="${tid}"]`)?.getAttribute('d') ?? '';
        const y = Number((d.match(/([\d.-]+)H/) ?? [])[1]);
        const mr = [...mark.getClientRects()].at(-1) as DOMRect;
        const blk = mark.closest('p, h2, li, td, pre') as HTMLElement;
        const w = document.createTreeWalker(blk, NodeFilter.SHOW_TEXT);
        let textBottom = -1e9;
        let nextTop: number | null = null;
        for (let n = w.nextNode(); n; n = w.nextNode()) {
          const rg = document.createRange();
          rg.selectNodeContents(n);
          for (const rc of rg.getClientRects()) {
            if (rc.height === 0) continue;
            if (rc.bottom > mr.top && rc.top < mr.bottom)
              textBottom = Math.max(textBottom, rc.bottom); // 同じ行
            else if (rc.top >= mr.bottom - 1) nextTop = nextTop === null ? rc.top : Math.min(nextTop, rc.top); // 次の行
          }
        }
        out.push({ q, y, blockTop: blk.getBoundingClientRect().top, textBottom, nextTop });
      }
      return out;
    }, quotes);
    for (const t of r) {
      expect(Number.isFinite(t.y), `${t.q}：引き出し線がある`).toBe(true);
      expect(t.y, `${t.q}：同じ行の文字の下（${t.textBottom}）を通る`).toBeGreaterThanOrEqual(t.textBottom - 0.01);
      if (t.nextTop !== null)
        expect(t.y, `${t.q}：次の行（${t.nextTop}）にかからない`).toBeLessThanOrEqual(t.nextTop + 0.01);
    }
  });

  test('引き出しの部分は、薄い点線（S 字の部分は、これまでどおり）。ホバー中は、実線・100%。1 件だけの行は、強調の右端の中央から出る', async ({
    page,
    app,
  }) => {
    await page.setViewportSize({ width: 1500, height: 1000 });
    await app.switchTopic(page, 'one', '一件', `# 一件\n\n一行目の語甲と続きの文字です。\n`);
    await app.apply({ threads: [{ page: 'root', anchor: { quote: '語甲' }, body: '確認です。' }] }, { topic: 'one' });
    await expect(ui(page).threads).toHaveCount(1);
    await settledLinks(page);
    const style = (sel: string) =>
      page
        .locator(sel)
        .first()
        .evaluate((e) => {
          const s = getComputedStyle(e);
          return { dash: s.strokeDasharray, op: parseFloat(s.strokeOpacity), w: parseFloat(s.strokeWidth) };
        });
    const lead = await style('#links .cn-lead');
    const main = await style('#links path.cn');
    expect(lead.dash).not.toBe('none');
    expect(lead.op).toBeLessThan(main.op * 0.7); // 約半分
    expect(main.dash).toBe('none');
    // 点は、強調の右端の中央（これまでと同じ）
    const dot = await page.evaluate(() => {
      const c = document.querySelector('#links circle.cn-dot') as SVGCircleElement;
      const m = document.querySelector('#article mark.hl') as HTMLElement;
      const r = [...m.getClientRects()].at(-1) as DOMRect;
      return { dx: c.cx.baseVal.value - r.right, dy: c.cy.baseVal.value - (r.top + r.height / 2) };
    });
    expect(Math.abs(dot.dx)).toBeLessThanOrEqual(1);
    expect(Math.abs(dot.dy)).toBeLessThanOrEqual(1);
    // ホバー中：引き出しも、実線・100%
    await ui(page).threads.first().locator('.th-head').hover();
    await expect(page.locator('#links .cn-g.linked')).toHaveCount(1);
    await expect.poll(async () => (await style('#links .cn-lead')).op).toBeGreaterThan(0.95); // 短い遷移のあと
    expect((await style('#links .cn-lead')).dash).toBe('none');
  });
});
