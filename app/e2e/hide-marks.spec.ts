// コメントの印を隠す（0.1.7）：本文・拡大表示の、コメントに関する印を、すべて隠す（入力中の対象の印〔pending〕だけは残す）。実際の Chrome。資料・コメントは、作り物。
// 印の種類（一覧）：文の強調（mark.hl：未解決・解決済み・選んだ・光らせた・端末の枠の中）・ブロックの外枠（.blk-thread：図・画像・html-app・全体へのコメント）・範囲の枠（.regionbox・.fv-box）・
// 番号の丸（#badges の .bno・.bno-more）・関連の線（#links・.fv-links の .cn-g）。見えているかは、描画（getComputedStyle・getBoundingClientRect）で測る：DOM がないだけでなく、CSS で隠れていること。
// 隠している間は、カードを選んでも・マウスを置いても、本文側に印が出ない。出すと、元に戻る。リロードしても、隠したまま。旧い保存の名前（regionBoxes）も読む。
import type { Page } from '@playwright/test';
import { BT, drawioBlock, HOTEL } from './drawio-samples';
import { expect, type RikaiApp, test } from './fixtures';
import { makePng } from './samples';
import { box, hoverBlock, ui } from './ui';

const SLUG = 'hm';
const APP = `${BT}html-app height=240
<button id="go">ボタン</button>
${BT}`;
const MM = `${BT}mermaid\nflowchart LR\n  A[呼び出し] --> B{成功?}\n  B -- はい --> C[返す]\n${BT}`;
const TERM = `${BT}terminal\nhello\\x1b[31m 赤い文字\\x1b[0m world\n${BT}`;
const DOC = [
  '# 印の確認',
  '',
  '猫は朝によく鳴きます。夜は静かです。',
  '',
  '新しく選ぶ段落です。',
  '',
  '![色見本](assets/p.png)',
  '',
  MM,
  '',
  drawioBlock(HOTEL),
  '',
  APP,
  '',
  TERM,
  '',
  '終わりの段落です。',
  '',
].join('\n');

type Rect = { x: number; y: number; w: number; h: number };

async function open(page: Page, app: RikaiApp, width = 1360, height = 1000) {
  await page.setViewportSize({ width, height });
  await app.switchTopic(page, SLUG, '印の確認', DOC, { 'p.png': makePng(600, 300) });
  await expect.poll(() => page.locator('#article img').evaluate((i) => (i as HTMLImageElement).complete)).toBe(true);
  await expect(page.locator('#article .mermaid-block svg')).toHaveCount(1);
  await expect(page.locator('#article .drawio-block svg')).toHaveCount(1);
  await expect(page.locator('#article iframe.appframe')).toHaveCount(1);
  await page.waitForTimeout(1200);
}

/** 本文のブロック（selector か、含む文字）に、コメントを付ける（HTTP の /api/comment）。quote があれば、文のコメント。rect があれば、範囲のコメント。なければ、ブロック全体 */
async function post(
  page: Page,
  app: RikaiApp,
  at: { sel?: string; text?: string },
  text: string,
  anchor: { quote?: string; rect?: Rect; label?: string } = {},
) {
  const info = await page.evaluate(({ sel, text }) => {
    const all = [...document.querySelectorAll<HTMLElement>('#article [data-bid]')];
    const b = sel ? (document.querySelector(sel) as HTMLElement) : all.find((e) => e.textContent?.includes(text ?? ''));
    if (!b) throw new Error('ブロックがありません');
    return { id: b.dataset.bid, hash: b.dataset.bhash, tag: b.tagName };
  }, at);
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
        quote: anchor.quote ?? '',
        prefix: '',
        suffix: '',
        label: anchor.label ?? (anchor.rect ? '範囲' : anchor.quote ? '' : '対象全体'),
        ...(anchor.rect ? { rect: anchor.rect } : {}),
      },
      text,
      images: [],
    },
  });
  expect(r.status()).toBe(200);
}

