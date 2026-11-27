// アラート（`> [!NOTE]`）とタスクリスト（`- [ ]`）：実際の Chrome で、見た目（ライト・ダーク・狭い窓・コントラスト）・コメント（文・ブロック・版をまたいで残る）・
// チェック欄は押せない・版の差分・安全（スクリプトが動かない）・外への通信が 0 件（fixtures）。資料は、作り物。
import fs from 'node:fs';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { expect, type RikaiApp, test } from './fixtures';
import { addTextComment, fillAndAdd, hoverBlock, submitAll, ui } from './ui';

const BT = '```';
const lines = (...l: string[]) => `${l.join('\n')}\n`;

const DOC_V1 = lines(
  '# アラートの見本',
  '',
  '普通の段落です。',
  '',
  '> [!NOTE]',
  '> 補足です。**太字**と `code` と [内部リンク](page:next) を書けます。',
  '',
  '> [!TIP]',
  '> コツです。',
  '>',
  '> - 項目 A',
  '> - 項目 B',
  '',
  '> [!IMPORTANT]',
  '> 始める前に、バックアップを取ってください。',
  '>',
  `> ${BT}sh`,
  '> cp -r data data.bak',
  `> ${BT}`,
  '',
  '> [!WARNING]',
  '> この操作は、元に戻せません。',
  '',
  '> [!CAUTION]',
  '> 本番のデータには、触れないでください。',
  '',
  '> ふつうの引用です。',
  '',
  '> [!NOTE] 同じ行に文字がある引用は、ふつうの引用です。',
  '',
  '## 作業',
  '',
  '- [ ] 下書きを書く',
  '- [x] 見本を作る',
  '  - [ ] 入れ子の未完了',
  '  - [x] 入れ子の完了',
  '',
  '1. [ ] 番号つきの一つ目',
  '2. [x] 番号つきの二つ目',
  '',
  '- 普通の項目',
  '',
  '最後の段落です。',
);

// v2：警告 → 注意（種類だけ変える）・「下書きを書く」を完了に・メモの文を直す・「入れ子の完了」を未完了に
const DOC_V2 = DOC_V1.replace('> [!WARNING]', '> [!CAUTION]')
  .replace('- [ ] 下書きを書く', '- [x] 下書きを書く')
  .replace('補足です。', '補足を、直しました。')
  .replace('- [x] 入れ子の完了', '- [ ] 入れ子の完了');

const TITLE = 'アラートの見本';
async function open(page: Page, app: RikaiApp, md = DOC_V1) {
  await app.switchTopic(page, 'alerts', TITLE, md);
}

// 保存されたコメントのアンカー（threads.json）
function threadAnchor(app: RikaiApp, i: number): { blockTag: string; blockText: string; blockHash: string } {
  const f = path.join(app.root, '.rikai', app.slug, 'threads.json');
  return JSON.parse(fs.readFileSync(f, 'utf8')).threads[i].anchor;
}
// 画面と同じ、ブロックの文字のハッシュ（lib/dom.ts の hash）
function hashOf(s: string): string {
  let x = 5381;
  for (let i = 0; i < s.length; i++) x = ((x << 5) + x + s.charCodeAt(i)) | 0;
  return (x >>> 0).toString(36);
}

type Rgb = [number, number, number];
const parseRgb = (s: string): Rgb => {
  const m = s.match(/[\d.]+/g)?.map(Number) ?? [];
  if (m.length < 3) throw new Error(`色を読めません: ${s}`);
  return [m[0] as number, m[1] as number, m[2] as number];
};
const lum = ([r, g, b]: Rgb): number => {
  const f = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrast = (a: Rgb, b: Rgb): number => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
};

const TYPES = ['note', 'tip', 'important', 'warning', 'caution'] as const;
const TITLES: Record<(typeof TYPES)[number], string> = {
  note: 'メモ · Note',
  tip: 'ヒント · Tip',
  important: '重要 · Important',
  warning: '警告 · Warning',
  caution: '注意 · Caution',
};

const alertOf = (page: Page, t: string): Locator => page.locator(`#article blockquote[data-alert="${t}"]`);

