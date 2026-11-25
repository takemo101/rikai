// コメントの印を隠す（0.1.6 の「範囲の枠を隠す」→ 0.1.7 で、すべての印へ）：html-app の枠に、範囲のコメントの枠が重なると、枠の中のボタン・入力欄に、操作が届かない箇所がある（拡大表示の .fv-box・入力中の枠）。
// 「コメントの印を隠す」（右のパネルの見出し・拡大表示のドックの見出し）で、本文の .regionbox・番号の丸・拡大表示の .fv-box と、その線を、DOM に置かない。実際の Chrome・本物のマウス・キー・ホイール。資料・コメントは、作り物。
// 印の種類ごとの、見えない確認（文の強調・ブロックの外枠・番号・線）は、hide-marks.spec.ts。後半：html-app の見出しの注意（隔離・秘密を入力しない）は、見える文字にしない。title・aria-label に持つ。旧い版が保存した、範囲の名前の注意は、表示から除く。
import type { Page } from '@playwright/test';
import { expect, type RikaiApp, test } from './fixtures';
import { makePng } from './samples';
import { box, dragBox, ui } from './ui';

const BT = '```';
const APP = `${BT}html-app height=360
<style>body{margin:0;font:16px sans-serif}.row{padding:8px}#sc{height:60px;width:200px;overflow:auto;border:1px solid #888}#sc div{height:300px}</style>
<div class="row"><button id="go">ボタン</button> <span id="n">0</span> <input id="t" type="text" value=""> <input id="r" type="range" min="0" max="100" value="20"> <span id="v">20</span></div>
<div class="row"><div id="sc"><div>長い内容</div></div> <span id="s">0</span></div>
<script>
var n=0;document.getElementById('go').addEventListener('click',function(){n++;document.getElementById('n').textContent=n});
var r=document.getElementById('r');r.addEventListener('input',function(){document.getElementById('v').textContent=r.value});
document.getElementById('sc').addEventListener('scroll',function(){document.getElementById('s').textContent=Math.round(this.scrollTop)});
</script>
${BT}`;
const DOC = `# 枠の確認\n\n前の段落です。\n\n![色見本](assets/p.png)\n\n${APP}\n\n後の段落です。\n`;
const SLUG = 'hb';
type Rect = { x: number; y: number; w: number; h: number };
/** 枠の置き場に対する比率。ボタン・文字欄・スライダー・スクロールの箱に、重なる */
const RECTS: Rect[] = [
  { x: 0.0, y: 0.0, w: 0.5, h: 0.3 },
  { x: 0.4, y: 0.0, w: 0.6, h: 0.3 },
  { x: 0.0, y: 0.25, w: 0.6, h: 0.3 },
];
const IMG_RECT: Rect = { x: 0.1, y: 0.1, w: 0.4, h: 0.4 };
const NOTICE = '隔離されています。パスワードなどの秘密は、入力しないでください';

async function open(page: Page, app: RikaiApp, width = 1360, height = 900) {
  await page.setViewportSize({ width, height });
  await app.switchTopic(page, SLUG, '枠の確認', DOC, { 'p.png': makePng(600, 300) });
  await expect.poll(() => page.locator('#article img').evaluate((i) => (i as HTMLImageElement).complete)).toBe(true);
  await expect(page.locator('#article iframe.appframe')).toHaveCount(1);
  await page.waitForTimeout(1200); // 枠の中の読み込み・自動の高さが、落ち着くまで
}

/** 本文の、画像・枠のブロックに、範囲のコメントを付ける（HTTP の /api/comment：本物の画面の入力と同じ経路）。label は、旧い版の名前を試すために変えられる */
async function comment(page: Page, app: RikaiApp, sel: string, rects: Rect[], label = '範囲') {
  const info = await page.evaluate((s) => {
    const b = document.querySelector(s) as HTMLElement;
    return { id: b.dataset.bid, hash: b.dataset.bhash, tag: b.tagName };
  }, sel);
  for (const [i, rect] of rects.entries()) {
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
          label,
          rect,
        },
        text: `範囲 ${i + 1}`,
        images: [],
      },
    });
    expect(r.status()).toBe(200);
  }
}