const IMG = '#article p.blk:has(img), #article .blk:has(> img)';
const R: Rect = { x: 0.1, y: 0.1, w: 0.4, h: 0.4 };

/** すべての種類の印を付ける（文：未解決・解決済み・端末の枠の中／ブロック：図・draw.io・画像・html-app・全体／範囲：画像・html-app／要素コメント）。付けた数を返す */
async function seed(page: Page, app: RikaiApp): Promise<number> {
  await post(page, app, { text: '猫は朝' }, '文の未解決', { quote: '猫は朝によく鳴きます' });
  await post(page, app, { text: '猫は朝' }, '文の解決済み', { quote: '夜は静かです' });
  await post(page, app, { sel: '#article .fmt-term' }, '端末の中の文', { quote: '赤い文字' });
  await post(page, app, { sel: IMG }, '画像の範囲', { rect: R });
  await post(page, app, { sel: IMG }, '画像の全体');
  await post(page, app, { sel: '#article .mermaid-block' }, '図全体として、正しいですか');
  await post(page, app, { sel: '#article .drawio-block' }, 'draw.io の全体');
  await post(page, app, { sel: '#article .htmlapp' }, '枠の範囲 1', { rect: { x: 0, y: 0, w: 0.5, h: 0.3 } });
  await post(page, app, { sel: '#article .htmlapp' }, '枠の範囲 2', { rect: { x: 0.4, y: 0.1, w: 0.5, h: 0.4 } });
  await post(page, app, { sel: '#article .htmlapp' }, '枠の全体（この枠にコメント）');
  await post(page, app, { sel: '#article .htmlapp' }, '要素コメント', { label: '枠から：button' });
  const n = 11;
  await expect(ui(page).threads).toHaveCount(n);
  // 「文の解決済み」を、解決にする
  const t = JSON.parse((await app.http(`/api/topic/${SLUG}`, { auth: true })).body);
  const id = t.threads.find((x: { messages: { text: string }[] }) => x.messages[0]?.text === '文の解決済み')?.id;
  const r = await page.request.post(`${app.origin}/api/resolve`, {
    headers: { Origin: app.origin },
    data: { topic: SLUG, thread: id, resolved: true },
  });
  expect(r.status()).toBe(200);
  await expect(page.locator('#article mark.hl.resolved')).toHaveCount(1);
  await page.waitForTimeout(600);
  return n;
}

/**
 * いま見えている、コメントの印（入力中の対象を除く）を、描画から測って、名前で返す。空なら、見えない。
 * mark.hl：背景・輪郭・影が、あるか（端末の枠では、文字色が、親と同じか）。.blk-thread：輪郭と、背景（印の分だけ。印を外した背景と比べる）。番号・範囲の枠・線：矩形が、あるか。
 */
function visibleMarks(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const shown = (e: Element): boolean => {
      const r = e.getBoundingClientRect();
      const cs = getComputedStyle(e);
      return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0';
    };
    for (const m of document.querySelectorAll<HTMLElement>('mark.hl:not(.pending)')) {
      const cs = getComputedStyle(m);
      if (cs.backgroundColor !== 'rgba(0, 0, 0, 0)') out.push('mark.hl background');
      if (cs.outlineStyle !== 'none' && Number.parseFloat(cs.outlineWidth) > 0) out.push('mark.hl outline');
      if (cs.boxShadow !== 'none') out.push('mark.hl box-shadow');
      if (m.parentElement && cs.color !== getComputedStyle(m.parentElement).color) out.push('mark.hl color');
    }
    for (const b of document.querySelectorAll<HTMLElement>('.blk-thread:not(.blk-pending)')) {
      const cs = getComputedStyle(b);
      if (cs.outlineStyle !== 'none' && Number.parseFloat(cs.outlineWidth) > 0 && !b.matches(':focus-visible'))
        out.push('.blk-thread outline');
      const [bg, cls] = [cs.backgroundColor, b.className];
      b.className = cls
        .split(/\s+/)
        .filter((c) => !/^(blk-thread|linked|active|resolved)$/.test(c))
        .join(' ');
      const base = getComputedStyle(b).backgroundColor;
      b.className = cls;
      if (bg !== base) out.push('.blk-thread background');
    }
    for (const e of document.querySelectorAll('#badges .bno:not(.pending), #badges .bno-more'))
      if (shown(e)) out.push('.bno');
    for (const e of document.querySelectorAll(
      '#badges .regionbox:not(.pending), .fv-box:not(.pending), .fv-chip:not(.pending)',
    ))
      if (shown(e)) out.push('.regionbox/.fv-box');
    for (const g of document.querySelectorAll('#links .cn-g:not(.pending), .fv-links .cn-g:not(.pending)'))
      if ([...g.querySelectorAll('path, circle, line')].some((p) => shown(p))) out.push('.cn-g');
    return [...new Set(out)];
  });
}

