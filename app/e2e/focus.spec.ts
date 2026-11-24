// 個別表示（フォーカスビュー。F43）：F37 の拡大表示を、窓の左のステージ・右のコメントのドックに拡張した。画像・Mermaid の図・インラインの svg・html-app の枠を、個別に大きく見て、
// 細かい範囲・要素を選んで、ドックの入力欄（本文のパネルと同じ下書き）でコメントする。実際の Chrome・本物のマウス・キー。資料は、作り物。
import fs from 'node:fs';
import type { Locator, Page } from '@playwright/test';
import { expect, type RikaiApp, test } from './fixtures';
import { type DecodedPng, decodePng, makeSquarePng } from './samples';
import { box, clickUntilPicked, dragBox, submitAll, ui } from './ui';

const BT = '```';
const lines = (...l: string[]) => `${l.join('\n')}\n`;

// ---- 作り物の資料 ----
const SQ = { x: 1200, y: 300, w: 40, h: 30 }; // 緑の四角（画像の画素）
const INK =
  '<svg id="ink" viewBox="0 0 200 100" width="200" height="100"><rect width="200" height="100" fill="#e6e6e6"/><rect x="120" y="30" width="40" height="30" fill="#00a000"/></svg>';
const MM = lines(
  `${BT}mermaid`,
  'flowchart LR',
  '  A[呼び出し] --> B{成功?}',
  '  B -- はい --> C[返す]',
  '  B -- いいえ --> D[待つ]',
  BT,
);
// 赤い帯（高さ 100px）・スライダー・ボタンのある部品。状態（rikai.state）を知らせる
const APP = (marker = 'A') =>
  lines(
    `${BT}html-app height=320`,
    '<style>body{margin:0;font:16px sans-serif}.band{background:#e11d48;color:#fff;height:100px;padding:20px;box-sizing:border-box}</style>',
    `<div class="band">赤い帯 ${marker}</div>`,
    '<input id="r" type="range" min="0" max="100" value="20"> <button id="go">ボタン</button> <span id="v">20</span>',
    '<script>',
    "var r = document.getElementById('r');",
    "r.addEventListener('input', function () { document.getElementById('v').textContent = r.value; window.rikai.state({ slider: Number(r.value) }); });",
    'window.rikai.state({ slider: 20 });',
    '</script>',
    BT,
  );
const DOC = (extra = '') =>
  `# 個別表示の確認\n\n前の段落です。\n\n![緑の四角](assets/sq.png)\n\n${MM}\n${INK}\n\n${APP()}\n${extra}後の段落です。\n`;
const ASSETS = { 'sq.png': makeSquarePng(1600, 600, SQ) };

async function open(page: Page, app: RikaiApp, md = DOC(), slug = 'fv') {
  await page.setViewportSize({ width: 1360, height: 900 });
  await app.switchTopic(page, slug, '個別表示の確認', md, ASSETS);
  await expect.poll(() => page.locator('#article img').evaluate((i) => (i as HTMLImageElement).complete)).toBe(true);
  await expect(page.locator('#article .mermaid-block svg')).toHaveCount(1);
  await expect(page.locator('#article iframe.appframe')).toHaveCount(1);
}

const lbx = (page: Page) => page.locator('#lightbox');
const dock = (page: Page) => page.locator('#lightbox .fv-dock');
const dockComposer = (page: Page) => page.locator('#lightbox .fv-dock .thread.composer');
const dockThreads = (page: Page) => page.locator('#lightbox .fv-dock .thread:not(.composer)');
const regionTool = (page: Page) => page.locator('#lightbox .fv-tools [data-tool="region"]');
const stage = (page: Page) => page.locator('#lightbox .lb-stage');
const pct = async (page: Page) => Number.parseInt((await page.locator('#lightbox .lb-pct').textContent()) ?? '0', 10);
const artImg = (page: Page) => page.locator('#article img');
const artSvg = (page: Page) => page.locator('#article svg#ink');
const artMm = (page: Page) => page.locator('#article .mermaid-block svg');
const appCap = (page: Page) => page.locator('#article .htmlapp .cap');
const focusFrame = (page: Page) => page.frameLocator('#lightbox iframe.appframe');

/** 画像のステージが、画像の読み込みを終え、大きさを持つまで待つ */
async function stageReady(page: Page) {
  await expect(lbx(page)).toBeVisible();
  await expect.poll(async () => (await box(stage(page))).width).toBeGreaterThan(50);
}

/** (cx, cy) の下の点を動かさず、拡大率が target% 以上になるまで、ホイールで拡大する */
async function wheelZoomTo(page: Page, target: number, cx: number, cy: number) {
  await page.mouse.move(cx, cy);
  for (let i = 0; i < 14 && (await pct(page)) < target; i++) {
    await page.mouse.wheel(0, -300);
    await page.waitForTimeout(30);
  }
  expect(await pct(page)).toBeGreaterThanOrEqual(target);
}

// 入力欄のサムネイルの、(x, y)（0〜1）の画素の色
const thumbPixel = (thumb: Locator, fx: number, fy: number) =>
  thumb.evaluate(
    (img: HTMLImageElement, [x, y]) => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const g = c.getContext('2d') as CanvasRenderingContext2D;
      g.drawImage(img, 0, 0);
      const d = g.getImageData(Math.floor(c.width * (x as number)), Math.floor(c.height * (y as number)), 1, 1).data;
      return [d[0], d[1], d[2]] as number[];
    },
    [fx, fy],
  );

// 緑（0,160,0 に近い）の画素の割合
const greenShare = (png: DecodedPng) => {
  let g = 0;
  for (let y = 0; y < png.h; y++)
    for (let x = 0; x < png.w; x++) {
      const [r, gg, b] = png.at(x, y);
      if (r < 40 && Math.abs(gg - 160) < 40 && b < 40) g++;
    }
  return g / (png.w * png.h);
};

// 画像（assets の画像・ステージの画像）の、画素の位置（0〜1600 × 0〜600）→ 画面の座標
const imgAt = (b: { x: number; y: number; width: number }, nat: number) => (ix: number, iy: number) => ({
  x: b.x + (ix / nat) * b.width,
  y: b.y + (iy / nat) * b.width,
});

