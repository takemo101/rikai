// html-app の「橋」（F28・F40）：自動の高さ・配色の供給（ダーク追従：資料が、配色への対応を示したときだけ〔オプトイン〕。従来の資料は、従来と同じ見た目）・
// 枠の幅の切り替え（選んだ幅で計算して、本文の幅に縮小して見せる）・枠のライト/ダーク・安全（偽の知らせ・別の枠）・位置の追従・狭い窓。
// 実際の Chrome・本物の枠（iframe）で確かめる。資料は、作り物。
// 「対応を示す」資料：`var(--color-…)`・`<meta name="color-scheme">`・`data-theme` のどれかを、中身に含む（shared/htmlapp-theme.ts）。含まない資料は、従来（Before）と同じ
import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { ui } from './ui';

const BT = '```';
const lines = (...l: string[]) => `${l.join('\n')}\n`;

// ボタンで、中身が増える部品（自動の高さ）。数も、枠の中の状態として持つ
const GROW = (info: string, follow = false) =>
  lines(
    `${BT}html-app${info}`,
    `<button id="add">追加</button> <button id="inc">数える</button><span id="count"${follow ? ' style="color:var(--color-ink)"' : ''}>0</span>`,
    '<div id="list"></div>',
    '<script>',
    "var n = 0; document.getElementById('inc').onclick = function () { n++; document.getElementById('count').textContent = String(n); };",
    "document.getElementById('add').onclick = function () { var d = document.createElement('div'); d.className = 'row'; d.style.cssText = 'height:80px;border-bottom:1px solid #ccc'; d.textContent = '行'; document.getElementById('list').appendChild(d); };",
    '</script>',
    BT,
  );

const iframeAt = (page: Page, n: number): Locator => page.locator('#article iframe.appframe').nth(n);
const heightOf = async (f: Locator): Promise<number> => Number(await f.getAttribute('height'));
const boxOf = async (l: Locator) => {
  const b = await l.boundingBox();
  if (!b) throw new Error('boundingBox がありません');
  return b;
};
const frameCss = (page: Page, n: number, selector: string, prop: string) =>
  page
    .frameLocator('#article iframe.appframe')
    .nth(n)
    .locator(selector)
    .evaluate((e, p) => getComputedStyle(e).getPropertyValue(p), prop);

// 読み取りが、本文の描き直しの間（強調・番号の丸が、一瞬、なくなる）に当たったら、少し待って、やり直す（コメントの追加・通知のあとに、本文が描き直される）
async function stableValue<T>(read: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let i = 0; i < 60; i++) {
    try {
      return await read();
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw last;
}

/**
 * 縮小した枠（transform: scale）の中の要素の、画面の座標（中心）。Playwright の click() は、枠の transform を、座標に反映しない（boundingBox も、縮小前の値）ので、
 * 枠の中の要素の位置（枠の中の座標）に、縮小率と、枠の見える位置を、自分で掛けて、本物のマウスで押す（ブラウザが、ポインタの座標を、枠の中へ、正しく変換するかを確かめる）
 */
async function centerInFrame(page: Page, n: number, selector: string): Promise<{ x: number; y: number }> {
  const frame = iframeAt(page, n);
  const box = await boxOf(frame);
  const layoutWidth = await frame.evaluate((e) => (e as HTMLElement).offsetWidth);
  const s = box.width / layoutWidth;
  const r = await page
    .frameLocator('#article iframe.appframe')
    .nth(n)
    .locator(selector)
    .evaluate((e) => {
      const b = e.getBoundingClientRect();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    });
  return { x: box.x + r.x * s, y: box.y + r.y * s };
}
async function realClick(page: Page, n: number, selector: string, scrollIntoView = true): Promise<void> {
  if (scrollIntoView) await iframeAt(page, n).scrollIntoViewIfNeeded(); // 横にスクロールした置き場の中の枠は、これで、スクロールが戻ってしまうので、使わない

  const p = await centerInFrame(page, n, selector);
  await page.mouse.click(p.x, p.y);
}

// 自動の高さの枠は、読み込み直後に、高さを変える。その直後の数 ms は、Chrome が、枠への入力の宛先を更新している最中で、押したことが、枠に届かないことがある
// （人の操作の速さでは、起きない）：枠の高さが、落ち着いてから、押す
async function settled(page: Page): Promise<void> {
  const heights = () =>
    page.locator('#article iframe.appframe').evaluateAll((els) => els.map((e) => e.getAttribute('height')).join(','));
  let prev = '';
  await expect
    .poll(
      async () => {
        const cur = await heights();
        const same = cur === prev;
        prev = cur;
        return same;
      },
      { intervals: [500], timeout: 15_000 },
    )
    .toBe(true);
}

// 画面に届く、橋の知らせを、数える（最初に仕掛けて、トピックを切り替える：同じ文書のまま）
async function countMessages(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __msgs: number[] };
    w.__msgs = [];
    window.addEventListener('message', (e) => {
      if (e.data && typeof e.data === 'object' && (e.data as { __rikai?: number }).__rikai) w.__msgs.push(Date.now());
    });
  });
}
const messages = (page: Page): Promise<number[]> =>
  page.evaluate(() => (window as unknown as { __msgs: number[] }).__msgs);

test.describe('自動の高さ', () => {
  test('ボタンで中身が増えると、iframe の高さが伸びる。縮むと戻る。height=480 の枠は、固定のまま', async ({
    page,
    app,
  }) => {
    await app.switchTopic(page, 'ah', '自動の高さ', `# 題\n\n${GROW('')}\n${GROW(' height=480')}`);
    await settled(page);
    const auto = iframeAt(page, 0);
    const fixed = iframeAt(page, 1);
    await expect(fixed).toHaveAttribute('height', '480');
    // 自動：最初の高さ（200）から、中身に合わせて縮む・伸びる
    await expect.poll(() => heightOf(auto)).toBeLessThan(200);
    const h0 = await heightOf(auto);
    const f = page.frameLocator('#article iframe.appframe').first();
    for (let i = 0; i < 5; i++) await f.locator('#add').click();
    await expect.poll(() => heightOf(auto)).toBeGreaterThan(h0 + 300);
    const grown = await heightOf(auto);
    expect((await boxOf(auto)).height).toBeGreaterThanOrEqual(grown - 1);
    // 枠の中身が、全部見える（枠の中で、スクロールしない）
    await expect.poll(() => f.locator('body').evaluate((b) => b.scrollHeight <= window.innerHeight)).toBe(true);
    // 固定の枠：増やしても、高さは、480 のまま
    const g = page.frameLocator('#article iframe.appframe').nth(1);
    for (let i = 0; i < 8; i++) await g.locator('#add').click();
    await page.waitForTimeout(1500);
    await expect(fixed).toHaveAttribute('height', '480');
    expect((await boxOf(fixed)).height).toBeCloseTo(480, 0);
  });

  test('100vh・% の高さの中身でも、知らせは、少ない（1 秒に数回まで）。高さは、落ち着く', async ({ page, app }) => {
    await countMessages(page);
    const doc = lines(
      '# 100vh',
      '',
      `${BT}html-app`,
      '<style>html,body{height:100%}.full{min-height:100vh;background:linear-gradient(#eef,#fee)}</style>',
      '<div class="full">高さ 100vh の中身</div>',
      BT,
      '',
      `${BT}html-app`,
      '<style>body{margin:16px;min-height:100vh}</style>',
      '<p>余白つき・min-height: 100vh（枠を伸ばすと、中身も伸びる）</p>',
      BT,
      '',
      `${BT}html-app`,
      '<style>html,body{height:100%}.p{height:60%;background:#cfc}</style><div class="p">60%</div>',
      BT,
    );
    await app.switchTopic(page, 'vh', '100vh', doc);
    await page.waitForTimeout(3000);
    const t = await messages(page);
    expect(t.length, `3 秒間の知らせ：${t.length}`).toBeLessThanOrEqual(3 * 4 * 3 + 6); // 3 つの枠 × 1 秒に 4 回 × 3 秒（余裕）
    for (const a of t) expect(t.filter((b) => b >= a && b < a + 1000).length).toBeLessThanOrEqual(4 * 3 + 2);
    // 落ち着く：さらに 2 秒、高さが、変わらない
    const hs = async () => [
      await heightOf(iframeAt(page, 0)),
      await heightOf(iframeAt(page, 1)),
      await heightOf(iframeAt(page, 2)),
    ];
    const before = await hs();
    await page.waitForTimeout(2000);
    expect(await hs()).toEqual(before);
    for (const h of before) {
      expect(h).toBeGreaterThanOrEqual(120);
      expect(h).toBeLessThan(2400);
    }
    // 画面は、すぐ反応する（CPU を使い切っていない）
    const t0 = Date.now();
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(0))));
    expect(Date.now() - t0).toBeLessThan(500);
  });
});

