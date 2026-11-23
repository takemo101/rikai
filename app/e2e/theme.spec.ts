// 外観のモード（F36）：ライト・ダーク・システム（OS に合わせる。既定）。system は、OS の外観に追従する／ボタンで選んだ外観は、OS に関係なく保たれる（再読み込みしても）／
// Mermaid の図は、ダークで、描き直される／ダークでも、文字のコントラストが AA 以上（ライトも）。
// 既存の e2e は、ライト（Playwright の既定の colorScheme: 'light'）で、そのまま通る。
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { addTextComment, dragSelect, ui } from './ui';

const BT = '```';
const DOC = `# 外観の確認

猫は朝によく鳴きます。**太字**と \`code\` と [リンク](https://example.invalid/x) です。

> 引用の段落です。

| 時間 | 内容 |
| --- | --- |
| 朝 | カリカリ |

${BT}js
const meals = 3;
${BT}

${BT}mermaid
flowchart LR
  A[起点] --> B[終点]
${BT}

${BT}diff
-猫は鳴く
+猫は歌う
${BT}

最後の段落です。
`;

type Rgb = [number, number, number];
const lum = ([r, g, b]: Rgb): number => {
  const f = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const rgbOf = (s: string): Rgb => (s.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number) as Rgb;

// 本文の背景と文字の色（computed）
const colors = (page: Page) =>
  page.evaluate(() => ({
    bg: getComputedStyle(document.body).backgroundColor,
    ink: getComputedStyle(document.querySelector('#article p') as HTMLElement).color,
    attr: document.documentElement.getAttribute('data-theme'),
    scheme: getComputedStyle(document.documentElement).colorScheme,
  }));

const expectDark = async (page: Page) => {
  const c = await colors(page);
  expect(lum(rgbOf(c.bg)), `背景 ${c.bg}`).toBeLessThan(0.05);
  expect(lum(rgbOf(c.ink)), `文字 ${c.ink}`).toBeGreaterThan(0.7);
};
const expectLight = async (page: Page) => {
  const c = await colors(page);
  expect(lum(rgbOf(c.bg)), `背景 ${c.bg}`).toBeGreaterThan(0.9);
  expect(lum(rgbOf(c.ink)), `文字 ${c.ink}`).toBeLessThan(0.1);
};

const themeBtn = (page: Page) => page.locator('#btn-theme');
const stored = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('rikai-ui') ?? '{}').theme);

