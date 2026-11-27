// インライン SVG の伸縮：ブロックとしての `<svg>`（HTML ブロック・`<p>` に包まれた 1 行）は、Mermaid・draw.io と同じく、列より広いときだけ、縦横比を保って縮む（広げない）。
// 実際の Chrome で測る：窓幅（1360・1100・760）・右パネルの幅・ダーク・変更を重ねる・並べて比べる・返信の中の SVG・範囲の枠（本文・拡大表示・再読み込み後）・拡大表示の「自然な大きさ」・ほかの svg（アイコン・Mermaid・入れ子）は、変わらない。
// 図形は作り物。四隅の目印（data-mark）の矩形を、範囲の枠が囲むかで、縮んでも、枠が図形に重なることを確かめる
import type { Page } from '@playwright/test';
import { expect, type RikaiApp, test } from './fixtures';
import { addTextComment, dragBox, fillAndAdd, selectCard, settled, submitAll, ui } from './ui';

const BT = '```';
// この規則（app.css）の対象のセレクター（ブロックとしての svg）
const SCOPE =
  '#article > svg, #article > p > svg, .cmpcell.md > svg, .cmpcell.md > p > svg, .msg .body.md > svg, .msg .body.md > p > svg';
const NS = 'xmlns="http://www.w3.org/2000/svg"';
// 1200×800 の座標で描く（左上・右下に目印）。右下の目印は、列（約 634px）の外にあった：これまでは、本文で選べなかった
const WIDE_BODY =
  '<rect width="1200" height="800" fill="#eef2ff"/><rect data-mark="tl" x="20" y="20" width="200" height="120" fill="#4f46e5"/><rect data-mark="br" x="980" y="660" width="200" height="120" fill="#f59e0b"/><circle cx="600" cy="400" r="150" fill="#10b981"/>';
const MID_BODY =
  '<rect width="600" height="300" fill="#ecfeff"/><rect data-mark="tl" x="10" y="10" width="100" height="60" fill="#0891b2"/><rect data-mark="br" x="490" y="230" width="100" height="60" fill="#f59e0b"/>';
const ICON_BODY = '<circle data-mark="c" cx="40" cy="40" r="30" fill="#4f46e5"/>';
const WIDE_2_BODY =
  '<rect width="400" height="200" fill="#fef3c7"/><rect data-mark="tl" x="8" y="8" width="60" height="40" fill="#b45309"/><rect data-mark="br" x="332" y="152" width="60" height="40" fill="#4f46e5"/>';

const block = (c: string, attrs: string, body: string): string =>
  `<svg ${NS} data-case="${c}" ${attrs}>\n${body}\n</svg>`;
const oneLine = (c: string, attrs: string, body: string): string =>
  `<svg ${NS} data-case="${c}" ${attrs}>${body}</svg>`;

const DOC = `# 図の伸縮

導入の段落です。

wide（1200×800・viewBox あり）

${block('wide', 'width="1200" height="800" viewBox="0 0 1200 800"', WIDE_BODY)}

novb（1200×800・viewBox なし）

${block('novb', 'width="1200" height="800"', WIDE_BODY)}

mid（600×300・viewBox あり）

${block('mid', 'width="600" height="300" viewBox="0 0 600 300"', MID_BODY)}

icon（80×80）

${block('icon', 'width="80" height="80" viewBox="0 0 80 80"', ICON_BODY)}

vbonly（viewBox だけ）

${block('vbonly', 'viewBox="0 0 400 200"', WIDE_2_BODY)}

pct（width=100%）

${block('pct', 'width="100%" viewBox="0 0 400 200"', WIDE_2_BODY)}

pwrap（段落に包まれた 1 行）

${oneLine('pwrap', 'width="1200" height="800" viewBox="0 0 1200 800"', WIDE_BODY)}

末尾の段落です。
`;

const DOC_OTHER = `# ほかの svg

入れ子（数式の中の svg のつもり）：<span class="katex">式 ${oneLine('nested', 'width="1200" height="40" viewBox="0 0 1200 40"', '<rect width="1200" height="40" fill="#ddd"/>')}</span>

${BT}mermaid
flowchart LR
  A[受け取る] --> B{確認}
  B -- はい --> C[保存]
${BT}

${BT}html-app
<p>枠</p>
${BT}


${block('wide', 'width="1200" height="800" viewBox="0 0 1200 800"', WIDE_BODY)}

末尾の段落です。
`;

