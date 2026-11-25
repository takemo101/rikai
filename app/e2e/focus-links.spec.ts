// 拡大表示の関連の線（F55）：ステージの範囲の枠（.fv-box）と、右のドックのコメントのカードを、本文と同じ線（<svg class="fv-links">）で結ぶ。
// 画像・Mermaid・draw.io の図・html-app で、実際の Chrome・本物のマウス・キー。端点の座標を、実際の枠・カードの端と比べる。資料・コメントは、作り物。
import type { Page } from '@playwright/test';
import { drawioBlock, HOTEL } from './drawio-samples';
import { expect, type RikaiApp, test } from './fixtures';
import { makePng } from './samples';
import { box, dragBox, ui } from './ui';

const BT = '```';
const MM = `${BT}mermaid\nflowchart LR\n  A[呼び出し] --> B{成功?}\n  B -- はい --> C[返す]\n  B -- いいえ --> D[待つ]\n${BT}`;
const APP = `${BT}html-app height=320
<style>body{margin:0;font:16px sans-serif}.band{background:#e11d48;color:#fff;height:100px;padding:20px;box-sizing:border-box}</style>
<div class="band">赤い帯</div>
<input id="r" type="range" min="0" max="100" value="20"> <button id="go">ボタン</button>
${BT}`;
const DOC = `# 線の確認\n\n前の段落です。\n\n![色見本](assets/p.png)\n\n${MM}\n\n${drawioBlock(HOTEL)}\n\n${APP}\n\n後の段落です。\n`;
const SLUG = 'fl';
type Rect = [x: number, y: number, w: number, h: number];
/** 縦の中央が、すべて違う（同じ行にならない）範囲 */
const DISTINCT: Rect[] = [
  [0.05, 0.05, 0.3, 0.12],
  [0.4, 0.3, 0.3, 0.12],
  [0.1, 0.6, 0.3, 0.12],
];

async function open(page: Page, app: RikaiApp, width = 1360, height = 900) {
  await page.setViewportSize({ width, height });
  await app.switchTopic(page, SLUG, '線の確認', DOC, { 'p.png': makePng(1200, 700) });
  await expect.poll(() => page.locator('#article img').evaluate((i) => (i as HTMLImageElement).complete)).toBe(true);
  await expect(page.locator('#article .mermaid-block svg')).toHaveCount(1);
  await expect(page.locator('#article .drawio-block svg')).toHaveCount(1);
  await expect(page.locator('#article iframe.appframe')).toHaveCount(1);
  await page.waitForTimeout(800);
}

type Kind = 'img' | 'mm' | 'dio' | 'app';
const BLOCK: Record<Kind, string> = {
  img: '#article .blk:has(> img), #article p.blk:has(img)',
  mm: '#article .mermaid-block',
  dio: '#article .drawio-block',
  app: '#article .htmlapp',
};
const ENTRY: Record<Exclude<Kind, 'app'>, string> = {
  img: '#article img',
  mm: '#article .mermaid-block svg',
  dio: '#article .drawio-block svg',
};

/** 対象のブロックに、範囲のコメント（rects）と、対象全体のコメント（whole）を付ける（HTTP の /api/comment。本物の画面の入力と同じ経路） */
async function comment(page: Page, app: RikaiApp, kind: Kind, rects: Rect[], whole: string[] = []) {
  const info = await page.evaluate((sel) => {
    const b = document.querySelector(sel) as HTMLElement;
    return { id: b.dataset.bid, hash: b.dataset.bhash, tag: b.tagName };
  }, BLOCK[kind]);
  const post = async (text: string, rect?: { x: number; y: number; w: number; h: number }) => {
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
          label: rect ? '範囲' : '対象全体',
          ...(rect ? { rect } : {}),
        },
        text,
        images: [],
      },
    });
    expect(r.status()).toBe(200);
  };
  for (const [i, [x, y, w, h]] of rects.entries()) await post(`範囲 ${i + 1}`, { x, y, w, h });
  for (const [i, t] of whole.entries()) await post(`全体 ${i + 1}：${t}`);
  await expect(ui(page).threads).toHaveCount(rects.length + whole.length);
}