// ============================================================================
test.describe('個別表示：画像・図で、範囲を選んで、コメントする', () => {
  test('画像：範囲を選ぶ → 400% で小さな範囲をドラッグ → ドックに入力欄（個別表示は、開いたまま）→ 書く → 閉じる → パネルに下書き → 追加 → Submit → AI に、元の解像度から切り出した画像・region が届く', async ({
    page,
    app,
  }) => {
    const u = ui(page);
    await open(page, app);
    await artImg(page).scrollIntoViewIfNeeded();
    await artImg(page).click();
    await stageReady(page);
    await expect(dock(page)).toBeVisible();
    await expect(regionTool(page)).toBeEnabled();
    await regionTool(page).click();
    await expect(regionTool(page)).toHaveAttribute('aria-pressed', 'true');
    // 400% 以上へ：四角の上で、ホイール（カーソルの下の点が動かない）
    const s0 = await box(stage(page));
    const at0 = imgAt(s0, 1600);
    const c = at0(1220, 315);
    await wheelZoomTo(page, 400, c.x, c.y);
    const s1 = await box(stage(page));
    const k = s1.width / 1600; // 画像の 1 画素 = 画面の k px
    expect(k).toBeGreaterThanOrEqual(4);
    // 四角の内側（画像の画素で、(1208,306)〜(1232,324)：24×18）を、画面でドラッグ
    const at = imgAt(s1, 1600);
    await dragBox(page, at(1208, 306), at(1232, 324));
    await expect(dockComposer(page)).toBeVisible();
    await expect(lbx(page)).toBeVisible(); // 個別表示は、開いたまま
    await expect(regionTool(page)).toHaveAttribute('aria-pressed', 'false'); // 選び終えたら、道具は、やめる
    await expect(dockComposer(page).locator('.quote')).toContainText('緑の四角');
    // 範囲の画像：元の解像度から、24×18 画素（画面で選んだ大きさ ÷ 倍率）。全部、緑
    const thumb = dockComposer(page).locator('.thumb img');
    await expect(thumb).toHaveCount(1);
    await expect(thumb).toHaveJSProperty('complete', true);
    const dim = await thumb.evaluate((i: HTMLImageElement) => ({ w: i.naturalWidth, h: i.naturalHeight }));
    expect(Math.abs(dim.w - 24)).toBeLessThanOrEqual(2);
    expect(Math.abs(dim.h - 18)).toBeLessThanOrEqual(2);
    const [r, g, b] = await thumbPixel(thumb, 0.5, 0.5);
    expect([r, g, b]).toEqual([0, 160, 0]);
    // ステージに、入力中の枠（破線）と「新」が重なる（ドラッグした範囲の位置）
    const pend = page.locator('#lightbox .fv-box.pending');
    await expect(pend).toBeVisible();
    const pb = await box(pend);
    expect(Math.abs(pb.x - at(1208, 306).x)).toBeLessThanOrEqual(2);
    expect(Math.abs(pb.y - at(1208, 306).y)).toBeLessThanOrEqual(2);
    expect(Math.abs(pb.width - 24 * k)).toBeLessThanOrEqual(2);
    expect(Math.abs(pb.height - 18 * k)).toBeLessThanOrEqual(2);
    await expect(pend.locator('.fv-no')).toHaveText('新');
    // 書く（ドックの入力欄）。まだ、追加しない
    await dockComposer(page).locator('textarea').fill('緑の四角の、右端が欠けている？');
    // Esc：道具は、やめている → 個別表示を、閉じる。書きかけは、本文のパネルに、残る
    await page.keyboard.press('Escape');
    await expect(lbx(page)).toBeHidden();
    await expect(u.composer).toBeVisible();
    await expect(u.composer.locator('textarea')).toHaveValue('緑の四角の、右端が欠けている？');
    await expect(u.composer.locator('.thumb img')).toHaveCount(1);
    await expect(artImg(page)).toBeFocused(); // 開いた所に、フォーカスが戻る
    // パネルで追加 → Submit → AI に届く
    await u.composer.getByRole('button', { name: 'コメントを追加' }).click();
    await expect(u.threads).toHaveCount(1);
    await submitAll(page);
    const round = await app.nextRound();
    const item = round.items[0];
    const want = { x: 1208 / 1600, y: 306 / 600, w: 24 / 1600, h: 18 / 600 };
    const region = item.anchor.region;
    expect(Math.abs(region.x - want.x)).toBeLessThan(0.0015);
    expect(Math.abs(region.y - want.y)).toBeLessThan(0.0015);
    expect(Math.abs(region.w - want.w)).toBeLessThan(0.0015);
    expect(Math.abs(region.h - want.h)).toBeLessThan(0.0015);
    expect(item.anchor.label).toBe('画像: 緑の四角の一部');
    expect(item.new[0].text).toContain('緑の四角の、右端が欠けている');
    const imgs: string[] = item.new[0].images;
    expect(imgs).toHaveLength(1);
    const png = decodePng(fs.readFileSync(imgs[0] as string));
    expect(Math.abs(png.w - 24)).toBeLessThanOrEqual(2);
    expect(Math.abs(png.h - 18)).toBeLessThanOrEqual(2);
    expect(greenShare(png)).toBeGreaterThan(0.97); // 元の画像の、正しい位置から（四角の内側だけ）
  });

  test('画像の、四角の縁をまたぐ範囲：切り出した画像の、灰色・緑の境目が、選んだ位置と合う（ズーム 800%・移動した状態）', async ({
    page,
    app,
  }) => {
    await open(page, app);
    await artImg(page).click();
    await stageReady(page);
    await regionTool(page).click();
    const s0 = await box(stage(page));
    const c = imgAt(s0, 1600)(1200, 315);
    await wheelZoomTo(page, 800, c.x, c.y);
    // 左へ・上へ、少し動かす（ステージの、背景を、ドラッグ：範囲を選ぶ道具が、動いているので、いったん、やめて、動かして、また、始める）
    await regionTool(page).click();
    await page.mouse.move(c.x + 60, c.y + 40);
    await page.mouse.down();
    await page.mouse.move(c.x - 20, c.y + 10, { steps: 6 });
    await page.mouse.up();
    await regionTool(page).click();
    const s1 = await box(stage(page));
    const k = s1.width / 1600;
    expect(k).toBeGreaterThanOrEqual(7.9);
    const at = imgAt(s1, 1600);
    // 画像の (1190,310)〜(1220,326)：四角の左端（x=1200）をまたぐ。左の 10 画素が灰色・右の 20 画素が緑
    await dragBox(page, at(1190, 310), at(1220, 326));
    await expect(dockComposer(page)).toBeVisible();
    const thumb = dockComposer(page).locator('.thumb img');
    await expect(thumb).toHaveCount(1);
    await expect(thumb).toHaveJSProperty('complete', true);
    const dim = await thumb.evaluate((i: HTMLImageElement) => ({ w: i.naturalWidth, h: i.naturalHeight }));
    expect(Math.abs(dim.w - 30)).toBeLessThanOrEqual(2);
    expect(Math.abs(dim.h - 16)).toBeLessThanOrEqual(2);
    const left = await thumbPixel(thumb, 5 / 30, 0.5); // 灰色
    const right = await thumbPixel(thumb, 20 / 30, 0.5); // 緑
    expect(left[0]).toBeGreaterThan(200);
    expect(left[1]).toBeGreaterThan(200);
    expect(right).toEqual([0, 160, 0]);
    // 境目の位置：左から 10 画素（30 画素の 1/3）
    let edge = -1;
    for (let x = 0; x < 30; x++) {
      const p = await thumbPixel(thumb, (x + 0.5) / 30, 0.5);
      if (p[0] < 100) {
        edge = x;
        break;
      }
    }
    expect(Math.abs(edge - 10)).toBeLessThanOrEqual(2);
  });

  test('インラインの svg：範囲を選ぶ → 図の座標から切り出す（自然な大きさの 2 倍）。四角の内側は、全部緑。Mermaid の図でも、選んだ範囲の縦横比の画像が付く', async ({
    page,
    app,
  }) => {
    await open(page, app);
    // svg
    await artSvg(page).scrollIntoViewIfNeeded();
    await artSvg(page).click();
    await stageReady(page);
    await regionTool(page).click();
    const s = await box(stage(page));
    const k = s.width / 200; // 図の 1 単位 = 画面の k px
    await dragBox(page, { x: s.x + 126 * k, y: s.y + 36 * k }, { x: s.x + 154 * k, y: s.y + 54 * k });
    await expect(dockComposer(page)).toBeVisible();
    await expect(lbx(page)).toBeVisible();
    const thumb = dockComposer(page).locator('.thumb img');
    await expect(thumb).toHaveCount(1);
    await expect(thumb).toHaveJSProperty('complete', true);
    const dim = await thumb.evaluate((i: HTMLImageElement) => ({ w: i.naturalWidth, h: i.naturalHeight }));
    expect(Math.abs(dim.w - 56)).toBeLessThanOrEqual(3); // 28 単位 × 2
    expect(Math.abs(dim.h - 36)).toBeLessThanOrEqual(3); // 18 単位 × 2
    expect(await thumbPixel(thumb, 0.5, 0.5)).toEqual([0, 160, 0]);
    await dockComposer(page).getByRole('button', { name: 'やめる' }).click();
    await page.keyboard.press('Escape');
    await expect(lbx(page)).toBeHidden();
    // Mermaid
    await artMm(page).scrollIntoViewIfNeeded();
    await artMm(page).click();
    await stageReady(page);
    await regionTool(page).click();
    const m = await box(stage(page));
    const drag = { w: m.width * 0.3, h: m.height * 0.25 };
    await dragBox(
      page,
      { x: m.x + m.width * 0.1, y: m.y + m.height * 0.2 },
      { x: m.x + m.width * 0.1 + drag.w, y: m.y + m.height * 0.2 + drag.h },
    );
    await expect(dockComposer(page)).toBeVisible();
    const mt = dockComposer(page).locator('.thumb img');
    await expect(mt).toHaveCount(1);
    await expect(mt).toHaveJSProperty('complete', true);
    const md = await mt.evaluate((i: HTMLImageElement) => ({ w: i.naturalWidth, h: i.naturalHeight }));
    expect(Math.abs(md.w / md.h - drag.w / drag.h)).toBeLessThan(0.15); // 縦横比が、選んだ範囲のまま
    await expect(dockComposer(page).locator('.quote')).toContainText('図の一部');
  });

  test('既存の範囲コメントの枠・番号が、ステージに重なる：位置が合う・ズーム・移動に追従する・押すと、ドックの、そのスレッドが選ばれる・開き直しても、同じ', async ({
    page,
    app,
  }) => {
    await open(page, app);
    await artImg(page).click();
    await stageReady(page);
    // 2 つの範囲（四角の中・四角の外）に、コメント
    const mk = async (a: [number, number], b: [number, number], text: string) => {
      await regionTool(page)
        .click()
        .catch(() => {});
      const sb = await box(stage(page));
      const at = imgAt(sb, 1600);
      await dragBox(page, at(...a), at(...b));
      await expect(dockComposer(page)).toBeVisible();
      await dockComposer(page).locator('textarea').fill(text);
      await dockComposer(page).getByRole('button', { name: 'コメントを追加' }).click();
      await expect(dockComposer(page)).toHaveCount(0);
    };
    await mk([1190, 290], [1250, 340], '四角のまわり');
    await mk([100, 80], [500, 300], '左上の広い範囲');
    await expect(dockThreads(page)).toHaveCount(2);
    const boxes = page.locator('#lightbox .fv-box:not(.pending)');
    await expect(boxes).toHaveCount(2);
    // 本文の番号の順：左上が 1・四角が 2 …ではなく、本文の順（位置が同じブロックなので、作った順）
    const nums = await boxes.locator('.fv-no').allTextContents();
    expect([...nums].sort()).toEqual(['1', '2']);
    const expectAt = async (rect: { x: number; y: number; w: number; h: number }, tid: string) => {
      const sb = await box(stage(page));
      const b = await box(page.locator(`#lightbox .fv-box[data-tid="${tid}"]`));
      expect(Math.abs(b.x - (sb.x + rect.x * sb.width))).toBeLessThanOrEqual(2);
      expect(Math.abs(b.y - (sb.y + rect.y * sb.height))).toBeLessThanOrEqual(2);
      expect(Math.abs(b.width - rect.w * sb.width)).toBeLessThanOrEqual(2);
      expect(Math.abs(b.height - rect.h * sb.height)).toBeLessThanOrEqual(2);
    };
    const tids = await boxes.evaluateAll((l) => l.map((e) => (e as HTMLElement).dataset.tid ?? ''));
    const byText = async (t: string) => (await dockThreads(page).filter({ hasText: t }).getAttribute('data-tid')) ?? '';
    const wide = await byText('左上の広い範囲');
    const sq = await byText('四角のまわり');
    expect(new Set(tids)).toEqual(new Set([wide, sq]));
    const R_WIDE = { x: 100 / 1600, y: 80 / 600, w: 400 / 1600, h: 220 / 600 };
    const R_SQ = { x: 1190 / 1600, y: 290 / 600, w: 60 / 1600, h: 50 / 600 };
    await expectAt(R_WIDE, wide);
    await expectAt(R_SQ, sq);
    // ズーム（ボタン・キー）・移動に追従する
    await page.keyboard.press('+');
    await page.keyboard.press('+');
    expect(await pct(page)).toBeGreaterThan(80);
    await expectAt(R_WIDE, wide);
    await expectAt(R_SQ, sq);
    await page.mouse.move(600, 500);
    await page.mouse.down();
    await page.mouse.move(520, 470, { steps: 5 });
    await page.mouse.up();
    await expectAt(R_WIDE, wide);
    await expectAt(R_SQ, sq);
    await page.keyboard.press('0');
    await expectAt(R_SQ, sq);
    // 押すと、ドックの、そのスレッドが選ばれる（カードに active）
    await page.locator(`#lightbox .fv-box[data-tid="${sq}"]`).click();
    await expect(dockThreads(page).filter({ hasText: '四角のまわり' })).toHaveClass(/active/);
    await expect(page.locator(`#lightbox .fv-box[data-tid="${sq}"]`)).toHaveClass(/active/);
    await page.locator(`#lightbox .fv-box[data-tid="${wide}"]`).click();
    await expect(dockThreads(page).filter({ hasText: '左上の広い範囲' })).toHaveClass(/active/);
    await expect(lbx(page)).toBeVisible(); // 枠を押しても、閉じない
    // 閉じて、開き直す：同じ
    await page.keyboard.press('Escape');
    await expect(lbx(page)).toBeHidden();
    await artImg(page).click();
    await stageReady(page);
    await expect(page.locator('#lightbox .fv-box:not(.pending)')).toHaveCount(2);
    await expectAt(R_SQ, sq);
  });
});