interface Sz {
  w: number;
  h: number;
}
interface Measured {
  col: number;
  overflowX: boolean;
  sizes: Record<string, Sz | undefined>;
}

/** 本文（`root`）の、ケースごとの svg の大きさ・列（#article の内側の幅）・横スクロールの有無 */
const measure = (page: Page): Promise<Measured> =>
  page.evaluate(() => {
    const art = document.querySelector('#article') as HTMLElement;
    const cs = getComputedStyle(art);
    const col = art.clientWidth - Number.parseFloat(cs.paddingLeft) - Number.parseFloat(cs.paddingRight);
    const sc = document.querySelector('#docscroll') as HTMLElement;
    const sizes: Record<string, { w: number; h: number }> = {};
    for (const s of art.querySelectorAll('svg[data-case]')) {
      const r = s.getBoundingClientRect();
      sizes[(s as SVGElement).dataset.case as string] = { w: r.width, h: r.height };
    }
    return { col, overflowX: sc.scrollWidth > sc.clientWidth + 1, sizes };
  });

/** 期待：自然な大きさ nat（px）を上限に、列に収まる。`fill` は、列いっぱい。縦横比は、ratio のまま */
const EXPECT: Record<string, { nat: number | 'fill'; ratio: number }> = {
  wide: { nat: 1200, ratio: 1.5 },
  novb: { nat: 1200, ratio: 1.5 },
  pwrap: { nat: 1200, ratio: 1.5 },
  mid: { nat: 600, ratio: 2 },
  icon: { nat: 80, ratio: 1 },
  vbonly: { nat: 'fill', ratio: 2 },
  pct: { nat: 'fill', ratio: 2 },
};

function expectFit(m: Measured, label: string, col = m.col): void {
  expect(m.overflowX, `${label}：本文が、横にはみ出さない`).toBe(false);
  for (const [name, e] of Object.entries(EXPECT)) {
    const s = m.sizes[name];
    expect(s, `${label} ${name}`).toBeTruthy();
    const want = e.nat === 'fill' ? col : Math.min(e.nat, col);
    expect(Math.abs((s as Sz).w - want), `${label} ${name} 幅 ${(s as Sz).w} 期待 ${want}`).toBeLessThanOrEqual(1);
    expect(
      Math.abs((s as Sz).w / (s as Sz).h - e.ratio),
      `${label} ${name} 縦横比 ${(s as Sz).w}×${(s as Sz).h}`,
    ).toBeLessThan(0.02);
  }
}

type R = { x: number; y: number; w: number; h: number };
const diff = (a: R, b: R): number =>
  Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.w - b.w), Math.abs(a.h - b.h));
const fmt = (a: R | null | undefined): string =>
  a ? `[${[a.x, a.y, a.w, a.h].map((v) => v.toFixed(1)).join(',')}]` : 'null';

/** 目印の矩形（画面）。root：`#article`・`#lightbox .lb-stage` */
const markRect = (page: Page, root: string, c: string, mark: string): Promise<R | null> =>
  page.evaluate(
    ([root, c, mark]) => {
      const el = document.querySelector(`${root} svg[data-case="${c}"] [data-mark="${mark}"]`);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    },
    [root, c, mark] as const,
  );

const regionRects = (page: Page): Promise<Record<string, R>> =>
  page.evaluate(() => {
    const out: Record<string, R> = {};
    for (const e of document.querySelectorAll('#badges .regionbox:not(.pending)')) {
      const r = e.getBoundingClientRect();
      out[(e as HTMLElement).dataset.tid ?? ''] = { x: r.x, y: r.y, w: r.width, h: r.height };
    }
    return out;
  });
const lbRects = (page: Page): Promise<Record<string, R>> =>
  page.evaluate(() => {
    const out: Record<string, R> = {};
    for (const e of document.querySelectorAll('#lightbox .fv-box:not(.pending)')) {
      const r = e.getBoundingClientRect();
      out[(e as HTMLElement).dataset.tid ?? ''] = { x: r.x, y: r.y, w: r.width, h: r.height };
    }
    return out;
  });

const svgOf = (page: Page, c: string) => page.locator(`#article svg[data-case="${c}"]`);
const scrollTo = (page: Page, c: string) => svgOf(page, c).evaluate((e) => e.scrollIntoView({ block: 'center' }));

