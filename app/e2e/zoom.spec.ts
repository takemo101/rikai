// 本文・返信の、画像と図の拡大表示（F37）：クリックで、ライトボックスに出る。ズーム（＋／−／全体表示・ホイール・ダブルクリック・キー）・ドラッグで移動・閉じる（Esc・背景・X）。
// 文字を選ぶドラッグ・範囲を選ぶ最中・コメントの付いた対象は、開かない。ダークで、図の地と文字が読める。複製した図の url(#…) 参照が、拡大でも描かれる。
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { makePng } from './samples';
import { addTextComment, box, dragSelect, fillAndAdd, hoverBlock, ui } from './ui';

const BT = '```';
const DOC = `# 拡大の確認

前の段落です。写真の上の段落です。

![小さな画像](assets/small.png)

![大きな画像](assets/big.png)

${BT}mermaid
flowchart LR
  A[呼び出し] --> B{成功?}
  B -- はい --> C[返す]
  B -- いいえ --> D[待つ] --> A
${BT}

${BT}mermaid
sequenceDiagram
  participant U as 利用者
  participant S as サーバー
  U->>S: 要求
  S-->>U: 応答
${BT}

<svg id="ink" viewBox="0 0 200 100" width="200" height="100"><defs><linearGradient id="g1"><stop offset="0" stop-color="#2563eb"/><stop offset="1" stop-color="#16a34a"/></linearGradient><marker id="ar" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 z" fill="#dc2626"/></marker></defs><rect x="10" y="10" width="120" height="60" rx="8" fill="url(#g1)"/><line x1="20" y1="90" x2="180" y2="90" stroke="#dc2626" stroke-width="3" marker-end="url(#ar)"/></svg>

後の段落です。写真の下の段落です。

| 項目 | 内容 |
| --- | --- |
| 表 | 値 |

${BT}js
const a = 1;
${BT}
`;
const assets = { 'small.png': makePng(120, 60), 'big.png': makePng(1600, 600) };

const open = async (page: Page, app: Parameters<Parameters<typeof test>[2]>[0]['app'], md = DOC) => {
  await page.setViewportSize({ width: 1360, height: 900 });
  await app.switchTopic(page, 'zm', '拡大の確認', md, assets);
  await expect
    .poll(() => page.locator('#article img').evaluateAll((l) => l.every((i) => (i as HTMLImageElement).complete)))
    .toBe(true);
  await expect(page.locator('#article .mermaid-block svg')).toHaveCount(2);
};
const pct = async (page: Page) => Number.parseInt((await page.locator('#lightbox .lb-pct').textContent()) ?? '0', 10);
// ライトボックスの道具（入口のバーの「拡大」と、名前が重なるので、ライトボックスの中に絞る）
const tool = (page: Page, name: string) => page.locator('#lightbox').getByRole('button', { name, exact: true });
const stage = (page: Page) => page.locator('#lightbox .lb-stage');
const mermaid = (page: Page, i = 0) => page.locator('#article .mermaid-block svg').nth(i);

