// 関連の線（F35）：右のカードと、本文の対象を結ぶ線（`<svg id="links">`）。本数・端点の位置・スクロールへの追従・見える範囲の縁への寄せ・ホバー／選びの強調・
// 押せない（下の文字を選べる）・解決済みタブ／1 枚だけ見るで、本数が変わる・オン／オフ（localStorage `rikai-ui`・DocBar のトグル）。
import type { Page } from '@playwright/test';
import { expect, type RikaiApp, test } from './fixtures';
import { dragSelect, hoverBlock, ui } from './ui';

const paras = Array.from({ length: 30 }, (_, i) => `第${i + 1}段落の文章です。そのあとに、続きの文字があります。`);
const DOC_LONG = `# 長い資料\n\n${paras.join('\n\n')}\n`;

// AI 起点のスレッドを、本文の n 段落（1 始まり）に付ける
const onPara = (n: number) => ({
  page: 'root',
  anchor: { quote: `第${n}段落の文章です` },
  body: `第${n}段落への確認です。`,
});

async function openLong(page: Page, app: RikaiApp, threadParas: number[], doc = DOC_LONG) {
  await app.switchTopic(page, 'long', '長い資料', doc);
  await app.apply({ threads: threadParas.map(onPara) }, { topic: 'long' });
  await expect(ui(page).threads).toHaveCount(threadParas.length);
  await expect(ui(page).bno).toHaveCount(threadParas.length);
  await expect(page.locator('#links path[data-tid]')).not.toHaveCount(0);
}

const paths = (page: Page) => page.locator('#links path[data-tid]');
// 描き直しの落ち着きを待つ（rAF 2 回）
const frames = (page: Page) =>
  page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));

interface Ends {
  tid: string;
  cls: string;
  start: { x: number; y: number };
  end: { x: number; y: number };
  /** 本文側の、実際の強調の、最後の行の右端の中央（文のスレッド） */
  mark: { x: number; y: number } | null;
  /** カードの、番号の丸の中央の高さ・カードの左端 */
  card: { x: number; y: number } | null;
}

// 線の端点と、本文・カードの実測を、画面の座標で
const ends = (page: Page): Promise<Ends[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll<SVGPathElement>('#links path[data-tid]')].map((p) => {
      const tid = p.dataset.tid as string;
      const m = (p.getAttribute('d') ?? '').match(/^M(\S+) (\S+)C\S+ \S+ \S+ \S+ (\S+) (\S+)$/) as RegExpMatchArray;
      const marks = [...document.querySelectorAll<HTMLElement>('#article mark.hl[data-tid]')].filter(
        (e) => e.dataset.tid === tid,
      );
      const last = marks.at(-1)?.getClientRects();
      const lr = last?.[last.length - 1];
      const card = [...document.querySelectorAll<HTMLElement>('#threads .thread[data-tid]')].find(
        (e) => e.dataset.tid === tid,
      );
      const no = card?.querySelector('.no')?.getBoundingClientRect();
      const cr = card?.getBoundingClientRect();
      return {
        tid,
        cls: p.parentElement?.getAttribute('class') ?? '',
        start: { x: Number(m[1]), y: Number(m[2]) },
        end: { x: Number(m[3]), y: Number(m[4]) },
        mark: lr ? { x: lr.right, y: lr.top + lr.height / 2 } : null,
        card: no && cr ? { x: cr.left, y: no.top + no.height / 2 } : null,
      };
    }),
  );

const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(1);