async function setup(page: Page, app: RikaiApp, w = 1360): Promise<void> {
  await page.setViewportSize({ width: w, height: 900 });
  await app.switchTopic(page, 'fit', '図の伸縮', DOC);
  await expect(page.locator('#article svg[data-case]')).toHaveCount(7);
  await page.waitForTimeout(600);
}

/** 本文で、図（c）の目印（mark）を、範囲として選んで、コメントを足す。作った範囲の tid を返す */
const MARK_RGB: Record<string, [number, number, number]> = { br: [245, 158, 11], tl: [79, 70, 229] }; // 目印の色（WIDE_BODY）

async function regionOnMark(page: Page, c: string, mark: string, text: string): Promise<string> {
  const u = ui(page);
  await scrollTo(page, c);
  await page.waitForTimeout(250);
  const r = (await markRect(page, '#article', c, mark)) as R;
  const before = new Set(Object.keys(await regionRects(page)));
  await u.regbtn.click();
  await dragBox(page, { x: r.x, y: r.y }, { x: r.x + r.w, y: r.y + r.h });
  await expect(u.composer).toBeVisible();
  await settled(page);
  // 範囲の画像（本文を写して作る）は、囲んだ目印の色（一面）。空・別の場所（図の左上）ではない
  const thumb = u.composer.locator('.thumb img');
  await expect(thumb).toBeVisible();
  await expect
    .poll(
      () =>
        thumb.evaluate((i: HTMLImageElement, want: number[]) => {
          if (!i.complete || !i.naturalWidth) return 0;
          const cv = document.createElement('canvas');
          cv.width = i.naturalWidth;
          cv.height = i.naturalHeight;
          const ctx = cv.getContext('2d') as CanvasRenderingContext2D;
          ctx.drawImage(i, 0, 0);
          const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
          let colored = 0;
          for (let k = 0; k < d.length; k += 4) if (want.every((v, j) => Math.abs((d[k + j] ?? 0) - v) < 40)) colored++;
          return colored / (d.length / 4);
        }, MARK_RGB[mark] as number[]),
      { message: '範囲の画像に、目印の色が写る' },
    )
    .toBeGreaterThan(0.8);
  await fillAndAdd(page, text);
  await page.waitForTimeout(400);
  const after = await regionRects(page);
  const tid = Object.keys(after).find((k) => !before.has(k)) ?? '';
  expect(after[tid], `作った直後 ${c}/${mark}`).toBeTruthy();
  return tid;
}