test.describe('100vh の中身：枠の中に、スクロールバーが出ない', () => {
  test('.full{height:100vh}（既定の余白つき）：揺れず、止まって、最後に測った高さ（大きい側）。枠の中が、縦にスクロールしない', async ({
    page,
    app,
  }) => {
    await countMessages(page);
    const doc = lines(
      `${BT}html-app`,
      '<style>.full{height:100vh;background:linear-gradient(#eef,#fee)}</style>',
      '<div class="full">高さ 100vh（body の既定の余白 8px つき）</div>',
      BT,
    );
    await app.switchTopic(page, 'vhs', '100vh', `# 題\n\n${doc}`);
    await page.waitForTimeout(3500);
    const t = await messages(page);
    expect(t.length, `報告：${t.length}`).toBeLessThanOrEqual(6);
    const f = page.frameLocator('#article iframe.appframe').first().locator('html');
    // スクロールバーがない（ビューポートの幅＝文書の幅）
    expect(await f.evaluate(() => window.innerWidth - document.documentElement.clientWidth)).toBe(0);
    // 最後に報告した高さが、測った中で最も大きい側（小さい側の枠で止まって、24px 切れる、ではない）
    const h = await heightOf(iframeAt(page, 0));
    expect(await f.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(h + 40);
    expect(h).toBeGreaterThanOrEqual(240);
    // 落ち着く
    await page.waitForTimeout(2000);
    expect(await heightOf(iframeAt(page, 0))).toBe(h);
  });
});

// ---- オプトイン：従来の資料は、従来（Before：0.20.0）と同じ見た目 ----
// Before の枠の文書は、`<!doctype html><meta charset="utf-8">` に、中身がそのまま続くだけ（土台・橋なし）。同じ文書を、橋なしの単独のページに出して、基準にする
const LEGACY_DOCS: Array<{ name: string; html: string; sels: string[] }> = [
  {
    name: '何も書かない',
    html: '<p id="t">何も書かない資料です。</p><button id="b">ボタン</button> <input id="i" value="入力欄">',
    sels: ['body', '#t', '#b', '#i'],
  },
  {
    name: '背景だけを書いた（文字色は書かない）',
    html: '<style>.card{background:#f4f4f5;border-radius:8px;padding:12px;margin:8px}</style><div class="card" id="c">背景だけを書いたカード</div><div class="card" id="d" style="background:#fff7e0">黄色いカード</div>',
    sels: ['body', '#c', '#d'],
  },
  {
    name: 'body の margin・背景・文字色・フォントだけを書いた',
    html: '<style>body{margin:16px;background:#fafafa;color:#222;font:16px/1.4 Georgia,serif}</style><h1 id="t" style="margin:0">見出し</h1><p id="p">本文の段落です。</p>',
    sels: ['body', '#t', '#p'],
  },
  {
    name: '自分で --color-* を定義した（橋が配る名前ではない・橋の名前を、自分で定義した）',
    html: '<style>:root{--color-primary:#2563eb;--color-bg:#f4f4f5;--color-text:#222}.card{background:var(--color-bg);color:var(--color-text);padding:12px;margin:8px;border-radius:8px}.btn{background:var(--color-primary);color:#fff;border:0;padding:4px 12px}</style><div class="card" id="c">自作の変数で、背景を決めたカード</div><button class="btn" id="b">主なボタン</button>',
    sels: ['body', '#c', '#b'],
  },
  {
    name: 'data-theme という文字を、本文に書いた',
    html: '<p id="t">この資料は、data-theme 属性について書いています。</p><p id="p">data-theme と color-scheme の説明です。</p>',
    sels: ['body', '#t', '#p'],
  },
  {
    name: '全部書いた',
    html: '<style>html,body{margin:0;padding:0;background:#fff;color:#111;font:14px/1.5 sans-serif}.w{padding:20px}button{background:#eee;border:1px solid #999;padding:2px 8px}</style><div class="w" id="w"><p id="t">全部書いた資料</p><button id="b">ボタン</button></div>',
    sels: ['#w', '#t', '#b'],
  },
];
const STYLE_PROPS = [
  'margin-top',
  'margin-left',
  'padding-top',
  'padding-left',
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'color',
  'background-color',
  'border-top-width',
  'border-top-color',
  'color-scheme',
];
// 要素ごとの、計算済みのスタイルと、位置・大きさ（文書の左上から）
const snapshotOf = (sels: string[]) =>
  [
    (_: unknown, a: { sels: string[]; props: string[] }) =>
      a.sels.map((sel) => {
        const e = document.querySelector(sel) as HTMLElement;
        const cs = getComputedStyle(e);
        const r = e.getBoundingClientRect();
        return {
          sel,
          style: Object.fromEntries(a.props.map((p) => [p, cs.getPropertyValue(p)])),
          rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
        };
      }),
    { sels, props: STYLE_PROPS },
  ] as const;

/** 2 枚の画像（PNG）の、見た目の違う画素の割合（チャンネルの差が 40 を超える画素）。窓（page）の中で、デコードして数える */
async function diffRatio(page: Page, a: Buffer, b: Buffer): Promise<number> {
  return page.evaluate(
    async ([x, y]) => {
      const load = async (b64: string) => {
        const im = new Image();
        im.src = `data:image/png;base64,${b64}`;
        await im.decode();
        const c = document.createElement('canvas');
        c.width = im.width;
        c.height = im.height;
        const g = c.getContext('2d') as CanvasRenderingContext2D;
        g.drawImage(im, 0, 0);
        return g.getImageData(0, 0, im.width, im.height);
      };
      const [p, q] = [await load(x as string), await load(y as string)];
      if (p.width !== q.width || p.height !== q.height) return 1;
      let diff = 0;
      for (let i = 0; i < p.data.length; i += 4) {
        const d = Math.max(
          Math.abs((p.data[i] as number) - (q.data[i] as number)),
          Math.abs((p.data[i + 1] as number) - (q.data[i + 1] as number)),
          Math.abs((p.data[i + 2] as number) - (q.data[i + 2] as number)),
        );
        if (d > 40) diff++;
      }
      return diff / (p.width * p.height);
    },
    [a.toString('base64'), b.toString('base64')],
  );
}

test.describe('従来の資料（配色への対応を示さない）：従来と同じ見た目', () => {
  const doc = LEGACY_DOCS.map((d) => lines(`${BT}html-app height=200`, d.html, BT)).join('\n');

  for (const scheme of ['light', 'dark'] as const) {
    test(`画面が ${scheme} でも、Before（土台・橋なしの文書）と、計算済みのスタイル・位置・画素が同じ。data-theme・color-scheme を付けない`, async ({
      page,
      app,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await app.switchTopic(page, `lg-${scheme}`, '従来', `# 従来\n\n${doc}`);
      await settled(page);
      await page.addStyleTag({ content: '#regbtn, #actbar, #toast { visibility: hidden !important; }' }); // 画素の比較に、画面の浮かぶ部品（範囲を選ぶ）を、入れない
      const count = LEGACY_DOCS.length;
      await expect(page.locator('#article iframe.appframe')).toHaveCount(count);
      for (const [i, d] of LEGACY_DOCS.entries()) {
        const frame = iframeAt(page, i);
        await frame.scrollIntoViewIfNeeded();
        await page.waitForTimeout(150);
        const box = await boxOf(frame);
        const inFrame = await page
          .frameLocator('#article iframe.appframe')
          .nth(i)
          .locator('html')
          .evaluate(...snapshotOf(d.sels));
        expect(
          await page.frameLocator('#article iframe.appframe').nth(i).locator('html').getAttribute('data-theme'),
          d.name,
        ).toBeNull();
        expect(
          await page.frameLocator('#article iframe.appframe').nth(i).locator('html').getAttribute('data-follow'),
          d.name,
        ).toBeNull();
        // 基準：Before の文書（doctype・文字コード・中身だけ）を、橋なしの単独のページに。枠と同じ大きさ・ライト
        const base = await page.context().newPage();
        await base.setViewportSize({ width: Math.round(box.width), height: Math.round(box.height) });
        await base.emulateMedia({ colorScheme: 'light' });
        await base.setContent(`<!doctype html>\n<meta charset="utf-8">\n${d.html}`);
        const expected = await base.locator('html').evaluate(...snapshotOf(d.sels));
        expect(
          inFrame.map(({ sel, style }) => ({ sel, style })),
          `${d.name}：計算済みのスタイル`,
        ).toEqual(expected.map(({ sel, style }) => ({ sel, style })));
        // 位置・大きさ：丸めの違い（1px）は、許す（枠は、小数の位置にある）。8px→12px・16→28px の土台の違いは、見逃さない
        for (const [k, e] of expected.entries())
          for (const [j, v] of e.rect.entries())
            expect(
              Math.abs(v - (inFrame[k]?.rect[j] as number)),
              `${d.name} ${e.sel} の位置・大きさ[${j}]`,
            ).toBeLessThanOrEqual(1);
        // 画素：枠の中（線・角の丸みを避けて、8px 内側）。Before は、どちらの外観でも、白地・従来の色。枠は、小数の位置（y に .58）にあり、文字の縁が、少しずれる（文字だけの資料で 4%）：8% 未満。
        // 背景・文字の色の違いは、ほぼ全面（ダークの地なら 100%）で、見逃さない。細かい色の違いは、上の計算済みのスタイルで、完全一致を確かめる
        const inner = { x: box.x + 8, y: box.y + 8, width: box.width - 16, height: box.height - 16 };
        const shot = await page.screenshot({ clip: inner });
        const ref = await base.screenshot({ clip: { x: 8, y: 8, width: inner.width, height: inner.height } });
        await base.close();
        expect(await diffRatio(page, shot, ref), `${d.name}：画素の違い（${scheme}）`).toBeLessThan(0.08);
      }
    });
  }

  test('基準の確認：Before の「何も書かない」は、余白 8px・黒い文字・透明な背景（新しい土台の 12px・#18181b ではない）', async ({
    page,
    app,
  }) => {
    await app.switchTopic(
      page,
      'lg-ref',
      '従来',
      `# 従来\n\n${lines(`${BT}html-app height=200`, LEGACY_DOCS[0]?.html as string, BT)}`,
    );
    await settled(page);
    expect(await frameCss(page, 0, 'body', 'margin-top')).toBe('8px');
    expect(await frameCss(page, 0, 'body', 'padding-top')).toBe('0px');
    expect(await frameCss(page, 0, 'body', 'color')).toBe('rgb(0, 0, 0)');
    expect(await frameCss(page, 0, 'body', 'background-color')).toBe('rgba(0, 0, 0, 0)');
    expect(await frameCss(page, 0, 'body', 'font-size')).toBe('16px');
  });

  test('背景だけを書いたカード：画面がダークでも、文字は黒・背景はそのまま（読める）。画面の外観が変わっても、変わらない（by: auto は効かない）', async ({
    page,
    app,
  }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await app.switchTopic(
      page,
      'lg-auto',
      '従来',
      `# 従来\n\n${lines(`${BT}html-app height=200`, LEGACY_DOCS[1]?.html as string, BT)}`,
    );
    await settled(page);
    expect(await frameCss(page, 0, '#c', 'color')).toBe('rgb(0, 0, 0)');
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForTimeout(600);
    expect(await frameCss(page, 0, '#c', 'color')).toBe('rgb(0, 0, 0)');
    expect(await frameCss(page, 0, '#c', 'background-color')).toBe('rgb(244, 244, 245)');
    expect(
      await page.frameLocator('#article iframe.appframe').first().locator('html').getAttribute('data-theme'),
    ).toBeNull();
    // 枠の地も、従来どおり白（Before の `.appframe { background: #fff }`）
    expect(await iframeAt(page, 0).evaluate((e) => getComputedStyle(e).backgroundColor)).toBe('rgb(255, 255, 255)');
    // ツールバーも、従来の枠は「ライト」（画面がダークでも）
    await expect(page.locator('#article .htmlapp .cap button[data-frame-mode]').first()).toHaveAttribute(
      'aria-label',
      /^枠の外観：ライト/,
    );
  });

  test('ツールバーの「枠だけのダーク」（by: user）は、従来の枠でも効く（data-theme・color-scheme を、橋が付ける）。別の従来の枠は、変わらない。画面の外観が変わっても、戻らない', async ({
    page,
    app,
  }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await app.switchTopic(
      page,
      'lg-user',
      '従来',
      `# 従来\n\n${lines(`${BT}html-app height=200`, '<p id="t">一つ目</p>', BT)}\n${lines(`${BT}html-app height=200`, '<p id="t">二つ目</p>', BT)}`,
    );
    await settled(page);
    const caps = page.locator('#article .htmlapp .cap');
    const html = (n: number) => page.frameLocator('#article iframe.appframe').nth(n).locator('html');
    await caps.first().locator('button[data-frame-mode]').click();
    await expect.poll(() => html(0).getAttribute('data-theme')).toBe('dark');
    expect(await html(0).evaluate((e) => getComputedStyle(e).colorScheme)).toBe('dark');
    // 文字色を書いていない資料は、ダークにすると、白い文字・黒い地（利用者が選んだ結果）
    expect(await frameCss(page, 0, '#t', 'color')).toBe('rgb(255, 255, 255)');
    expect(await iframeAt(page, 0).evaluate((e) => getComputedStyle(e).backgroundColor)).toBe('rgb(9, 9, 11)');
    expect(await html(1).getAttribute('data-theme')).toBeNull();
    expect(await frameCss(page, 1, '#t', 'color')).toBe('rgb(0, 0, 0)');
    // 画面の外観が変わっても、枠だけの選びは、そのまま
    await page.locator('#btn-theme').click();
    await page.locator('#btn-theme').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.waitForTimeout(500);
    expect(await html(0).getAttribute('data-theme')).toBe('dark');
    expect(await html(1).getAttribute('data-theme')).toBeNull();
    // ライトへ戻す
    await caps.first().locator('button[data-frame-mode]').click();
    await expect.poll(() => html(0).getAttribute('data-theme')).toBe('light');
    expect(await frameCss(page, 0, '#t', 'color')).toBe('rgb(0, 0, 0)');
  });

  test('対応を示す印（橋が配る変数 var(--color-…)・<meta name="color-scheme">）：どれでも、土台と、ダークへの追従が付く（<html data-follow>）', async ({
    page,
    app,
  }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    const frames = [
      '<p id="t" style="color:var(--color-ink)">変数</p>',
      '<meta name="color-scheme" content="light dark"><p id="t">meta</p>',
      '<style>body{background:var(--color-bg)}</style><p id="t">橋の変数 bg</p>',
    ]
      .map((h) => lines(`${BT}html-app height=120`, h, BT))
      .join('\n');
    await app.switchTopic(page, 'opt', 'オプトイン', `# 題\n\n${frames}`);
    await settled(page);
    for (const n of [0, 1, 2]) {
      const html = page.frameLocator('#article iframe.appframe').nth(n).locator('html');
      await expect.poll(() => html.getAttribute('data-theme'), `枠 ${n}`).toBe('dark');
      expect(await html.getAttribute('data-follow')).not.toBeNull();
    }
    expect(await frameCss(page, 0, 'body', 'background-color')).toBe('rgb(9, 9, 11)');
    expect(await frameCss(page, 2, 'body', 'background-color')).toBe('rgb(9, 9, 11)');
  });
});

test.describe('配色の供給（ダーク追従）と、枠のライト/ダーク', () => {
  // 1 つ目：配色への対応を示した枠（画面の外観に従う）。2 つ目：従来の枠（何も示さない：常にライト・自分で全部書いた）
  const DOC = `# 色\n\n${GROW('', true)}\n${lines(`${BT}html-app height=200`, '<p id="p">legacy</p><div id="own" style="background:#abc;color:#123">自分で全部書いた</div>', BT)}`;

  test('ダーク：枠の中の背景・文字が、ダークの値。ライトに戻すと、ライトの値。再読み込みしない（枠の中の状態が、保たれる）', async ({
    page,
    app,
  }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await app.switchTopic(page, 'col', '色', DOC);
    await settled(page);
    const frame = iframeAt(page, 0);
    const f = page.frameLocator('#article iframe.appframe').first();
    await expect(frame).toHaveAttribute('src', /\?mode=dark$/);
    await expect.poll(() => frameCss(page, 0, 'body', 'background-color')).toBe('rgb(9, 9, 11)');
    expect(await frameCss(page, 0, 'body', 'color')).toBe('rgb(250, 250, 250)');
    await f.locator('#inc').click();
    await f.locator('#inc').click();
    await expect(f.locator('#count')).toHaveText('2');
    const handle = await frame.elementHandle();
    // 画面の外観を、切り替える（system[ダーク] → light）
    await page.locator('#btn-theme').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect.poll(() => frameCss(page, 0, 'body', 'background-color')).toBe('rgb(255, 255, 255)');
    expect(await frameCss(page, 0, 'body', 'color')).toBe('rgb(24, 24, 27)');
    await expect(f.locator('#count')).toHaveText('2'); // 再読み込みしていない
    expect(await (await iframeAt(page, 0).elementHandle())?.evaluate((e, h) => e === h, handle)).toBe(true);
    // ダークへ
    await page.locator('#btn-theme').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect.poll(() => frameCss(page, 0, 'body', 'background-color')).toBe('rgb(9, 9, 11)');
    await expect(f.locator('#count')).toHaveText('2');
    // 自分で全部書いた従来の枠：土台が、そもそも、ない。画面がダークでも、従来のまま（data-theme・color-scheme を付けない）
    expect(await frameCss(page, 1, '#own', 'background-color')).toBe('rgb(170, 187, 204)');
    expect(await frameCss(page, 1, '#own', 'color')).toBe('rgb(17, 34, 51)');
    const legacy = page.frameLocator('#article iframe.appframe').nth(1).locator('html');
    expect(await legacy.getAttribute('data-theme')).toBeNull();
    expect(await legacy.evaluate((e) => getComputedStyle(e).colorScheme)).toBe('normal');
  });

  test('OS の外観（system）が変わると、再読み込みなしで、枠も追従する', async ({ page, app }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await app.switchTopic(page, 'os', '色', DOC);
    await settled(page);
    const f = page.frameLocator('#article iframe.appframe').first();
    await expect.poll(() => frameCss(page, 0, 'body', 'background-color')).toBe('rgb(255, 255, 255)');
    await f.locator('#inc').click();
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect.poll(() => frameCss(page, 0, 'body', 'background-color')).toBe('rgb(9, 9, 11)');
    await expect(f.locator('#count')).toHaveText('1');
  });

  test('枠のライト/ダーク：その枠だけ、画面の外観とは別に切り替わる（両方を比べられる）。再読み込みしない。画面の外観が変わると、画面に合う', async ({
    page,
    app,
  }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await app.switchTopic(page, 'fm', '色', DOC);
    await settled(page);
    const f = page.frameLocator('#article iframe.appframe').first();
    await f.locator('#inc').click();
    const caps = page.locator('#article .htmlapp .cap');
    const toggle = caps.first().locator('button[data-frame-mode]');
    await expect(toggle).toHaveAttribute('aria-label', '枠の外観：ライト。押すと、ダークにします');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-label', '枠の外観：ダーク。押すと、ライトにします');
    await expect.poll(() => frameCss(page, 0, 'body', 'background-color')).toBe('rgb(9, 9, 11)');
    expect(await frameCss(page, 1, 'body', 'color')).toBe('rgb(0, 0, 0)'); // 別の枠（従来の枠）は、そのまま
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'dark'); // 画面は、そのまま
    await expect(f.locator('#count')).toHaveText('1');
    await toggle.click();
    await expect.poll(() => frameCss(page, 0, 'body', 'background-color')).toBe('rgb(255, 255, 255)');
    // 枠だけダークにしてから、画面をダークへ：枠は、画面に従う
    await page.locator('#btn-theme').click(); // system → light
    await page.locator('#btn-theme').click(); // light → dark
    await expect.poll(() => frameCss(page, 0, 'body', 'background-color')).toBe('rgb(9, 9, 11)');
    // 従来の枠は、画面の外観が変わっても、従来のまま（黒い文字・data-theme なし）
    await page.waitForTimeout(400);
    expect(await frameCss(page, 1, 'body', 'color')).toBe('rgb(0, 0, 0)');
    expect(
      await page.frameLocator('#article iframe.appframe').nth(1).locator('html').getAttribute('data-theme'),
    ).toBeNull();
  });

  test('本文を描き直しても（コメントの追加）、枠の幅・枠だけの外観を、覚えている', async ({ page, app }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await app.switchTopic(page, 'mem', '色', `# 題\n\n最初の段落です。\n\n${GROW('', true)}`);
    const cap = page.locator('#article .htmlapp .cap').first();
    await cap.locator('button[data-width="375"]').click();
    await cap.locator('button[data-frame-mode]').click();
    await app.apply(
      { threads: [{ page: 'root', anchor: { quote: '最初の段落です' }, body: '確認です。' }] },
      { topic: 'mem' },
    );
    await expect(ui(page).threads).toHaveCount(1);
    await expect.poll(async () => (await boxOf(iframeAt(page, 0))).width).toBeCloseTo(375, 0);
    await expect.poll(() => frameCss(page, 0, 'body', 'background-color')).toBe('rgb(9, 9, 11)');
  });
});

test.describe('幅の切り替え', () => {
  test('スマートフォン 375・タブレット 768・デスクトップ 1280・1920・自動：本文（634px 前後）より狭い幅は、そのまま。広い幅は、その幅で計算して、本文の幅に縮小（下限 50%：収まらないときは、置き場が横にスクロール）。自動で戻る', async ({
    page,
    app,
  }) => {
    await app.switchTopic(page, 'w', '幅', `# 題\n\n${GROW('')}`);
    const frame = iframeAt(page, 0);
    const wrap = page.locator('#article .appview').first();
    const cap = page.locator('#article .htmlapp .cap').first();
    const full = (await boxOf(wrap)).width;
    expect(full).toBeGreaterThan(400);
    expect(full).toBeLessThan(700); // 普通の窓：本文の幅は、768 より狭い
    const inner = () =>
      page
        .frameLocator('#article iframe.appframe')
        .first()
        .locator('html')
        .evaluate(() => window.innerWidth);
    const pick = async (w: string) => {
      await cap.locator(`button[data-width="${w}"]`).click();
      await expect(cap.locator(`button[data-width="${w}"]`)).toHaveAttribute('aria-pressed', 'true');
    };
    await pick('375');
    await expect.poll(async () => (await boxOf(frame)).width).toBeCloseTo(375, 0);
    await expect.poll(inner).toBe(375); // 枠の幅を変えた直後は、枠の中の幅が、まだ前のことがある
    expect(await frame.evaluate((e) => e.style.transform)).toBe(''); // 狭い幅は、縮小しない
    for (const w of [768, 1280, 1920]) {
      await pick(String(w));
      // 枠の中は、その幅（window.innerWidth）。見た目は、本文の幅に縮小（下限 50%）
      await expect.poll(inner).toBe(w);
      const scale = Math.max(0.5, full / w);
      await expect.poll(async () => (await boxOf(frame)).width).toBeCloseTo(w * scale, 0);
      expect(await boxOf(wrap)).toMatchObject({ width: full });
      expect(await frame.evaluate((e) => Number(/scale\(([^)]+)\)/.exec(e.style.transform)?.[1]))).toBeCloseTo(
        scale,
        3,
      );
      // 下限で止まって、まだ収まらないときは、置き場が、横にスクロールする（ページ全体は、スクロールしない）
      const scrolls = w * scale > full + 0.5;
      expect(await wrap.evaluate((e) => e.scrollWidth > e.clientWidth + 0.5)).toBe(scrolls);
      await expect(cap.locator(`button[data-width="${w}"]`)).toHaveAttribute(
        'title',
        new RegExp(`${w}px・表示は ${Math.round(scale * 100)}% に縮小${scrolls ? '。横にスクロールできます' : ''}）`),
      );
      expect(await page.locator('#docscroll').evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
    }
    // 狭い幅の title には、縮小率がない
    await expect(cap.locator('button[data-width="375"]')).toHaveAttribute('title', '枠の幅：スマートフォン（375px）');
    await pick('auto');
    await expect.poll(async () => (await boxOf(frame)).width).toBeCloseTo(full, 0);
    await expect.poll(inner).toBeCloseTo(full, 0);
    expect(await frame.evaluate((e) => [e.style.width, e.style.transform])).toEqual(['', '']);
    expect(
      await page
        .locator('#article .appscale')
        .first()
        .evaluate((e) => [e.style.width, e.style.height]),
    ).toEqual(['', '']);
  });

  test('縮小した枠（本文 634px・1280）：@media (min-width) が効く・クリック・入力・スクロールが、正しく届く・高さが、縮小に追従する・本文の幅が変わると、縮小率が追従する', async ({
    page,
    app,
  }) => {
    const doc = lines(
      `${BT}html-app`,
      '<style>#m{color:rgb(1,2,3)}@media (min-width:1000px){#m{color:rgb(4,5,6)}}#box{height:300px;overflow:auto;border:1px solid #888}#tall{height:900px}</style>',
      '<p id="m">幅で色が変わる</p>',
      '<button id="inc">数える</button><span id="count">0</span> <input id="inp" placeholder="入力">',
      '<div id="box"><div id="tall">長い中身</div></div>',
      '<script>var n=0;document.getElementById("inc").onclick=function(){n++;document.getElementById("count").textContent=n};</script>',
      BT,
    );
    await app.switchTopic(page, 'sc', '縮小', `# 題\n\n${doc}`);
    await settled(page);
    const f = page.frameLocator('#article iframe.appframe').first();
    const frame = iframeAt(page, 0);
    const wrap = page.locator('#article .appview').first();
    const cap = page.locator('#article .htmlapp .cap').first();
    expect(await frameCss(page, 0, '#m', 'color')).toBe('rgb(1, 2, 3)');
    const full = (await boxOf(wrap)).width;
    await cap.locator('button[data-width="1280"]').click();
    await expect.poll(() => frameCss(page, 0, '#m', 'color')).toBe('rgb(4, 5, 6)'); // @media (min-width: 1000px)
    await expect.poll(() => f.locator('html').evaluate(() => window.innerWidth)).toBe(1280);
    expect(await boxOf(wrap)).toMatchObject({ width: full });
    await settled(page);
    // 高さ：縮小後の大きさを持つ箱（.appscale）＝枠の高さ（CSS）× 縮小率。見た目の枠の高さと、同じ
    const s = Math.max(0.5, full / 1280); // 本文 634px：49.5% → 下限 50%（置き場は、わずかに、横にスクロールする）
    await expect
      .poll(async () => {
        const h = await heightOf(frame);
        const w = (await boxOf(page.locator('#article .appscale').first())).height;
        const v = (await boxOf(frame)).height;
        return Math.abs(w - h * s) < 1.5 && Math.abs(v - h * s) < 1.5;
      })
      .toBe(true);
    // 操作：縮小した枠の中のボタン・入力に、本物のマウス・キーボードが、正しく届く
    await realClick(page, 0, '#inc');
    await realClick(page, 0, '#inc');
    await expect(f.locator('#count')).toHaveText('2');
    await realClick(page, 0, '#inp');
    await page.keyboard.type('abc');
    await expect(f.locator('#inp')).toHaveValue('abc');
    // 枠の中のスクロール（縮小した枠の中の箱）：ホイールが、その箱に届く
    const box = await centerInFrame(page, 0, '#box');
    await page.mouse.move(box.x, box.y);
    await page.mouse.wheel(0, 200);
    await expect.poll(() => f.locator('#box').evaluate((e) => e.scrollTop)).toBeGreaterThan(50);
    // 横にスクロールしない・枠の線・輪が切れない余白
    expect(await page.locator('#docscroll').evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
    expect(await wrap.evaluate((e) => getComputedStyle(e).overflowX)).toBe('auto'); // 下限で止まった：横にスクロール
    expect(await wrap.evaluate((e) => getComputedStyle(e).overflowY)).toBe('hidden');
    // 「この枠にコメント」：縮小した枠でも、そのまま使える（枠全体が、コメントの対象）
    await cap.getByRole('button', { name: 'この枠にコメント' }).click();
    await expect(ui(page).composer).toBeVisible();
    // 窓の幅が変わる（左の一覧をしまう）と、縮小率が、追従する
    await page.locator('#btn-side').click();
    await expect.poll(async () => (await boxOf(wrap)).width).not.toBeCloseTo(full, 0);
    const full2 = (await boxOf(wrap)).width;
    await expect
      .poll(async () => (await frame.evaluate((e) => Number(/scale\(([^)]+)\)/.exec(e.style.transform)?.[1]))) * 1280)
      .toBeCloseTo(full2, 0);
    expect(Math.abs((await boxOf(frame)).width - full2)).toBeLessThan(1.5);
  });

  test('縮小した枠の下のコメント：強調・番号の丸・関連の線が、縮小・高さの変化に追従する', async ({ page, app }) => {
    await app.switchTopic(
      page,
      'scp',
      '位置',
      `# 題\n\n${GROW('')}\n枠の下の段落です。ここにコメントを付けます。\n\n最後の段落です。\n`,
    );
    await app.apply(
      { threads: [{ page: 'root', anchor: { quote: '枠の下の段落です' }, body: '確認です。' }] },
      { topic: 'scp' },
    );
    await expect(ui(page).threads).toHaveCount(1);
    await settled(page);
    const mark = page.locator('#article mark.hl').first();
    const badge = ui(page).bno.first();
    await expect(badge).toBeVisible();
    const cap = page.locator('#article .htmlapp .cap').first();
    const rel = async () => {
      const m = await boxOf(mark);
      const b = await boxOf(badge);
      const dot = await page
        .locator('#links circle.cn-dot')
        .first()
        .evaluate((e) => Number(e.getAttribute('cy')));
      const last = await mark.evaluate((e) => {
        const r = e.getClientRects();
        const l = r[r.length - 1] as DOMRect;
        return l.top + l.height / 2;
      });
      return { markTop: m.y, delta: b.y - m.y, dotDelta: dot - last };
    };
    await cap.locator('button[data-width="1920"]').click();
    await settled(page);
    await page.waitForTimeout(500);
    const before = await stableValue(rel);
    for (let i = 0; i < 6; i++) await realClick(page, 0, '#add'); // 枠の中身が増える（縮小しているので、見た目の増え方は、小さい）
    await expect.poll(async () => (await stableValue(rel)).markTop).toBeGreaterThan(before.markTop + 40);
    await page.waitForTimeout(500);
    const after = await stableValue(rel);
    expect(Math.abs(after.delta - before.delta), `番号の丸：${before.delta} → ${after.delta}`).toBeLessThanOrEqual(6);
    expect(Math.abs(after.dotDelta), `線の点：${after.dotDelta}`).toBeLessThanOrEqual(6);
    // 幅を戻すと、また、追従する
    await cap.locator('button[data-width="auto"]').click();
    await page.waitForTimeout(600);
    const back = await stableValue(rel);
    expect(Math.abs(back.delta - before.delta)).toBeLessThanOrEqual(6);
    expect(Math.abs(back.dotDelta)).toBeLessThanOrEqual(6);
  });

  test('1920（本文 634px）：縮小は 50% で止まり、置き場が横にスクロールする。枠の左端から右端まで、スクロールで、たどり着ける（右端の要素も押せる）。コメントの位置は、ずれない', async ({
    page,
    app,
  }) => {
    const doc = lines(
      `${BT}html-app height=200`,
      '<style>body{margin:0}#l{position:absolute;left:8px;top:8px}#r{position:absolute;right:8px;top:8px}</style>',
      '<button id="l">左端</button><button id="r">右端</button><span id="out" style="position:absolute;left:300px;top:60px">0</span>',
      '<script>document.getElementById("r").onclick=function(){document.getElementById("out").textContent="右端を押した"};</script>',
      BT,
    );
    await app.switchTopic(page, 'w19', '1920', `# 題\n\n${doc}\n枠の下の段落です。ここにコメントを付けます。\n`);
    await app.apply(
      { threads: [{ page: 'root', anchor: { quote: '枠の下の段落です' }, body: '確認です。' }] },
      { topic: 'w19' },
    );
    await expect(ui(page).threads).toHaveCount(1);
    await settled(page);
    const wrap = page.locator('#article .appview').first();
    const cap = page.locator('#article .htmlapp .cap').first();
    const frame = iframeAt(page, 0);
    const full = (await boxOf(wrap)).width;
    await cap.locator('button[data-width="1920"]').click();
    await expect.poll(() => frame.evaluate((e) => e.style.transform)).toBe('scale(0.5)');
    expect(await frame.evaluate((e) => (e as HTMLElement).offsetWidth)).toBe(1920);
    expect(await boxOf(frame)).toMatchObject({ width: 960 });
    expect(await boxOf(wrap)).toMatchObject({ width: full }); // 置き場は、本文の幅
    await expect(cap.locator('button[data-width="1920"]')).toHaveAttribute(
      'title',
      /50% に縮小。横にスクロールできます/,
    );
    // 横にスクロールできる：右端までスクロールすると、枠の右端が見える
    const max = await wrap.evaluate((e) => e.scrollWidth - e.clientWidth);
    expect(max).toBeGreaterThan(300); // 960 - 634
    expect(await wrap.evaluate((e) => getComputedStyle(e).overflowX)).toBe('auto');
    expect(await page.locator('#docscroll').evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true); // ページ全体は、スクロールしない
    // 縮小した枠（1920 の半分）の、本文の幅の外側にある「右端」ボタンは、最初は、見えない。横スクロールで、見えて、押せる
    const wrapBox = await boxOf(wrap);
    const r0 = await centerInFrame(page, 0, '#r');
    expect(r0.x).toBeGreaterThan(wrapBox.x + wrapBox.width); // 置き場の右の外（切れている）
    await wrap.evaluate((e) => {
      e.scrollLeft = e.scrollWidth;
    });
    await expect.poll(async () => (await centerInFrame(page, 0, '#r')).x).toBeLessThan(wrapBox.x + wrapBox.width);
    await page.waitForTimeout(300); // 枠が動いた直後の数 ms は、Chrome が、枠への入力の宛先を更新している最中で、押したことが、枠に届かないことがある（人の操作の速さでは、起きない）
    await realClick(page, 0, '#r', false);
    await expect(page.frameLocator('#article iframe.appframe').first().locator('#out')).toHaveText('右端を押した');
    // コメント：番号の丸・線の点が、強調に付いたまま
    const mark = page.locator('#article mark.hl').first();
    await expect
      .poll(() =>
        stableValue(async () => {
          const m = await boxOf(mark);
          const b = await boxOf(ui(page).bno.first());
          return Math.abs(b.y - m.y) <= 12;
        }),
      )
      .toBe(true);
    // 自動に戻すと、スクロールも縮小も、なくなる
    await cap.locator('button[data-width="auto"]').click();
    await expect.poll(() => frame.evaluate((e) => e.style.transform)).toBe('');
    expect(await wrap.evaluate((e) => [e.scrollLeft, getComputedStyle(e).overflowX])).toEqual([0, 'visible']);
  });

  test('UI のモック（作り物）を、モバイルとデスクトップで見比べる：幅で、レイアウトが変わる（@media）', async ({
    page,
    app,
  }) => {
    const mock = lines(
      `${BT}html-app`,
      '<style>',
      '.bar{display:flex;gap:8px;align-items:center;padding:8px 12px;background:var(--color-surface);border-bottom:1px solid var(--color-line)}',
      '.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;padding:12px}',
      '.card{border:1px solid var(--color-line);border-radius:var(--radius);padding:12px}',
      '.primary{background:var(--color-accent-fill);color:#fff;border-color:transparent}',
      '@media (max-width:480px){.grid{grid-template-columns:1fr}.bar span{display:none}}',
      '</style>',
      '<div class="bar"><strong>注文</strong><span>ダッシュボード</span><span style="margin-left:auto"><button class="primary">新規</button></span></div>',
      '<div class="grid"><div class="card">A<br>カード</div><div class="card">B<br>カード</div><div class="card">C<br>カード</div></div>',
      BT,
    );
    await app.switchTopic(page, 'mock', 'モック', `# モック\n\n${mock}`);
    const cap = page.locator('#article .htmlapp .cap').first();
    const f = page.frameLocator('#article iframe.appframe').first();
    const frame = iframeAt(page, 0);
    await expect.poll(async () => (await boxOf(frame)).width).toBeGreaterThan(600);
    const desktopH = await heightOf(frame);
    await cap.locator('button[data-width="375"]').click();
    await expect.poll(() => heightOf(frame)).toBeGreaterThan(desktopH + 60); // 1 列になって、高くなる
    expect(await f.locator('.grid').evaluate((e) => getComputedStyle(e).gridTemplateColumns.split(' ').length)).toBe(1);
    await cap.locator('button[data-width="auto"]').click();
    await expect.poll(() => heightOf(frame)).toBeLessThanOrEqual(desktopH + 2);
    expect(await f.locator('.grid').evaluate((e) => getComputedStyle(e).gridTemplateColumns.split(' ').length)).toBe(3);
  });
});

test.describe('安全', () => {
  test('隔離は、そのまま：sandbox は allow-scripts だけ・CSP は変わらない・?mode の細工は効かない・合言葉なしは 403', async ({
    page,
    app,
  }) => {
    await app.switchTopic(page, 'sec', '安全', `# 題\n\n${GROW('')}`);
    const frame = iframeAt(page, 0);
    expect(((await frame.getAttribute('sandbox')) ?? '').trim().split(/\s+/)).toEqual(['allow-scripts']);
    expect((await frame.getAttribute('allow')) ?? '').toBe('');
    const CSP =
      "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";
    for (const q of ['', '?mode=dark', '?mode=light', `?mode=${encodeURIComponent('evil"><script>1</script>')}`]) {
      const r = await app.http(`/appframe/sec/root/1/0${q}`, { auth: true });
      expect(r.status, q).toBe(200);
      expect(r.headers['content-security-policy'], q).toBe(CSP);
      if (q.includes('evil')) expect(r.body).not.toContain('evil');
    }
    expect((await app.http('/appframe/sec/root/1/0?mode=dark')).status).toBe(403);
    expect(
      await page
        .frameLocator('#article iframe.appframe')
        .first()
        .locator('html')
        .evaluate(() => window.origin),
    ).toBe('null');
  });

  test('偽の知らせ（巨大・負・NaN・文字・連打）を送る枠が、画面を壊さない。高さは、上下限の中。ほかの枠の高さ・外観を変えられない', async ({
    page,
    app,
  }) => {
    const evil = lines(
      `${BT}html-app`,
      '<p>悪意のある枠</p>',
      '<script>',
      'var bad = [1e12, -50, NaN, Infinity, "900", null, {valueOf: function(){return 900}}, [900], 0, 5];',
      "bad.forEach(function (h) { parent.postMessage({ __rikai: 1, type: 'resize', height: h }, '*'); });",
      "parent.postMessage({ __rikai: 1, type: 'resize', height: 600, extra: 'x' }, '*');",
      // ほかの枠への、なりすまし（高さ・外観）。窓の参照は、親を通って、取れる（postMessage だけは、できる）
      "try { for (var i = 0; i < parent.frames.length; i++) { if (parent.frames[i] !== window) { parent.frames[i].postMessage({ __rikai: 1, type: 'resize', height: 2000 }, '*'); parent.frames[i].postMessage({ __rikai: 1, type: 'theme', mode: 'dark', by: 'user' }, '*'); parent.frames[i].postMessage({ __rikai: 1, type: 'theme', mode: 'dark', by: 'auto' }, '*'); } } } catch (e) {}",
      "setTimeout(function () { for (var k = 0; k < 20000; k++) parent.postMessage({ __rikai: 1, type: 'resize', height: 300 + (k % 1500) }, '*'); }, 400);",
      '</script>',
      BT,
    );
    const quiet = lines(
      `${BT}html-app`,
      '<div id="q" style="height:150px;background:#9c9;color:var(--color-ink)">静かな枠</div>',
      BT,
    );
    await app.switchTopic(page, 'evil', '悪意', `# 題\n\n${evil}\n${quiet}`);
    await expect
      .poll(() => heightOf(iframeAt(page, 1)), { message: '静かな枠が、自分の高さ（150 + 余白 24）に' })
      .toBe(174);
    const own = await heightOf(iframeAt(page, 1));
    await page.waitForTimeout(2500);
    // 静かな枠：高さ・外観は、そのまま
    expect(await heightOf(iframeAt(page, 1))).toBe(own);
    expect(await frameCss(page, 1, 'body', 'background-color')).toBe('rgb(255, 255, 255)'); // 対応を示した静かな枠：ライトのまま（偽の theme は、送り元が親でないので、効かない）
    // 悪意のある枠：自分の高さだけが、上下限の中で変わる
    const eh = await heightOf(iframeAt(page, 0));
    expect(eh).toBeGreaterThanOrEqual(120);
    expect(eh).toBeLessThanOrEqual(2400);
    // 画面は、生きている：入力・ボタン・描画が、すぐ返る
    const t0 = Date.now();
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(0))));
    expect(Date.now() - t0).toBeLessThan(1000);
    await expect(ui(page).top).toBeVisible();
    await page.locator('#btn-theme').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', /light|dark/);
    // 枠は、画面に触れていない
    expect(await page.evaluate(() => document.body.getAttribute('data-hacked'))).toBeNull();
  });

  test('画面のほかの iframe（添付画像のプレビューなど）や、ほかの窓からの知らせは、効かない（送り元の窓で検査する）', async ({
    page,
    app,
  }) => {
    await app.switchTopic(page, 'src', '送り元', `# 題\n\n${GROW('')}`);
    const frame = iframeAt(page, 0);
    await expect.poll(() => heightOf(frame)).toBeLessThan(200);
    const own = await heightOf(frame);
    // 画面が置いた枠ではない iframe（about:blank）と、画面自身から、偽の知らせ
    await page.evaluate(() => {
      const ifr = document.createElement('iframe');
      document.body.append(ifr);
      const msg = { __rikai: 1, type: 'resize', height: 1500 };
      ifr.contentWindow?.parent.postMessage(msg, '*');
      window.postMessage(msg, '*');
      ifr.remove();
    });
    await page.waitForTimeout(800);
    expect(await heightOf(frame)).toBe(own);
  });
});