// ============================================================================
test.describe('個別表示：html-app の枠', () => {
  test('枠は、新しい iframe（同じ隔離）。本文の枠は、動かない・状態は、引き継がない。「要素を選ぶ」→ 枠の中の要素を押す → ドックに、情報の行（個別表示の枠の状態が添う）。送信後のカードにも、同じ行', async ({
    page,
    app,
  }) => {
    const u = ui(page);
    await open(page, app);
    // 本文の枠の状態を変える（スライダー 55）。個別表示は、これを、引き継がない
    const body = page.frameLocator('#article iframe.appframe');
    await page.waitForTimeout(1200);
    await body.locator('#r').fill('55');
    await expect(body.locator('#v')).toHaveText('55');
    await appCap(page).getByRole('button', { name: '個別表示', exact: true }).click();
    await expect(lbx(page)).toBeVisible();
    await expect(page.locator('#lightbox iframe.appframe')).toHaveCount(1);
    const f = focusFrame(page);
    await expect(f.locator('#v')).toHaveText('20'); // 新しい iframe：初期の状態
    // 隔離：sandbox は allow-scripts だけ・allow は空
    const attrs = await page.locator('#lightbox iframe.appframe').evaluate((e) => ({
      sandbox: e.getAttribute('sandbox'),
      allow: e.getAttribute('allow'),
      src: e.getAttribute('src'),
    }));
    expect(attrs.sandbox).toBe('allow-scripts');
    expect(attrs.allow).toBe('');
    expect(attrs.src).toMatch(/^\/appframe\/fv\/root\/1\/0\?mode=(light|dark)$/);
    // 本文の枠は、そのまま（再読み込みされていない：状態が残っている）
    await expect(body.locator('#v')).toHaveText('55');
    // 利用できる幅いっぱい（本文の枠より、広い）
    const fb = await box(page.locator('#lightbox iframe.appframe'));
    expect(fb.width).toBeGreaterThan(700);
    // 個別表示の枠で、スライダーを動かす → 状態（rikai.state）
    await f.locator('#r').fill('70');
    await page.waitForTimeout(700);
    // 要素を選ぶ（ステージの道具）→ 枠の中のボタンを押す
    const pick = page.locator('#lightbox button[data-pick]');
    await pick.click();
    await expect(pick).toHaveAttribute('aria-pressed', 'true');
    await clickUntilPicked(f.locator('#go'), dockComposer(page));
    await expect(dockComposer(page)).toBeVisible();
    await expect(lbx(page)).toBeVisible();
    await expect(dockComposer(page)).toHaveAttribute('data-from-frame', '');
    await expect(dockComposer(page).locator('.quote')).toHaveText('枠から：button');
    expect(await dockComposer(page).locator('textarea').inputValue()).toBe(''); // 入力欄は、空
    const row = dockComposer(page).locator('.framemeta'); // ドックの入力欄の上に、情報の行
    await expect(row.locator('.fm-sum')).toContainText('要素を選びました（button・x:');
    await row.locator('.fm-toggle').click();
    await expect(row.locator('.fm-body')).toContainText('button#go');
    const st = JSON.parse((await row.locator('.fm-body pre').textContent()) ?? 'null');
    expect(st).toMatchObject({ slider: 70 }); // 個別表示の枠の状態（本文の枠の 55 ではない）
    // 書いて、閉じる → パネルに下書き（情報の行つき）が残る → 追加 → Submit → 錨は、本文の、元の枠
    await dockComposer(page).locator('textarea').fill('このボタンを、もっと目立たせたい');
    await page.keyboard.press('Escape');
    await expect(lbx(page)).toBeHidden();
    await expect(u.composer).toBeVisible();
    await expect(u.composer).toHaveAttribute('data-from-frame', '');
    await expect(u.composer.locator('.fm-sum')).toContainText('要素を選びました');
    await expect(appCap(page).getByRole('button', { name: '個別表示', exact: true })).toBeFocused(); // 開いた所に、戻る
    await u.composer.getByRole('button', { name: 'コメントを追加' }).click();
    await expect(u.threads).toHaveCount(1);
    await submitAll(page);
    const round = await app.nextRound();
    const item = round.items[0];
    expect(item.anchor.label).toBe('枠から：button');
    await expect(page.locator('#article .htmlapp.blk-thread')).toHaveCount(1); // 錨は、本文の、元の枠（ブロック）
    await expect(ui(page).bno).toHaveText(['1']);
    expect(item.new[0].text).toBe('このボタンを、もっと目立たせたい'); // 本文は、利用者の言葉だけ
    expect(JSON.parse(item.new[0].frameMeta.state)).toMatchObject({ slider: 70 });
    expect(item.new[0].frameMeta.pick).toMatchObject({ selector: 'button#go', tag: 'button', text: 'ボタン' });
  });

  test('枠の画像：範囲を選ぶ → 枠の範囲が画像になる（赤い帯が写る）。ドックの入力欄に付く・印が付く。幅の切り替え（縮小表示）でも、位置が合う。既存の範囲の枠が、縮小表示に追従する', async ({
    page,
    app,
  }) => {
    await open(page, app);
    await page.waitForTimeout(1200);
    await appCap(page).getByRole('button', { name: '個別表示', exact: true }).click();
    await expect(lbx(page)).toBeVisible();
    await page.waitForTimeout(1500);
    const fr = page.locator('#lightbox iframe.appframe');
    await regionTool(page).click();
    const b0 = await box(fr);
    // 赤い帯（枠の上 100px）を含む範囲
    await dragBox(page, { x: b0.x + 20, y: b0.y + 10 }, { x: b0.x + 420, y: b0.y + 160 });
    await expect(dockComposer(page)).toBeVisible();
    await expect(lbx(page)).toBeVisible();
    const thumb = dockComposer(page).locator('.thumb img');
    await expect(thumb).toHaveCount(1, { timeout: 15_000 });
    await expect(thumb).toHaveJSProperty('complete', true);
    const dim = await thumb.evaluate((i: HTMLImageElement) => ({ w: i.naturalWidth, h: i.naturalHeight }));
    expect(Math.abs(dim.w - 400 * 2)).toBeLessThanOrEqual(4); // 画面の 2 倍
    expect(Math.abs(dim.h - 150 * 2)).toBeLessThanOrEqual(4);
    const top = await thumbPixel(thumb, 0.5, 0.2); // 赤い帯（枠の上 100px のうち、選んだ 10〜100px）
    expect(top[0]).toBeGreaterThan(190);
    expect(top[1]).toBeLessThan(80);
    const below = await thumbPixel(thumb, 0.8, 0.9); // 帯の下（白い地）
    expect(below[1]).toBeGreaterThan(200);
    await expect(dockComposer(page).locator('.quote')).toContainText('枠の画像は、枠自身が作ったもの');
    expect(await dockComposer(page).locator('textarea').inputValue()).toBe(''); // 本文には、書かない
    await expect(dockComposer(page).locator('.framemeta .fromframe')).toBeVisible();
    await expect(dockComposer(page).locator('.fm-sum')).toHaveText('枠の画像は、枠自身が作ったもの');
    await dockComposer(page).locator('textarea').fill('この帯の色が気になる');
    await dockComposer(page).getByRole('button', { name: 'コメントを追加' }).click();
    await expect(dockThreads(page)).toHaveCount(1);
    await expect(dockThreads(page).first().locator('.framemeta .fm-sum')).toHaveText('枠の画像は、枠自身が作ったもの'); // ドックのカードにも、情報の行（外すは、ない）
    await expect(dockThreads(page).first().getByRole('button', { name: '外す' })).toHaveCount(0);
    // ステージに、範囲の枠が重なる。枠の画像の上での位置は、選んだとおり
    const rb = page.locator('#lightbox .fv-box:not(.pending)');
    await expect(rb).toHaveCount(1);
    const expectFrac = async () => {
      const f = await box(fr);
      const r = await box(rb);
      expect(Math.abs((r.x - f.x) / f.width - 20 / b0.width)).toBeLessThan(0.01);
      expect(Math.abs((r.y - f.y) / f.height - 10 / b0.height)).toBeLessThan(0.02);
      expect(Math.abs(r.width / f.width - 400 / b0.width)).toBeLessThan(0.01);
      expect(Math.abs(r.height / f.height - 150 / b0.height)).toBeLessThan(0.02);
    };
    await expectFrac();
    // 幅の切り替え：375（そのまま）・1280・1920（縮小表示：50% で止まって、横にスクロール）でも、枠の見た目の割合は、同じ
    for (const w of ['375', '1280', '1920', 'auto']) {
      await page.locator(`#lightbox button[data-width="${w}"]`).click();
      await page.waitForTimeout(250);
      const f = await box(fr);
      const r = await box(rb);
      // 枠の中に収まる
      expect(r.x).toBeGreaterThanOrEqual(f.x - 2);
      expect(r.x + r.width).toBeLessThanOrEqual(f.x + f.width + 2);
      if (w !== 'auto') expect(Math.abs(r.width / f.width - 400 / b0.width)).toBeLessThan(0.02);
    }
    // 押すと、ドックのカードが選ばれる
    await rb.click();
    await expect(dockThreads(page).first()).toHaveClass(/active/);
  });

  test('枠の状態の添付：「この枠にコメント」（ドック）に、個別表示の枠の状態が添う。状態を呼ばなければ、添えない', async ({
    page,
    app,
  }) => {
    await open(page, app);
    await page.waitForTimeout(1200);
    await appCap(page).getByRole('button', { name: '個別表示', exact: true }).click();
    await page.waitForTimeout(1500);
    await focusFrame(page).locator('#r').fill('33');
    await page.waitForTimeout(700);
    await dock(page).getByRole('button', { name: 'この枠にコメント' }).click();
    await expect(dockComposer(page)).toBeVisible();
    expect(await dockComposer(page).locator('textarea').inputValue()).toBe(''); // 状態は、本文に書かない
    const row = dockComposer(page).locator('.framemeta'); // ドックの入力欄の上に、情報の行
    await expect(row.locator('.fm-sum')).toHaveText('枠の状態');
    await row.locator('.fm-toggle').click();
    expect(JSON.parse((await row.locator('.fm-body pre').textContent()) ?? 'null')).toMatchObject({ slider: 33 });
  });
});