async function openZoom(page: Page, kind: Kind) {
  if (kind === 'app') {
    const b = page.locator('#article .htmlapp .cap').getByRole('button', { name: '拡大表示', exact: true });
    await b.scrollIntoViewIfNeeded();
    await b.click();
    await expect(page.locator('#lightbox iframe.appframe')).toHaveCount(1);
    await page.waitForTimeout(1200);
  } else {
    const e = page.locator(ENTRY[kind]).first();
    await e.scrollIntoViewIfNeeded();
    await e.click();
    await expect.poll(async () => (await box(page.locator('#lightbox .lb-stage'))).width).toBeGreaterThan(50);
  }
  await expect(page.locator('#lightbox .fv-dock')).toBeVisible();
}

const links = (page: Page) => page.locator('svg.fv-links path[data-tid]');
const frames = (page: Page) =>
  page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));

interface Ends {
  tid: string;
  cls: string;
  edge: boolean;
  /** 本文側の丸（線の端点）・カード側の棒の中央（なければ null） */
  dot: { x: number; y: number } | null;
  bar: { x: number; y: number } | null;
  /** 実測：範囲の枠（なければ null）・対象（画像・図／枠の iframe）・カードの左端と、番号の丸の高さ */
  boxR: { left: number; right: number; mid: number } | null;
  media: { right: number; mid: number } | null;
  card: { x: number; y: number } | null;
}

/** 線の端点と、実際の枠・カードの実測（画面の座標） */
const ends = (page: Page): Promise<Ends[]> =>
  page.evaluate(() => {
    const media = document.querySelector('#lightbox .lb-stage, #lightbox .fv-app iframe')?.getBoundingClientRect();
    return [...document.querySelectorAll<SVGGElement>('svg.fv-links g[data-tid]')].map((g) => {
      const tid = g.dataset.tid as string;
      const dot = g.querySelector('circle.cn-dot');
      const bar = g.querySelector('line.cn-bar');
      const b = [...document.querySelectorAll<HTMLElement>('#lightbox .fv-box')]
        .find((e) => e.dataset.tid === tid)
        ?.getBoundingClientRect();
      const card = [...document.querySelectorAll<HTMLElement>('#lightbox .fv-dock .thread')].find(
        (e) => (e.classList.contains('composer') ? 'pending' : e.dataset.tid) === tid,
      );
      const no = card?.querySelector('.no')?.getBoundingClientRect();
      const cr = card?.getBoundingClientRect();
      return {
        tid,
        cls: g.getAttribute('class') ?? '',
        edge: g.classList.contains('edge'),
        dot: dot ? { x: Number(dot.getAttribute('cx')), y: Number(dot.getAttribute('cy')) } : null,
        bar: bar
          ? {
              x: Number(bar.getAttribute('x1')),
              y: (Number(bar.getAttribute('y1')) + Number(bar.getAttribute('y2'))) / 2,
            }
          : null,
        boxR: b ? { left: b.left, right: b.right, mid: b.top + b.height / 2 } : null,
        media: media ? { right: media.right, mid: media.top + media.height / 2 } : null,
        card: no && cr ? { x: cr.left, y: no.top + no.height / 2 } : null,
      };
    });
  });

const near = (a: number, b: number, tol = 1.5) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol);

/** 引いてある線（edge でない）の端点が、実際の枠（右端 + gap の外・縦の中央）・対象（全体のコメント。右端 + 6）・カード（左端・番号の丸の高さ）と、一致する */
async function expectEndsMatch(page: Page, n: number) {
  await expect(links(page)).toHaveCount(n);
  await frames(page);
  const all = await ends(page);
  expect(all).toHaveLength(n);
  for (const e of all.filter((x) => !x.edge)) {
    expect(e.dot, e.tid).not.toBeNull();
    expect(e.card, e.tid).not.toBeNull();
    const gap = e.tid === 'pending' ? 10 : 4;
    if (e.boxR) {
      near((e.dot as { x: number }).x, e.boxR.right + gap);
      near((e.dot as { y: number }).y, e.boxR.mid);
    } else {
      near((e.dot as { x: number }).x, (e.media as { right: number }).right + 6); // 対象全体：対象の右端
      near((e.dot as { y: number }).y, (e.media as { mid: number }).mid);
    }
    near((e.bar as { x: number }).x, (e.card as { x: number }).x);
    near((e.bar as { y: number }).y, (e.card as { y: number }).y);
  }
  return all;
}