const toggle = (page: Page) => page.locator('#marks-toggle');
const dockToggle = (page: Page) => page.locator('#lightbox .fv-marks-toggle');
const ALL_KINDS = ['mark.hl background', '.blk-thread outline', '.bno', '.regionbox/.fv-box', '.cn-g'];

/** 隠している間：カードを選ぶ・マウスを置く・ブロックに置く、のあとでも、印が出ない */
async function stayHidden(page: Page) {
  const u = ui(page);
  const n = await u.threads.count();
  for (let i = 0; i < n; i++) {
    const card = u.threads.nth(i);
    await card.scrollIntoViewIfNeeded();
    await card.locator('.th-head').click(); // 選ぶ（active）
    await card.hover(); // マウスを置く（linked）
    expect(await visibleMarks(page), `カード ${i + 1} を選んだとき`).toEqual([]);
  }
  for (const sel of [
    '#article .mermaid-block',
    '#article .drawio-block',
    '#article .htmlapp',
    IMG,
    '#article mark.hl',
  ]) {
    await hoverBlock(page, page.locator(sel).first());
    expect(await visibleMarks(page), `${sel} に置いたとき`).toEqual([]);
  }
}

test.describe('コメントの印を隠す：本文のすべての印', () => {
  test('隠すと、文の強調・ブロックの外枠・範囲の枠・番号・線が、すべて見えない。カードを選んでも・マウスを置いても、出ない。出すと、元に戻る。リロードしても、隠したまま', async ({
    page,
    app,
  }) => {
    await open(page, app);
    await seed(page, app);
    // 隠す前：すべての種類が、見えている（測り方が、空振りしていない）
    const before = await visibleMarks(page);
    for (const k of ALL_KINDS) expect(before, k).toContain(k);
    // カードを選ぶ（active）と、文の強調に、輪郭が付く：隠す前は、見える
    await ui(page).threads.filter({ hasText: '文の未解決' }).locator('.th-head').click();
    expect(await visibleMarks(page)).toContain('mark.hl outline');
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
    await toggle(page).click();
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('body')).toHaveClass(/hide-marks/);
    expect(await visibleMarks(page)).toEqual([]);
    await expect(page.locator('#badges .bno')).toHaveCount(0); // 番号の丸は、DOM にも置かない
    await expect(page.locator('#badges .regionbox')).toHaveCount(0);
    await expect(ui(page).threads).toHaveCount(10); // カードは、そのまま（未解決 10。解決済み 1 は、別のタブ）
    await stayHidden(page);
    // 隠したまま、リロード
    await page.reload();
    await expect(page.locator('#article iframe.appframe')).toHaveCount(1);
    await expect(page.locator('body')).toHaveClass(/hide-marks/);
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
    await page.waitForTimeout(800);
    expect(await visibleMarks(page)).toEqual([]);
    // 出す：元に戻る（種類も、数も）
    await toggle(page).click();
    await expect(page.locator('body')).not.toHaveClass(/hide-marks/);
    await expect.poll(async () => (await visibleMarks(page)).sort().join()).toBe([...new Set(before)].sort().join());
  });

  test('旧い保存の名前（regionBoxes: false。0.1.6）でも、隠した状態で始まる。新しい名前があれば、そちらが先', async ({
    page,
    app,
  }) => {
    await open(page, app);
    await seed(page, app);
    await page.evaluate(() => localStorage.setItem('rikai-ui', JSON.stringify({ regionBoxes: false })));
    await page.reload();
    await expect(page.locator('#article iframe.appframe')).toHaveCount(1);
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
    await page.waitForTimeout(800);
    expect(await visibleMarks(page)).toEqual([]);
    await page.evaluate(() => localStorage.setItem('rikai-ui', JSON.stringify({ marks: true, regionBoxes: false })));
    await page.reload();
    await expect(page.locator('#article iframe.appframe')).toHaveCount(1);
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
  });

  test('入力中の対象の印（pending）だけは、隠している間も、残る：文の強調（破線）・「新」の番号・線。ブロックの外枠（破線）', async ({
    page,
    app,
  }) => {
    const u = ui(page);
    await open(page, app);
    await seed(page, app);
    await toggle(page).click();
    // 文：選んで、コメント
    await page.locator('#article').getByText('新しく選ぶ段落です。').scrollIntoViewIfNeeded();
    const b = await box(page.locator('#article p', { hasText: '新しく選ぶ段落です。' }));
    await page.mouse.move(b.x + 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width - 4, b.y + b.height / 2, { steps: 6 });
    await page.mouse.up();
    await u.actComment.click();
    await expect(u.composer).toBeVisible();
    const pend = await page.evaluate(() => {
      const shown = (e: Element | null) => {
        if (!e) return false;
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && getComputedStyle(e).display !== 'none';
      };
      const m = document.querySelector('mark.hl.pending');
      return {
        mark: !!m && getComputedStyle(m).outlineStyle === 'dashed',
        no: shown(document.querySelector('#badges .bno.pending')),
      };
    });
    expect(pend).toEqual({ mark: true, no: true });
    expect(await visibleMarks(page)).toEqual([]); // 入力中以外は、見えない
    await u.composer.getByRole('button', { name: 'やめる' }).click();
    // ブロック：図に、マウスを置いて、「コメント」
    await hoverBlock(page, page.locator('#article .mermaid-block'));
    await u.actComment.click();
    await expect(u.composer).toBeVisible();
    await expect(page.locator('#article .blk-pending')).toHaveCSS('outline-style', 'dashed');
    expect(await visibleMarks(page)).toEqual([]);
  });
});