test.describe('位置の追従', () => {
  test('枠の高さが変わると、コメントの強調・番号の丸が、追従する（枠の下の段落）', async ({ page, app }) => {
    await app.switchTopic(
      page,
      'pos',
      '位置',
      `# 題\n\n${GROW('')}\n枠の下の段落です。ここにコメントを付けます。\n\n最後の段落です。\n`,
    );
    await app.apply(
      { threads: [{ page: 'root', anchor: { quote: '枠の下の段落です' }, body: '確認です。' }] },
      { topic: 'pos' },
    );
    await expect(ui(page).threads).toHaveCount(1);
    const mark = page.locator('#article mark.hl').first();
    const badge = ui(page).bno.first();
    await expect(badge).toBeVisible();
    await expect.poll(() => heightOf(iframeAt(page, 0))).toBeLessThan(200);
    const rel = async () => {
      const m = await boxOf(mark);
      const b = await boxOf(badge);
      return { markTop: m.y, delta: b.y - m.y };
    };
    await page.waitForTimeout(500);
    const before = await stableValue(rel);
    const f = page.frameLocator('#article iframe.appframe').first();
    for (let i = 0; i < 6; i++) await f.locator('#add').click();
    await expect.poll(async () => (await stableValue(rel)).markTop).toBeGreaterThan(before.markTop + 380);
    await page.waitForTimeout(500);
    const after = await stableValue(rel);
    expect(
      Math.abs(after.delta - before.delta),
      `番号の丸は、強調に付いている：${before.delta} → ${after.delta}`,
    ).toBeLessThanOrEqual(6);
    // 関連の線の、本文側の点：強調の、最後の行の右端の中央に付いている（高さが変わったあとも）
    await expect
      .poll(async () =>
        stableValue(async () => {
          const dot = await page
            .locator('#links circle.cn-dot')
            .first()
            .evaluate((e) => Number(e.getAttribute('cy')));
          const mk = await mark.evaluate((e) => {
            const r = e.getClientRects();
            const l = r[r.length - 1] as DOMRect;
            return l.top + l.height / 2;
          });
          return Math.abs(dot - mk);
        }),
      )
      .toBeLessThanOrEqual(6);
  });
});