test.describe('拡大表示の関連の線（F55）', () => {
  for (const kind of ['img', 'mm', 'dio', 'app'] as const) {
    test(`${{ img: '画像', mm: 'Mermaid の図', dio: 'draw.io の図', app: 'html-app' }[kind]}：範囲 3 件＋対象全体 1 件 → 線が 4 本。端点が、実際の枠・カードの端と一致する。aria-hidden・押せない・道具の下`, async ({
      page,
      app,
    }) => {
      await open(page, app);
      await comment(page, app, kind, DISTINCT, ['確認です']);
      await openZoom(page, kind);
      const all = await expectEndsMatch(page, 4);
      // 範囲 3 件は枠の右端・対象全体は対象の右端（枠が、ない）
      expect(all.filter((e) => e.boxR)).toHaveLength(3);
      expect(all.filter((e) => !e.boxR)).toHaveLength(1);
      // 線の置き場・装飾・押せない
      const svg = page.locator('#lightbox > svg.fv-links');
      await expect(svg).toHaveCount(1);
      await expect(svg).toHaveAttribute('aria-hidden', 'true');
      const st = await svg.evaluate((e) => {
        const cs = getComputedStyle(e);
        const tools = document.querySelector('#lightbox .lb-tools, #lightbox .fv-tools') as HTMLElement;
        return {
          pe: cs.pointerEvents,
          pos: cs.position,
          z: Number(cs.zIndex),
          toolsZ: Number(getComputedStyle(tools).zIndex),
        };
      });
      expect(st.pe).toBe('none');
      expect(st.pos).toBe('fixed');
      expect(st.z).toBeLessThan(st.toolsZ); // ツールバーの文字を、隠さない
      // 線は、カードの左端で止まる：カードの文字の上を通らない・iframe の中へは、入らない
      const geo = await page.evaluate(() => {
        const cardLeft = Math.min(
          ...[...document.querySelectorAll('#lightbox .fv-dock .thread')].map((e) => e.getBoundingClientRect().left),
        );
        const right = Math.max(
          ...[...document.querySelectorAll<SVGPathElement>('svg.fv-links path.cn')].map((p) => {
            const b = p.getBoundingClientRect();
            return b.right;
          }),
        );
        return { cardLeft, right, inFrame: document.querySelectorAll('iframe svg.fv-links').length };
      });
      expect(geo.right).toBeLessThanOrEqual(geo.cardLeft + 1);
      expect(geo.inFrame).toBe(0);
      // 線の上の点は、下の要素に届く（押せない）
      const hit = await page.evaluate(() => {
        const p = document.querySelector<SVGPathElement>('svg.fv-links path.cn') as SVGPathElement;
        const pt = p.getPointAtLength(p.getTotalLength() * 0.5);
        const m = p.getScreenCTM() as DOMMatrix;
        const x = pt.x * m.a + m.e;
        const y = pt.y * m.d + m.f;
        return !!document.elementFromPoint(x, y)?.closest('svg.fv-links');
      });
      expect(hit).toBe(false);
    });
  }

  test('画像：ズーム（キー・ホイール・ボタン）・移動（ドラッグ）に、線が追いかける（毎回、端点が、実際の枠と一致する）', async ({
    page,
    app,
  }) => {
    await open(page, app);
    await comment(page, app, 'img', DISTINCT, ['確認です']);
    await openZoom(page, 'img');
    await expectEndsMatch(page, 4);
    const before = (await ends(page)).map((e) => e.dot?.x);
    await page.keyboard.press('+');
    await page.keyboard.press('+');
    await frames(page);
    // 拡大で、枠が動いた（線の端点も動く）。見える範囲の外へ出た枠の線は、選んでいなければ、消える
    const z = await ends(page);
    expect(z.length).toBeGreaterThan(0);
    for (const e of z.filter((x) => !x.edge)) {
      near((e.dot as { x: number }).x, (e.boxR?.right ?? (e.media as { right: number }).right) + (e.boxR ? 4 : 6));
      near((e.bar as { y: number }).y, (e.card as { y: number }).y);
    }
    expect(z.map((e) => e.dot?.x)).not.toEqual(before);
    // ホイールで、さらに（カーソルを中心に）。ボタン（ズームアウト）で戻る
    await page.mouse.move(300, 400);
    await page.mouse.wheel(0, -200);
    await page.waitForTimeout(100);
    await frames(page);
    for (const e of (await ends(page)).filter((x) => !x.edge)) {
      near((e.bar as { y: number }).y, (e.card as { y: number }).y);
      if (e.boxR) near((e.dot as { x: number }).x, e.boxR.right + 4);
    }
    // 移動（ドラッグ）：枠が動き、線が追う
    const r0 = await box(page.locator('#lightbox .lb-stage'));
    await page.mouse.move(640, 700);
    await page.mouse.down();
    await page.mouse.move(600, 660, { steps: 5 });
    await page.mouse.up();
    await frames(page);
    const r1 = await box(page.locator('#lightbox .lb-stage'));
    expect(Math.abs(r1.x - r0.x) + Math.abs(r1.y - r0.y)).toBeGreaterThan(20);
    for (const e of (await ends(page)).filter((x) => !x.edge && x.boxR)) {
      near((e.dot as { x: number }).x, (e.boxR as { right: number }).right + 4);
      near((e.dot as { y: number }).y, (e.boxR as { mid: number }).mid);
    }
    // 全体に合わせる：4 本に戻って、一致する
    await page.getByRole('button', { name: '全体に合わせる' }).click();
    await expectEndsMatch(page, 4);
  });

  test('ドックのスクロール：カードが動くと、線のカード側が追いかける。見える範囲の外のカードの線は、消える', async ({
    page,
    app,
  }) => {
    await open(page, app);
    // 12 件：ドックが、スクロールする
    const rects: Rect[] = Array.from({ length: 12 }, (_, i) => [0.05 + (i % 6) * 0.14, 0.05 + i * 0.07, 0.12, 0.05]);
    await comment(page, app, 'img', rects);
    await openZoom(page, 'img');
    await expect.poll(async () => await links(page).count()).toBeGreaterThanOrEqual(2);
    const body = page.locator('#lightbox .fv-dock-body');
    expect(await body.evaluate((e) => e.scrollHeight > e.clientHeight)).toBe(true);
    const n0 = await links(page).count();
    await body.evaluate((e) => e.scrollTo(0, 500));
    await frames(page);
    const after = await ends(page);
    expect(after.length).toBeGreaterThan(0);
    for (const e of after.filter((x) => !x.edge)) near((e.bar as { y: number }).y, (e.card as { y: number }).y); // 動いたカードに、追従
    const tidsNow = after.map((e) => e.tid);
    // スクロールの上端の外へ出たカードの線は、引かない（見えている行だけ）
    const hidden = await page.evaluate(() => {
      const b = document.querySelector('#lightbox .fv-dock-body')?.getBoundingClientRect();
      return [...document.querySelectorAll<HTMLElement>('#lightbox .fv-dock .thread[data-tid]')]
        .filter((c) => c.getBoundingClientRect().bottom < (b?.top ?? 0))
        .map((c) => c.dataset.tid);
    });
    expect(hidden.length).toBeGreaterThan(0);
    for (const t of hidden) expect(tidsNow).not.toContain(t);
    await body.evaluate((e) => e.scrollTo(0, 0));
    await expect.poll(async () => await links(page).count()).toBe(n0);
  });

  test('カードを選ぶと active・枠にマウスを置くと linked（線が濃くなる・カードも光る）。解除すると戻る', async ({
    page,
    app,
  }) => {
    await open(page, app);
    await comment(page, app, 'img', DISTINCT);
    await openZoom(page, 'img');
    await expectEndsMatch(page, 3);
    const g = (tid: string) => page.locator(`svg.fv-links g[data-tid="${tid}"]`);
    const op = (tid: string) =>
      page
        .locator(`svg.fv-links path.cn[data-tid="${tid}"]`)
        .evaluate((p) => Number.parseFloat(getComputedStyle(p).strokeOpacity));
    const tids = await links(page).evaluateAll((l) => l.map((p) => (p as SVGElement).dataset.tid as string));
    const [t1, t2] = tids as [string, string];
    await page.waitForTimeout(250); // transition
    const base = await op(t1);
    // カード（見出し）を押す → active
    await page.locator(`#lightbox .fv-dock .thread[data-tid="${t1}"] .th-head`).click();
    await expect(g(t1)).toHaveClass(/active/);
    await expect(g(t2)).not.toHaveClass(/active/);
    await expect.poll(() => op(t1)).toBeGreaterThan(base);
    await expect(page.locator('svg.fv-links')).toHaveClass(/focus/);
    // 枠にマウスを置く → linked（カードにも .linked）
    const b2 = await box(page.locator(`#lightbox .fv-box[data-tid="${t2}"]`));
    await page.mouse.move(b2.x + b2.width / 2, b2.y + b2.height / 2);
    await expect(g(t2)).toHaveClass(/linked/);
    await expect(page.locator(`#lightbox .fv-dock .thread[data-tid="${t2}"]`)).toHaveClass(/linked/);
    await expect(page.locator(`#lightbox .fv-box[data-tid="${t2}"]`)).toHaveClass(/linked/);
    // 離すと、消える
    await page.mouse.move(5, 880);
    await expect(g(t2)).not.toHaveClass(/linked/);
  });

  test('「関連の線」ボタン（ドックの見出し）：消す・出す。右のパネルのボタン・本文の線と、同じ状態（ui.links）', async ({
    page,
    app,
  }) => {
    await open(page, app);
    await comment(page, app, 'img', DISTINCT);
    await openZoom(page, 'img');
    await expectEndsMatch(page, 3);
    const t = page.locator('button.fv-links-toggle');
    await expect(t).toHaveAttribute('aria-pressed', 'true');
    await t.click();
    await expect(t).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('svg.fv-links')).toHaveCount(0);
    // 閉じても、オフのまま（同じ状態）：本文のパネルのボタンも、本文の線も
    await page.keyboard.press('Escape');
    await expect(page.locator('#lightbox')).toBeHidden();
    await expect(page.locator('#links-toggle')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#links')).toHaveCount(0);
    // 本文のパネルで、オンに戻す → 拡大表示にも出る
    await page.locator('#links-toggle').click();
    await expect(page.locator('#links path[data-tid]')).not.toHaveCount(0);
    await openZoom(page, 'img');
    await expectEndsMatch(page, 3);
    await expect(page.locator('button.fv-links-toggle')).toHaveAttribute('aria-pressed', 'true');
  });

  test('線は、ステージの操作を妨げない：線の上からのドラッグで移動・範囲選択ができる。入力中の範囲は、点線（pending）でドックの入力欄と結ぶ', async ({
    page,
    app,
  }) => {
    await open(page, app);
    await comment(page, app, 'img', DISTINCT);
    await openZoom(page, 'img');
    await expectEndsMatch(page, 3);
    // 線（引き出しの点線）の上の点（ステージの中）
    const onLine = () =>
      page.evaluate(() => {
        const p = document.querySelector<SVGPathElement>('svg.fv-links path.cn-lead') as SVGPathElement;
        const pt = p.getPointAtLength(p.getTotalLength() * 0.6);
        return { x: pt.x, y: pt.y };
      });
    // 範囲選択：線の上から、ドラッグ
    await page.locator('#lightbox .fv-tools [data-tool="region"]').click();
    const s = await onLine();
    await dragBox(page, { x: s.x, y: s.y }, { x: s.x + 60, y: s.y + 50 });
    const composer = page.locator('#lightbox .fv-dock .thread.composer');
    await expect(composer).toBeVisible();
    // 入力中（pending）の線：入力中の枠の右端 + 10・入力欄の左端
    await expect(links(page)).toHaveCount(4);
    const all = await ends(page);
    const p = all.find((e) => e.tid === 'pending') as Ends;
    expect(p.cls).toContain('pending');
    expect(p.boxR).not.toBeNull();
    near((p.dot as { x: number }).x, (p.boxR as { right: number }).right + 10);
    near((p.dot as { y: number }).y, (p.boxR as { mid: number }).mid);
    near((p.bar as { x: number }).x, (p.card as { x: number }).x);
    near((p.bar as { y: number }).y, (p.card as { y: number }).y);
    expect(
      await page.locator('svg.fv-links g.pending path.cn').evaluate((e) => getComputedStyle(e).strokeDasharray),
    ).not.toBe('none');
    // 入力欄に打てる・入力中の線は、追加すると、通常の線になる
    await composer.locator('textarea').fill('線の上から選びました');
    await composer.getByRole('button', { name: 'コメントを追加' }).click();
    await expect(page.locator('svg.fv-links g.pending')).toHaveCount(0);
    await expect(links(page)).toHaveCount(4);
    // 移動：線の上から、ドラッグ（全体表示では動かないので、拡大してから）
    await page.keyboard.press('+');
    await page.keyboard.press('+');
    await frames(page);
    const r0 = await box(page.locator('#lightbox .lb-stage'));
    const s2 = await onLine();
    await dragBox(page, { x: s2.x, y: s2.y }, { x: s2.x - 70, y: s2.y - 40 });
    await frames(page);
    const r1 = await box(page.locator('#lightbox .lb-stage'));
    expect(Math.abs(r1.x - r0.x)).toBeGreaterThan(30);
  });

  test('同じ高さの範囲が複数：始点が、カードの順に、少しずつずれる（本文の fanOutSameRow と同じ）。線は、交差しない', async ({
    page,
    app,
  }) => {
    await open(page, app);
    // 縦の中央が同じ 3 つ（左・中・右）
    await comment(page, app, 'img', [
      [0.05, 0.2, 0.2, 0.2],
      [0.35, 0.2, 0.2, 0.2],
      [0.65, 0.2, 0.2, 0.2],
    ]);
    await openZoom(page, 'img');
    await expect(links(page)).toHaveCount(3);
    await frames(page);
    const starts = await page.evaluate(() =>
      [...document.querySelectorAll<SVGPathElement>('svg.fv-links path.cn')].map((p) => {
        const m = (p.getAttribute('d') ?? '').match(/^M([\d.-]+) ([\d.-]+)/) as RegExpMatchArray;
        const card = [...document.querySelectorAll<HTMLElement>('#lightbox .fv-dock .thread[data-tid]')].find(
          (c) => c.dataset.tid === (p as SVGElement).dataset.tid,
        );
        return { sy: Number(m[2]), cardTop: card?.getBoundingClientRect().top ?? 0 };
      }),
    );
    const byCard = [...starts].sort((a, b) => a.cardTop - b.cardTop).map((s) => s.sy);
    expect(byCard[0]).toBeLessThan(byCard[1] as number);
    expect(byCard[1]).toBeLessThan(byCard[2] as number);
    expect((byCard[2] as number) - (byCard[0] as number)).toBeLessThanOrEqual(8); // 少しだけ（FAN_SPREAD 以内）
  });

  for (const [w, h] of [
    [1100, 800],
    [900, 800],
  ] as const) {
    test(`狭い窓（${w}px）：線は、引ける（端点が一致する）`, async ({ page, app }) => {
      await open(page, app, w, h);
      await comment(page, app, 'mm', DISTINCT, ['確認です']);
      await openZoom(page, 'mm');
      await expectEndsMatch(page, 4);
    });
  }

  test('窓が 760px 未満（ドックが、下のシート）：線は引かない（カードが、ステージの下）。番号は、そのまま。窓を広げると、線が出る', async ({
    page,
    app,
  }) => {
    await open(page, app, 420, 800);
    await comment(page, app, 'img', DISTINCT);
    await openZoom(page, 'img');
    await expect(page.locator('#lightbox .fv-box .fv-no')).toHaveCount(3);
    await frames(page);
    await expect(page.locator('svg.fv-links')).toHaveCount(0);
    await page.setViewportSize({ width: 1000, height: 800 });
    await expectEndsMatch(page, 3);
  });

  test('窓の大きさの変更：線が、追いかける（端点が、また一致する）', async ({ page, app }) => {
    await open(page, app);
    await comment(page, app, 'dio', DISTINCT, ['確認です']);
    await openZoom(page, 'dio');
    await expectEndsMatch(page, 4);
    await page.setViewportSize({ width: 1100, height: 760 });
    await frames(page);
    await expectEndsMatch(page, 4);
  });

  test('ダーク：線の色は、本文の線と同じ（アクセント）・どちらのテーマでも、描かれる', async ({ page, app }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await open(page, app);
    await comment(page, app, 'img', DISTINCT);
    await openZoom(page, 'img');
    await expectEndsMatch(page, 3);
    const c = await page.evaluate(() => {
      const probe = document.createElement('i');
      probe.style.color = 'var(--accent)';
      document.body.append(probe);
      const accent = getComputedStyle(probe).color;
      probe.remove();
      const p = document.querySelector('svg.fv-links path.cn') as SVGPathElement;
      return { accent, stroke: getComputedStyle(p).stroke, scheme: matchMedia('(prefers-color-scheme: dark)').matches };
    });
    expect(c.scheme).toBe(true);
    expect(c.stroke).toBe(c.accent);
  });

  test('終了したトピック（閲覧専用）でも、線を引く（読むための情報）。入力欄は、ない', async ({ page, app }) => {
    await open(page, app);
    await comment(page, app, 'img', DISTINCT, ['確認です']);
    await ui(page).end.click();
    await ui(page).enddlg.getByRole('button', { name: '終了する' }).click();
    await expect(ui(page).closedbar).toBeVisible();
    await openZoom(page, 'img');
    await expect(page.locator('#lightbox .fv-dock .thread.composer')).toHaveCount(0);
    await expectEndsMatch(page, 4);
    await expect(page.locator('button.fv-links-toggle')).toBeVisible();
  });

  test('html-app：線は、親側の範囲の枠と結ぶ。枠（iframe）の sandbox・src は、そのまま。枠の幅を変えても、追従する', async ({
    page,
    app,
  }) => {
    await open(page, app);
    await comment(page, app, 'app', DISTINCT, ['確認です']);
    await openZoom(page, 'app');
    await expectEndsMatch(page, 4);
    const attrs = await page.locator('#lightbox iframe.appframe').evaluate((e) => ({
      sandbox: e.getAttribute('sandbox'),
      src: e.getAttribute('src'),
    }));
    expect(attrs.sandbox).toBe('allow-scripts');
    expect(attrs.src).toMatch(/^\/appframe\//);
    // 幅の切り替え（375）：枠の大きさが変わり、範囲の枠が動く。線が追う
    await page.locator('#lightbox .fv-tools button', { hasText: '375' }).click();
    await page.waitForTimeout(400);
    await frames(page);
    await expectEndsMatch(page, 4);
  });
  test('枠にマウスを置いたまま、Esc で閉じる：光り（linkedTid）が残らない（本文のカードの .linked・本文の線の focus）。ほかの経路で付いた光りは、消さない', async ({
    page,
    app,
  }) => {
    await open(page, app);
    await comment(page, app, 'img', DISTINCT);
    await openZoom(page, 'img');
    await expectEndsMatch(page, 3);
    const tid = await page
      .locator('#lightbox .fv-box')
      .first()
      .evaluate((e) => (e as HTMLElement).dataset.tid);
    const b = await box(page.locator('#lightbox .fv-box').first());
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await expect(page.locator(`svg.fv-links g[data-tid="${tid}"]`)).toHaveClass(/linked/);
    await page.keyboard.press('Escape'); // マウスは、枠の上のまま
    await expect(page.locator('#lightbox')).toBeHidden();
    // 閉じたあと、マウスが、窓の左の一覧の上にあっても：本文の線は focus（ほかの線が薄くなる）にならず、右のパネルのカードにも、.linked が残らない
    await page.mouse.move(60, 400);
    await expect(page.locator('#threads .thread.linked')).toHaveCount(0);
    await expect(page.locator('#links')).not.toHaveClass(/focus/);
    await expect(page.locator('#links g.linked')).toHaveCount(0);
  });

  test('拡大表示の間、本文の線（#links）は隠す（visibility: hidden）。閉じると戻る', async ({ page, app }) => {
    await open(page, app);
    await comment(page, app, 'img', DISTINCT);
    const vis = () => page.locator('#links').evaluate((e) => getComputedStyle(e).visibility);
    await expect(page.locator('#links path[data-tid]')).not.toHaveCount(0);
    expect(await vis()).toBe('visible');
    await openZoom(page, 'img');
    await expectEndsMatch(page, 3);
    expect(await vis()).toBe('hidden'); // 窓の後ろの線は、拡大表示の線と、まぎれる
    await page.keyboard.press('Escape');
    await expect(page.locator('#lightbox')).toBeHidden();
    expect(await vis()).toBe('visible');
  });
});