test.describe('画像・図の拡大（F37）', () => {
  test('画像を押す：ライトボックスに、窓に収まる大きさで出る（大きい画像は、本文より大きい・小さい画像は、2 倍まで）。role="dialog"・フォーカス', async ({
    page,
    app,
  }) => {
    await open(page, app);
    const lb = ui(page).lightbox;
    const small = page.locator('#article img[alt="小さな画像"]');
    await small.scrollIntoViewIfNeeded();
    const s0 = await box(small);
    await small.click();
    await expect(lb).toBeVisible();
    await expect(lb).toHaveAttribute('role', 'dialog');
    await expect(lb).toHaveAttribute('aria-modal', 'true');
    await expect(lb).toBeFocused();
    await expect.poll(async () => (await box(stage(page))).width).toBeGreaterThan(s0.width * 1.9); // 画像の読み込みを待つ
    const s1 = await box(stage(page));
    expect(s1.width).toBeGreaterThan(s0.width * 1.9); // 小さい画像：2 倍まで
    expect(s1.width).toBeLessThanOrEqual(s0.width * 2 + 1);
    await page.keyboard.press('Escape');
    await expect(lb).toBeHidden();
    const big = page.locator('#article img[alt="大きな画像"]');
    await big.scrollIntoViewIfNeeded();
    const b0 = await box(big);
    await big.click();
    await expect(lb).toBeVisible();
    await expect.poll(async () => (await box(stage(page))).width).toBeGreaterThan(b0.width * 1.2);
    const b1 = await box(stage(page));
    expect(b1.width).toBeGreaterThan(b0.width * 1.2); // 本文より、大きい
    const vw = page.viewportSize()?.width ?? 0;
    expect(b1.width).toBeLessThanOrEqual(vw * 0.92 + 1); // 窓に収まる（92vw）
    expect(b1.height).toBeLessThanOrEqual((page.viewportSize()?.height ?? 0) * 0.9 + 1);
    await expect(lb.locator('.lb-stage img')).toHaveAttribute('src', /\/asset\/zm\/big\.png/);
  });

  test('Mermaid の図を押す：元より、大きく出る。＋／−／全体表示・ホイール（カーソルを中心に）・ダブルクリック・キー（＋ − 0）で、拡大率が変わる。範囲は、全体表示〜800%', async ({
    page,
    app,
  }) => {
    await open(page, app);
    const svg = mermaid(page);
    await svg.scrollIntoViewIfNeeded();
    const o = await box(svg);
    await svg.click();
    const lb = ui(page).lightbox;
    await expect(lb).toBeVisible();
    const f = await box(stage(page));
    expect(f.width).toBeGreaterThan(o.width * 1.2);
    const fitPct = await pct(page);
    await expect(tool(page, '縮小')).toBeDisabled(); // 全体表示より、縮めない
    await tool(page, '拡大').click();
    expect(await pct(page)).toBeGreaterThan(fitPct);
    await tool(page, '縮小').click();
    expect(await pct(page)).toBe(fitPct);
    // キー
    await page.keyboard.press('+');
    await page.keyboard.press('+');
    const k = await pct(page);
    expect(k).toBeGreaterThan(fitPct * 1.5);
    await page.keyboard.press('-');
    expect(await pct(page)).toBeLessThan(k);
    await page.keyboard.press('0');
    expect(await pct(page)).toBe(fitPct);
    // ホイール：カーソルの下の点が、動かない
    const cx = f.x + f.width * 0.25;
    const cy = f.y + f.height * 0.5;
    const rel = (b: { x: number; y: number; width: number; height: number }) => ({
      u: (cx - b.x) / b.width,
      v: (cy - b.y) / b.height,
    });
    const r0 = rel(await box(stage(page)));
    await page.mouse.move(cx, cy);
    await page.mouse.wheel(0, -300);
    await expect.poll(() => pct(page)).toBeGreaterThan(fitPct);
    const r1 = rel(await box(stage(page)));
    expect(Math.abs(r1.u - r0.u)).toBeLessThan(0.02);
    expect(Math.abs(r1.v - r0.v)).toBeLessThan(0.02);
    expect((await box(stage(page))).width).toBeGreaterThan(f.width * 1.2);
    for (let i = 0; i < 12; i++) await page.mouse.wheel(0, -600);
    await expect.poll(() => pct(page)).toBe(800); // 上限
    for (let i = 0; i < 12; i++) await page.mouse.wheel(0, 600);
    await expect.poll(() => pct(page)).toBe(fitPct); // 下限：全体表示
    // ダブルクリック：全体表示 ↔ 等倍（全体表示が等倍以上なら、2 倍）
    await stage(page).dblclick();
    const d = await pct(page);
    expect(d).not.toBe(fitPct);
    expect(d === 100 || d === Math.round(fitPct * 2)).toBe(true);
    await stage(page).dblclick();
    expect(await pct(page)).toBe(fitPct);
    // 全体表示ボタン
    await tool(page, '拡大').click();
    await tool(page, '全体表示').click();
    expect(await pct(page)).toBe(fitPct);
  });

  test('ドラッグで移動（拡大時）。ドラッグの終わりでは、閉じない。全体表示では、動かない。移動は、範囲内', async ({
    page,
    app,
  }) => {
    await open(page, app);
    await mermaid(page).scrollIntoViewIfNeeded();
    await mermaid(page).click();
    const lb = ui(page).lightbox;
    const f = await box(stage(page));
    // 全体表示：ドラッグしても、動かない
    await page.mouse.move(f.x + f.width / 2, f.y + f.height / 2);
    await page.mouse.down();
    await page.mouse.move(f.x + f.width / 2 - 120, f.y + f.height / 2 - 40, { steps: 5 });
    await page.mouse.up();
    expect((await box(stage(page))).x).toBeCloseTo(f.x, 0);
    await expect(lb).toBeVisible();
    // 拡大して、ドラッグ：動く
    for (let i = 0; i < 4; i++) await tool(page, '拡大').click();
    const z = await box(stage(page));
    await page.mouse.move(700, 500);
    await page.mouse.down();
    await page.mouse.move(580, 450, { steps: 6 });
    await page.mouse.up();
    const m = await box(stage(page));
    expect(m.x).toBeLessThan(z.x - 80);
    expect(m.y).toBeLessThan(z.y - 30);
    await expect(lb).toBeVisible(); // 図の上で、ドラッグを終えても、閉じない
    // 背景の上で、ドラッグを終えても、閉じない（ツールバーの上でも）
    await page.mouse.move(600, 500);
    await page.mouse.down();
    await page.mouse.move(40, 40, { steps: 6 });
    await page.mouse.up();
    await expect(lb).toBeVisible();
    // 移動は、範囲内：左へいっぱいドラッグしても、図の右の縁は、窓の右の縁より、内側へは入らない
    for (let i = 0; i < 3; i++) {
      await page.mouse.move(900, 500);
      await page.mouse.down();
      await page.mouse.move(100, 500, { steps: 4 });
      await page.mouse.up();
    }
    const e = await box(stage(page));
    const vw = page.viewportSize()?.width ?? 0;
    expect(e.x + e.width).toBeGreaterThanOrEqual(vw - 2);
  });

  test('閉じる：Esc・背景（図・画像の外）を押す・X。図・画像の上を押しても、閉じない。閉じても、本文のスクロールは、そのまま', async ({
    page,
    app,
  }) => {
    await open(page, app);
    const lb = ui(page).lightbox;
    const scroller = ui(page).docscroll;
    await mermaid(page, 1).scrollIntoViewIfNeeded();
    const top = await scroller.evaluate((e) => e.scrollTop);
    await mermaid(page, 1).click();
    await expect(lb).toBeVisible();
    // 図の上を押す：閉じない
    await stage(page).click();
    await expect(lb).toBeVisible();
    // 背景を押す：閉じる
    await page.mouse.click(8, 400);
    await expect(lb).toBeHidden();
    // X
    await mermaid(page, 1).click();
    await expect(lb).toBeVisible();
    await tool(page, '閉じる').click();
    await expect(lb).toBeHidden();
    // Esc
    await mermaid(page, 1).click();
    await page.keyboard.press('Escape');
    await expect(lb).toBeHidden();
    expect(await scroller.evaluate((e) => e.scrollTop)).toBe(top);
  });

  test('本文の DOM は、変わらない：開いて・ズームして・閉じても、#article の中身が同じ（ブロック・番号・位置づけ・関連の線に影響しない）', async ({
    page,
    app,
  }) => {
    await open(page, app);
    const art = ui(page).article;
    const before = await art.evaluate((e) => e.innerHTML);
    const bnoBefore = await ui(page).bno.count();
    await mermaid(page).click();
    await tool(page, '拡大').click();
    await page.keyboard.press('Escape');
    await page.locator('#article img[alt="大きな画像"]').click();
    await page.keyboard.press('Escape');
    expect(await art.evaluate((e) => e.innerHTML)).toBe(before);
    expect(await ui(page).bno.count()).toBe(bnoBefore);
    // 図の上のカーソルは、zoom-in（CSS）
    expect(await mermaid(page).evaluate((e) => getComputedStyle(e).cursor)).toBe('zoom-in');
    expect(
      await page
        .locator('#article img')
        .first()
        .evaluate((e) => getComputedStyle(e).cursor),
    ).toBe('zoom-in');
  });

  test('インラインの svg：開く。複製の id は、元と重ならない。グラデーション・矢印（marker）の参照が、拡大でも描かれる（元の図を、隠しても）', async ({
    page,
    app,
  }) => {
    await open(page, app);
    const ink = page.locator('#article svg#ink');
    await ink.scrollIntoViewIfNeeded();
    await ink.click();
    await expect(ui(page).lightbox).toBeVisible();
    const ids = await page.evaluate(() => {
      const all = [...document.querySelectorAll('[id]')].map((e) => e.id);
      return {
        dup: all.filter((v, i) => all.indexOf(v) !== i),
        clone: [...document.querySelectorAll('#lightbox [id]')].map((e) => e.id),
      };
    });
    expect(ids.dup, 'id が、文書の中で、重ならない').toEqual([]);
    expect(ids.clone.length).toBeGreaterThan(0);
    for (const id of ids.clone) expect(id.startsWith('zoom-')).toBe(true);
    // 元の図（display: none の svg の defs は、参照できない）を隠して、複製だけの描画を確かめる
    await page.addStyleTag({ content: '#article svg#ink { display: none !important; }' });
    const sb = await box(stage(page));
    const shot = (await stage(page).screenshot()).toString('base64');
    const px = await page.evaluate(
      async ([b64, w, h]) => {
        const im = new Image();
        im.src = `data:image/png;base64,${b64}`;
        await im.decode();
        const c = document.createElement('canvas');
        c.width = im.width;
        c.height = im.height;
        const g = c.getContext('2d') as CanvasRenderingContext2D;
        g.drawImage(im, 0, 0);
        const at = (fx: number, fy: number) =>
          [...g.getImageData(Math.round(im.width * fx), Math.round(im.height * fy), 1, 1).data].slice(0, 3);
        void w;
        void h;
        return { left: at(0.12, 0.35), right: at(0.6, 0.35), arrow: at(0.89, 0.9) };
      },
      [shot, sb.width, sb.height] as const,
    );
    // 矩形：左は青・右は緑（グラデーション。塗りが、効いている）
    expect(px.left[2]).toBeGreaterThan(px.left[1]);
    expect(px.right[1]).toBeGreaterThan(px.right[2]);
    // 矢印（marker）：赤
    expect(px.arrow[0]).toBeGreaterThan(180);
    expect(px.arrow[1]).toBeLessThan(90);
  });

  test('返信（rikai apply）の中の図・画像も、開く', async ({ page, app }) => {
    await open(page, app);
    await app.apply(
      {
        threads: [
          {
            page: 'root',
            anchor: { quote: '前の段落です' },
            body: `返信の図です。\n\n${BT}mermaid\nflowchart TD\n  X[原因] --> Y[結果]\n${BT}\n\n![小さな画像](assets/small.png)\n`,
          },
        ],
      },
      { topic: 'zm' },
    );
    await expect(ui(page).threads).toHaveCount(1);
    const card = ui(page).threads.first();
    await expect(card.locator('.msg .body.md .mermaid-block svg')).toHaveCount(1);
    const o = await box(card.locator('.msg .body.md .mermaid-block svg'));
    await card.locator('.msg .body.md .mermaid-block svg').click();
    await expect(ui(page).lightbox).toBeVisible();
    expect((await box(stage(page))).width).toBeGreaterThan(o.width * 1.2);
    await page.keyboard.press('Escape');
    await expect(ui(page).lightbox).toBeHidden();
    await card.locator('.msg .body.md img').click();
    await expect(ui(page).lightbox).toBeVisible();
    await expect(ui(page).lightbox.locator('.lb-stage img')).toHaveAttribute('src', /small\.png/);
  });

  test('開かないもの：文字を選ぶドラッグが画像の上で終わる・画像の上で動かして離す・範囲を選ぶ最中・html-app（枠）・外部画像のブロック表示', async ({
    page,
    app,
  }) => {
    await open(page, app);
    const lb = ui(page).lightbox;
    const img = page.locator('#article img[alt="小さな画像"]');
    await img.scrollIntoViewIfNeeded();
    // 文字を選ぶドラッグが、画像の上で終わる
    const ib = await box(img);
    const text = page.locator('#article p', { hasText: '写真の上の段落' });
    const tb = await box(text);
    await page.mouse.move(tb.x + 4, tb.y + tb.height / 2);
    await page.mouse.down();
    await page.mouse.move(ib.x + ib.width / 2, ib.y + ib.height / 2, { steps: 8 });
    await page.mouse.up();
    await expect(lb).toBeHidden();
    // 画像の上で、押して、動かして、離す
    await page.mouse.move(ib.x + 10, ib.y + 10);
    await page.mouse.down();
    await page.mouse.move(ib.x + 80, ib.y + 30, { steps: 5 });
    await page.mouse.up();
    await expect(lb).toBeHidden();
    // 図の上で、押して、動かして、離す（click は、図の中の要素で起きる：ドラッグの判定が、ないと、開く）
    const fig = mermaid(page);
    await fig.scrollIntoViewIfNeeded();
    const fb = await box(fig);
    await page.mouse.move(fb.x + fb.width * 0.2, fb.y + fb.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(fb.x + fb.width * 0.7, fb.y + fb.height * 0.55, { steps: 8 });
    await page.mouse.up();
    await expect(lb).toBeHidden();
    await img.scrollIntoViewIfNeeded();
    // 範囲を選ぶ最中：押しても、開かない
    await page.mouse.click(5, 5);
    await ui(page).regbtn.click();
    await expect(ui(page).regsel).toBeVisible();
    await page.mouse.click(ib.x + ib.width / 2, ib.y + ib.height / 2);
    await expect(lb).toBeHidden();
    await page.keyboard.press('Escape');
    // ふつうに押せば、開く（上の操作が、状態を壊していない）
    await img.click();
    await expect(lb).toBeVisible();
  });

  test('外部画像のブロック表示・html-app の枠は、開かない', async ({ page, app }) => {
    const md = `# 対象外\n\n![外部](https://example.invalid/x.png)\n\n${BT}html-app height=120\n<p style="margin:0">枠の中の文書</p>\n${BT}\n\n![小さな画像](assets/small.png)\n`;
    await app.switchTopic(page, 'zm2', '対象外', md, assets);
    const lb = ui(page).lightbox;
    await page.locator('#article .img-blocked').click();
    await expect(lb).toBeHidden();
    const frame = page.locator('#article iframe.appframe');
    await frame.scrollIntoViewIfNeeded();
    await frame.click({ position: { x: 20, y: 20 } });
    await expect(lb).toBeHidden();
    await page.locator('#article img[alt="小さな画像"]').click();
    await expect(lb).toBeVisible();
  });

  test('既存のコメントの操作が、壊れない：強調を押す（カードが選ばれる）・入口バーの「コメント」（画像の右上。押しても、拡大しない）・コメントの付いた画像は、押すと、そのコメントを選ぶ', async ({
    page,
    app,
  }) => {
    await open(page, app);
    const u = ui(page);
    // 文字へのコメント：強調を押すと、カードが選ばれる
    await addTextComment(page, '写真の下の段落', 'テキストへのコメント');
    await expect(u.threads).toHaveCount(1);
    await page.locator('#article mark.hl').first().click();
    await expect(page.locator('#article mark.hl.active')).toHaveCount(1);
    await expect(u.lightbox).toBeHidden();
    // 画像のブロックへのコメント：入口バーの「コメント」は、拡大しない
    const img = page.locator('#article img[alt="小さな画像"]');
    await img.scrollIntoViewIfNeeded();
    await hoverBlock(page, blockOf(page, 'img[alt="小さな画像"]'));
    await expect(u.actbar).toBeVisible();
    await u.actComment.click();
    await expect(u.lightbox).toBeHidden();
    await expect(u.composer).toBeVisible();
    await fillAndAdd(page, '画像へのコメント');
    await expect(u.threads).toHaveCount(2);
    // コメントの付いた画像を押す：そのコメントを選ぶ（拡大に化けない）
    await page.mouse.move(5, 5);
    await img.click();
    await expect(u.lightbox).toBeHidden();
    // 本文の別の画像は、拡大できる
    await page.locator('#article img[alt="大きな画像"]').click();
    await expect(u.lightbox).toBeVisible();
  });

  test('ダーク：図の地は、画面の紙の色（暗い地）。Mermaid の文字が、読める（コントラスト AA 以上）。ツールバーも見える。ライトでは、明るい地', async ({
    page,
    app,
  }) => {
    await open(page, app);
    const lum = (c: string) => {
      const [r, g, b] = (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number) as [number, number, number];
      const f = (v: number) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    for (const scheme of ['dark', 'light'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await expect
        .poll(() =>
          mermaid(page).evaluate((e) => getComputedStyle(e.querySelector('.node rect, .node polygon') ?? e).fill),
        )
        .toBeTruthy();
      await page.waitForTimeout(800); // Mermaid の描き直し
      await mermaid(page).scrollIntoViewIfNeeded();
      await mermaid(page).click();
      await expect(ui(page).lightbox).toBeVisible();
      const bg = await stage(page).evaluate((e) => getComputedStyle(e).backgroundColor);
      if (scheme === 'dark') expect(lum(bg), `地 ${bg}`).toBeLessThan(0.05);
      else expect(lum(bg), `地 ${bg}`).toBeGreaterThan(0.9);
      // 図の文字と地のコントラスト（画面の写しの、いちばん明るい画素と、いちばん暗い画素）
      const shot = (await stage(page).screenshot()).toString('base64');
      const ratio = await page.evaluate(async (b64) => {
        const im = new Image();
        im.src = `data:image/png;base64,${b64}`;
        await im.decode();
        const c = document.createElement('canvas');
        c.width = im.width;
        c.height = im.height;
        const g = c.getContext('2d') as CanvasRenderingContext2D;
        g.drawImage(im, 0, 0);
        const d = g.getImageData(0, 0, im.width, im.height).data;
        const f = (v: number) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
        let lo = 1;
        let hi = 0;
        for (let i = 0; i < d.length; i += 4) {
          const l = 0.2126 * f(d[i] as number) + 0.7152 * f(d[i + 1] as number) + 0.0722 * f(d[i + 2] as number);
          lo = Math.min(lo, l);
          hi = Math.max(hi, l);
        }
        return (hi + 0.05) / (lo + 0.05);
      }, shot);
      expect(ratio, `${scheme}：図の中の、明暗の比`).toBeGreaterThanOrEqual(4.5);
      // ツールバー：暗い地に、白いアイコン
      const tools = await ui(page)
        .lightbox.locator('.lb-tools')
        .evaluate((e) => ({ bg: getComputedStyle(e).backgroundColor, ink: getComputedStyle(e).color }));
      expect(lum(tools.bg)).toBeLessThan(0.05);
      expect(lum(tools.ink)).toBeGreaterThan(0.9);
      await page.keyboard.press('Escape');
      await expect(ui(page).lightbox).toBeHidden();
    }
  });

  test('キーボード：Tab は、ライトボックスの中のボタンだけを回る。閉じたら、フォーカスは、開く前の要素へ（フォーカスできる要素だったとき）', async ({
    page,
    app,
  }) => {
    await open(page, app);
    const btn = page.locator('#btn-theme');
    await btn.focus();
    await mermaid(page).scrollIntoViewIfNeeded();
    await mermaid(page).click();
    await expect(ui(page).lightbox).toBeVisible();
    // 画像の押下で、フォーカスは、ボタンから外れて、ライトボックスへ（図は、フォーカスできないので、body → ライトボックス）
    await expect(ui(page).lightbox).toBeFocused();
    const seen = new Set<string>();
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
      seen.add((await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '')) as string);
    }
    expect([...seen].every((n) => ['縮小', '拡大', '全体表示', '閉じる', ''].includes(n))).toBe(true);
    expect(seen.has('閉じる')).toBe(true);
    await page.keyboard.press('Escape');
    await expect(ui(page).lightbox).toBeHidden();
    await expect(page.locator('#article')).toBeVisible();
  });

  // ---- 入口のバーの「拡大」（コメントの付いた画像・図も、ここから拡大できる） ----
  // その要素を含む（要素自身でもよい）、本文のブロック
  const blockOf = (page: Page, inner: string) =>
    page.locator(`#article ${inner}`).first().locator('xpath=ancestor-or-self::*[@data-bid][1]');
  const hoverTo = async (page: Page, inner: string) => {
    const blk = blockOf(page, inner);
    await blk.scrollIntoViewIfNeeded();
    await hoverBlock(page, blk);
    await expect(ui(page).actbar).toBeVisible();
  };

  test('入口のバーの「拡大」：画像・図のブロックに出る（コメントのない画像でも）。押すと開く。コメントの入力欄は、開かない。「コメント」は、これまでどおり、入力欄', async ({
    page,
    app,
  }) => {
    await open(page, app);
    const u = ui(page);
    const zoom = page.locator('#act-zoom');
    await hoverTo(page, 'img[alt="小さな画像"]');
    await expect(zoom).toBeVisible();
    await expect(zoom).toHaveAccessibleName('拡大');
    await expect(zoom).toHaveText('拡大');
    await zoom.click();
    await expect(u.lightbox).toBeVisible();
    await expect(u.lightbox.locator('.lb-stage img')).toHaveAttribute('src', /small\.png/);
    await expect(u.composer).toHaveCount(0);
    await page.keyboard.press('Escape');
    // 図（Mermaid）
    await hoverTo(page, '.mermaid-block svg');
    await zoom.click();
    await expect(u.lightbox.locator('.lb-stage svg')).toHaveCount(1);
    await expect(u.composer).toHaveCount(0);
    await page.keyboard.press('Escape');
    // インラインの svg
    await hoverTo(page, 'svg#ink');
    await zoom.click();
    await expect(u.lightbox.locator('.lb-stage svg')).toHaveCount(1);
    await page.keyboard.press('Escape');
    // 「コメント」：これまでどおり
    await hoverTo(page, 'img[alt="小さな画像"]');
    await u.actComment.click();
    await expect(u.lightbox).toBeHidden();
    await expect(u.composer).toBeVisible();
  });

  test('「拡大」は、表・コード・文では、出ない（「コメント」だけ）。文を選んだときのバーにも、出ない', async ({
    page,
    app,
  }) => {
    await open(page, app);
    for (const inner of ['table', 'pre']) {
      await hoverTo(page, inner);
      await expect(page.locator('#act-comment')).toBeVisible();
      await expect(page.locator('#act-zoom')).toHaveCount(0);
    }
    await hoverTo(page, 'img[alt="小さな画像"]');
    await expect(page.locator('#act-zoom')).toHaveCount(1);
    // 文を選ぶ（ブロックのバーが、消えてから：出ているのは、文を選んだときのバー）
    await page.mouse.move(2, 2);
    await expect(ui(page).actbar).toBeHidden();
    await dragSelect(page, '前の段落です');
    await page.waitForTimeout(200); // 選択の確定（mouseup のあと）を待つ：それまでは、マウスの下のブロックのバー
    await expect(ui(page).actbar).toBeVisible();
    await expect(page.locator('#act-zoom')).toHaveCount(0);
  });

  test('コメントの付いた画像・図：押すとコメントを選ぶ（拡大しない）が、バーの「拡大」で、拡大できる', async ({
    page,
    app,
  }) => {
    await open(page, app);
    const u = ui(page);
    for (const [inner, name] of [
      ['img[alt="小さな画像"]', '画像へのコメント'],
      ['.mermaid-block svg', '図へのコメント'],
    ] as const) {
      await hoverTo(page, inner);
      await u.actComment.click();
      await fillAndAdd(page, name);
    }
    await expect(u.threads).toHaveCount(2);
    for (const inner of ['img[alt="小さな画像"]', '.mermaid-block svg']) {
      const el = page.locator(`#article ${inner}`).first();
      await el.scrollIntoViewIfNeeded();
      await page.mouse.move(5, 5);
      await el.click();
      await expect(u.lightbox).toBeHidden(); // 押すと、そのコメントを選ぶ
      await hoverTo(page, inner);
      await page.locator('#act-zoom').click();
      await expect(u.lightbox).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(u.lightbox).toBeHidden();
    }
  });

  test('バーの形：「拡大」があっても、「コメント」の位置（右端）は、変わらない。ライト・ダーク・狭い窓で、窓からはみ出さず、文字が読める', async ({
    page,
    app,
  }) => {
    await open(page, app);
    const lum = (c: string) => {
      const [r, g, b] = (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number) as [number, number, number];
      const f = (v: number) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    await hoverTo(page, 'pre');
    const textRight = (await box(page.locator('#act-comment'))).x + (await box(page.locator('#act-comment'))).width;
    for (const [w, scheme] of [
      [1360, 'light'],
      [1360, 'dark'],
      [900, 'light'],
      [700, 'dark'],
      [420, 'light'],
    ] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width: w, height: 900 });
      await page.mouse.move(2, 2);
      await expect(ui(page).actbar).toBeHidden(); // 前の窓の大きさで出したバーが、消えてから
      await hoverTo(page, 'img[alt="小さな画像"]');
      const bar = await box(ui(page).actbar);
      expect(bar.x, `${w}px：左`).toBeGreaterThanOrEqual(0);
      expect(bar.x + bar.width, `${w}px：右`).toBeLessThanOrEqual(w);
      const z = await box(page.locator('#act-zoom'));
      const c = await box(page.locator('#act-comment'));
      expect(z.x + z.width, '「拡大」は、「コメント」の左').toBeLessThanOrEqual(c.x + 1);
      if (w === 1360 && scheme === 'light') expect(Math.abs(c.x + c.width - textRight)).toBeLessThan(2); // 「コメント」の右端は、拡大のないバーと、同じ
      const colors = await page.locator('#act-zoom').evaluate((e) => ({
        ink: getComputedStyle(e).color,
        bg: getComputedStyle(e.parentElement as Element).backgroundColor,
      }));
      const [a, b] = [lum(colors.ink), lum(colors.bg)];
      expect((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05), `${scheme}：文字`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