test.describe('100vh のヒーローの下に、本物の中身が続く資料：枠の中を、スクロールして、最後まで読める', () => {
  const section = (i: number) =>
    `<section style="padding:24px 12px;height:400px"><h2>節 ${i}</h2><p>本物の節 ${i} の中身です。</p></section>`;
  const wheelUntilBottom = async (page: Page, n: number): Promise<void> => {
    const frame = iframeAt(page, n);
    const box = await boxOf(frame);
    await page.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height / 2, 200));
    for (let i = 0; i < 60; i++) {
      const done = await page
        .frameLocator('#article iframe.appframe')
        .nth(n)
        .locator('html')
        .evaluate((e) => e.scrollTop + window.innerHeight >= e.scrollHeight - 2);
      if (done) return;
      await page.mouse.wheel(0, 600);
      await page.waitForTimeout(60);
    }
  };

  test('ヒーロー（min-height:100vh）＋ 下に本物の節 4 つ：ホイールで、枠の中をスクロールでき、最後の節に、たどり着ける（overflow を、隠さない）', async ({
    page,
    app,
  }) => {
    const doc = lines(
      `${BT}html-app`,
      '<style>.hero{min-height:100vh;background:linear-gradient(#eef,#fee);padding:24px}</style>',
      '<div class="hero"><h1>ヒーロー</h1><p>最初の画面いっぱいの部分</p></div>',
      ...[1, 2, 3, 4].map(section),
      '<p id="last">最後の行です</p>',
      BT,
    );
    await app.switchTopic(page, 'land', 'ランディング', `# 題\n\n${doc}`);
    await page.waitForTimeout(3500);
    const html = page.frameLocator('#article iframe.appframe').first().locator('html');
    // 隠していない：縦に、スクロールできる状態
    expect(await html.evaluate((e) => getComputedStyle(e).overflowY)).not.toBe('hidden');
    expect(await html.evaluate((e) => e.scrollHeight)).toBeGreaterThan(
      (await html.evaluate(() => window.innerHeight)) + 100,
    );
    // 落ち着く
    const h = await heightOf(iframeAt(page, 0));
    expect(h).toBeLessThanOrEqual(2400);
    await page.waitForTimeout(1500);
    expect(await heightOf(iframeAt(page, 0))).toBe(h);
    // ホイールで、枠の中が、動く。最後の行まで、たどり着ける
    await wheelUntilBottom(page, 0);
    expect(await html.evaluate((e) => e.scrollTop)).toBeGreaterThan(100);
    const last = await html.evaluate(() => {
      const r = (document.getElementById('last') as HTMLElement).getBoundingClientRect();
      return { bottom: r.bottom, inner: window.innerHeight };
    });
    expect(last.bottom, '最後の行が、枠の中で、見える').toBeLessThanOrEqual(last.inner + 1);
    expect(last.bottom).toBeGreaterThan(0);
  });

  test('html,body{height:100%} の後ろに段落が続く資料：最後の行が、見える（または、スクロールで、たどり着ける）', async ({
    page,
    app,
  }) => {
    const paras = Array.from({ length: 30 }, (_, i) => `<p>段落 ${i + 1}：本文が続きます。</p>`);
    const doc = lines(
      `${BT}html-app`,
      '<style>html,body{height:100%}</style>',
      '<h1>見出し</h1>',
      ...paras,
      '<p id="last">最後の行です</p>',
      BT,
    );
    await app.switchTopic(page, 'h100', '高さ 100%', `# 題\n\n${doc}`);
    await page.waitForTimeout(3500);
    const html = page.frameLocator('#article iframe.appframe').first().locator('html');
    await wheelUntilBottom(page, 0);
    const last = await html.evaluate(() => {
      const r = (document.getElementById('last') as HTMLElement).getBoundingClientRect();
      return { bottom: r.bottom, inner: window.innerHeight };
    });
    expect(last.bottom, '最後の行が、枠の中で、見える').toBeLessThanOrEqual(last.inner + 1);
    expect(last.bottom).toBeGreaterThan(0);
  });
});