test.describe('個別表示：日本語の変換中（IME）', () => {
  test('変換中（isComposing・keyCode 229）の Esc は、閉じない・道具を止めない。変換中の Ctrl+Enter は、送信しない。ドックの入力欄・パネルの入力欄とも', async ({
    page,
    app,
  }) => {
    const u = ui(page);
    await open(page, app);
    await artMm(page).scrollIntoViewIfNeeded();
    await artMm(page).click();
    await stageReady(page);
    await dock(page).getByRole('button', { name: 'この対象全体にコメント' }).click();
    const area = dockComposer(page).locator('textarea');
    await area.fill('へんかんちゅう');
    await regionTool(page).click();
    const fire = (sel: string) =>
      page.evaluate((s) => {
        const ta = document.querySelector(s) as HTMLElement;
        const mk = (init: KeyboardEventInit) =>
          new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
        ta.dispatchEvent(mk({ key: 'Escape', isComposing: true }));
        ta.dispatchEvent(mk({ key: 'Escape', keyCode: 229 }));
        ta.dispatchEvent(mk({ key: 'Enter', ctrlKey: true, isComposing: true }));
        ta.dispatchEvent(mk({ key: 'Enter', metaKey: true, keyCode: 229 }));
      }, sel);
    await fire('#lightbox textarea[data-key="composer"]');
    await expect(lbx(page)).toBeVisible();
    await expect(regionTool(page)).toHaveAttribute('aria-pressed', 'true'); // 道具も、止まらない
    await expect(dockComposer(page)).toBeVisible();
    await expect(u.threads).toHaveCount(0); // 送信されていない
    await page.keyboard.press('Escape'); // 変換が終われば、ふつうに：道具の中止 → 閉じる
    await expect(regionTool(page)).toHaveAttribute('aria-pressed', 'false');
    await page.keyboard.press('Escape');
    await expect(lbx(page)).toBeHidden();
    // パネルの入力欄（同じ下書き）：変換中の Ctrl+Enter は、送信しない
    await expect(u.composer.locator('textarea')).toHaveValue('へんかんちゅう');
    await fire('#threads textarea[data-key="composer"]');
    await page.waitForTimeout(300);
    await expect(u.threads).toHaveCount(0);
    await expect(u.composer).toBeVisible();
  });
});

test.describe('個別表示：枠の中の Esc', () => {
  test('枠の中にフォーカスがあっても、Esc が親に届く：道具（範囲選択）の中止 → もう一度で、閉じる。要素選択の Esc は、1 回で、選択だけ中止（二重にならない）。本文の枠の Esc は、何もしない', async ({
    page,
    app,
  }) => {
    await open(page, app);
    await page.waitForTimeout(1200);
    // 本文の枠の中の Esc：何も起きない（個別表示でないとき）
    await page.frameLocator('#article iframe.appframe').locator('#go').click();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await expect(lbx(page)).toBeHidden();
    await appCap(page).getByRole('button', { name: '個別表示', exact: true }).click();
    await page.waitForTimeout(1500);
    const f = focusFrame(page);
    // 枠の中にフォーカス（ボタンを押す）→ 範囲を選ぶ道具 → 枠の中で Esc
    await regionTool(page).click();
    await regionTool(page).click(); // いったん、やめる（枠を押せるように）
    await f.locator('#go').click();
    await regionTool(page).click();
    await expect(regionTool(page)).toHaveAttribute('aria-pressed', 'true');
    await f.locator('#go').focus();
    await page.keyboard.press('Escape');
    await expect(regionTool(page)).toHaveAttribute('aria-pressed', 'false'); // 1 回目：道具の中止
    await expect(lbx(page)).toBeVisible();
    await page.waitForTimeout(250); // 橋は、150ms に 1 回までしか、転送しない
    await f.locator('#go').focus();
    await page.keyboard.press('Escape');
    await expect(lbx(page)).toBeHidden(); // 2 回目：閉じる
    // 要素選択：枠の中の Esc は、橋が処理して pick-cancel：1 回で、選択だけやめる（閉じない）
    await appCap(page).getByRole('button', { name: '個別表示', exact: true }).click();
    await page.waitForTimeout(1500);
    await page.locator('#lightbox button[data-pick]').click();
    await expect(page.locator('#lightbox button[data-pick]')).toHaveAttribute('aria-pressed', 'true');
    await f
      .locator('#go')
      .focus()
      .catch(() => {});
    await page.keyboard.press('Escape');
    await expect(page.locator('#lightbox button[data-pick]')).toHaveAttribute('aria-pressed', 'false');
    await page.waitForTimeout(500);
    await expect(lbx(page)).toBeVisible(); // 閉じていない（二重に処理されない）
    await page.keyboard.press('Escape');
    await expect(lbx(page)).toBeHidden();
  });

  test('Esc の転送は、偽装できない：兄弟の枠・本文の枠が送る偽の esc は、個別表示を閉じない。形の不正（余分なキー）・洪水も、効かない', async ({
    page,
    app,
  }) => {
    const FLOOD = lines(
      `${BT}html-app height=100`,
      '<p>洪水の枠</p>',
      "<script>setInterval(function(){for(var i=0;i<50;i++){parent.postMessage({__rikai:1,type:'esc'},'*');}},50);</script>",
      BT,
    );
    await app.switchTopic(page, 'fv-esc', 'Esc', `# 題\n\n${FLOOD}\n${APP()}\n後の段落です。\n`);
    await page.waitForTimeout(1800);
    await appCap(page).nth(1).getByRole('button', { name: '個別表示', exact: true }).click();
    await page.waitForTimeout(2500); // 洪水が続く
    await expect(lbx(page)).toBeVisible();
    await expect(page.locator('#lightbox iframe.appframe')).toHaveCount(1);
  });
});

