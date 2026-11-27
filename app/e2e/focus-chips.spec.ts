// 拡大表示の番号の丸：画像・図（.fv-box > .fv-no）と html-app（.fv-chip。ステージの中・枠の外）で、同じ大きさ・同じ位置の規則（0.1.7）。
// 規則：枠の左上の外側（左 −2px・上 −22px。縁の分で、枠の外側の角から −0.5px・−20.5px）。上に余地（24px）がないときだけ、内側（3.5px・3.5px）。丸は、直径 18px・文字 11px。
// 以前は、html-app だけ、丸が、いつも枠の内側（小さな要素の中身を隠す）だった（`.top` が、固定で付いていた）。実際の Chrome。資料・コメントは、作り物。
import type { Page } from '@playwright/test';
import { BT, drawioBlock, HOTEL } from './drawio-samples';
import { expect, type RikaiApp, test } from './fixtures';
import { makePng } from './samples';
import { box, dragBox } from './ui';

const SLUG = 'fc';
const APP = `${BT}html-app height=300\n<style>body{margin:0;font:16px sans-serif}</style>\n<div style="padding:10px"><button id="go">ボタン</button> <input id="t" value="x"></div>\n${BT}`;
const DOC = `# 丸\n\n![色](assets/p.png)\n\n${drawioBlock(HOTEL)}\n\n${APP}\n`;
type Rect = { x: number; y: number; w: number; h: number };

async function open(page: Page, app: RikaiApp, width = 1360, height = 900) {
  await page.setViewportSize({ width, height });
  await app.switchTopic(page, SLUG, '丸', DOC, { 'p.png': makePng(600, 300) });
  await expect.poll(() => page.locator('#article img').evaluate((i) => (i as HTMLImageElement).complete)).toBe(true);
  await expect(page.locator('#article .drawio-block svg')).toHaveCount(1);
  await expect(page.locator('#article iframe.appframe')).toHaveCount(1);
  await page.waitForTimeout(1200);
}

async function post(page: Page, app: RikaiApp, sel: string, rect: Rect, text: string) {
  const info = await page.evaluate((s) => {
    const b = document.querySelector(s) as HTMLElement;
    return { id: b.dataset.bid, hash: b.dataset.bhash, tag: b.tagName };
  }, sel);
  const r = await page.request.post(`${app.origin}/api/comment`, {
    headers: { Origin: app.origin },
    data: {
      topic: SLUG,
      page: 'root',
      version: 1,
      anchor: {
        blockId: info.id,
        blockHash: info.hash,
        blockTag: info.tag,
        blockText: 'x',
        quote: '',
        prefix: '',
        suffix: '',
        label: '範囲',
        rect,
      },
      text,
      images: [],
    },
  });
  expect(r.status()).toBe(200);
}

const KIND = {
  img: { block: '#article p.blk:has(img), #article .blk:has(> img)', open: '#article img' },
  svg: { block: '#article .drawio-block', open: '#article .drawio-block svg' },
  app: { block: '#article .htmlapp', open: '' },
} as const;
type Kind = keyof typeof KIND;

/**
 * 拡大表示を開く。**押す要素は、本文の描き直しで、作り直される**（コメントが届く・図を描き直す：同じ内容でも、要素は別物になる）：スクロールした直後に外れる（`not attached`）ことがある。
 * 開けるまで、押し直す（開いていれば、押さない）。人の操作の速さでは、起きない
 */
async function openZoom(page: Page, kind: Kind) {
  const lb = page.locator('#lightbox');
  await expect(async () => {
    if (await lb.isHidden()) {
      if (kind === 'app') {
        const b = page.locator('#article .htmlapp .cap').getByRole('button', { name: '拡大表示', exact: true });
        await b.scrollIntoViewIfNeeded({ timeout: 2000 });
        await b.click({ timeout: 2000 });
      } else {
        const e = page.locator(KIND[kind].open).first();
        await e.scrollIntoViewIfNeeded({ timeout: 2000 });
        await e.click({ timeout: 2000 });
      }
    }
    await expect(page.locator('#lightbox .fv-dock')).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20_000 });
  if (kind === 'app') {
    await expect(page.locator('#lightbox iframe.appframe')).toHaveCount(1);
    await page.waitForTimeout(1600);
  } else {
    await expect.poll(async () => (await box(page.locator('#lightbox .lb-stage'))).width).toBeGreaterThan(50);
    await page.waitForTimeout(500);
  }
}