// 文字のコントラスト：見えている文字ごとに、色と、背景の比。描かれる順（親 → 子）に、背景・不透明度（opacity）を重ねて、実際に見える色で測る。
// 入力欄の placeholder も、測る。AA（4.5。大きな文字は 3。無効の部品は、読めること〔3〕）に届かないものの一覧
const contrastFailures = (page: Page) =>
  page.evaluate(() => {
    type C = [number, number, number, number];
    const parse = (c: string): C | null => {
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const p = (m[1] as string)
        .split(/[ ,/]+/)
        .filter(Boolean)
        .map(Number);
      return [p[0] as number, p[1] as number, p[2] as number, p[3] ?? 1];
    };
    const lin = (v: number) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    const luminance = (r: C) => 0.2126 * lin(r[0]) + 0.7152 * lin(r[1]) + 0.0722 * lin(r[2]);
    const over = (f: C, b: C): C =>
      [0, 1, 2].map((i) => (f[i] as number) * f[3] + (b[i] as number) * (1 - f[3])).concat(1) as C;
    const mix = (inner: C, backdrop: C, o: number): C =>
      [0, 1, 2].map((i) => (inner[i] as number) * o + (backdrop[i] as number) * (1 - o)).concat(1) as C;
    // 親 → 子の順に描く：背景を重ね、その要素の opacity で、まとめて、下に混ぜる。leaf では、文字（text）か、背景だけ
    const paint = (chain: Element[], i: number, backdrop: C, text: C | null): C => {
      const e = chain[i] as Element;
      const cs = getComputedStyle(e);
      const bg = parse(cs.backgroundColor);
      const local = bg && bg[3] > 0 ? over(bg, backdrop) : backdrop;
      const inner = i + 1 < chain.length ? paint(chain, i + 1, local, text) : text ? over(text, local) : local;
      return mix(inner, backdrop, Number.parseFloat(cs.opacity));
    };
    const chainOf = (el: Element): Element[] => {
      const out: Element[] = [];
      for (let e: Element | null = el; e; e = e.parentElement) out.unshift(e);
      return out;
    };
    const out: string[] = [];
    const check = (el: Element, fg: C, label: string) => {
      const chain = chainOf(el);
      const white: C = [255, 255, 255, 1];
      const t = paint(chain, 0, white, fg);
      const b = paint(chain, 0, white, null);
      const [l1, l2] = [luminance(t), luminance(b)];
      const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      const cs = getComputedStyle(el);
      const size = Number.parseFloat(cs.fontSize);
      const inactive = !!el.closest(':disabled');
      const need = inactive ? 3 : size >= 24 || (size >= 18.66 && Number.parseInt(cs.fontWeight, 10) >= 700) ? 3 : 4.5;
      if (ratio < need)
        out.push(`${el.tagName.toLowerCase()}.${String(el.className)} ${label} ${ratio.toFixed(2)}:1（${need} 必要）`);
    };
    const skip = (el: Element) => !!el.closest('svg, iframe, .fmt-term, [hidden], dialog:not([open])'); // 図・枠（別の文書）・端末（もともと暗い）は、対象外
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const t = (n.nodeValue || '').trim();
      const el = n.parentElement;
      if (!t || !el || skip(el)) continue;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (r.width < 2 || r.height < 2 || cs.visibility === 'hidden' || cs.display === 'none') continue;
      const fg = parse(cs.color);
      if (fg) check(el, fg, `「${t.slice(0, 16)}」`);
    }
    // 空の入力欄の placeholder
    for (const el of document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      'textarea[placeholder], input[placeholder]',
    )) {
      if (el.value || skip(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      const ph = getComputedStyle(el, '::placeholder');
      const fg = parse(ph.color);
      if (fg)
        check(
          el,
          [fg[0], fg[1], fg[2], fg[3] * Number.parseFloat(ph.opacity || '1')],
          `placeholder「${el.placeholder.slice(0, 12)}」`,
        );
    }
    return [...new Set(out)];
  });