const APP_BLOCK = '#article .htmlapp';
const IMG_BLOCK = '#article p.blk:has(img), #article .blk:has(> img)';
const bodyBoxes = (page: Page) => page.locator('#badges .regionbox');
const bodyLines = (page: Page) => page.locator('#links path[data-tid]');
const fvBoxes = (page: Page) => page.locator('#lightbox .fv-box');
const fvLines = (page: Page) => page.locator('svg.fv-links path[data-tid]');
const regionsToggle = (page: Page) => page.locator('#marks-toggle');
const dockToggle = (page: Page) => page.locator('#lightbox .fv-marks-toggle');

interface Probe {
  /** 枠の中の要素の中心で、最前面の要素（iframe であれば、操作が、枠の中へ届く） */
  tops: Record<string, string | null>;
  goClicks: number;
  typed: string;
  slider: string;
  scrolled: number;
}

/** 枠の中の、ボタン・文字欄・スライダー・スクロールの箱を、本物のマウス・キー・ホイールで操作して、届いたかを返す（押す前に、最前面の要素も測る） */
async function probe(page: Page, frameSel: string): Promise<Probe> {
  const f = page.frameLocator(frameSel);
  const center = async (id: string) => {
    const b = await box(f.locator(id));
    return { x: b.x + b.width / 2, y: b.y + b.height / 2, b };
  };
  const tops: Probe['tops'] = {};
  for (const id of ['#go', '#t', '#r', '#sc']) {
    const c = await center(id);
    tops[id] = await page.evaluate(
      ([x, y]) => {
        const e = document.elementFromPoint(x as number, y as number);
        return e ? e.tagName : null;
      },
      [c.x, c.y],
    );
  }
  // ボタン：押して、数が増える（枠の中のハンドラーが付く前は、増えないので、増えるまで、押し直す）
  const go = await center('#go');
  await expect(async () => {
    await page.mouse.click(go.x, go.y);
    expect(Number(await f.locator('#n').textContent({ timeout: 1000 }))).toBeGreaterThanOrEqual(1);
  }).toPass({ timeout: 15_000 });
  const goClicks = Number(await f.locator('#n').textContent());
  // 文字欄：押して、打つ
  const t = await center('#t');
  await page.mouse.click(t.x, t.y);
  await page.keyboard.type('abc');
  const typed = await f.locator('#t').inputValue();
  // スライダー：右寄りの位置を押す
  const r = await center('#r');
  await page.mouse.click(r.b.x + r.b.width * 0.8, r.y);
  const slider = (await f.locator('#v').textContent()) ?? '';
  // ホイール：スクロールの箱が、動く
  const s = await center('#sc');
  await page.mouse.move(s.x, s.y);
  await page.mouse.wheel(0, 100);
  await expect.poll(async () => Number(await f.locator('#s').textContent())).toBeGreaterThan(0);
  const scrolled = Number(await f.locator('#s').textContent());
  return { tops, goClicks, typed, slider, scrolled };
}

const reached = (p: Probe) => {
  expect(p.tops).toEqual({ '#go': 'IFRAME', '#t': 'IFRAME', '#r': 'IFRAME', '#sc': 'IFRAME' });
  expect(p.goClicks).toBeGreaterThanOrEqual(1);
  expect(p.typed).toBe('abc');
  expect(Number(p.slider)).toBeGreaterThan(50);
  expect(p.scrolled).toBeGreaterThan(0);
};

/** 枠の中の要素（中心）が、範囲の枠（画面の矩形）に重なっているか：重なっていなければ、隠しても、確かめたことにならない */
async function overlapped(page: Page, frameSel: string, boxSel: string): Promise<boolean> {
  const f = page.frameLocator(frameSel);
  const targets = [await box(f.locator('#go')), await box(f.locator('#t'))];
  const boxes = await page.locator(boxSel).evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()));
  return targets.every((t) => {
    const cx = t.x + t.width / 2;
    const cy = t.y + t.height / 2;
    return boxes.some((b) => cx >= b.left && cx <= b.right && cy >= b.top && cy <= b.bottom);
  });
}

async function openZoom(page: Page) {
  const b = page.locator('#article .htmlapp .cap').getByRole('button', { name: '拡大表示', exact: true });
  await b.scrollIntoViewIfNeeded();
  await b.click();
  await expect(page.locator('#lightbox iframe.appframe')).toHaveCount(1);
  await expect(page.locator('#lightbox .fv-dock')).toBeVisible();
  await page.waitForTimeout(1500);
}