test.describe('インライン SVG の伸縮', () => {
  test('窓幅 1360・1100・760：列を超えない・縦横比を保つ・小さい SVG は元の大きさ・viewBox のみと 100% は列いっぱい。右パネルを広げて列が狭くなると追従する', async ({
    page,
    app,
  }) => {
    await setup(page, app);
    const u = ui(page);
    for (const w of [1360, 1100, 760]) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.waitForTimeout(500);
      const m = await measure(page);
      expectFit(m, `w=${w}`);
      if (w === 1360) {
        // 列より広い SVG が、列いっぱい（これまでは、1200px で、横にはみ出した）
        expect(m.sizes.wide?.w).toBeCloseTo(m.col, 0);
        expect(m.sizes.icon).toMatchObject({ w: 80, h: 80 });
        expect(m.sizes.mid?.w).toBe(600);
      }
      if (w === 760) expect(m.sizes.mid?.w).toBeCloseTo(m.col, 0); // 600 が、列（約 420）より広い：縮む
    }
    // viewBox のない `width`・`height` だけの SVG：枠だけが縮んで図形が切れないよう、viewBox を、幅・高さから足す。ほかの SVG の viewBox は、そのまま
    await page.setViewportSize({ width: 1360, height: 900 });
    await expect(svgOf(page, 'novb')).toHaveAttribute('viewBox', '0 0 1200 800');
    await expect(svgOf(page, 'vbonly')).toHaveAttribute('viewBox', '0 0 400 200');
    await expect(svgOf(page, 'vbonly')).not.toHaveAttribute('width', /.*/);
    await expect(svgOf(page, 'pct')).toHaveAttribute('width', '100%');
    // 図形が、枠と一緒に縮む（右下の目印が、枠の中。右端から、20 × 縮尺）
    for (const c of ['wide', 'novb', 'pwrap']) {
      await scrollTo(page, c);
      const s = (await svgOf(page, c).boundingBox()) as { x: number; y: number; width: number; height: number };
      const br = (await markRect(page, '#article', c, 'br')) as R;
      const k = s.width / 1200;
      expect(Math.abs(s.x + s.width - (br.x + br.w) - 20 * k), `${c} 右下の目印の右の余白`).toBeLessThan(0.8);
      expect(Math.abs(s.y + s.height - (br.y + br.h) - 20 * k), `${c} 右下の目印の下の余白`).toBeLessThan(0.8);
      expect(Math.abs(br.w - 200 * k), `${c} 目印の幅`).toBeLessThan(0.8);
    }
    // 右パネルを広げる（← 24px ずつ）：列が狭くなる → 追従
    const before = (await measure(page)).col;
    await page.locator('#panel-resizer').focus();
    for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(500);
    const narrow = await measure(page);
    expect(narrow.col).toBeLessThan(before - 150);
    expectFit(narrow, 'パネルを広げた');
    expect(narrow.sizes.mid?.w).toBeLessThan(600); // 600 の図も、縮む
    // 戻すと、広がる（広げ直す）
    for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(500);
    const back = await measure(page);
    expectFit(back, 'パネルを戻した');
    expect(back.col).toBeCloseTo(before, 0);
    // ダーク
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForTimeout(500);
    expectFit(await measure(page), 'ダーク');
    // 右パネル・本文の、ほかの操作に、影響しない：文章の段落の幅は、列のまま
    await expect(u.article).toBeVisible();
  });

  test('ほかの svg は、変わらない：UI のアイコン・Mermaid・html-app の見出しのアイコン・入れ子の svg（直接の子でない）・関連の線・拡大表示のステージ', async ({
    page,
    app,
  }) => {
    await app.switchTopic(page, 'other', 'ほかの svg', DOC_OTHER);
    await expect(page.locator('#article .mermaid-block svg')).toHaveCount(1);
    await page.waitForTimeout(600);
    const st = (sel: string) =>
      page.evaluate(
        ([s, scope]) => {
          const e = document.querySelector(s as string) as Element;
          const cs = getComputedStyle(e);
          const r = e.getBoundingClientRect();
          return { maxWidth: cs.maxWidth, w: r.width, h: r.height, inScope: e.matches(scope as string) };
        },
        [sel, SCOPE] as const,
      );
    // UI のアイコン（lucide）：14〜15px のまま（max-width: none）
    const icon = await st('#top svg.lucide, #docbar svg.lucide');
    expect(icon.maxWidth).toBe('none');
    expect(icon.inScope).toBe(false);
    expect(icon.w).toBeLessThan(20);
    // html-app の見出しのアイコン
    const cap = await st('#article .htmlapp .cap svg');
    expect(cap.maxWidth).toBe('none');
    expect(cap.w).toBeLessThan(20);
    // 入れ子（`<span>` の中）の svg：元の大きさのまま（列を超える：触っていない）
    const nested = await st('#article svg[data-case="nested"]');
    expect(nested.maxWidth).toBe('none');
    expect(nested.w).toBe(1200);
    // 関連の線
    expect((await st('#links')).maxWidth).toBe('none');
    // Mermaid：この規則の対象外（Mermaid・draw.io には、既存の規則）
    expect((await st('#article .mermaid-block svg')).inScope).toBe(false);
    expect((await st('#article svg[data-case="wide"]')).inScope).toBe(true);
    expect((await st('#article svg[data-case="wide"]')).maxWidth).toBe('100%'); // 規則が効いている
    // 拡大表示のステージの svg：自然な大きさ。`max-width: none`
    await scrollTo(page, 'wide');
    await svgOf(page, 'wide').click({ position: { x: 3, y: 3 } });
    await expect(ui(page).lightbox).toBeVisible();
    const stage = await st('#lightbox .lb-stage svg');
    expect(stage.maxWidth).toBe('none');
    expect(stage.inScope).toBe(false);
    expect(stage.w).toBeGreaterThan(0);
  });

  test('拡大表示：縮んだ大きさでなく、自然な大きさ（width・height・viewBox）で開く。窓が狭くても同じ。範囲は、拡大表示でも本文でも、図形に重なる', async ({
    page,
    app,
  }) => {
    test.setTimeout(120_000);
    await setup(page, app, 760); // 列が、約 420px：1200 の図は、約 35% に縮んでいる
    const natural: [string, number, number][] = [
      ['wide', 1200, 800],
      ['novb', 1200, 800],
      ['mid', 600, 300],
      ['vbonly', 400, 200],
      ['pwrap', 1200, 800],
    ];
    for (const [c, w, h] of natural) {
      await scrollTo(page, c);
      await svgOf(page, c).click({ position: { x: 3, y: 3 } });
      await expect(ui(page).lightbox).toBeVisible();
      await page.waitForTimeout(300);
      const stage = await page.evaluate(() => {
        const s = document.querySelector('#lightbox .lb-stage') as HTMLElement;
        return { w: s.offsetWidth, h: s.offsetHeight };
      });
      expect(stage, `${c} 拡大表示の自然な大きさ`).toEqual({ w, h });
      await page.keyboard.press('Escape');
      await expect(ui(page).lightbox).toBeHidden();
    }

    // 本文で、右下の目印（これまでは、列の外）を、範囲で囲む → 拡大表示で、別の目印を囲む → どちらも、本文・拡大表示・再読み込み・窓幅の変更・パネル幅の変更で、図形に重なる
    const body = await regionOnMark(page, 'wide', 'br', 'body:wide:br');
    const body2 = await regionOnMark(page, 'novb', 'tl', 'body:novb:tl');
    // 拡大表示で（wide の左上）
    await scrollTo(page, 'wide');
    await svgOf(page, 'wide').click({ position: { x: 3, y: 3 } });
    await expect(ui(page).lightbox).toBeVisible();
    await page.waitForTimeout(500);
    // 開いた直後の、既存の範囲の枠も、拡大表示の目印に重なる（本文で付けた範囲の比率が、そのまま合う）
    {
      const boxes = await lbRects(page);
      const br = (await markRect(page, '#lightbox .lb-stage', 'wide', 'br')) as R;
      expect(boxes[body], '拡大表示に、本文で付けた範囲が出る').toBeTruthy();
      expect(
        diff(boxes[body] as R, br),
        `拡大表示 本文で付けた範囲 枠 ${fmt(boxes[body])} 目印 ${fmt(br)}`,
      ).toBeLessThanOrEqual(2);
    }
    const tl = (await markRect(page, '#lightbox .lb-stage', 'wide', 'tl')) as R;
    const lbBefore = new Set(Object.keys(await lbRects(page)));
    await page.locator('#lightbox .fv-tools [data-tool="region"]').click();
    await dragBox(page, { x: tl.x, y: tl.y }, { x: tl.x + tl.w, y: tl.y + tl.h });
    const comp = page.locator('#lightbox .fv-dock .thread.composer');
    await expect(comp).toBeVisible();
    await expect(comp).not.toContainText('アップロード中');
    await comp.locator('textarea').fill('lb:wide:tl');
    await comp.getByRole('button', { name: 'コメントを追加' }).click();
    await expect(comp).toHaveCount(0);
    await page.waitForTimeout(500);
    const lbAfter = await lbRects(page);
    const lbTid = Object.keys(lbAfter).find((k) => !lbBefore.has(k)) ?? '';
    const tlNow = (await markRect(page, '#lightbox .lb-stage', 'wide', 'tl')) as R;
    expect(lbAfter[lbTid], '拡大表示で付けた範囲').toBeTruthy();
    expect(
      diff(lbAfter[lbTid] as R, tlNow),
      `拡大表示 枠 ${fmt(lbAfter[lbTid])} 目印 ${fmt(tlNow)}`,
    ).toBeLessThanOrEqual(2);
    await page.keyboard.press('Escape');
    await expect(ui(page).lightbox).toBeHidden();

    const made: { tid: string; c: string; mark: string }[] = [
      { tid: body, c: 'wide', mark: 'br' },
      { tid: body2, c: 'novb', mark: 'tl' },
      { tid: lbTid, c: 'wide', mark: 'tl' },
    ];
    const check = async (label: string): Promise<void> => {
      await page.waitForTimeout(900);
      for (const m of made) {
        await scrollTo(page, m.c);
        await page.waitForTimeout(250);
        const t = await markRect(page, '#article', m.c, m.mark);
        const b = (await regionRects(page))[m.tid];
        expect(b && t, `${label} ${m.c}/${m.mark}`).toBeTruthy();
        expect(diff(b as R, t as R), `${label} ${m.c}/${m.mark} 枠 ${fmt(b)} 目印 ${fmt(t)}`).toBeLessThanOrEqual(2);
      }
    };
    await check('拡大表示のあと（本文）');
    for (const w of [1360, 1100, 760]) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.reload();
      await expect(page.locator('#article svg[data-case]')).toHaveCount(7);
      await check(`再読み込み w=${w}`);
    }
    // 窓は 760：右パネルを広げて、列をさらに狭くする（再読み込みなし）
    await page.setViewportSize({ width: 1360, height: 900 });
    await page.waitForTimeout(500);
    await check('窓を広げた');
    await page.locator('#panel-resizer').focus();
    for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowLeft');
    await check('パネルを広げた');
    for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowRight');
    await check('パネルを戻した');
  });

  test('変更を重ねる・並べて比べる（左右の列が狭い）・返信の中の SVG：縮む。返信の SVG は、押すと、自然な大きさで開く', async ({
    page,
    app,
  }) => {
    await setup(page, app);
    // 返信の中の svg（右パネルの幅は、約 380px）
    await addTextComment(page, '導入の段落です', 'この図を直してください');
    await submitAll(page);
    const r = await app.nextRound();
    const replySvg = oneLine('reply', 'width="1200" height="800" viewBox="0 0 1200 800"', WIDE_BODY);
    await app.apply({
      round: r.round,
      revisions: [{ page: 'root', markdown: DOC.replace('導入の段落です。', '導入の段落です。直しました。') }],
      replies: [{ thread: r.items[0].thread, body: `直した図です。\n\n${replySvg}\n\n以上です。` }],
    });
    await expect(page.locator('#docbar select')).toHaveValue('2');
    const card = ui(page).threads.first();
    await selectCard(card);
    const rs = card.locator('.msg .body.md svg[data-case="reply"]');
    await expect(rs).toBeVisible();
    const rb = await rs.boundingBox();
    const body = (await card.locator('.msg .body.md').last().boundingBox()) as { x: number; width: number };
    expect(rb && rb.x + rb.width <= body.x + body.width + 1, '返信の svg が、返信の幅に収まる').toBe(true);
    expect(Math.abs((rb?.width ?? 0) / (rb?.height ?? 1) - 1.5)).toBeLessThan(0.02);
    expect(rb?.width ?? 9999).toBeLessThan(400);
    await rs.click({ position: { x: 3, y: 3 } });
    await expect(ui(page).lightbox).toBeVisible();
    await page.waitForTimeout(300);
    expect(
      await page.evaluate(() => {
        const s = document.querySelector('#lightbox .lb-stage') as HTMLElement;
        return { w: s.offsetWidth, h: s.offsetHeight };
      }),
    ).toEqual({ w: 1200, h: 800 });
    await page.keyboard.press('Escape');
    await expect(ui(page).lightbox).toBeHidden();

    // 変更を重ねる（v2：前の版との差分）
    await page.locator('.modeseg button', { hasText: '変更を重ねる' }).click();
    await page.waitForTimeout(800);
    expectFit(await measure(page), '変更を重ねる');
    await page.locator('.modeseg button', { hasText: '通常' }).click();

    // 並べて比べる：左右の列は、本文より狭い
    await page.locator('#btn-compare').click();
    await expect(page.locator('#compare .cmprow').first()).toBeVisible();
    await page.waitForTimeout(800);
    const cmp = await page.evaluate(() => {
      const out: { side: string; cell: number; w: number; h: number; c: string }[] = [];
      for (const c of document.querySelectorAll('#compare .cmpcell.md')) {
        const cs = getComputedStyle(c);
        const cell =
          (c as HTMLElement).clientWidth - Number.parseFloat(cs.paddingLeft) - Number.parseFloat(cs.paddingRight);
        for (const s of c.querySelectorAll(':scope > svg[data-case], :scope > p > svg[data-case]')) {
          const r = s.getBoundingClientRect();
          out.push({
            side: c.classList.contains('cmpl') ? 'l' : 'r',
            cell,
            w: r.width,
            h: r.height,
            c: (s as SVGElement).dataset.case as string,
          });
        }
      }
      return out;
    });
    expect(cmp.length).toBeGreaterThanOrEqual(14);
    for (const s of cmp) {
      const e = EXPECT[s.c];
      if (!e) continue;
      const want = e.nat === 'fill' ? s.cell : Math.min(e.nat, s.cell);
      expect(Math.abs(s.w - want), `比べる ${s.side} ${s.c} 幅 ${s.w} 期待 ${want}`).toBeLessThanOrEqual(1);
      expect(Math.abs(s.w / s.h - e.ratio), `比べる ${s.side} ${s.c} 縦横比`).toBeLessThan(0.02);
    }
    expect(cmp.some((s) => s.c === 'wide' && s.w < 1200 && s.cell < 700)).toBe(true);
  });
});