test.describe('外観のモード（F36）', () => {
  test('system（既定）：OS の外観に追従する（ダーク・ライト）。<html data-theme> は、付かない', async ({
    page,
    app,
  }) => {
    await app.switchTopic(page, 'th', '外観', DOC);
    await expect(themeBtn(page)).toHaveAttribute('aria-label', '外観：システム（自動）。押すと、ライトにします');
    expect(await stored(page)).toBeUndefined(); // 何も選んでいない
    await page.emulateMedia({ colorScheme: 'light' });
    await expectLight(page);
    await page.emulateMedia({ colorScheme: 'dark' });
    await expectDark(page);
    expect((await colors(page)).attr).toBeNull();
    expect((await colors(page)).scheme).toContain('dark');
    await page.emulateMedia({ colorScheme: 'light' });
    await expectLight(page);
  });

  test('ボタン：system → ライト → ダーク → system。選んだ外観は、OS に関係なく保たれる。再読み込みしても、保たれる', async ({
    page,
    app,
  }) => {
    await app.switchTopic(page, 'th', '外観', DOC);
    // OS はダーク：ライトを選ぶと、ライト
    await page.emulateMedia({ colorScheme: 'dark' });
    await expectDark(page);
    await themeBtn(page).click();
    await expect(themeBtn(page)).toHaveAttribute('aria-label', '外観：ライト。押すと、ダークにします');
    await expectLight(page);
    expect((await colors(page)).attr).toBe('light');
    expect(await stored(page)).toBe('light');
    await page.reload();
    await ui(page).article.locator('.blk').first().waitFor();
    await expectLight(page); // OS はダークのまま
    // OS はライト：ダークを選ぶと、ダーク
    await page.emulateMedia({ colorScheme: 'light' });
    await themeBtn(page).click();
    await expect(themeBtn(page)).toHaveAttribute('aria-label', '外観：ダーク。押すと、システム（自動）にします');
    await expectDark(page);
    expect(await stored(page)).toBe('dark');
    await page.reload();
    await ui(page).article.locator('.blk').first().waitFor();
    await expectDark(page);
    expect((await colors(page)).attr).toBe('dark');
    // system に戻すと、OS（ライト）に追従する。OS を変えると、また追従する
    await themeBtn(page).click();
    await expect(themeBtn(page)).toHaveAttribute('aria-label', '外観：システム（自動）。押すと、ライトにします');
    expect((await colors(page)).attr).toBeNull();
    await expectLight(page);
    await page.emulateMedia({ colorScheme: 'dark' });
    await expectDark(page);
    expect(await stored(page)).toBe('system');
  });

  test('保存が壊れている・知らない値のとき：system に戻る（OS に従う）。ほかの設定は、そのまま', async ({
    page,
    app,
  }) => {
    await page.evaluate(() => localStorage.setItem('rikai-ui', JSON.stringify({ sideOpen: false, theme: 'neon' })));
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.reload();
    await ui(page).article.locator('.blk').first().waitFor();
    await expectDark(page); // OS（ダーク）
    expect((await colors(page)).attr).toBeNull();
    await expect(page.locator('#btn-side')).toHaveAttribute('aria-expanded', 'false'); // 一覧は、しまったまま
    await page.evaluate(() => localStorage.setItem('rikai-ui', '{壊れた'));
    await page.reload();
    await ui(page).article.locator('.blk').first().waitFor();
    await expectDark(page);
    void app;
  });

  test('Mermaid の図：ダークで、描き直される（ライトの図を、使い回さない）。OS の外観の変化にも追従する。ライトに戻すと、ライトの図', async ({
    page,
    app,
  }) => {
    await app.switchTopic(page, 'th', '外観', DOC);
    const fill = () =>
      page.evaluate(() => {
        const e = document.querySelector(
          '#article .mermaid-block .node rect, #article .mermaid-block .node polygon',
        ) as SVGElement | null;
        return e ? getComputedStyle(e).fill : null;
      });
    await expect.poll(fill).not.toBeNull();
    const light = lum(rgbOf((await fill()) as string));
    expect(light).toBeGreaterThan(0.5); // neutral：明るい
    // ボタンで、ダーク
    await themeBtn(page).click();
    await themeBtn(page).click();
    await expect(themeBtn(page)).toHaveAttribute('aria-label', /ダーク/);
    await expect.poll(async () => lum(rgbOf((await fill()) as string))).toBeLessThan(0.25);
    // system に戻し、OS をライト・ダークと変える：追従して、描き直す
    await themeBtn(page).click();
    await page.emulateMedia({ colorScheme: 'light' });
    await expect.poll(async () => lum(rgbOf((await fill()) as string))).toBeGreaterThan(0.5);
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect.poll(async () => lum(rgbOf((await fill()) as string))).toBeLessThan(0.25);
  });

  test('ダーク・ライトの、どちらでも、見えている文字のコントラストが AA（4.5:1。大きな文字は 3:1）以上：本文・カード・ask・ボタン・タブ・リンク・補助の文字・ダイアログ', async ({
    page,
    app,
  }) => {
    await app.switchTopic(page, 'th', '外観', DOC);
    const ask = {
      type: 'single_choice',
      question: '何を食べますか',
      options: [
        { id: 'a', label: 'カリカリ', detail: '乾いたもの' },
        { id: 'b', label: '魚' },
      ],
      allowOther: true,
    };
    await app.apply(
      {
        threads: [
          {
            page: 'root',
            anchor: { quote: '猫は朝によく鳴きます' },
            body: '朝についての確認です。**太字**と `code`。',
            ask,
          },
          {
            page: 'root',
            anchor: { quote: '最後の段落です' },
            body: '確認です。',
            ask: { type: 'scale', question: '理解度', min: 1, max: 5, minLabel: 'ぜんぜん', maxLabel: 'よく分かった' },
          },
        ],
      },
      { topic: 'th' },
    );
    await expect(ui(page).threads).toHaveCount(2);
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.waitForTimeout(300);
      expect(await contrastFailures(page), `${scheme}：本文・カード`).toEqual([]);
      // 解決済みのタブ・ダイアログ
      await page.locator('#btn-end').click();
      await expect(ui(page).enddlg).toBeVisible();
      expect(await contrastFailures(page), `${scheme}：ダイアログ`).toEqual([]);
      await page.keyboard.press('Escape');
      await expect(ui(page).enddlg).toBeHidden();
    }
  });

  test('ダークでも、白い島がない：本文・パネル・カード・入力欄・表・コードの背景が、暗い。html-app の枠（別の文書）と、画像は、そのまま', async ({
    page,
    app,
  }) => {
    await app.switchTopic(page, 'th', '外観', DOC);
    await app.apply(
      { threads: [{ page: 'root', anchor: { quote: '猫は朝によく鳴きます' }, body: '確認です。' }] },
      { topic: 'th' },
    );
    await expect(ui(page).threads).toHaveCount(1);
    await page.emulateMedia({ colorScheme: 'dark' });
    const bgs = await page.evaluate(() => {
      const bg = (s: string) => getComputedStyle(document.querySelector(s) as HTMLElement).backgroundColor;
      return {
        top: bg('#top'),
        side: bg('#side'),
        docscroll: bg('#docscroll'),
        panel: bg('#threads'),
        card: bg('#threads .thread'),
        textarea: bg('#threads .thread textarea'),
        ghost: bg('#threads .thread button.ghost'),
        pre: bg('#article pre'),
        tab: bg('#threads .tab.on'),
        regbtn: bg('#regbtn'),
      };
    });
    for (const [name, c] of Object.entries(bgs)) expect(lum(rgbOf(c)), `${name}：${c}`).toBeLessThan(0.1);
  });

  const BOTH = ['light', 'dark'] as const;
  const auditBoth = async (page: Page, label: string) => {
    for (const scheme of BOTH) {
      await page.emulateMedia({ colorScheme: scheme });
      expect(await contrastFailures(page), `${scheme}：${label}`).toEqual([]);
    }
    await page.emulateMedia({ colorScheme: 'light' });
  };

  test('状態の総当たり：無効のボタン・placeholder・解決済み（丸・.no）・#actbar・範囲選択のヒント・トースト（エラー・通常）・ポップオーバーも、AA 以上（無効は 3:1 以上）', async ({
    page,
    app,
  }) => {
    await app.switchTopic(page, 'th', '外観', DOC);
    await expect(ui(page).submit).toBeDisabled();
    await auditBoth(page, '無効の Submit');
    await addTextComment(page, '猫は朝によく鳴きます', '一つ目');
    await addTextComment(page, '最後の段落です', '二つ目');
    await expect(ui(page).threads.first().locator('textarea')).toHaveAttribute('placeholder', /返信/);
    await auditBoth(page, '返信欄の placeholder・未送信');
    // 解決済み（丸・.no）：「すべて」で、解決済みのカードも見える
    await ui(page).threads.first().getByRole('button', { name: '解決', exact: true }).click();
    await page.locator('.tab', { hasText: 'すべて' }).click();
    await expect(page.locator('#badges .bno.resolved')).toHaveCount(1);
    await auditBoth(page, '解決済み（丸・.no）');
    await page.locator('.tab', { hasText: '進行中' }).click();
    // #actbar（文を選ぶと出る）
    await dragSelect(page, '最後の段落です');
    await expect(ui(page).actbar).toBeVisible();
    await auditBoth(page, '#actbar');
    await page.mouse.click(5, 5);
    // 範囲選択のヒント
    await ui(page).regbtn.click();
    await expect(page.locator('#regsel .hint')).toBeVisible();
    await auditBoth(page, '範囲選択のヒント');
    // トースト（エラー）：小さすぎる範囲
    const r = (await page.locator('#article pre.blk').first().boundingBox()) as { x: number; y: number };
    await page.mouse.move(r.x + 20, r.y + 10);
    await page.mouse.down();
    await page.mouse.move(r.x + 22, r.y + 12);
    await page.mouse.up();
    await expect(ui(page).toast).toContainText('小さすぎます');
    await expect(ui(page).toast).toHaveClass(/err/);
    await auditBoth(page, 'トースト（エラー）');
    await expect(ui(page).toast).toBeHidden();
    // トースト（通常）：送信
    await ui(page).submit.click();
    await ui(page).submitdlg.getByRole('button', { name: '送信する' }).click();
    await expect(ui(page).toast).toContainText('送信しました');
    await auditBoth(page, 'トースト（通常）');
  });

  test('状態の総当たり：同じ行の「+N」のポップオーバーも、AA 以上', async ({ page, app }) => {
    await page.setViewportSize({ width: 1500, height: 1000 });
    const words = ['語一', '語二', '語三', '語四', '語五', '語六', '語七'];
    await app.switchTopic(page, 'row', '行', `# 行\n\n${words.join('、')}。\n`);
    await app.apply(
      { threads: words.map((w) => ({ page: 'root', anchor: { quote: w }, body: `${w}の確認です。` })) },
      { topic: 'row' },
    );
    await expect(page.locator('#badges .bno-more')).toHaveCount(1);
    await page.locator('#badges .bno-more').hover();
    await expect(page.locator('#badges .bno-pop')).toBeVisible();
    for (const scheme of BOTH) {
      await page.emulateMedia({ colorScheme: scheme });
      expect(await contrastFailures(page), `${scheme}：ポップオーバー`).toEqual([]);
    }
  });

  // Mermaid：図を、たくさん（7 つ）。描いている間に、外観を、何度も切り替える
  const manyDiagrams = (n: number) =>
    Array.from(
      { length: n },
      (_, i) => `${BT}mermaid\nflowchart LR\n  A${i}[起点${i}] --> B${i}[終点${i}]\n${BT}`,
    ).join('\n\n');
  const nodeFills = (page: Page) =>
    page.evaluate(() =>
      [...document.querySelectorAll('#article .mermaid-block')].map((b) => {
        const e = b.querySelector('.node rect, .node polygon') as SVGElement | null;
        return e ? getComputedStyle(e).fill : null;
      }),
    );

  for (const final of ['light', 'dark'] as const) {
    test(`Mermaid の競合：描画の途中に、外観を何度も切り替えても、図は、すべて、いまの外観（最後は ${final}）`, async ({
      page,
      app,
    }) => {
      // 図の部品（別の chunk）の読み込みを遅らせて、描画を、長引かせる
      await page.route('**/assets/*.js', async (route) => {
        if (/index-|theme-init/.test(route.request().url())) return route.continue();
        await new Promise((r) => setTimeout(r, 200));
        return route.continue();
      });
      await app.switchTopic(page, 'dg', '図', `# 図\n\n${manyDiagrams(7)}`);
      const flips: ('light' | 'dark')[] =
        final === 'light' ? ['dark', 'light', 'dark', 'light'] : ['dark', 'light', 'dark'];
      for (const f of flips) {
        await page.emulateMedia({ colorScheme: f });
        await page.waitForTimeout(120);
      }
      await expect
        .poll(async () => (await nodeFills(page)).filter((f) => f !== null).length, { timeout: 30_000 })
        .toBe(7);
      await expect
        .poll(
          async () =>
            (await nodeFills(page)).map((f) =>
              f ? (lum(rgbOf(f)) > 0.5 ? 'light' : lum(rgbOf(f)) < 0.25 ? 'dark' : '?') : null,
            ),
          { timeout: 30_000 },
        )
        .toEqual(Array(7).fill(final));
      // 反対の外観にして、また戻す：キャッシュの図も、正しい外観
      await page.emulateMedia({ colorScheme: final === 'light' ? 'dark' : 'light' });
      await expect
        .poll(
          async () =>
            (await nodeFills(page)).map((f) =>
              f ? (lum(rgbOf(f)) > 0.5 ? 'light' : lum(rgbOf(f)) < 0.25 ? 'dark' : '?') : null,
            ),
          { timeout: 30_000 },
        )
        .toEqual(Array(7).fill(final === 'light' ? 'dark' : 'light'));
    });
  }

  test('OS の外観の変化に、図が、追従する（画面の更新に頼らない：サーバーへの問い合わせを止めても、描き直す）', async ({
    page,
    app,
  }) => {
    await app.switchTopic(page, 'dg', '図', `# 図\n\n${manyDiagrams(2)}`);
    await expect.poll(async () => (await nodeFills(page)).filter((f) => f !== null).length).toBe(2);
    await page.route('**/api/**', () => new Promise(() => {})); // 以後の取得は、答えない：画面は、再描画されない
    await page.waitForTimeout(300);
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect
      .poll(async () => (await nodeFills(page)).map((f) => (f ? lum(rgbOf(f)) < 0.25 : false)), { timeout: 4000 })
      .toEqual([true, true]);
  });

  test('ちらつきがない：保存した外観（ダーク）と OS（ライト）が逆でも、最初のフレームから、保存した外観（JS の読み込みを遅らせても）', async ({
    page,
    app,
  }) => {
    await app.switchTopic(page, 'th', '外観', DOC);
    await page.evaluate(() => localStorage.setItem('rikai-ui', JSON.stringify({ theme: 'dark' })));
    await page.emulateMedia({ colorScheme: 'light' });
    await page.addInitScript(() => {
      const w = window as unknown as { __bg: string[] };
      w.__bg = [];
      const tick = () => {
        if (document.body) w.__bg.push(getComputedStyle(document.body).backgroundColor);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await page.route('**/assets/index-*.js', async (route) => {
      await new Promise((r) => setTimeout(r, 1500)); // 画面の本体（モジュール）を、遅らせる
      await route.continue();
    });
    await page.reload({ waitUntil: 'commit' }); // load を待たない（本体の読み込みが、遅れているので）
    await page.waitForTimeout(1000);
    expect(await page.evaluate(() => !!document.querySelector('#top')), '本体は、まだ、動いていない').toBe(false);
    const samples = (await page.evaluate(() => (window as unknown as { __bg: string[] }).__bg)).filter(
      (c) => !/, 0\)$/.test(c) && c !== 'transparent',
    );
    expect(samples.length).toBeGreaterThan(0);
    for (const c of samples) expect(lum(rgbOf(c)), `最初のフレームから：${c}`).toBeLessThan(0.05);
  });

  test('html-app の枠：画面の外観に従う（橋が、?mode と theme で、配色を渡す）。ライトでもダークでも、枠の中の文字は、地に対して、読める。<meta name="color-scheme" content="light dark"> を宣言した部品も、読める', async ({
    page,
    app,
  }) => {
    const doc = `# 部品\n\n${BT}html-app height=120\n<meta name="color-scheme" content="light dark"><p id="t">読める文字です</p>\n${BT}\n`;
    await app.switchTopic(page, 'ha', '部品', doc);
    const frame = page.locator('iframe.appframe').first();
    for (const scheme of BOTH) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.waitForTimeout(300);
      // 意図した変更（F40）：この部品は、<meta name="color-scheme"> で、配色への対応を示している（オプトイン）ので、画面の外観に従う（再読み込みなし）。
      // 対応を示さない従来の部品が、常にライトのままであることは、htmlapp-bridge.spec.ts（従来の資料：従来と同じ見た目）
      await expect
        .poll(() => page.frameLocator('iframe.appframe').first().locator('html').getAttribute('data-theme'))
        .toBe(scheme);
      const text = await page
        .frameLocator('iframe.appframe')
        .first()
        .locator('#t')
        .evaluate((e) => getComputedStyle(e).color);
      // 枠の、見えている地（画面の写しの、右下の角の 1 画素：文字から離れている）
      const shot = (await frame.screenshot()).toString('base64');
      const px = await page.evaluate(async (b64) => {
        const im = new Image();
        im.src = `data:image/png;base64,${b64}`;
        await im.decode();
        const c = document.createElement('canvas');
        c.width = im.width;
        c.height = im.height;
        const g = c.getContext('2d') as CanvasRenderingContext2D;
        g.drawImage(im, 0, 0);
        const d = g.getImageData(im.width - 4, im.height - 4, 1, 1).data;
        return `rgb(${d[0]}, ${d[1]}, ${d[2]})`;
      }, shot);
      const [a, b] = [lum(rgbOf(text)), lum(rgbOf(px))];
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      expect(ratio, `${scheme}：枠の中の文字 ${text}・地 ${px}`).toBeGreaterThanOrEqual(4.5);
    }
    await expect(page.locator('iframe.appframe').first()).toHaveAttribute('sandbox', 'allow-scripts'); // F28：隔離は、そのまま
  });

  test('強調（mark.hl）の中の文字：リンク・引用・太字・コード・json・diff・trace も、ライト・ダークで AA 以上（形式の枠の中は、補助の文字も）', async ({
    page,
    app,
  }) => {
    const doc = [
      '# 強調',
      '',
      '強調の段落に、[リンクの文](https://example.invalid/x) と **太字の語** と `コードの語` があります。',
      '',
      '> 引用の文章です。',
      '',
      '別の段落に、[別のリンク](https://example.invalid/y) があります。',
      '',
      '> 別の引用です。',
      '',
      `${BT}json`,
      '{"name": "たま", "age": 3, "owner": {"city": "東京"}}',
      BT,
      '',
      `${BT}diff`,
      '-猫は鳴く',
      '+猫は歌う',
      BT,
      '',
      `${BT}trace`,
      '準備 | 0 | 100 | 最初',
      '実行 | 100 | 300 | 本番',
      BT,
      '',
    ].join('\n');
    await app.switchTopic(page, 'hl', '強調', doc);
    const quotes = [
      'リンクの文',
      '太字の語',
      'コードの語',
      '引用の文章です',
      'たま',
      '東京',
      '猫は歌う',
      '最初',
      '本番',
    ];
    await app.apply(
      { threads: quotes.map((q) => ({ page: 'root', anchor: { quote: q }, body: `${q}の確認です。` })) },
      { topic: 'hl' },
    );
    await expect(page.locator('#article mark.hl.live')).not.toHaveCount(0);
    expect(await page.locator('#article .fmt mark.hl.live').count(), '形式の枠の中の強調').toBeGreaterThan(2);
    await auditBoth(page, '強調の中の文字');
    // ライトの見た目を変えない：強調の付いた文字は、強調のない同じ要素と、同じ色（リンクは青・引用は灰色のまま。json・diff の色付きの文字も、消えない）
    const colorOf = (sel: string) =>
      page
        .locator(sel)
        .first()
        .evaluate((e) => getComputedStyle(e).color);
    const linkMarked = await colorOf('#article a mark.hl');
    expect(linkMarked, '強調の付いたリンクの文字').toBe(await colorOf('#article a:not(:has(mark))'));
    const quoteMarked = await colorOf('#article blockquote mark.hl');
    expect(quoteMarked, '強調の付いた引用の文字').toBe(await colorOf('#article blockquote:not(:has(mark.hl)) p'));
    expect(linkMarked).not.toBe(quoteMarked);
    const diffs = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('#article mark.hl')]
        .filter((m) => !m.closest('.fmt-term'))
        .filter((m) => getComputedStyle(m).color !== getComputedStyle(m.parentElement as HTMLElement).color)
        .map((m) => m.textContent),
    );
    expect(diffs, '強調の色が、親の文字色と違う（色が消えた）').toEqual([]);
  });

  test('端末（.fmt-term）の中：未解決は、不透明な琥珀に暗い文字／解決済みは、灰色の下線／入力中は、アクセントの破線。どれも、暗い地の上で読める', async ({
    page,
    app,
  }) => {
    const doc = `# 端末\n\n${BT}terminal\n$ npm test\nPASS 全部の試験\nFAIL 一つの試験\n${BT}\n`;
    await app.switchTopic(page, 'tm', '端末', doc);
    await app.apply(
      {
        threads: [
          { page: 'root', anchor: { quote: 'PASS 全部の試験' }, body: '確認です。' },
          { page: 'root', anchor: { quote: 'FAIL 一つの試験' }, body: '確認です。' },
        ],
      },
      { topic: 'tm' },
    );
    const mark = (cls: string) =>
      page
        .locator(`#article .fmt-term mark.hl.${cls}`)
        .first()
        .evaluate((e) => {
          const cs = getComputedStyle(e);
          return {
            bg: cs.backgroundColor,
            color: cs.color,
            shadow: cs.boxShadow,
            outline: `${cs.outlineStyle} ${cs.outlineColor}`,
          };
        });
    const alpha = (c: string) => Number((c.match(/[\d.]+/g) ?? [])[3] ?? 1);
    const ratio = (a: Rgb, b: Rgb) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
    const termBg = await page
      .locator('#article .fmt-term')
      .first()
      .evaluate((e) => getComputedStyle(e).backgroundColor);
    for (const scheme of BOTH) {
      await page.emulateMedia({ colorScheme: scheme });
      // 未解決：不透明な琥珀に、暗い文字
      const live = await mark('live');
      expect(alpha(live.bg), `${scheme}：未解決の背景は、ほぼ不透明`).toBeGreaterThan(0.8);
      expect(ratio(rgbOf(live.color), rgbOf(live.bg)), `${scheme}：未解決の文字`).toBeGreaterThanOrEqual(4.5);
    }
    // 1 つを解決する（解決済み）
    await page.emulateMedia({ colorScheme: 'light' });
    await ui(page).threads.first().getByRole('button', { name: '解決', exact: true }).click();
    await expect(page.locator('#article .fmt-term mark.hl.resolved')).toHaveCount(1);
    // 入力中：端末の行を選んで、コメントの入力欄を開く
    await dragSelect(page, '$ npm test');
    await ui(page).actbar.getByRole('button', { name: 'コメント' }).click();
    await expect(page.locator('#article .fmt-term mark.hl.pending')).toHaveCount(1);
    for (const scheme of BOTH) {
      await page.emulateMedia({ colorScheme: scheme });
      const done = await mark('resolved');
      expect(alpha(done.bg), `${scheme}：解決済みは、背景なし（下線だけ）`).toBe(0);
      expect(done.shadow, `${scheme}：解決済みは、灰色の下線`).not.toBe('none');
      expect(ratio(rgbOf(done.color), rgbOf(termBg)), `${scheme}：解決済みの文字`).toBeGreaterThanOrEqual(4.5);
      const pend = await mark('pending');
      expect(pend.outline, `${scheme}：入力中は、破線`).toMatch(/^dashed/);
      expect(alpha(pend.bg), `${scheme}：入力中の背景は、半透明（琥珀ではない）`).toBeLessThan(0.5);
      expect(
        ratio(rgbOf(pend.color), rgbOf(termBg)),
        `${scheme}：入力中の文字（地は暗い端末の上）`,
      ).toBeGreaterThanOrEqual(4.5);
      // 琥珀ではない：青が、赤より強い
      const [r, , b] = rgbOf(pend.outline.replace(/^dashed /, ''));
      expect(b, `${scheme}：入力中の破線は、青系`).toBeGreaterThan(r);
    }
  });
});