test.describe('コメントの印を隠す：本文（html-app の操作）', () => {
  test('既定は表示。隠すと、枠（.regionbox）と、その線が消え、枠の中のボタン・文字欄・スライダー・ホイールが、元の枠の位置でも届く。番号・カードは、そのまま。出すと、戻る', async ({
    page,
    app,
  }) => {
    const u = ui(page);
    await open(page, app);
    await comment(page, app, APP_BLOCK, RECTS);
    await comment(page, app, IMG_BLOCK, [IMG_RECT]);
    await expect(u.threads).toHaveCount(4);
    await page.locator(APP_BLOCK).scrollIntoViewIfNeeded();
    const t = regionsToggle(page);
    // 既定：表示（aria-pressed=false）。枠 4・線 4
    await expect(t).toHaveAttribute('aria-pressed', 'false');
    await expect(t).toHaveAccessibleName('コメントの印を隠す');
    await expect(bodyBoxes(page)).toHaveCount(4);
    await expect(bodyLines(page)).toHaveCount(4);
    // 隠す：画像の範囲も、同じボタンで
    await t.click();
    await expect(t).toHaveAttribute('aria-pressed', 'true');
    await expect(t).toHaveAttribute('title', /いま：非表示/);
    await expect(bodyBoxes(page)).toHaveCount(0);
    await expect(bodyLines(page)).toHaveCount(0);
    await expect(u.bno).toHaveCount(0); // 番号の丸も、隠す（0.1.7）
    await expect(u.threads).toHaveCount(4); // カードは、そのまま使える
    reached(await probe(page, '#article iframe.appframe'));
    // カードを押すと、選べる（本文側に印は出ない：hide-marks.spec.ts）
    await u.threads.nth(1).locator('.th-head').click();
    await expect(u.threads.nth(1)).toHaveClass(/active/);
    await expect(bodyBoxes(page)).toHaveCount(0);
    // 出す：戻る
    await t.click();
    await expect(t).toHaveAttribute('aria-pressed', 'false');
    await expect(bodyBoxes(page)).toHaveCount(4);
  });

  test('リロードしても、隠したまま（rikai-ui に保存）。出すと、保存も戻る。別のトピックを開いても、同じ', async ({
    page,
    app,
  }) => {
    await open(page, app);
    await comment(page, app, APP_BLOCK, RECTS);
    await expect(ui(page).threads).toHaveCount(3);
    await regionsToggle(page).click();
    await expect(bodyBoxes(page)).toHaveCount(0);
    expect(JSON.parse((await page.evaluate(() => localStorage.getItem('rikai-ui'))) ?? '{}').marks).toBe(false);
    await page.reload();
    await expect(page.locator('#article iframe.appframe')).toHaveCount(1);
    await expect(ui(page).bno).toHaveCount(0);
    await expect(regionsToggle(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(bodyBoxes(page)).toHaveCount(0);
    await regionsToggle(page).click();
    await expect(bodyBoxes(page)).toHaveCount(3);
    expect(JSON.parse((await page.evaluate(() => localStorage.getItem('rikai-ui'))) ?? '{}').marks).toBe(true);
  });

  test('隠している間：範囲を選ぶ → 入力中の枠（pending）だけが、押せない形（.still・ハンドルなし）で、対象を示す。枠の中の操作は届く。出すと、つかめる枠（ハンドルつき）が、枠を塞ぐ', async ({
    page,
    app,
  }) => {
    const u = ui(page);
    await open(page, app);
    await page.locator(APP_BLOCK).scrollIntoViewIfNeeded();
    await regionsToggle(page).click();
    const ib = await box(page.locator('#article iframe.appframe'));
    await u.regbtn.click();
    await dragBox(page, { x: ib.x + 5, y: ib.y + 5 }, { x: ib.x + ib.width - 5, y: ib.y + 120 });
    await expect(u.composer).toBeVisible();
    await expect(u.composer.locator('.quote')).toHaveText('範囲：実行できる枠 1'); // 名前は、枠の名前だけ（道具の文字・注意を、含まない）
    await page.waitForTimeout(1200);
    const pending = page.locator('#badges .regionbox.pending');
    await expect(pending).toHaveCount(1);
    await expect(pending).toHaveClass(/still/);
    await expect(pending.locator('.rh')).toHaveCount(0);
    reached(await probe(page, '#article iframe.appframe')); // 入力中の枠が、枠の中の操作を、塞がない
    // 出す：つかめる枠（ハンドルつき）。これは、枠の中の操作を、塞ぐ（枠の調整のため：F31）
    await regionsToggle(page).click();
    await expect(pending).not.toHaveClass(/still/);
    await expect(pending.locator('.rh')).toHaveCount(8);
  });

  test('旧い版が保存した、範囲の名前の注意（隔離されています…）は、表示から除く（保存したデータは、そのまま）。見出しの文字は、出ない。title・aria-label に残る', async ({
    page,
    app,
  }) => {
    const u = ui(page);
    await open(page, app);
    const legacy = '範囲：実行できる枠 1（隔離されています。パスワードなどの秘密は…（枠の幅 980px で選択）';
    await comment(page, app, APP_BLOCK, [RECTS[0] as Rect], legacy);
    await expect(u.threads).toHaveCount(1);
    await expect(u.threads.first().locator('.quote')).toHaveText('範囲：実行できる枠 1（枠の幅 980px で選択）');
    // 保存したデータは、そのまま
    const saved = await app.http(`/api/topic/${SLUG}`, { auth: true });
    expect(saved.body).toContain('隔離されています。パスワードなどの秘密は…');
    // 錨は壊れていない：枠に番号・ブロックの印が付く
    await expect(page.locator('#article .htmlapp.blk-thread')).toHaveCount(1);
    await expect(u.bno).toHaveText(['1']);
    // 見出し：見える文字にしない・title と aria-label に残る
    const cap = page.locator('#article .htmlapp .cap');
    await expect(cap).not.toContainText('隔離されています');
    await expect(cap).not.toContainText('実行できる枠');
    await expect(cap).toHaveAttribute('title', `実行できる枠 1（${NOTICE}）`);
    await expect(cap).toHaveAttribute('aria-label', `実行できる枠 1（${NOTICE}）`);
    await expect(page.getByRole('group', { name: `実行できる枠 1（${NOTICE}）` })).toHaveCount(1);
    // 見出しの行の見える文字は、道具だけ（広い窓で、1 行）
    const h = await box(cap);
    expect(h.height).toBeLessThan(40);
  });
});

test.describe('コメントの印を隠す：拡大表示（html-app の操作）', () => {
  test('ステージの枠（.fv-box）は、ドックの見出しのボタンで消える。線も。枠の位置でも、枠の中の操作が届く。カードは使える。本文のボタンも、同じ状態（共有）', async ({
    page,
    app,
  }) => {
    await open(page, app);
    await comment(page, app, APP_BLOCK, RECTS);
    await expect(ui(page).threads).toHaveCount(3);
    await openZoom(page);
    await expect(fvBoxes(page)).toHaveCount(3);
    await expect(fvLines(page)).toHaveCount(3);
    expect(await overlapped(page, '#lightbox iframe.appframe', '#lightbox .fv-box')).toBe(true); // 隠す前は、ボタン・文字欄が、枠の下
    const dt = dockToggle(page);
    await expect(dt).toHaveAttribute('aria-pressed', 'false');
    await expect(dt).toHaveAccessibleName('コメントの印を隠す');
    // 関連の線のボタンの隣
    const [a, b] = await Promise.all([box(dt), box(page.locator('#lightbox .fv-links-toggle'))]);
    expect(Math.abs(a.y - b.y)).toBeLessThan(2);
    expect(b.x - (a.x + a.width)).toBeLessThan(12);
    await dt.click();
    await expect(dt).toHaveAttribute('aria-pressed', 'true');
    await expect(fvBoxes(page)).toHaveCount(0);
    await expect(fvLines(page)).toHaveCount(0);
    reached(await probe(page, '#lightbox iframe.appframe'));
    // ドックのカードは、使える：押すと、選ばれる（active）
    const card = page.locator('#lightbox .fv-dock .thread[data-tid]').nth(1);
    await card.locator('.th-head').click();
    await expect(card).toHaveClass(/active/);
    // 閉じても、同じ状態：本文のボタンも、押している・本文の枠もない
    await page.keyboard.press('Escape');
    await expect(page.locator('#lightbox')).toBeHidden();
    await expect(regionsToggle(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(bodyBoxes(page)).toHaveCount(0);
    // 開き直しても、隠したまま。出すと、戻る
    await openZoom(page);
    await expect(fvBoxes(page)).toHaveCount(0);
    await dockToggle(page).click();
    await expect(fvBoxes(page)).toHaveCount(3);
    await expect(fvLines(page)).toHaveCount(3);
  });

  test('隠している間：拡大表示の「範囲を選ぶ」→ 入力中の枠だけが示される（押せない）。枠の中の操作は、そのまま届く', async ({
    page,
    app,
  }) => {
    await open(page, app);
    await openZoom(page);
    await dockToggle(page).click();
    await page.locator('#lightbox .fv-tools [data-tool="region"]').click();
    const ib = await box(page.locator('#lightbox iframe.appframe'));
    await dragBox(page, { x: ib.x + 5, y: ib.y + 5 }, { x: ib.x + ib.width - 5, y: ib.y + 120 });
    await expect(page.locator('#lightbox .fv-dock .thread.composer')).toBeVisible();
    await page.waitForTimeout(1200);
    await expect(fvBoxes(page)).toHaveCount(1);
    await expect(fvBoxes(page)).toHaveClass(/pending/);
    await expect(page.locator('#lightbox .fv-dock .thread.composer .quote')).toContainText(
      /^範囲：実行できる枠 1（枠の幅 \d+px で選択）/,
    );
    reached(await probe(page, '#lightbox iframe.appframe'));
  });
});

test.describe('コメントの印を隠す：終了したトピック・狭い窓・ダーク', () => {
  test('終了したトピック（閲覧専用）でも、同じボタンが効く（本文・拡大表示）', async ({ page, app }) => {
    const u = ui(page);
    await open(page, app);
    await comment(page, app, APP_BLOCK, RECTS);
    await expect(u.threads).toHaveCount(3);
    await u.end.click();
    await u.enddlg.getByRole('button', { name: '終了する' }).click();
    await expect(u.closedbar).toBeVisible();
    await expect(bodyBoxes(page)).toHaveCount(3);
    await regionsToggle(page).click();
    await expect(bodyBoxes(page)).toHaveCount(0);
    await expect(u.bno).toHaveCount(0);
    reached(await probe(page, '#article iframe.appframe'));
    await regionsToggle(page).click();
    await expect(bodyBoxes(page)).toHaveCount(3);
    await openZoom(page);
    await expect(fvBoxes(page)).toHaveCount(3);
    await dockToggle(page).click();
    await expect(fvBoxes(page)).toHaveCount(0);
    reached(await probe(page, '#lightbox iframe.appframe'));
  });

  for (const width of [1100, 820, 640]) {
    test(`狭い窓（${width}px）：ボタンが、窓の中に収まる（本文のパネル・拡大表示のドック）。見出しが、はみ出さない`, async ({
      page,
      app,
    }) => {
      await open(page, app, width, 800);
      await comment(page, app, APP_BLOCK, RECTS);
      await expect(ui(page).threads).toHaveCount(3);
      if (await page.locator('#btn-side[aria-expanded="true"]').count()) await page.locator('#btn-side').click(); // 左の一覧は、しまう
      const inView = async (sel: string) => {
        const b = await box(page.locator(sel));
        expect(b.x).toBeGreaterThanOrEqual(0);
        expect(b.x + b.width).toBeLessThanOrEqual(width + 0.5);
        expect(b.width).toBeGreaterThan(10);
        return b;
      };
      await inView('#marks-toggle');
      await inView('#links-toggle');
      const head = await box(page.locator('#threads .panel-h'));
      expect(head.height).toBeLessThan(40); // 1 行
      await openZoom(page);
      await inView('#lightbox .fv-marks-toggle');
      await inView('#lightbox .fv-links-toggle');
      const dh = await box(page.locator('#lightbox .fv-dock-h'));
      expect(dh.height).toBeLessThan(60);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await dockToggle(page).click();
      await expect(fvBoxes(page)).toHaveCount(0);
    });
  }

  test('ダーク：押している（隠している）ボタンが、見分けられる（背景が、押していないものと違う）。枠は、消える', async ({
    page,
    app,
  }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await open(page, app);
    await comment(page, app, APP_BLOCK, RECTS);
    await expect(ui(page).threads).toHaveCount(3);
    const bg = () => regionsToggle(page).evaluate((e) => getComputedStyle(e).backgroundColor);
    const off = await bg();
    await regionsToggle(page).click();
    await expect(bodyBoxes(page)).toHaveCount(0);
    expect(await bg()).not.toBe(off);
    const color = await regionsToggle(page).evaluate((e) => getComputedStyle(e).color);
    expect(color).not.toBe('');
  });
});