// 入力中の対象への線（pending）も、隠している間、残る（線は、入力欄と対象を結ぶ）。ほかの線は、出ない。短い資料で（長い資料では、入力欄の位置によって、線が引かれない）
test('隠している間：入力中の対象への線（.cn-g.pending）だけが、残る', async ({ page, app }) => {
  const u = ui(page);
  await page.setViewportSize({ width: 1360, height: 1000 });
  await app.switchTopic(page, SLUG, '線', '# 題\n\n猫は朝によく鳴きます。夜は静かです。\n\n終わりの段落です。\n');
  await post(page, app, { text: '猫は朝' }, '既存', { quote: '夜は静かです' });
  await toggle(page).click();
  const b = await box(page.locator('#article p', { hasText: '終わりの段落です。' }));
  await page.mouse.move(b.x + 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width - 4, b.y + b.height / 2, { steps: 6 });
  await page.mouse.up();
  await u.actComment.click();
  await expect(u.composer).toBeVisible();
  const lines = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('#links .cn-g')].map((g) => [
        g.classList.contains('pending'),
        [...g.querySelectorAll('path')].some((p) => p.getBoundingClientRect().width > 0),
      ]),
    );
  await expect.poll(async () => (await lines()).filter(([, shown]) => shown)).toEqual([[true, true]]); // 既存のコメントの線は、見えない。入力中の線だけ
  await toggle(page).click(); // 出すと、既存の線も出る
  await expect.poll(async () => (await lines()).filter(([, shown]) => shown).length).toBe(2);
});