interface Chip {
  tid: string;
  cls: string;
  w: number;
  h: number;
  fs: string;
  bg: string;
  /** 枠の外側の角（border-box の左上）からの、丸の左上のずれ（px） */
  dx: number;
  dy: number;
}

/** 拡大表示の、番号の丸すべて（画像・図：`.fv-box > .fv-no`／html-app：`.fv-chip`）の、大きさ・文字・色・枠の左上からのずれ */
const chips = (page: Page): Promise<Chip[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('#lightbox .fv-no, #lightbox .fv-chip')].map((n) => {
      const isChip = n.classList.contains('fv-chip');
      const boxes = [...document.querySelectorAll<HTMLElement>('#lightbox .fv-box')];
      const b = isChip
        ? boxes[[...document.querySelectorAll('#lightbox .fv-chip')].indexOf(n)]
        : (n.closest('.fv-box') as HTMLElement);
      const [r, br, cs] = [n.getBoundingClientRect(), (b as HTMLElement).getBoundingClientRect(), getComputedStyle(n)];
      return {
        tid: (b as HTMLElement).dataset.tid as string,
        cls: n.className,
        w: r.width,
        h: r.height,
        fs: cs.fontSize,
        bg: cs.backgroundColor,
        dx: r.left - br.left,
        dy: r.top - br.top,
      };
    }),
  );

const near = (a: number, b: number) => expect(Math.abs(a - b), `${a} と ${b}`).toBeLessThanOrEqual(1);