test.describe('関連の線（F35）', () => {
  test('コメント 3 件：線が 3 本。本文側は、強調の最後の行の右端の中央、カード側は、番号の丸の高さの、カードの左端。押せない・aria-hidden', async ({
    page,
    app,
  }) => {
    await openLong(page, app, [3, 4, 5]);
    await expect(paths(page)).toHaveCount(3);
    const svg = page.locator('svg#links');
    await expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(await svg.evaluate((e) => getComputedStyle(e).pointerEvents)).toBe('none');
    expect(await svg.evaluate((e) => getComputedStyle(e).position)).toBe('fixed');
    // 本文（#article）には、何も足さない
    expect(await page.locator('#article #links, #article svg#links').count()).toBe(0);
    // 本文側の丸（r=3）・カード側の棒
    await expect(page.locator('#links circle.cn-dot')).toHaveCount(3);
    await expect(page.locator('#links circle.cn-dot').first()).toHaveAttribute('r', '3');
    await expect(page.locator('#links line.cn-bar')).toHaveCount(3);

    for (const e of await ends(page)) {
      expect(e.mark, e.tid).not.toBeNull();
      expect(e.card, e.tid).not.toBeNull();
      near(e.start.x, (e.mark as { x: number }).x);
      near(e.start.y, (e.mark as { y: number }).y);
      near(e.end.x, (e.card as { x: number }).x);
      near(e.end.y, (e.card as { y: number }).y);
    }
    // 上から下へ単調（カードの並びは、本文の順）
    const es = await ends(page);
    expect(es.map((e) => e.start.y)).toEqual([...es.map((e) => e.start.y)].sort((a, b) => a - b));
    expect(es.map((e) => e.end.y)).toEqual([...es.map((e) => e.end.y)].sort((a, b) => a - b));
  });

  test('既定は、静か：1px・アクセントの薄い色。コメントのない資料では、線がない', async ({ page, app }) => {
    await app.switchTopic(page, 'empty', '空の資料', DOC_LONG);
    await expect(page.locator('#links path[data-tid]')).toHaveCount(0);
    await openLong(page, app, [3]);
    const style = await paths(page)
      .first()
      .evaluate((p) => {
        const s = getComputedStyle(p);
        return { w: parseFloat(s.strokeWidth), o: parseFloat(s.strokeOpacity), fill: s.fill };
      });
    expect(style.w).toBe(1);
    expect(style.o).toBeGreaterThan(0.25);
    expect(style.o).toBeLessThan(0.45);
    expect(style.fill).toBe('none');
  });

  test('本文をスクロールすると、本文側の端点が追従する。本文の外へ出た端点は、縁に寄せる（edge）。両方が同じ側の外なら、引かない', async ({
    page,
    app,
  }) => {
    await openLong(page, app, [3, 15, 28]);
    const u = ui(page);
    await u.docscroll.evaluate((e) => {
      e.scrollTop = 0;
    });
    await frames(page);
    const before = await ends(page);
    expect(before).toHaveLength(2); // 第 3・15 段落（第 28 段落は、本文の下の外：選んでいないので、引かない）

    await u.docscroll.evaluate((e) => {
      e.scrollTop += 120;
    });
    await frames(page);
    const after = await ends(page);
    // 追従：第 3 段落の端点は、120px 上がり、実測と、そろう
    const t3b = [...before].sort((a, b) => a.start.y - b.start.y)[0] as Ends;
    expect(t3b).toBeTruthy();
    const t3a = after.find((e) => e.tid === t3b.tid) as Ends;
    near(t3a.start.y, t3b.start.y - 120);
    near(t3a.start.y, (t3a.mark as { y: number }).y);
    near(t3a.end.y, (t3a.card as { y: number }).y); // カードは、動かない

    // 第 28 段落までスクロール：第 3 段落は、本文の上の外。選んでいない線は、引かない（縁へ寄せた線が、束にならない）
    await u.docscroll.evaluate((e) => {
      e.scrollTop = e.scrollHeight;
    });
    await frames(page);
    const docBox = await u.docscroll.evaluate((e) => e.getBoundingClientRect().toJSON());
    expect(
      (await ends(page)).find((e) => e.tid === t3b.tid),
      '本文の上の外の線は、選んでいなければ、引かない',
    ).toBeUndefined();
    // カードに、マウスを置く（linked）：縁の内側に、短く止めて、引く。edge・丸なし
    await u.panel.locator(`.thread[data-tid="${t3b.tid}"] .th-head`).hover();
    await expect(page.locator(`#links g[data-tid="${t3b.tid}"]`)).toHaveClass(/linked/);
    const clamped = (await ends(page)).find((e) => e.tid === t3b.tid) as Ends;
    near(clamped.start.y, docBox.top + 8);
    near(clamped.start.x, docBox.right - 10);
    expect(clamped.cls).toContain('edge');
    await expect(page.locator(`#links g[data-tid="${t3b.tid}"] circle.cn-dot`)).toHaveCount(0);
  });

  test('右のパネルをスクロールすると、カード側の端点が追従する。パネルの見える範囲の外は、引かない（選んでいる線は、縁の内側に止める）', async ({
    page,
    app,
  }) => {
    await openLong(page, app, [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24]);
    const panel = ui(page).panel;
    const scrollable = await panel.evaluate((e) => e.scrollHeight - e.clientHeight);
    expect(scrollable).toBeGreaterThan(200);
    await panel.evaluate((e) => {
      e.scrollTop = 250;
    });
    await frames(page);
    const es = await ends(page);
    const panelBox = await panel.evaluate((e) => {
      const head = e.querySelector('.panel-top')?.getBoundingClientRect();
      const r = e.getBoundingClientRect();
      return { top: Math.max(r.top, head?.bottom ?? 0), bottom: r.bottom };
    });
    let inside = 0;
    for (const e of es) {
      const c = e.card as { y: number };
      // 引くのは、見えているカードだけ（見える範囲の外のカードへ、選んでいない線を、引かない）
      expect(
        c.y >= panelBox.top && c.y <= panelBox.bottom,
        `${e.tid}：パネルの見える範囲の外のカードに、線がある`,
      ).toBe(true);
      near(e.end.y, c.y); // 見えているカード：番号の丸の高さ
      inside++;
    }
    expect(inside).toBeGreaterThan(2);
    // 上に隠れたカードには、線がない
    const hiddenTid = await panel.evaluate((p) => {
      const top = (p.querySelector('.panel-top')?.getBoundingClientRect().bottom ?? 0) + 10;
      const c = [...p.querySelectorAll<HTMLElement>('.thread[data-tid]')].find(
        (e) => e.getBoundingClientRect().bottom < top,
      );
      return c?.dataset.tid ?? null;
    });
    expect(hiddenTid, '上に隠れたカードがある').not.toBeNull();
    expect(es.some((e) => e.tid === hiddenTid)).toBe(false);
    // （本文の強調にマウスを置くと、そのカードは、見える所まで動く。縁の内側に止める線は、単体と jsdom で確かめる）
    // パネルの下端まで：見えているカードは、また、追従する
    await panel.evaluate((e) => {
      e.scrollTop = e.scrollHeight;
    });
    await frames(page);
    for (const e of await ends(page)) {
      const c = e.card as { y: number };
      if (c.y >= panelBox.top && c.y <= panelBox.bottom) near(e.end.y, c.y);
    }
  });

  test('線は、本文・パネル・そのすきまの中だけ：左の一覧・上のバーにはみ出さない（clipPath）', async ({
    page,
    app,
  }) => {
    await openLong(page, app, [3, 15]);
    const r = await page.evaluate(() => {
      const c = document.querySelector('#links clipPath rect') as SVGRectElement;
      const box = (s: string) => (document.querySelector(s) as HTMLElement).getBoundingClientRect();
      return {
        x: c.x.baseVal.value,
        y: c.y.baseVal.value,
        w: c.width.baseVal.value,
        h: c.height.baseVal.value,
        doc: box('#docscroll').toJSON(),
        panel: box('#threads').toJSON(),
        top: box('#top').toJSON(),
        side: box('#side').toJSON(),
      };
    });
    near(r.x, r.doc.left);
    near(r.x + r.w, r.panel.right);
    expect(r.y).toBeGreaterThanOrEqual(r.top.bottom - 1); // 上のバーの下
    expect(r.x).toBeGreaterThanOrEqual(r.side.right - 1); // 左の一覧の右
  });

  test('カードにマウスを置くと、その線が強調される（linked：1.5px・不透明）。離すと戻る。番号を押すと、選んだ（active）線が強調される', async ({
    page,
    app,
  }) => {
    await openLong(page, app, [3, 4, 5]);
    const u = ui(page);
    const stroke = (tid: string) =>
      page.locator(`#links path[data-tid="${tid}"]`).evaluate((p) => {
        const s = getComputedStyle(p);
        return { w: parseFloat(s.strokeWidth), o: parseFloat(s.strokeOpacity) };
      });
    const tids = (await ends(page)).map((e) => e.tid);
    const [a, b] = tids as [string, string, string];
    const quiet = await stroke(a);
    await u.threads.nth(0).locator('.th-head').hover();
    await expect(page.locator(`#links g[data-tid="${a}"]`)).toHaveClass(/linked/);
    await expect(page.locator(`#links g[data-tid="${b}"]`)).not.toHaveClass(/linked/);
    await expect.poll(async () => (await stroke(a)).w).toBeCloseTo(1.5, 1);
    expect((await stroke(a)).o).toBeGreaterThan(0.95);
    expect(quiet.o).toBeLessThan(0.5);
    // ほかの線は、少し薄い
    expect((await stroke(b)).o).toBeLessThanOrEqual(quiet.o);
    await expect(page.locator('svg#links')).toHaveClass(/focus/);
    // 強調する線は、手前（あとに描く）
    await expect(paths(page).last()).toHaveAttribute('data-tid', a);

    await page.mouse.move(5, 5); // パネルの外へ
    await expect(page.locator('#links .linked')).toHaveCount(0);
    await expect.poll(async () => (await stroke(a)).w).toBe(1); // 戻る（短い遷移）

    // 本文の強調（文字）にマウスを置いても、同じ
    await page.locator('#article mark.hl').nth(1).hover();
    await expect(page.locator(`#links g[data-tid="${b}"]`)).toHaveClass(/linked/);
    await page.mouse.move(5, 5);

    // 番号を押す：その 1 枚だけ（solo）になり、その線が active。もう一度、一覧へ戻す
    await u.bno.nth(0).click();
    await expect(paths(page)).toHaveCount(1);
    await expect(page.locator(`#links g[data-tid="${a}"]`)).toHaveClass(/active/);
    await page.getByRole('button', { name: 'すべてのコメントに戻る' }).click();
    await expect(paths(page)).toHaveCount(3);
    await expect(page.locator(`#links g[data-tid="${a}"]`)).toHaveClass(/active/);
  });

  test('入力中の対象：入力欄にも、破線（pending）の線。やめると消える', async ({ page, app }) => {
    await openLong(page, app, [3]);
    const u = ui(page);
    await dragSelect(page, '第10段落の文章です');
    await u.actComment.click();
    await expect(u.composer).toBeVisible();
    const pending = page.locator('#links g.pending path');
    await expect(pending).toHaveCount(1);
    expect(await pending.evaluate((p) => getComputedStyle(p).strokeDasharray)).not.toBe('none');
    await expect(paths(page)).toHaveCount(2);
    await u.composer.getByRole('button', { name: 'やめる' }).click();
    await expect(paths(page)).toHaveCount(1);
  });

  test('線の上の文字を、選べる（pointer-events: none）：線が通る行の文字を、ドラッグで選ぶ。線の上の点は、本文の要素に当たる', async ({
    page,
    app,
  }) => {
    await openLong(page, app, [3]);
    const e = (await ends(page))[0] as Ends;
    // 線の出だし（強調の右端のすぐ右）：その点に当たる要素は、本文（svg ではない）
    const hit = await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x + 8, y);
      return { inLinks: !!el?.closest('#links'), inArticle: !!el?.closest('#article') };
    }, e.start);
    expect(hit).toEqual({ inLinks: false, inArticle: true });
    // 線が通る、同じ行の文字（強調のあとの文）を選ぶ
    await dragSelect(page, 'そのあとに、続きの文字があります');
    await expect(ui(page).actbar).toBeVisible();
    expect(await page.evaluate(() => window.getSelection()?.toString())).toContain('そのあとに、続きの文字があります');
    // 線の上の本文のブロックに、マウスを置くと、入口のバーが出る（下に届く）
    await page.mouse.click(5, 5);
    await hoverBlock(page, page.locator('#article p').nth(1));
    await expect(ui(page).actbar).toBeVisible();
  });

  test('解決済み：進行中のタブでは、引かない（カードがない）。解決済みのタブでは、1 行（.donerow）には引かない。開いたカードには、灰色の線。1 枚だけ見るで、1 本', async ({
    page,
    app,
  }) => {
    await openLong(page, app, [3, 4, 5]);
    const u = ui(page);
    const tab = (n: string) => page.locator('.tab', { hasText: n });
    await u.threads.nth(0).getByRole('button', { name: '理解できた（解決）' }).click();
    await expect(tab('解決済み')).toHaveText('解決済み1');
    await expect(paths(page)).toHaveCount(2); // 進行中のタブ：解決済みは、カードがない

    await tab('解決済み').click();
    await expect(page.locator('.donerow')).toHaveCount(1);
    await expect(paths(page)).toHaveCount(0); // 1 行にたたまれたものには、引かない

    await page.locator('.donerow').click(); // 開く：カードが出る
    await expect(page.locator('#links g.resolved path')).toHaveCount(1);
    await tab('すべて').click();
    await expect(paths(page)).toHaveCount(3); // 進行中 2 ＋ 開いている解決済み 1
    // 開いた直後は、そのカードが active（アクセントで強調）：別のカードを選ぶと、解決済みは、灰色（--muted）に戻る
    await u.threads.first().locator('.th-head').click();
    await expect(page.locator('#links g.resolved')).not.toHaveClass(/active/);
    const muted = await page.evaluate(() => {
      const probe = document.createElement('span');
      probe.style.color = 'var(--muted)';
      document.body.append(probe);
      const c = getComputedStyle(probe).color;
      probe.remove();
      return c;
    });
    expect(await page.locator('#links g.resolved path').evaluate((p) => getComputedStyle(p).stroke)).toBe(muted);
    await page.locator('.rowopen button.link', { hasText: '一覧の 1 行に戻す' }).click();
    await expect(paths(page)).toHaveCount(2);

    await u.bno.nth(1).click(); // 1 枚だけ
    await expect(paths(page)).toHaveCount(1);
  });

  test('オン・オフ：localStorage の rikai-ui（links: false）で、線は出ない（svg もない）。再読み込みしても、そのまま', async ({
    page,
    app,
  }) => {
    await openLong(page, app, [3, 4]);
    await expect(paths(page)).toHaveCount(2);
    await page.evaluate(() => {
      const v = JSON.parse(localStorage.getItem('rikai-ui') ?? '{}');
      localStorage.setItem('rikai-ui', JSON.stringify({ ...v, links: false }));
    });
    await page.reload();
    await ui(page).article.locator('.blk').first().waitFor();
    await expect(ui(page).threads).toHaveCount(2);
    await expect(page.locator('svg#links')).toHaveCount(0);
    await page.evaluate(() => {
      const v = JSON.parse(localStorage.getItem('rikai-ui') ?? '{}');
      localStorage.setItem('rikai-ui', JSON.stringify({ ...v, links: true }));
    });
    await page.reload();
    await expect(paths(page)).toHaveCount(2);
  });

  test('トグル：右のパネルの見出し（「コメント」の右端）の「関連の線を出す」ボタンで、消える・出る。再読み込みしても残る', async ({
    page,
    app,
  }) => {
    await openLong(page, app, [3, 4]);
    const toggle = page.getByRole('button', { name: '関連の線を出す' });
    await expect(ui(page).panel.locator('.panel-top').getByRole('button', { name: '関連の線を出す' })).toHaveCount(1);
    await expect(ui(page).docbar.getByRole('button', { name: '関連の線を出す' })).toHaveCount(0);
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await toggle.click();
    await expect(page.locator('svg#links')).toHaveCount(0);
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await page.reload();
    await ui(page).article.locator('.blk').first().waitFor();
    await expect(page.locator('svg#links')).toHaveCount(0);
    await toggle.click();
    await expect(paths(page)).toHaveCount(2);
    const links = await page.evaluate(() => JSON.parse(localStorage.getItem('rikai-ui') ?? '{}').links);
    expect(links).toBe(true);
  });

  test('コメントが多い資料（36 件）で、本文だけをスクロール：見えている本文と見えているカードを結ぶ線がないとき、縁へ寄せた線を、束にして引かない。光らせた線だけ、縁の内側に短く止める', async ({
    page,
    app,
  }) => {
    const many = Array.from({ length: 40 }, (_, i) => `第${i + 1}段落の文章です。そのあとに、続きの文字があります。`);
    await openLong(
      page,
      app,
      Array.from({ length: 36 }, (_, i) => i + 1),
      `# 長い資料\n\n${many.join('\n\n')}\n`,
    );
    const u = ui(page);
    // 本文を、第 20 段落のあたりへ。パネルは、先頭（第 1〜 数番目のカードが見える）
    await u.docscroll.evaluate((e) => {
      e.scrollTop = e.scrollHeight * 0.5;
    });
    await frames(page);
    const es = await ends(page);
    // 引くのは、両端が見える範囲の中の線だけ：縁へ寄せた線（edge）は、1 本もない
    expect(
      es.filter((e) => e.cls.includes('edge')),
      '縁へ寄せた線',
    ).toHaveLength(0);
    const docBox = await u.docscroll.evaluate((e) => e.getBoundingClientRect().toJSON());
    for (const e of es) {
      expect(e.start.y).toBeGreaterThanOrEqual(docBox.top - 1);
      expect(e.start.y).toBeLessThanOrEqual(docBox.bottom + 1);
    }
    // 先頭のカードに、マウスを置く：その線だけが、縁の内側に、短く止まって、引かれる（本文の上端に沿って、走らない）
    await u.threads.first().locator('.th-head').hover();
    const tid = await u.threads.first().getAttribute('data-tid');
    const one = (await ends(page)).filter((e) => e.cls.includes('edge'));
    expect(one.map((e) => e.tid)).toEqual([tid]);
    near((one[0] as Ends).start.y, docBox.top + 8);
    near((one[0] as Ends).start.x, docBox.right - 10);
    expect(docBox.right - (one[0] as Ends).start.x).toBeLessThanOrEqual(24); // 本文の右端の近く：本文の上を、横切らない
  });

  test('横スクロールする箱（pre）の中の強調：箱の外へ隠れたら、線を引かない。pre.scrollLeft を動かすと、始点が追従する', async ({
    page,
    app,
  }) => {
    const wide = `${'x'.repeat(260)}ENDPOINT${'y'.repeat(20)}`;
    await app.switchTopic(
      page,
      'wide',
      '横長の資料',
      `# 横長の資料\n\n導入の段落です。\n\n\`\`\`\n${wide}\n\`\`\`\n\n終わりの段落です。\n`,
    );
    await app.apply(
      { threads: [{ page: 'root', anchor: { quote: 'ENDPOINT' }, body: '確認です。' }] },
      { topic: 'wide' },
    );
    await expect(ui(page).threads).toHaveCount(1);
    const pre = page.locator('#article pre');
    const scrollable = await pre.evaluate((e) => e.scrollWidth - e.clientWidth);
    expect(scrollable).toBeGreaterThan(300);
    const state = () =>
      page.evaluate(() => {
        const mark = document.querySelector<HTMLElement>('#article mark.hl') as HTMLElement;
        const r = mark.getClientRects()[0] as DOMRect;
        const box = (document.querySelector('#article pre') as HTMLElement).getBoundingClientRect();
        const p = document.querySelector<SVGPathElement>('#links path[data-tid]');
        const m = (p?.getAttribute('d') ?? '').match(/^M(\S+) (\S+)C/);
        return {
          drawn: !!p,
          start: m ? { x: Number(m[1]), y: Number(m[2]) } : null,
          mark: { x: r.right, y: r.top + r.height / 2 },
          inBox: r.right >= box.left && r.right <= box.right,
        };
      });
    // 左端：強調は、箱の右の外に隠れている → 引かない
    await pre.evaluate((e) => {
      e.scrollLeft = 0;
    });
    await frames(page);
    expect((await state()).inBox).toBe(false);
    await expect(paths(page)).toHaveCount(0);
    // 右へ送る：強調が見える → 引く。始点は、強調の右端に、追従する
    for (const frac of [1, 0.9]) {
      await pre.evaluate((e, f) => {
        e.scrollLeft = (e.scrollWidth - e.clientWidth) * f;
      }, frac);
      await frames(page);
      const s = await state();
      expect(s.inBox).toBe(true);
      expect(s.drawn).toBe(true);
      near((s.start as { x: number }).x, s.mark.x);
      near((s.start as { y: number }).y, s.mark.y);
    }
    // 戻す：また、隠れる
    await pre.evaluate((e) => {
      e.scrollLeft = 0;
    });
    await frames(page);
    await expect(paths(page)).toHaveCount(0);
  });

  test('複数行（折り返し）の強調：始点は、最後の行の右端の中央（先頭の行ではない）。強調の文字を、線が横切らない', async ({
    page,
    app,
  }) => {
    const long = 'この文は、とても長いので、本文の幅の中で、何行にも折り返されます。'.repeat(5);
    await app.switchTopic(page, 'wrap', '折り返しの資料', `# 折り返しの資料\n\n${long}あとに続く短い文です。\n`);
    await app.apply({ threads: [{ page: 'root', anchor: { quote: long }, body: '確認です。' }] }, { topic: 'wrap' });
    await expect(ui(page).threads).toHaveCount(1);
    const r = await page.evaluate(() => {
      const marks = [...document.querySelectorAll<HTMLElement>('#article mark.hl')];
      const rects = marks.flatMap((m) => [...m.getClientRects()]);
      const last = rects.reduce((a, b) => (b.bottom > a.bottom ? b : a));
      const first = rects[0] as DOMRect;
      const p = document.querySelector<SVGPathElement>('#links path[data-tid]');
      const m = (p?.getAttribute('d') ?? '').match(/^M(\S+) (\S+)C/) as RegExpMatchArray;
      return {
        lines: new Set(rects.map((x) => Math.round(x.top))).size,
        start: { x: Number(m[1]), y: Number(m[2]) },
        last: { x: last.right, y: last.top + last.height / 2 },
        first: { x: first.right, y: first.top + first.height / 2 },
      };
    });
    expect(r.lines).toBeGreaterThanOrEqual(3);
    near(r.start.x, r.last.x);
    near(r.start.y, r.last.y);
    expect(r.start.y).toBeGreaterThan(r.first.y + 20); // 先頭の行ではない
  });

  test('左の一覧の開閉・窓の大きさで、線が合い直る（端点が、実測とそろう）', async ({ page, app }) => {
    await openLong(page, app, [3, 15]);
    await page.locator('#btn-side').click();
    await expect.poll(async () => (await ui(page).side.boundingBox())?.width ?? 0).toBeLessThan(5);
    await frames(page);
    for (const e of await ends(page)) {
      near(e.start.y, (e.mark as { y: number }).y);
      near(e.start.x, (e.mark as { x: number }).x);
      near(e.end.x, (e.card as { x: number }).x);
    }
    await page.setViewportSize({ width: 1100, height: 700 });
    await frames(page);
    await expect(paths(page).first()).toBeAttached();
    for (const e of await ends(page)) {
      if (e.cls.includes('edge')) continue;
      near(e.start.x, (e.mark as { x: number }).x);
      near(e.end.x, (e.card as { x: number }).x);
    }
  });
});