test.describe('見た目', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(`狭い窓（${scheme}）：見出しの行のツールバーが、本文からはみ出さない。横にスクロールしない`, async ({
      page,
      app,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await app.switchTopic(page, `nw-${scheme}`, '狭い窓', `# 題\n\n${GROW('')}`);
      await page.setViewportSize({ width: 560, height: 800 });
      await expect(page.locator('#article .apptools')).toBeVisible();
      // 窓の大きさの変更が、レイアウトに届くまで待つ：はみ出しの一覧が、空になる
      await expect
        .poll(async () => {
          const art = await boxOf(page.locator('#article'));
          const right = art.x + art.width + 1;
          const bad: string[] = [];
          const cap = await boxOf(page.locator('#article .htmlapp .cap').first());
          if (cap.x + cap.width > right) bad.push('見出しの行');
          for (const b of await page.locator('#article .apptools button').all()) {
            const r = await boxOf(b);
            if (r.x + r.width > right) bad.push('ボタン');
          }
          if ((await boxOf(iframeAt(page, 0))).width > art.width + 1) bad.push('枠');
          if (!(await page.locator('#docscroll').evaluate((e) => e.scrollWidth <= e.clientWidth + 1)))
            bad.push('横スクロール');
          return bad;
        })
        .toEqual([]);
    });
  }
});

test.describe('見た目（420px の窓）', () => {
  test('ツールバーが、枠の置き場（.htmlapp）の右からはみ出さない（折り返す）', async ({ page, app }) => {
    await app.switchTopic(page, 'n420', '狭い窓', `# 題\n\n${GROW('')}`);
    await page.setViewportSize({ width: 420, height: 800 });
    await expect(page.locator('#article .apptools')).toBeVisible();
    await expect
      .poll(async () => {
        const box = await boxOf(page.locator('#article .htmlapp').first());
        const bad: string[] = [];
        for (const b of await page.locator('#article .apptools button').all()) {
          const r = await boxOf(b);
          if (r.x + r.width > box.x + box.width + 0.5 || r.x < box.x - 0.5) bad.push('ボタン');
        }
        if (!(await page.locator('#docscroll').evaluate((e) => e.scrollWidth <= e.clientWidth + 1)))
          bad.push('横スクロール');
        return bad;
      })
      .toEqual([]);
    // 6 つのボタンが、すべて見える・押せる
    for (const b of await page.locator('#article .apptools button').all()) await expect(b).toBeVisible();
    await page.locator('#article .apptools button[data-frame-mode]').click();
  });
});