test.describe('個別表示：html-app の幅の注記・ラベル・古い基準の枠', () => {
  const note = (page: Page) => page.locator('#lightbox .fv-widthnote');

  test('幅の既定は、本文の枠の、いまの幅。本文の枠と幅が違うときだけ、注記。範囲の錨のラベルに、選んだときの枠の幅（px）', async ({
    page,
    app,
  }) => {
    await open(page, app);
    await page.waitForTimeout(1200);
    // 本文の枠が「自動」：個別表示も「自動」（ステージの幅いっぱい）。本文より広いので、注記
    await appCap(page).getByRole('button', { name: '個別表示', exact: true }).click();
    await page.waitForTimeout(1200);
    await expect(page.locator('#lightbox button[data-width="auto"]')).toHaveAttribute('aria-pressed', 'true');
    const bodyW = await page.locator('#article iframe.appframe').evaluate((e) => (e as HTMLIFrameElement).offsetWidth);
    await expect(note(page)).toHaveText(`本文の枠と幅が違います（本文 ${bodyW}px）`);
    // 範囲：ラベルに、枠の幅
    await regionTool(page).click();
    const f = page.locator('#lightbox iframe.appframe');
    const fw = await f.evaluate((e) => (e as HTMLIFrameElement).offsetWidth);
    const b = await box(f);
    await dragBox(page, { x: b.x + 20, y: b.y + 10 }, { x: b.x + 300, y: b.y + 120 });
    await expect(dockComposer(page)).toBeVisible();
    await expect(dockComposer(page).locator('.thumb img')).toHaveCount(1, { timeout: 15_000 });
    await dockComposer(page).locator('textarea').fill('幅のラベル');
    await dockComposer(page).getByRole('button', { name: 'コメントを追加' }).click();
    await expect(dockThreads(page)).toHaveCount(1);
    await page.keyboard.press('Escape');
    await submitAll(page);
    const label: string = (await app.nextRound()).items[0].anchor.label;
    expect(label).toContain(`（枠の幅 ${fw}px で選択）`);
    expect(label.length).toBeLessThanOrEqual(120);
    expect(label.startsWith('範囲：')).toBe(true);
    // 本文の枠を 1280 に：個別表示も、1280 で開く（同じ幅：注記なし）。幅を変えると、注記
    await appCap(page).locator('button[data-width="1280"]').click();
    await appCap(page).getByRole('button', { name: '個別表示', exact: true }).click();
    await page.waitForTimeout(1200);
    await expect(page.locator('#lightbox button[data-width="1280"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(note(page)).toHaveCount(0);
    await page.locator('#lightbox button[data-width="375"]').click();
    await expect(note(page)).toContainText('本文の枠と幅が違います（本文 1280px）');
    await page.locator('#lightbox button[data-width="1280"]').click();
    await expect(note(page)).toHaveCount(0);
  });

  test('古い基準（見出しのアイコン 15px）で保存された html-app の範囲：枠は、基準の周りに収める（本文の高さを伸ばさない・巨大な枠を作らない）。個別表示でも。完全に外へ出るものは、描かない', async ({
    page,
    app,
  }) => {
    await open(page, app);
    await page.waitForTimeout(1200);
    const info = await page.evaluate(() => {
      const b = document.querySelector('#article .htmlapp') as HTMLElement;
      return { id: b.dataset.bid, hash: b.dataset.bhash };
    });
    const h0 = await ui(page).docscroll.evaluate((e) => e.scrollHeight);
    const post = async (rect: object, text: string) => {
      const r = await page.request.post(`${app.origin}/api/comment`, {
        headers: { Origin: app.origin },
        data: {
          topic: 'fv',
          page: 'root',
          version: 1,
          anchor: {
            blockId: info.id,
            blockHash: info.hash,
            blockTag: 'DIV',
            blockText: 'html-app',
            quote: '',
            prefix: '',
            suffix: '',
            label: '範囲：実行できる枠',
            rect,
          },
          text,
          images: [],
        },
      });
      expect(r.status()).toBe(200);
    };
    await post({ x: 0.5, y: 0.5, w: 40, h: 8 }, '旧基準 1'); // はみ出す
    await post({ x: 26, y: 10, w: 13, h: 7 }, '旧基準 2'); // 外へ出きっている
    await expect(ui(page).threads).toHaveCount(2);
    await expect(ui(page).bno).toHaveCount(2);
    await page.waitForTimeout(500);
    const ap = await box(page.locator('#article .htmlapp .appview'));
    const boxes = placed(page);
    await expect(boxes).toHaveCount(1); // 2 つ目は、描かない
    const rb = await box(boxes);
    expect(rb.height).toBeLessThanOrEqual(ap.height * 1.5 + 4); // 基準の周り（1.5 倍まで）
    // 本文の高さは、基準の周り（1.5 倍）の分だけ。収めないと、幅 40・高さ 8（基準の 8 倍）で、数千 px 伸びる
    expect(await ui(page).docscroll.evaluate((e) => e.scrollHeight)).toBeLessThanOrEqual(h0 + ap.height * 1.5 + 8);
    // 個別表示
    await appCap(page).getByRole('button', { name: '個別表示', exact: true }).click();
    await page.waitForTimeout(1500);
    const f = await box(page.locator('#lightbox iframe.appframe'));
    const fb = page.locator('#lightbox .fv-box:not(.pending)');
    await expect(fb).toHaveCount(1);
    const fbb = await box(fb);
    expect(fbb.width).toBeLessThanOrEqual(f.width * 3 + 4);
    expect(fbb.height).toBeLessThanOrEqual(f.height * 3 + 4);
  });
});

test.describe('個別表示：枠が応答しないとき', () => {
  test('枠が応答しない（snapshot-req で、固まる）：範囲を選んでも、2 秒で、箱の画像に戻る。コメントは作れる（枠の画像の印は付かない）', async ({
    page,
    app,
  }) => {
    const silent = lines(
      `${BT}html-app height=200`,
      '<style>body{margin:0}.band{background:#e11d48;height:100px}</style><div class="band"></div>',
      "<script>window.addEventListener('message', function (e) { if (e.data && e.data.type === 'snapshot-req') { var t = Date.now(); while (Date.now() - t < 3500) {} } });</script>",
      BT,
    );
    await app.switchTopic(page, 'fv-silent', '無言', `# 題\n\n前の段落です。\n\n${silent}\n後の段落です。\n`);
    await page.waitForTimeout(1500);
    await appCap(page).getByRole('button', { name: '個別表示', exact: true }).click();
    await expect(lbx(page)).toBeVisible();
    await page.waitForTimeout(1500);
    await regionTool(page).click();
    const b = await box(page.locator('#lightbox iframe.appframe'));
    const t0 = Date.now();
    await dragBox(page, { x: b.x + 20, y: b.y + 10 }, { x: b.x + 420, y: b.y + 160 });
    const thumb = dockComposer(page).locator('.thumb img');
    await expect(thumb).toHaveCount(1, { timeout: 15_000 });
    await expect(thumb).toHaveJSProperty('complete', true);
    expect(Date.now() - t0).toBeGreaterThan(1800); // 2 秒待った
    // 帯（赤）は写らない：箱の画像（点線の枠・文字）
    const red = await thumbPixel(thumb, 0.5, 0.2);
    expect(red[0] > 190 && red[1] < 80).toBe(false);
    await expect(dockComposer(page).locator('.quote')).not.toContainText('枠の画像は、枠自身が作ったもの');
    await expect(dockComposer(page).locator('textarea')).toHaveValue('');
    await expect(lbx(page)).toBeVisible(); // 個別表示は、固まらない（開いたまま）
  });
});

// ============================================================================
// html-app の範囲の基準：枠の置き場（`.appview`）。以前は、見出しのツールバーの、最初のアイコン（15px）だった（F25 の不具合。F43 で直した）
test.describe('html-app の範囲の基準（枠の置き場）', () => {
  const appview = (page: Page) => page.locator('#article .htmlapp .appview');
  const frameBox = (page: Page) => box(page.locator('#article iframe.appframe'));
  const placed = (page: Page) => ui(page).badges.locator('.regionbox:not(.pending)');

  /** 本文で、範囲（画面の座標）を選び、コメントを追加し、Submit して、AI に届いた region を返す */
  async function commentRegion(
    page: Page,
    app: RikaiApp,
    from: { x: number; y: number },
    to: { x: number; y: number },
  ) {
    const u = ui(page);
    await u.regbtn.click();
    await dragBox(page, from, to);
    await expect(u.composer).toBeVisible();
    await expect(u.composer.locator('.thumb img')).toHaveCount(1, { timeout: 15_000 });
    await u.composer.locator('textarea').fill('この辺りの余白');
    await u.composer.getByRole('button', { name: 'コメントを追加' }).click();
    await expect(u.threads).toHaveCount(1);
    await submitAll(page);
    return (await app.nextRound()).items[0];
  }

  const near = (a: number, b: number, tol = 0.004) => Math.abs(a - b) < tol;

  for (const width of ['auto', '1280'] as const) {
    test(`本文：枠の上で範囲を選ぶ（幅 ${width}）→ 錨の region は、枠の置き場に対する割合。範囲の枠は、選んだ位置に重なる`, async ({
      page,
      app,
    }) => {
      await open(page, app);
      await page.waitForTimeout(1200);
      if (width !== 'auto') await appCap(page).locator(`button[data-width="${width}"]`).click();
      await page.waitForTimeout(300);
      await page.locator('#article .htmlapp').scrollIntoViewIfNeeded();
      const ap = await box(appview(page));
      const fr = await frameBox(page);
      const from = { x: fr.x + 100, y: fr.y + 20 };
      const to = { x: fr.x + 300, y: fr.y + 120 };
      const item = await commentRegion(page, app, from, to);
      const r = item.anchor.region;
      // 基準は、枠の置き場（本文の幅の箱）：見出しのアイコン（15px）ではない（アイコン基準なら、幅・高さが、10 を超える）
      expect(near(r.x, (from.x - ap.x) / ap.width), `x ${r.x}`).toBe(true);
      expect(near(r.y, (from.y - ap.y) / ap.height), `y ${r.y}`).toBe(true);
      expect(near(r.w, 200 / ap.width), `w ${r.w}`).toBe(true);
      expect(near(r.h, 100 / ap.height), `h ${r.h}`).toBe(true);
      expect(r.w).toBeLessThan(1.5);
      expect(item.anchor.label).toMatch(/^範囲：/);
      // 既存の範囲の枠（コメント済み）：選んだ位置に重なる
      const rb = await box(placed(page));
      expect(Math.abs(rb.x - from.x)).toBeLessThanOrEqual(3);
      expect(Math.abs(rb.y - from.y)).toBeLessThanOrEqual(3);
      expect(Math.abs(rb.width - 200)).toBeLessThanOrEqual(3);
      expect(Math.abs(rb.height - 100)).toBeLessThanOrEqual(3);
      // 個別表示でも、同じ位置（枠の割合）に重なる
      await appCap(page).getByRole('button', { name: '個別表示', exact: true }).click();
      await expect(page.locator('#lightbox iframe.appframe')).toHaveCount(1);
      const f = await box(page.locator('#lightbox iframe.appframe'));
      const fb = await box(page.locator('#lightbox .fv-box:not(.pending)'));
      expect(near((fb.x - f.x) / f.width, (from.x - fr.x) / fr.width, 0.01)).toBe(true);
      expect(near((fb.y - f.y) / f.height, (from.y - fr.y) / fr.height, 0.02)).toBe(true);
      expect(near(fb.width / f.width, 200 / fr.width, 0.01)).toBe(true);
    });
  }

  test('個別表示：枠の上で範囲を選ぶ → 錨の region は、本文の枠の置き場に対する、同じ相対位置（幅の切り替え 1280 でも）', async ({
    page,
    app,
  }) => {
    await open(page, app);
    await page.waitForTimeout(1200);
    await page.locator('#article .htmlapp').scrollIntoViewIfNeeded();
    const ap = await box(appview(page));
    const fr = await frameBox(page);
    await appCap(page).getByRole('button', { name: '個別表示', exact: true }).click();
    await page.waitForTimeout(1500);
    await page.locator('#lightbox button[data-width="1280"]').click();
    await page.waitForTimeout(300);
    const f = await box(page.locator('#lightbox iframe.appframe'));
    await regionTool(page).click();
    await dragBox(
      page,
      { x: f.x + f.width * 0.1, y: f.y + f.height * 0.1 },
      { x: f.x + f.width * 0.4, y: f.y + f.height * 0.5 },
    );
    await expect(dockComposer(page)).toBeVisible();
    await expect(dockComposer(page).locator('.thumb img')).toHaveCount(1, { timeout: 15_000 });
    await dockComposer(page).locator('textarea').fill('個別表示から');
    await dockComposer(page).getByRole('button', { name: 'コメントを追加' }).click();
    await expect(dockThreads(page)).toHaveCount(1);
    await page.keyboard.press('Escape');
    await submitAll(page);
    const r = (await app.nextRound()).items[0].anchor.region;
    // 割合（枠に対して 10%・10%・30%・40%）を、本文の枠（fr）に写し、本文の置き場（ap）に対する割合にしたもの
    expect(near(r.x, (fr.x + fr.width * 0.1 - ap.x) / ap.width)).toBe(true);
    expect(near(r.y, (fr.y + fr.height * 0.1 - ap.y) / ap.height)).toBe(true);
    expect(near(r.w, (fr.width * 0.3) / ap.width)).toBe(true);
    expect(near(r.h, (fr.height * 0.4) / ap.height)).toBe(true);
    // 本文の、範囲の枠も、本文の枠の同じ割合の位置
    const rb = await box(placed(page));
    expect(near((rb.x - fr.x) / fr.width, 0.1, 0.01)).toBe(true);
    expect(near(rb.width / fr.width, 0.3, 0.01)).toBe(true);
  });
});

// ============================================================================
test.describe('個別表示：生の <img>（ブロックそのものが画像）', () => {
  const RAW = `# 生の画像\n\n前の段落です。\n\n<img src="assets/sq.png" width="800" height="600" alt="生の緑">\n\n後の段落です。\n`;
  const rawImg = (page: Page) => page.locator('#article > img');

  test('クリック・Enter で開く（F37 から後退しない）。範囲を選ぶと、画像の同じ内容の位置に、錨・本文の枠が付く（width/height 属性で表示の縦横比が変わっても）', async ({
    page,
    app,
  }) => {
    const u = ui(page);
    await page.setViewportSize({ width: 1360, height: 900 });
    await app.switchTopic(page, 'fv-raw', '生の画像', RAW, ASSETS);
    await expect(rawImg(page)).toHaveCount(1);
    await expect.poll(() => rawImg(page).evaluate((i) => (i as HTMLImageElement).complete)).toBe(true);
    await expect(rawImg(page)).toHaveClass(/blk/); // <img> そのものが、ブロック
    // クリック
    await rawImg(page).scrollIntoViewIfNeeded();
    await rawImg(page).click();
    await expect(lbx(page)).toBeVisible();
    await page.waitForTimeout(600); // すぐ閉じない（対象が見つかる）
    await expect(lbx(page)).toBeVisible();
    await expect(dock(page)).toBeVisible();
    await expect(dock(page).locator('.fv-dock-target')).toHaveText('画像: 生の緑');
    await page.keyboard.press('Escape');
    await expect(lbx(page)).toBeHidden();
    await expect(rawImg(page)).toBeFocused();
    // Enter
    await page.keyboard.press('Enter');
    await expect(lbx(page)).toBeVisible();
    await stageReady(page);
    // 範囲：画像の (1208,306)〜(1232,324)（緑の四角の内側）
    await regionTool(page).click();
    const s0 = await box(stage(page));
    const c = imgAt(s0, 1600)(1220, 315);
    await wheelZoomTo(page, 400, c.x, c.y);
    const s1 = await box(stage(page));
    const at = imgAt(s1, 1600);
    await dragBox(page, at(1208, 306), at(1232, 324));
    await expect(dockComposer(page)).toBeVisible();
    await expect(dockComposer(page).locator('.thumb img')).toHaveCount(1);
    await dockComposer(page).locator('textarea').fill('生の画像の四角');
    await dockComposer(page).getByRole('button', { name: 'コメントを追加' }).click();
    await expect(dockThreads(page)).toHaveCount(1);
    await expect(page.locator('#lightbox .fv-box:not(.pending)')).toHaveCount(1); // 開いたまま、範囲の枠が重なる
    await page.keyboard.press('Escape');
    // 本文：範囲の枠は、画像の同じ内容（緑の四角）の上
    const ib = await box(rawImg(page));
    const rb = await box(placed(page));
    expect(Math.abs((rb.x + rb.width / 2 - ib.x) / ib.width - 1220 / 1600)).toBeLessThan(0.01);
    expect(Math.abs((rb.y + rb.height / 2 - ib.y) / ib.height - 315 / 600)).toBeLessThan(0.01);
    await submitAll(page);
    const item = (await app.nextRound()).items[0];
    expect(Math.abs(item.anchor.region.x - 1208 / 1600)).toBeLessThan(0.0015);
    expect(Math.abs(item.anchor.region.y - 306 / 600)).toBeLessThan(0.0015);
    expect(item.anchor.label).toBe('画像: 生の緑の一部');
    const png = decodePng(fs.readFileSync(item.new[0].images[0] as string));
    expect(greenShare(png)).toBeGreaterThan(0.97);
    void u;
  });
});

function placed(page: Page) {
  return ui(page).badges.locator('.regionbox:not(.pending)');
}

// ============================================================================
test.describe('個別表示：キーボード・フォーカス・Esc', () => {
  test('入口がキーボードで届く：Tab で図・画像・枠の「個別表示」にフォーカス → Enter で開く → Tab は窓の外へ出ない → Esc で閉じると、開いた所に戻る', async ({
    page,
    app,
  }) => {
    await open(page, app);
    const entries = page.locator('#article [data-focus-entry]');
    await expect(entries).toHaveCount(3); // 画像・Mermaid のブロック・インラインの svg
    for (const e of await entries.all()) {
      await expect(e).toHaveAttribute('tabindex', '0');
      await expect(e).toHaveAttribute('role', 'button');
    }
    await expect(entries.first()).toHaveAccessibleName(/個別表示/);
    // 本文の先頭から Tab を送って、最初の入口（画像）に着く
    await page.locator('#btn-theme').focus();
    let reached = '';
    for (let i = 0; i < 80 && !reached; i++) {
      await page.keyboard.press('Tab');
      reached = await page.evaluate(() => {
        const a = document.activeElement;
        return a?.hasAttribute('data-focus-entry') ? (a.tagName === 'IMG' ? 'img' : a.className) : '';
      });
    }
    expect(reached).toBe('img');
    await page.keyboard.press('Enter');
    await expect(lbx(page)).toBeVisible();
    await expect(lbx(page)).toBeFocused();
    await stageReady(page); // 画像の読み込みが終わるまで、「範囲を選ぶ」は、使えない（Tab で、飛ばされる）
    await expect(regionTool(page)).toBeEnabled();
    await expect(page.locator('#doc')).toHaveAttribute('inert', ''); // 窓の後ろは、キーボード・マウスが届かない
    await expect(page.locator('#threads')).toHaveAttribute('inert', '');
    // Tab・Shift+Tab は、窓の中だけ（ドックの入力欄・ボタンを含む）
    const seen = new Set<string>();
    for (let i = 0; i < 24; i++) {
      await page.keyboard.press(i < 14 ? 'Tab' : 'Shift+Tab');
      const info = await page.evaluate(() => {
        const a = document.activeElement as HTMLElement | null;
        return {
          inside: !!a?.closest('#lightbox'),
          name: a?.getAttribute('aria-label') ?? a?.textContent?.trim() ?? '',
        };
      });
      expect(info.inside).toBe(true);
      seen.add(info.name);
    }
    expect([...seen].some((n) => n.includes('範囲を選ぶ'))).toBe(true);
    expect([...seen].some((n) => n.includes('この対象全体にコメント'))).toBe(true);
    expect(seen.has('閉じる')).toBe(true);
    await page.keyboard.press('Escape');
    await expect(lbx(page)).toBeHidden();
    await expect(page.locator('#doc')).not.toHaveAttribute('inert', '');
    await expect(artImg(page)).toBeFocused();
    // キー（Space）でも開く。Mermaid のブロック
    await page.locator('#article .mermaid-block').focus();
    await page.keyboard.press('Space');
    await expect(lbx(page).locator('.lb-stage svg')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(page.locator('#article .mermaid-block')).toBeFocused();
    // html-app：見出しの「個別表示」にフォーカスして、Enter
    const btn = appCap(page).getByRole('button', { name: '個別表示', exact: true });
    await btn.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#lightbox iframe.appframe')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(lbx(page)).toBeHidden();
    await expect(btn).toBeFocused();
  });

  test('入口のバーの「拡大」は、マウスで画像・図・html-app の枠のブロックに出て、押すと個別表示になる（閉じたら、本文の入口にフォーカスが戻る）', async ({
    page,
    app,
  }) => {
    await open(page, app);
    const hover = async (loc: Locator) => {
      await loc.scrollIntoViewIfNeeded();
      const r = await loc.boundingBox();
      if (!r) throw new Error('box');
      await page.mouse.move(2, 2);
      await expect(ui(page).actbar).toBeHidden();
      await page.mouse.move(r.x + Math.min(r.width / 2, 120), r.y + Math.min(r.height / 2, 24), { steps: 3 });
      await expect(ui(page).actbar).toBeVisible();
    };
    await hover(page.locator('#article .htmlapp .cap'));
    await expect(page.locator('#act-zoom')).toBeVisible();
    await page.locator('#act-zoom').click();
    await expect(page.locator('#lightbox iframe.appframe')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(lbx(page)).toBeHidden();
    // ボタンが消えていても（バーは、押すと隠れる）、本文の、その枠の入口にフォーカスが戻る
    await expect(appCap(page).getByRole('button', { name: '個別表示', exact: true })).toBeFocused();
  });

  test('Esc の順序：道具（範囲選択）の中止 → 入力欄の下書きは触らない → もう一度で、個別表示を閉じる。書きかけは、パネルに残る', async ({
    page,
    app,
  }) => {
    const u = ui(page);
    await open(page, app);
    await artMm(page).scrollIntoViewIfNeeded();
    await artMm(page).click();
    await stageReady(page);
    await dock(page).getByRole('button', { name: 'この対象全体にコメント' }).click();
    await expect(dockComposer(page)).toBeVisible();
    await dockComposer(page).locator('textarea').fill('書きかけの下書き');
    await regionTool(page).click();
    await expect(regionTool(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#lightbox .fv-sel')).toBeVisible();
    await page.keyboard.press('Escape'); // 1 回目：道具の中止だけ
    await expect(regionTool(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#lightbox .fv-sel')).toHaveCount(0);
    await expect(lbx(page)).toBeVisible();
    await expect(dockComposer(page).locator('textarea')).toHaveValue('書きかけの下書き'); // 下書きは、触らない
    await page.keyboard.press('Escape'); // 2 回目：閉じる（入力欄のフォーカスの中でも）
    await expect(lbx(page)).toBeHidden();
    await expect(u.composer.locator('textarea')).toHaveValue('書きかけの下書き'); // パネルに、残る
    // 範囲選択の最中に、ドラッグしている間の Esc も、道具の中止
    await artMm(page).click();
    await stageReady(page);
    await regionTool(page).click();
    const s = await box(stage(page));
    await page.mouse.move(s.x + 30, s.y + 30);
    await page.mouse.down();
    await page.mouse.move(s.x + 90, s.y + 80, { steps: 4 });
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await expect(lbx(page)).toBeVisible();
    await expect(regionTool(page)).toHaveAttribute('aria-pressed', 'false');
  });

  test('数字・記号キーは、入力欄では、文字として打てる（＋ − 0 は、ズームに化けない）', async ({ page, app }) => {
    await open(page, app);
    await artMm(page).click();
    await stageReady(page);
    await dock(page).getByRole('button', { name: 'この対象全体にコメント' }).click();
    const before = await pct(page);
    await dockComposer(page).locator('textarea').focus();
    await page.keyboard.type('+-0 100%');
    await expect(dockComposer(page).locator('textarea')).toHaveValue('+-0 100%');
    expect(await pct(page)).toBe(before);
  });
});

// ============================================================================
test.describe('個別表示：本文の更新・窓の大きさ・外観', () => {
  test('開いたまま、AI の返信・新しい版が届いても、壊れない：返信がドックに出る・範囲の枠は残る。対象が消える版では、閉じて、知らせる（下書きは、パネルに残る）', async ({
    page,
    app,
  }) => {
    const u = ui(page);
    await open(page, app);
    await artImg(page).click();
    await stageReady(page);
    await regionTool(page).click();
    const s = await box(stage(page));
    await dragBox(page, imgAt(s, 1600)(1190, 290), imgAt(s, 1600)(1250, 340));
    await dockComposer(page).locator('textarea').fill('この四角は、何ですか');
    await dockComposer(page).getByRole('button', { name: 'コメントを追加' }).click();
    await expect(dockThreads(page)).toHaveCount(1);
    await expect(page.locator('#lightbox .fv-box')).toHaveCount(1);
    // 未送信の数
    await expect(dock(page).locator('.fv-unsent')).toHaveText('未送信 1 件');
    // 書きかけも、1 つ、作っておく
    await dock(page).getByRole('button', { name: 'この対象全体にコメント' }).click();
    await dockComposer(page).locator('textarea').fill('もう 1 つの書きかけ');
    // Submit は、画面のバー：窓の後ろ。個別表示を閉じてから。開き直す
    await page.keyboard.press('Escape');
    await expect(lbx(page)).toBeHidden();
    await u.composer.getByRole('button', { name: 'やめる' }).click();
    await submitAll(page);
    const round = await app.nextRound();
    await artImg(page).click();
    await stageReady(page);
    await expect(dockThreads(page)).toHaveCount(1);
    // 返信が届く（個別表示は、開いたまま）
    await app.apply({
      round: round.round,
      replies: [{ thread: round.items[0].thread, body: '緑の四角は、目印です。' }],
    });
    await expect(dockThreads(page).first()).toContainText('緑の四角は、目印です。');
    await expect(lbx(page)).toBeVisible();
    await expect(page.locator('#lightbox .fv-box')).toHaveCount(1);
    // 新しい版（画像のブロックは、そのまま）：開いたまま
    const r2 = await (async () => {
      await dockThreads(page).first().locator('textarea').fill('追加の質問');
      await dockThreads(page).first().getByRole('button', { name: '追加', exact: true }).click();
      await page.keyboard.press('Escape');
      await expect(lbx(page)).toBeHidden();
      await submitAll(page);
      return app.nextRound();
    })();
    await artImg(page).click();
    await stageReady(page);
    await app.apply({
      round: r2.round,
      revisions: [{ page: 'root', markdown: `${DOC('増えた段落です。\n\n')}` }],
      replies: [{ thread: r2.items[0].thread, body: '資料を直しました。' }],
    });
    await expect(page.locator('#docbar select')).toHaveValue('2');
    await expect(lbx(page)).toBeVisible(); // 壊れない
    await expect(dockThreads(page)).toHaveCount(1);
    await expect(page.locator('#lightbox .fv-box')).toHaveCount(1); // 範囲の枠は、新しい版の本文に、位置づけ直されて、残る
    await expect(stage(page).locator('img')).toHaveAttribute('src', /sq\.png/);
    // 対象（画像）が消える版
    await app.apply({ revisions: [{ page: 'root', markdown: '# 個別表示の確認\n\n画像を、消しました。\n' }] });
    await expect(lbx(page)).toBeHidden();
    await expect(u.toast).toContainText('個別表示の対象が見つからなくなった');
  });

  test('窓が 760px 未満：ドックは、下からのシート・ステージが使える（範囲を選べる）。700px・420px。はみ出さない', async ({
    page,
    app,
  }) => {
    await open(page, app);
    for (const w of [700, 420]) {
      await page.setViewportSize({ width: w, height: 800 });
      await artImg(page).scrollIntoViewIfNeeded();
      await artImg(page).click();
      await stageReady(page);
      const d = await box(dock(page));
      const v = await box(page.locator('#lightbox .lb-view'));
      expect(d.width, `${w}px：シートの幅`).toBeGreaterThanOrEqual(w - 2);
      expect(d.y, `${w}px：シートは、ステージの下`).toBeGreaterThanOrEqual(v.y + v.height - 2);
      expect(d.y + d.height).toBeLessThanOrEqual(800 + 1);
      expect(v.height, `${w}px：ステージの高さ`).toBeGreaterThan(250);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(w);
      // ステージで、範囲を選べる
      await regionTool(page).click();
      const s = await box(stage(page));
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.x + s.width).toBeLessThanOrEqual(w + 1);
      await dragBox(
        page,
        { x: s.x + s.width * 0.3, y: s.y + s.height * 0.3 },
        { x: s.x + s.width * 0.6, y: s.y + s.height * 0.7 },
      );
      await expect(dockComposer(page)).toBeVisible();
      await expect(dockComposer(page).locator('textarea')).toBeVisible();
      const c = await box(dockComposer(page).locator('textarea'));
      expect(c.y + c.height).toBeLessThanOrEqual(800 + 1);
      await dockComposer(page).getByRole('button', { name: 'やめる' }).click();
      // 道具・拡大の道具が、窓からはみ出さない
      for (const sel of ['.fv-tools', '.lb-tools']) {
        const t = await box(page.locator(`#lightbox ${sel}`));
        expect(t.x).toBeGreaterThanOrEqual(0);
        expect(t.x + t.width).toBeLessThanOrEqual(w + 1);
      }
      await page.keyboard.press('Escape');
      await expect(lbx(page)).toBeHidden();
    }
    // html-app も、420px で、道具が折り返して、はみ出さない
    await appCap(page).getByRole('button', { name: '個別表示', exact: true }).click();
    await expect(page.locator('#lightbox iframe.appframe')).toHaveCount(1);
    for (const sel of ['.fv-tools', '.lb-tools']) {
      const t = await box(page.locator(`#lightbox ${sel}`));
      expect(t.x).toBeGreaterThanOrEqual(0);
      expect(t.x + t.width).toBeLessThanOrEqual(420 + 1);
    }
  });

  test('ライト・ダーク：ドックの文字・札が読める（AA）。ステージの道具・範囲の枠・番号が見える', async ({
    page,
    app,
  }) => {
    await open(page, app);
    // 色は、`rgb()`・`color(srgb …)`（color-mix の結果。0〜1）のどちらでも、読む
    const lum = (c: string) => {
      const n = (c.match(/[\d.]+(?:e-?\d+)?/g) ?? []).slice(0, 3).map(Number);
      if (n.length < 3 || n.some((v) => Number.isNaN(v))) throw new Error(`色を読めません：${c}`);
      const unit = c.startsWith('color(') ? 1 : 255;
      const f = (v: number) => (v / unit <= 0.03928 ? v / unit / 12.92 : ((v / unit + 0.055) / 1.055) ** 2.4);
      const [r, g, b] = n as [number, number, number];
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const contrast = async (loc: Locator) => {
      const c = await loc.evaluate((e) => {
        let bg = '';
        for (let el: Element | null = e; el && !bg; el = el.parentElement) {
          const v = getComputedStyle(el).backgroundColor;
          if (v && v !== 'rgba(0, 0, 0, 0)' && v !== 'transparent') bg = v;
        }
        return { ink: getComputedStyle(e).color, bg };
      });
      const [a, b] = [lum(c.ink), lum(c.bg)];
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    };
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await artImg(page).scrollIntoViewIfNeeded();
      await artImg(page).click();
      await stageReady(page);
      if (scheme === 'light') {
        await regionTool(page).click();
        const s = await box(stage(page));
        await dragBox(page, imgAt(s, 1600)(1190, 290), imgAt(s, 1600)(1250, 340));
        await dockComposer(page).locator('textarea').fill('色の確認');
        await dockComposer(page).getByRole('button', { name: 'コメントを追加' }).click();
      }
      await expect(dockThreads(page)).toHaveCount(1);
      await expect(page.locator('#lightbox .fv-box:not(.pending)')).toHaveCount(1);
      for (const loc of [
        dock(page).locator('.fv-dock-t'),
        dock(page).locator('.fv-dock-target'),
        dock(page).locator('.fv-unsent'),
        dockThreads(page).first().locator('.quote'),
        dockThreads(page).first().locator('.msg .body').first(),
      ])
        expect(await contrast(loc), `${scheme}：ドックの文字`).toBeGreaterThanOrEqual(4.5);
      const b = await box(page.locator('#lightbox .fv-box:not(.pending)'));
      expect(b.width).toBeGreaterThan(10);
      const tools = await regionTool(page).evaluate((e) => ({
        ink: getComputedStyle(e).color,
        bg: getComputedStyle(e.parentElement as Element).backgroundColor,
      }));
      expect(lum(tools.bg)).toBeLessThan(0.05);
      expect(lum(tools.ink)).toBeGreaterThan(0.9);
      await page.keyboard.press('Escape');
      await expect(lbx(page)).toBeHidden();
    }
  });
});

// ============================================================================
test.describe('個別表示：安全', () => {
  const GREEN_PNG =
    "(function(){var c=document.createElement('canvas');c.width=20;c.height=20;var g=c.getContext('2d');g.fillStyle='#16a34a';g.fillRect(0,0,20,20);return c.toDataURL('image/png');})()";
  // 1 つ目：攻撃する枠（なりすまし・洪水）。2 つ目：本物の（赤い帯のある）枠
  const ATTACKER = lines(
    `${BT}html-app height=140`,
    '<p id="a">攻撃する枠</p>',
    '<script>',
    `var green = ${GREEN_PNG};`,
    "var XSS = { __rikai: 1, type: 'pick', selector: 'a[href=\"javascript:alert(1)\"]', tag: 'a', text: '<img src=x onerror=window.__xss=1>', rect: { x: 1, y: 2, w: 3, h: 4 }, styles: { color: '<' + '/script><b>' }, frame: { w: 10, h: 10 } };",
    'var n = 0;',
    'setInterval(function () {',
    '  for (var i = 0; i < 200; i++) {',
    '    parent.postMessage(XSS, "*");',
    "    parent.postMessage({ __rikai: 1, type: 'state', json: '{\"evil\":' + (n++) + '}' }, '*');",
    "    parent.postMessage({ __rikai: 1, type: 'snapshot', id: 's' + (i + 1), png: green }, '*');",
    '  }',
    // 兄弟の枠（本物の枠・個別表示の枠も含む）へのなりすまし
    '  for (var k = 0; k < parent.frames.length; k++) { if (parent.frames[k] !== window) { try { parent.frames[k].postMessage({ __rikai: 1, type: "pick-start" }, "*"); parent.frames[k].postMessage({ __rikai: 1, type: "snapshot-req", id: "s1" }, "*"); } catch (e) {} } }',
    '}, 150);',
    '</script>',
    BT,
  );

  test('攻撃する兄弟の枠・本文の枠が、偽の pick・state・snapshot を送っても、個別表示の枠・下書きに効かない（個別表示の枠の画像・状態・下書きは、本物の枠のものだけ）', async ({
    page,
    app,
  }) => {
    await app.switchTopic(
      page,
      'fv-atk',
      '攻撃',
      `# 題\n\n${ATTACKER}\n中の段落です。\n\n${APP('本物')}\n後の段落です。\n`,
    );
    await page.waitForTimeout(1800);
    await expect(ui(page).composer).toHaveCount(0);
    // 本物の枠（2 つ目）を、個別表示で開く
    await appCap(page).nth(1).getByRole('button', { name: '個別表示', exact: true }).click();
    await expect(lbx(page)).toBeVisible();
    await page.waitForTimeout(1800); // 攻撃は、続いている
    await expect(dockComposer(page)).toHaveCount(0); // 勝手に、下書きは、できない
    await expect(page.locator('#lightbox button[data-pick]')).toHaveAttribute('aria-pressed', 'false'); // 勝手に、選択モードにならない
    // 範囲：本物の枠の画像（赤い帯）。攻撃する枠の偽の画像（緑）ではない
    await regionTool(page).click();
    const fr = page.locator('#lightbox iframe.appframe');
    const b = await box(fr);
    await dragBox(page, { x: b.x + 20, y: b.y + 10 }, { x: b.x + 420, y: b.y + 160 });
    const thumb = dockComposer(page).locator('.thumb img');
    await expect(thumb).toHaveCount(1, { timeout: 15_000 });
    await expect(thumb).toHaveJSProperty('complete', true);
    const top = await thumbPixel(thumb, 0.5, 0.2);
    expect(top[0]).toBeGreaterThan(190);
    expect(top[1]).toBeLessThan(80);
    await dockComposer(page).getByRole('button', { name: 'やめる' }).click();
    // 状態：攻撃する枠の状態（evil）は、入らない。本物の枠の状態（slider）だけ
    await focusFrame(page).locator('#r').fill('44');
    await page.waitForTimeout(800);
    await dock(page).getByRole('button', { name: 'この枠にコメント' }).click();
    expect(await dockComposer(page).locator('textarea').inputValue()).toBe(''); // 状態は、本文に書かない
    const row = dockComposer(page).locator('.framemeta');
    await row.locator('.fm-toggle').click();
    const shown = (await row.locator('.fm-body pre').textContent()) ?? '';
    expect(shown).toContain('"slider": 44');
    expect(shown).not.toContain('evil');
    // 錨は、本物の枠（2 つ目）のブロック：ソースに「本物」が入っている
    await dockComposer(page).locator('textarea').fill('本物の枠の状態');
    await dockComposer(page).getByRole('button', { name: 'コメントを追加' }).click();
    await expect(dockThreads(page)).toHaveCount(1);
    await page.keyboard.press('Escape');
    await submitAll(page);
    const r = await app.nextRound();
    expect(r.items[0].anchor.label).toBe('実行できる枠');
    expect(r.items[0].new[0].text).toBe('本物の枠の状態');
    expect(JSON.parse(r.items[0].new[0].frameMeta.state)).toMatchObject({ slider: 44 }); // 攻撃する枠の状態は、入らない
    await expect(page.locator('#article .htmlapp.blk-thread')).toHaveCount(1);
    await expect(page.locator('#article .htmlapp').nth(1)).toHaveClass(/blk-thread/); // 錨は、本物の枠（2 つ目）のブロック
    await expect(page.locator('#article .htmlapp').nth(0)).not.toHaveClass(/blk-thread/);
    expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
    // 洪水は、続いていた（親は、固まらない）
    const t0 = Date.now();
    await page.evaluate(() => new Promise((res) => requestAnimationFrame(() => res(0))));
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  test('個別表示を 50 回、開閉しても、iframe・リスナー・ノードが増えない（閉じたら、枠を破棄して、橋の登録簿から外す）。複数の個別表示は、同時に開かない', async ({
    page,
    app,
  }) => {
    test.setTimeout(180_000);
    await open(page, app);
    await page.waitForTimeout(1000);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    const metric = async () => {
      await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
      const { metrics } = await cdp.send('Performance.getMetrics');
      const get = (n: string) => metrics.find((m) => m.name === n)?.value ?? 0;
      return {
        listeners: get('JSEventListeners'),
        nodes: get('Nodes'),
        frames: await page.evaluate(() => document.querySelectorAll('iframe').length),
      };
    };
    const cycle = async () => {
      await appCap(page).getByRole('button', { name: '個別表示', exact: true }).click();
      await expect(page.locator('#lightbox iframe.appframe')).toHaveCount(1);
      await page.keyboard.press('Escape');
      await expect(lbx(page)).toBeHidden();
      await expect(page.locator('#lightbox iframe')).toHaveCount(0); // 枠は、破棄されている
    };
    for (let i = 0; i < 5; i++) await cycle();
    const base = await metric();
    for (let i = 0; i < 50; i++) await cycle();
    // 閉じた直後は、破棄した枠・複製が、GC・保留中のタイマーで、まだ残っていることがある（負荷が高いと長引く）：落ち着くまで、測り直す。本物の漏れは、待っても残るので、落ちる
    await expect
      .poll(
        async () => {
          const m = await metric();
          return { frames: m.frames, listeners: m.listeners - base.listeners <= 10, nodes: m.nodes - base.nodes <= 60 };
        },
        { timeout: 20_000 },
      )
      .toEqual({ frames: 1, listeners: true, nodes: true }); // 枠は、本文の枠だけ
    // 図でも、同じ（複製した svg の、DOM が残らない）。最初の数回は、初回の確保（ウォームアップ）
    const mm = async (n: number) => {
      for (let i = 0; i < n; i++) {
        await artMm(page).click();
        await expect(lbx(page)).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(lbx(page)).toBeHidden();
      }
    };
    await mm(4);
    const warm = await metric();
    await mm(20);
    await expect
      .poll(
        async () => {
          const m = await metric();
          return { listeners: m.listeners - warm.listeners <= 10, nodes: m.nodes - warm.nodes <= 60 };
        },
        { timeout: 20_000 },
      )
      .toEqual({ listeners: true, nodes: true });
    // 個別表示が開いている間は、後ろの本文（枠の見出しのボタン）を押せない：2 つ目は、開かない
    await appCap(page).getByRole('button', { name: '個別表示', exact: true }).click();
    await expect(page.locator('#lightbox iframe.appframe')).toHaveCount(1);
    await appCap(page)
      .getByRole('button', { name: '個別表示', exact: true })
      .click({ timeout: 1500, force: true })
      .catch(() => {});
    await expect(page.locator('iframe.appframe')).toHaveCount(2); // 本文の枠 ＋ 個別表示の枠（2 つ目は、できない）
  });

  test('下書きは、自動で送られない：個別表示で作った下書き（要素・範囲の画像）を、Submit するまで、AI に届かない', async ({
    page,
    app,
  }) => {
    await open(page, app);
    await page.waitForTimeout(1200);
    await appCap(page).getByRole('button', { name: '個別表示', exact: true }).click();
    await page.waitForTimeout(1500);
    await page.locator('#lightbox button[data-pick]').click();
    await clickUntilPicked(focusFrame(page).locator('#go'), dockComposer(page));
    await expect(dockComposer(page)).toBeVisible();
    await page.waitForTimeout(800);
    expect((await app.pull()).status).not.toBe('feedback');
    await expect(ui(page).threads).toHaveCount(0);
  });
});