test.describe('コメントの印を隠す：拡大表示', () => {
  test('画像：ステージの範囲の枠・線が、隠れる。カードを選んでも、出ない。本文の印も、隠れたまま（窓の後ろ）。出すと、戻る', async ({
    page,
    app,
  }) => {
    await open(page, app);
    await seed(page, app);
    await page.locator('#article img').scrollIntoViewIfNeeded();
    await page.locator('#article img').click();
    await expect(page.locator('#lightbox .fv-dock')).toBeVisible();
    await expect.poll(async () => (await box(page.locator('#lightbox .lb-stage'))).width).toBeGreaterThan(50);
    await expect(page.locator('#lightbox .fv-box')).toHaveCount(1);
    expect(await visibleMarks(page)).toContain('.regionbox/.fv-box');
    await dockToggle(page).click();
    await expect(page.locator('#lightbox .fv-box')).toHaveCount(0);
    expect(await visibleMarks(page)).toEqual([]);
    const cards = page.locator('#lightbox .fv-dock .thread[data-tid]');
    for (let i = 0; i < (await cards.count()); i++) {
      await cards.nth(i).locator('.th-head').click();
      await cards.nth(i).hover();
      expect(await visibleMarks(page), `ドックのカード ${i + 1}`).toEqual([]);
    }
    await dockToggle(page).click();
    await expect(page.locator('#lightbox .fv-box')).toHaveCount(1);
    await expect.poll(async () => (await visibleMarks(page)).includes('.cn-g')).toBe(true);
  });

  test('html-app：ステージの枠・線が、隠れる（入力中の枠だけ残る）。カードを選んでも、出ない', async ({
    page,
    app,
  }) => {
    await open(page, app);
    await seed(page, app);
    const b = page.locator('#article .htmlapp .cap').getByRole('button', { name: '拡大表示', exact: true });
    await b.scrollIntoViewIfNeeded();
    await b.click();
    await expect(page.locator('#lightbox iframe.appframe')).toHaveCount(1);
    await page.waitForTimeout(1500);
    await expect(page.locator('#lightbox .fv-box')).toHaveCount(2);
    await dockToggle(page).click();
    await expect(page.locator('#lightbox .fv-box')).toHaveCount(0);
    expect(await visibleMarks(page)).toEqual([]);
    const cards = page.locator('#lightbox .fv-dock .thread[data-tid]');
    for (let i = 0; i < (await cards.count()); i++) {
      await cards.nth(i).locator('.th-head').click();
      expect(await visibleMarks(page), `ドックのカード ${i + 1}`).toEqual([]);
    }
  });
});

test.describe('コメントの印を隠す：終了したトピック・狭い窓・ダーク', () => {
  test('終了したトピック（閲覧専用）でも、すべての印が隠れる。出すと戻る', async ({ page, app }) => {
    const u = ui(page);
    await open(page, app);
    await seed(page, app);
    await u.end.click();
    await u.enddlg.getByRole('button', { name: '終了する' }).click();
    await expect(u.closedbar).toBeVisible();
    for (const k of ALL_KINDS) expect(await visibleMarks(page), k).toContain(k);
    await toggle(page).click();
    expect(await visibleMarks(page)).toEqual([]);
    await stayHidden(page);
    await toggle(page).click();
    await expect.poll(async () => (await visibleMarks(page)).length).toBeGreaterThan(3);
  });

  for (const [scheme, width] of [
    ['dark', 1360],
    ['light', 640],
    ['dark', 640],
  ] as const) {
    test(`${scheme}・${width}px：すべての印が隠れる（カードを選んでも）`, async ({ page, app }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await open(page, app, width, 900);
      await seed(page, app);
      if (width < 800 && (await page.locator('#btn-side[aria-expanded="true"]').count()))
        await page.locator('#btn-side').click();
      expect((await visibleMarks(page)).length).toBeGreaterThan(3);
      await toggle(page).click();
      expect(await visibleMarks(page)).toEqual([]);
      await stayHidden(page);
    });
  }
});