test.describe('アラート：見た目', () => {
  test('5 種類が、題・アイコン・左の色帯つきで描かれる。同じ行に文字がある引用・ふつうの引用は、これまでどおり', async ({
    page,
    app,
  }) => {
    await open(page, app);
    await expect(page.locator('#article blockquote[data-alert]')).toHaveCount(5);
    const seen = new Set<string>();
    for (const t of TYPES) {
      const bq = alertOf(page, t);
      await expect(bq).toHaveCount(1);
      const st = await bq.evaluate((e) => {
        const b = getComputedStyle(e, '::before');
        const a = getComputedStyle(e, '::after');
        return {
          title: a.content,
          mask: b.webkitMaskImage || b.maskImage,
          bar: getComputedStyle(e).borderLeftColor,
          barW: getComputedStyle(e).borderLeftWidth,
          text: e.textContent ?? '',
        };
      });
      expect(st.title).toBe(`"${TITLES[t]}"`);
      expect(st.mask).toContain('data:image/svg+xml');
      expect(st.barW).toBe('4px');
      seen.add(st.bar);
      expect(st.text).not.toMatch(/\[!|メモ ·|警告 ·|Note|Warning/); // 題・マーカーは、DOM の文字ではない
    }
    expect(seen.size).toBe(5); // 種類ごとに、色が違う
    // マーカーの行・同じ行に文字がある引用・ふつうの引用
    const plain = page.locator('#article blockquote:not([data-alert])');
    await expect(plain).toHaveCount(2);
    await expect(plain.nth(1)).toContainText('[!NOTE] 同じ行に文字がある');
    const st = await plain.first().evaluate((e) => ({
      w: getComputedStyle(e).borderLeftWidth,
      pl: getComputedStyle(e).paddingLeft,
      bg: getComputedStyle(e).backgroundColor,
      before: getComputedStyle(e, '::before').content,
      after: getComputedStyle(e, '::after').content,
    }));
    expect(st).toEqual({ w: '3px', pl: '14px', bg: 'rgba(0, 0, 0, 0)', before: 'none', after: 'none' });
    // 中の記法：段落・リスト・コード・リンク
    await expect(alertOf(page, 'note').locator('strong')).toHaveText('太字');
    await expect(alertOf(page, 'note').locator('a.pagelink')).toHaveCount(1);
    await expect(alertOf(page, 'tip').locator('ul > li')).toHaveCount(2);
    await expect(alertOf(page, 'important').locator('pre code')).toContainText('cp -r data data.bak');
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`${scheme}：題・本文・チェック欄が、読める（コントラスト AA：題と本文は 4.5:1・チェック欄の枠は 3:1）`, async ({
      page,
      app,
    }) => {
      await open(page, app);
      await page.emulateMedia({ colorScheme: scheme });
      for (const t of TYPES) {
        const r = await alertOf(page, t).evaluate((e) => ({
          title: getComputedStyle(e, '::after').color,
          bar: getComputedStyle(e).borderLeftColor,
          bg: getComputedStyle(e).backgroundColor,
          ink: getComputedStyle(e.querySelector('p, li') as Element).color,
          page: getComputedStyle(document.body).backgroundColor,
        }));
        expect(contrast(parseRgb(r.title), parseRgb(r.bg)), `${t} の題`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(parseRgb(r.ink), parseRgb(r.bg)), `${t} の本文`).toBeGreaterThanOrEqual(7);
        expect(contrast(parseRgb(r.bar), parseRgb(r.bg)), `${t} の帯`).toBeGreaterThanOrEqual(3);
      }
      const box = page.locator('#article .task-box').first();
      const b = await box.evaluate((e) => ({
        edge: getComputedStyle(e).borderTopColor,
        bg: getComputedStyle(e).backgroundColor,
        around: getComputedStyle(document.querySelector('#article') as Element).backgroundColor,
      }));
      const paper = await page.evaluate(
        () => getComputedStyle(document.querySelector('#docscroll') as Element).backgroundColor,
      );
      expect(contrast(parseRgb(b.edge), parseRgb(paper)), 'チェック欄の枠').toBeGreaterThanOrEqual(3);
      // 完了の項目の文字（薄く）も、AA
      const done = page.locator('#article li.task-done').first();
      const fg = await done.evaluate((e) => getComputedStyle(e).color);
      expect(contrast(parseRgb(fg), parseRgb(paper)), '完了の文字').toBeGreaterThanOrEqual(4.5);
      // 完了の欄：塗りと、中のチェック（白）が、読める
      const fill = await page
        .locator('#article .task-box[aria-checked="true"]')
        .first()
        .evaluate((e) => getComputedStyle(e).backgroundColor);
      expect(contrast(parseRgb(fill), [255, 255, 255])).toBeGreaterThanOrEqual(4.5);
    });
  }

  test('狭い窓：アラート・タスクが、横にあふれない。題がアイコンと重ならない', async ({ page, app }) => {
    await open(page, app);
    await page.setViewportSize({ width: 560, height: 900 });
    await expect
      .poll(() => page.locator('#docscroll').evaluate((e) => e.scrollWidth - e.clientWidth))
      .toBeLessThanOrEqual(1);
    for (const t of TYPES) {
      const bq = alertOf(page, t);
      await bq.scrollIntoViewIfNeeded();
      const box = (await bq.boundingBox()) as { x: number; width: number };
      const art = (await page.locator('#article').boundingBox()) as { x: number; width: number };
      expect(box.x + box.width).toBeLessThanOrEqual(art.x + art.width + 1);
    }
    for (const li of await page.locator('#article li.task-item').all()) {
      const b = (await li.boundingBox()) as { x: number };
      const bx = (await li.locator('.task-box').first().boundingBox()) as { x: number };
      expect(bx.x).toBeGreaterThanOrEqual(0); // 欄が、画面の左に、はみ出さない
      expect(b.x).toBeGreaterThanOrEqual(0);
    }
  });
});

test.describe('アラート：コメント', () => {
  test('中の文を選んでコメント → 送る → 版を更新しても、同じ文に残る。送られる文に、マーカー・題は入らない', async ({
    page,
    app,
  }) => {
    const u = ui(page);
    await open(page, app);
    await addTextComment(page, 'この操作は、元に戻せません。', '本当に戻せませんか？');
    await expect(alertOf(page, 'warning').locator('mark.hl')).toHaveText('この操作は、元に戻せません。');
    await submitAll(page);
    const r = await app.nextRound();
    const a = r.items[0].anchor;
    expect(a.quote).toBe('この操作は、元に戻せません。');
    expect(JSON.stringify(a)).not.toMatch(/\[!WARNING\]|警告 ·/);
    await app.apply({
      round: r.round,
      revisions: [{ page: 'root', markdown: DOC_V2 }],
      replies: [{ thread: r.items[0].thread, body: '種類を、注意に変えました。' }],
    });
    await expect(page.locator('#docbar select')).toHaveValue('2');
    await expect(u.threads).toHaveCount(1);
    // 版 2 では、警告 → 注意になった（同じ文は、注意のアラートの中で、強調され続ける）
    await expect(alertOf(page, 'caution')).toHaveCount(2);
    await expect(alertOf(page, 'caution').locator('mark.hl')).toHaveText('この操作は、元に戻せません。');
    await expect(u.bno).toHaveCount(1);
  });

  test('アラートにマウスを置いて「コメント」：1 つのブロック。カードの見出しに種類。送られる blockText に、題・マーカーは入らない。版をまたいで残る', async ({
    page,
    app,
  }) => {
    const u = ui(page);
    await open(page, app);
    const bq = alertOf(page, 'important');
    await hoverBlock(page, bq);
    await expect(u.actbar).toBeVisible();
    await u.actComment.click();
    await expect(u.composer.locator('.quote')).toContainText('重要: 始める前に、バックアップを取ってください。');
    await fillAndAdd(page, 'この手順は、必須ですか？');
    await expect(bq).toHaveClass(/blk-thread/);
    await submitAll(page);
    const r = await app.nextRound();
    const a = r.items[0].anchor;
    expect(a.quote).toBe('');
    expect(a.label).toMatch(/^重要: 始める前に/);
    // 保存されたアンカー：本文の文字（題・マーカーなし）・ブロックの種類
    const saved = threadAnchor(app, 0);
    expect(saved.blockTag).toBe('BLOCKQUOTE');
    expect(saved.blockText).toContain('始める前に、バックアップを取ってください。');
    expect(saved.blockText).not.toMatch(/\[!IMPORTANT\]|重要 ·/);
    await app.apply({
      round: r.round,
      revisions: [{ page: 'root', markdown: DOC_V2 }],
      replies: [{ thread: r.items[0].thread, body: '必須です。' }],
    });
    await expect(page.locator('#docbar select')).toHaveValue('2');
    await expect(alertOf(page, 'important')).toHaveClass(/blk-thread/); // 内容が同じなので、確実に見つかる
    await expect(u.threads.first()).not.toContainText('推定');
  });
});

test.describe('タスクリスト', () => {
  test('項目にコメントを付けられる（ブロックは、ふつうの項目と同じ）。送られる blockText・label に、チェックの文字は入らない', async ({
    page,
    app,
  }) => {
    const u = ui(page);
    await open(page, app);
    const item = page.locator('#article li', { hasText: '下書きを書く' });
    await hoverBlock(page, item);
    await expect(u.actbar).toBeVisible();
    await u.actComment.click();
    await expect(u.composer.locator('.quote')).toContainText('下書きを書く');
    await fillAndAdd(page, '誰が書きますか？');
    await addTextComment(page, '番号つきの二つ目', '番号つきの項目の文');
    await submitAll(page);
    const r = await app.nextRound();
    const labels: string[] = r.items.map((i: { anchor: { label: string } }) => i.anchor.label);
    expect(labels).toContain('下書きを書く'); // チェックの文字は、入らない
    const quotes: string[] = r.items.map((i: { anchor: { quote: string } }) => i.anchor.quote);
    expect(quotes).toContain('番号つきの二つ目');
    const saved = threadAnchor(app, 0);
    expect(saved.blockTag).toBe('LI');
    expect(saved.blockText).toBe('下書きを書く');
    expect(saved.blockHash).toBe(hashOf('下書きを書く')); // ふつうの項目（`- 下書きを書く`）と、同じハッシュ
  });

  test('チェック欄は、押せない：押しても、何も起きない（状態も、通信も、入力欄も）。欄の上の操作は、項目に届く', async ({
    page,
    app,
  }) => {
    const u = ui(page);
    await open(page, app);
    const boxes = page.locator('#article .task-box');
    const before = await page.locator('#article').innerHTML();
    const requests: string[] = [];
    page.on('request', (rq) => requests.push(`${rq.method()} ${new URL(rq.url()).pathname}`));
    for (const i of [0, 1, 2, 4]) {
      const b = boxes.nth(i);
      await b.scrollIntoViewIfNeeded();
      const c = (await b.boundingBox()) as { x: number; y: number; width: number; height: number };
      const x = c.x + c.width / 2;
      const y = c.y + c.height / 2;
      // 欄の上の要素は、欄でなく、項目（クリックが、本文の操作を妨げない）
      expect(
        await page.evaluate(([px, py]) => document.elementFromPoint(px as number, py as number)?.tagName, [x, y]),
      ).toBe('LI');
      await page.mouse.click(x, y);
    }
    await page.keyboard.press('Space');
    await expect(boxes.first()).not.toBeFocused();
    expect(await page.locator('#article').innerHTML()).toBe(before);
    await expect(u.composer).toHaveCount(0);
    expect(requests.filter((r) => !r.startsWith('GET'))).toEqual([]); // 保存・変更の通信なし
    // 機能：読み上げ用の属性
    await expect(boxes.first()).toHaveAttribute('role', 'checkbox');
    await expect(boxes.first()).toHaveAttribute('aria-checked', 'false');
    await expect(boxes.first()).toHaveAttribute('aria-disabled', 'true');
    await expect(boxes.nth(1)).toHaveAttribute('aria-checked', 'true');
    await expect(boxes.nth(1)).toHaveAttribute('aria-label', '完了');
    await expect(page.locator('#article input')).toHaveCount(0);
  });

  test('項目の文を選んでコメントできる（チェック欄をまたぐ選択でも、文は取れる）。完了の項目は、色が薄く、取り消し線はない', async ({
    page,
    app,
  }) => {
    const u = ui(page);
    await open(page, app);
    await addTextComment(page, '入れ子の未完了', '入れ子へのコメント');
    await expect(page.locator('#article li mark.hl')).toHaveText('入れ子の未完了');
    const st = await page.locator('#article li.task-done', { hasText: '見本を作る' }).evaluate((e) => ({
      deco: getComputedStyle(e).textDecorationLine,
      color: getComputedStyle(e).color,
      ink: getComputedStyle(document.querySelector('#article p') as Element).color,
      nestedUndone: getComputedStyle(e.querySelector('li:not(.task-done)') as Element).color,
    }));
    expect(st.deco).toBe('none');
    expect(st.color).not.toBe(st.ink); // 薄い
    expect(st.nestedUndone).toBe(st.ink); // 入れ子の未完了は、親が完了でも、薄くならない
    await expect(u.bno).toHaveCount(1);
  });
});

test.describe('版の差分（F11）', () => {
  test('アラートの種類・チェックの変化・文の変更が、「変更」と分かる。入れ子のチェックも', async ({ page, app }) => {
    const u = ui(page);
    await open(page, app);
    await addTextComment(page, '普通の段落です。', 'つなぎのコメント');
    await submitAll(page);
    const r = await app.nextRound();
    await app.apply({
      round: r.round,
      revisions: [{ page: 'root', markdown: DOC_V2 }],
      replies: [{ thread: r.items[0].thread, body: '直しました。' }],
    });
    await expect(page.locator('#docbar select')).toHaveValue('2');
    // 変更：警告 → 注意（文字は同じ）・メモの文・「下書きを書く」・「見本を作る」（入れ子のチェックが変わった）
    await expect(u.docbar).toContainText('変更 4');
    const changed = u.article.locator('.blk.changed');
    await expect(changed).toHaveCount(4);
    const notes = await u.article.locator('.diffbox .diffnote').allTextContents();
    expect(notes).toContain('ブロックの種類が変わりました：注意書き（警告） → 注意書き（注意）');
    expect(notes).toContain('ブロックの種類が変わりました：箇条書き・チェック ☐ → 箇条書き・チェック ☑');
    expect(notes).toContain('ブロックの種類が変わりました：箇条書き・チェック ☑☐☑ → 箇条書き・チェック ☑☐☐');
    // 変わらないもの：同じアラート（TIP・IMPORTANT）・普通の項目は、変更にならない
    await expect(alertOf(page, 'tip')).not.toHaveClass(/changed/);
    await expect(u.article.locator('li', { hasText: '普通の項目' })).not.toHaveClass(/changed/);
    await expect(u.article.locator('li.task-item', { hasText: '番号つきの一つ目' })).not.toHaveClass(/changed/);
    // 文字の差分（メモの文）は、通常どおり
    const memo = u.article.locator('details', { has: page.locator('summary', { hasText: '前の版との差分' }) });
    await expect(memo).toHaveCount(4);
  });
});

test.describe('安全（N3）', () => {
  test('アラート・タスクの中に書いた script・onerror・javascript: は、動かない。input・form は、残らない。リンクは、これまでの規則', async ({
    page,
    app,
  }) => {
    const md = lines(
      '# 悪意のある入力',
      '',
      '> [!NOTE]',
      '> <script>window.__pwned = 1</script>',
      '> <img src="assets/none.png" onerror="window.__pwned = 2">',
      '> [悪意](javascript:window.__pwned=3)',
      '> <a href="javascript:window.__pwned=4" onclick="window.__pwned=5">x</a>',
      '> <input type="checkbox" checked name="a" form="f"> 生の input',
      '',
      '<form id="f" action="https://evil.example/submit"><input type="checkbox" name="b"><button>送る</button></form>',
      '',
      '- [ ] <img src=x onerror="window.__pwned=6"> [悪意](javascript:window.__pwned=7)',
      '- <input type="checkbox" checked disabled> 項目の中の生の input',
      '- 途中の <span class="task-box" role="checkbox" aria-checked="true"></span> 偽の印',
      '',
      '> [!TIP]<img src=x onerror="window.__pwned=8">',
      '> 本文',
    );
    const dialogs: string[] = [];
    page.on('dialog', (d) => {
      dialogs.push(d.message());
      void d.dismiss();
    });
    await app.switchTopic(page, 'evil', '悪意のある入力', md);
    await page
      .locator('#article a', { hasText: '悪意' })
      .first()
      .click({ force: true })
      .catch(() => {});
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
    expect(dialogs).toEqual([]);
    const art = page.locator('#article');
    await expect(art.locator('script, input, form, button, iframe')).toHaveCount(0);
    expect(await art.locator('[onerror], [onclick], [onload]').count()).toBe(0);
    expect(await art.locator('a[href^="javascript:" i]').count()).toBe(0);
    await expect(art.locator('blockquote[data-alert="note"]')).toHaveCount(1);
    await expect(art.locator('blockquote:not([data-alert])')).toHaveCount(1); // `[!TIP]<img…>` は、ふつうの引用
    // 偽の印は、項目の先頭でないので消える。本物は、項目の先頭の 1 つ
    await expect(art.locator('.task-box')).toHaveCount(1);
    await expect(art.locator('.task-box[aria-checked="true"]')).toHaveCount(0);
  });
});