test.describe('拡大表示の番号の丸：画像・図・html-app で同じ', () => {
  test('ズーム 1 倍：枠の左上の外側に、同じ大きさ（18px・11px）・同じ位置。html-app も、枠の中に入らない', async ({
    page,
    app,
  }) => {
    await open(page, app);
    const R: Rect = { x: 0.3, y: 0.4, w: 0.3, h: 0.3 };
    for (const k of ['img', 'svg', 'app'] as const) await post(page, app, KIND[k].block, R, k);
    const got: Record<string, Chip> = {};
    for (const k of ['img', 'svg', 'app'] as const) {
      await openZoom(page, k);
      await expect.poll(async () => (await chips(page)).length, k).toBe(1); // 描き終えるまで、待つ
      const c = await chips(page);
      got[k] = c[0] as Chip;
      await page.keyboard.press('Escape');
      await expect(page.locator('#lightbox')).toBeHidden();
    }
    for (const k of ['img', 'svg', 'app']) {
      const c = got[k] as Chip;
      near(c.w, 18);
      near(c.h, 18);
      expect(c.fs).toBe('11px');
      near(c.dx, -0.5); // 左上の外側
      near(c.dy, -20.5);
    }
    expect(new Set(Object.values(got).map((c) => c.bg)).size).toBe(1); // 同じ色
    expect(got.app?.cls).toContain('fv-chip');
  });

  test('上に余地がないとき（上端の枠）：3 種類とも、内側（3.5px・3.5px）に入る。大きさは同じ', async ({
    page,
    app,
  }) => {
    await open(page, app);
    const R: Rect = { x: 0.3, y: 0, w: 0.3, h: 0.3 };
    for (const k of ['img', 'svg', 'app'] as const) await post(page, app, KIND[k].block, R, k);
    for (const k of ['img', 'svg', 'app'] as const) {
      await openZoom(page, k);
      if (k !== 'app') for (let i = 0; i < 5; i++) await page.keyboard.press('+'); // 拡大：枠の上端が、窓の外へ。丸は、内側
      await page.waitForTimeout(300);
      const c = (await chips(page))[0] as Chip;
      near(c.w, 18);
      near(c.h, 18);
      expect(c.fs).toBe('11px');
      near(c.dx, 3.5);
      near(c.dy, 3.5);
      await page.keyboard.press('Escape');
      await expect(page.locator('#lightbox')).toBeHidden();
    }
  });

  test('html-app：幅の切り替え（375・768・1280）・縮小表示でも、丸は同じ大きさ・同じ位置。入力中（新）・解決済みも、同じ規則', async ({
    page,
    app,
  }) => {
    await open(page, app);
    await post(page, app, KIND.app.block, { x: 0.3, y: 0.4, w: 0.3, h: 0.3 }, 'app');
    await openZoom(page, 'app');
    for (const w of ['375', '768', '1280', '1920']) {
      await page.locator(`#lightbox button[data-width="${w}"]`).click();
      await page.waitForTimeout(500);
      const c = (await chips(page))[0] as Chip;
      near(c.w, 18);
      near(c.h, 18);
      expect(c.fs).toBe('11px');
      near(c.dx, -0.5);
      near(c.dy, -20.5);
    }
    // 入力中：範囲を選ぶ → 「新」の丸（同じ規則）
    await page.locator('#lightbox .fv-tools [data-tool="region"]').click();
    const ib = await box(page.locator('#lightbox iframe.appframe'));
    await dragBox(page, { x: ib.x + 40, y: ib.y + 120 }, { x: ib.x + 200, y: ib.y + 220 });
    await expect(page.locator('#lightbox .fv-dock .thread.composer')).toBeVisible();
    await page.waitForTimeout(800);
    const all = await chips(page);
    const pend = all.find((c) => c.cls.includes('pending')) as Chip;
    expect(pend).toBeDefined();
    near(pend.h, 18);
    expect(pend.w).toBeGreaterThanOrEqual(18); // 「新」は、全角：幅は、画像・図の「新」と同じ（min-width 18px・左右の余白 5px）
    near(pend.dx, -0.5);
    near(pend.dy, -20.5);
    // 入力中の丸の色（アクセントの濃い色）は、CSS の同じ規則（.fv-no・.fv-chip の .pending）：e2e では、大きさと位置だけ見る
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
  });

  test('ダーク・狭い窓（800px）：丸は、同じ大きさ・同じ位置', async ({ page, app }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await open(page, app, 800, 900);
    const R: Rect = { x: 0.3, y: 0.4, w: 0.3, h: 0.3 };
    for (const k of ['img', 'app'] as const) await post(page, app, KIND[k].block, R, k);
    if (await page.locator('#btn-side[aria-expanded="true"]').count()) await page.locator('#btn-side').click();
    const bgs: string[] = [];
    for (const k of ['img', 'app'] as const) {
      await openZoom(page, k);
      const c = (await chips(page))[0] as Chip;
      near(c.w, 18);
      near(c.h, 18);
      expect(c.fs).toBe('11px');
      near(c.dx, -0.5);
      near(c.dy, -20.5);
      bgs.push(c.bg);
      await page.keyboard.press('Escape');
      await expect(page.locator('#lightbox')).toBeHidden();
    }
    expect(bgs[0]).toBe(bgs[1]);
  });

  test('枠の外の丸は、切り取られない（ステージの中・枠の置き場の外）。ステージをスクロールしても、枠に付いてくる', async ({
    page,
    app,
  }) => {
    await open(page, app, 1360, 380); // 低い窓：ステージが、縦にスクロールする
    await post(page, app, KIND.app.block, { x: 0.3, y: 0.7, w: 0.3, h: 0.3 }, 'app');
    await openZoom(page, 'app');
    const chip = page.locator('#lightbox .fv-chip');
    await expect(chip).toHaveCount(1);
    const stage = page.locator('#lightbox .fv-appstage');
    expect(
      await chip.evaluate(
        (e, s) => (e.parentElement?.parentElement as Element) === document.querySelector(s),
        '#lightbox .fv-appstage',
      ),
    ).toBe(true);
    const d0 = await chips(page);
    await stage.evaluate((e) => {
      e.scrollTop = 40;
    });
    await page.waitForTimeout(400);
    const d1 = await chips(page);
    near((d1[0] as Chip).dx, (d0[0] as Chip).dx); // スクロールしても、枠との位置関係は、同じ
    near((d1[0] as Chip).dy, (d0[0] as Chip).dy);
  });

  test('コメントの印を隠している間は、html-app の丸も出ない（入力中を除く）', async ({ page, app }) => {
    await open(page, app);
    await post(page, app, KIND.app.block, { x: 0.3, y: 0.4, w: 0.3, h: 0.3 }, 'app');
    await openZoom(page, 'app');
    await expect(page.locator('#lightbox .fv-chip')).toHaveCount(1);
    await page.locator('#lightbox .fv-marks-toggle').click();
    await expect(page.locator('#lightbox .fv-chip')).toHaveCount(0);
    await page.locator('#lightbox .fv-marks-toggle').click();
    await expect(page.locator('#lightbox .fv-chip')).toHaveCount(1);
  });
});
