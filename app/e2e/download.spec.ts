// 「Markdown を保存」（0.30.0。F50）：実際の Chrome で、ボタンを押して、ファイルが落ちる。保存されたファイルは、サーバーの `pages/<page>/v<n>.md` と、バイト単位で一致する
// （最新版・過去の版・子ページ・変更を重ねる表示中・日本語・BOM・CRLF・空の本文）。コメントは含まれない・差分の装飾は入らない。外への通信は増えない・CSP は妨げない・バーは、はみ出さない。資料は作り物。
import fs from 'node:fs';
import path from 'node:path';
import type { Download, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { DOC_BASIC } from './samples';
import { addTextComment, submitAll, ui } from './ui';

const save = (page: Page) => page.getByRole('button', { name: 'Markdown を保存' });

/** ボタンを押して、落ちたファイル（名前・バイト列）を受け取る */
async function download(
  page: Page,
  how: 'click' | 'enter' | 'space' = 'click',
): Promise<{ name: string; bytes: Buffer }> {
  const btn = save(page);
  await expect(btn).toBeEnabled();
  const wait = page.waitForEvent('download');
  if (how === 'click') await btn.click();
  else {
    await btn.focus();
    await page.keyboard.press(how === 'enter' ? 'Enter' : 'Space');
  }
  const dl: Download = await wait;
  const file = await dl.path();
  return { name: dl.suggestedFilename(), bytes: fs.readFileSync(file) };
}

/** サーバーの実際のファイル */
const onDisk = (root: string, slug: string, pg: string, v: number): Buffer =>
  fs.readFileSync(path.join(root, '.rikai', slug, 'pages', pg, `v${v}.md`));

const V2 = DOC_BASIC.replace('三回', '四回');
const V3 = `${DOC_BASIC.replace('三回', '五回')}\n## 追記\n\n三つ目の版にだけある段落です。\n`;
const CHILD = '# 子ページ：猫の食事\n\n日本語の本文です。<b>タグ</b>と `code` を含みます。\n';

const hashOf = (page: Page, h: string) =>
  page.evaluate((x) => {
    location.hash = x;
  }, h);

test.describe('保存：ファイルの中身は、サーバーの実際のファイルと、バイト単位で一致する', () => {
  test('最新版・過去の版・子ページ・変更を重ねる表示中：ファイル名と中身。コメントは含まれない', async ({
    page,
    app,
  }) => {
    test.setTimeout(120_000);
    const u = ui(page);
    await app.switchTopic(page, 'dl-a', 'ダウンロード', DOC_BASIC);
    await app.apply({ revisions: [{ page: 'root', markdown: V2 }] });
    await app.apply({ revisions: [{ page: 'root', markdown: V3 }] });
    await app.apply({ pages: [{ id: 'sub-1', title: '日本語の子ページ', parent: 'root', markdown: CHILD }] });
    await expect(page.locator('#docbar select option')).toHaveCount(3);

    // 変更を重ねている（既定）最新版：差分の装飾が本文にある。保存するのは、元の Markdown（装飾なし）
    await addTextComment(page, '猫は朝によく鳴きます', 'この文に、作り物のコメント'); // コメントは、保存に含まれない
    await expect(u.docbar.locator('#btn-changes')).toHaveAttribute('aria-pressed', 'true');
    await expect(u.article.locator('.changed, .added').first()).toBeVisible();
    let r = await download(page);
    expect(r.name).toBe('dl-a-v3.md');
    expect(r.bytes.equals(onDisk(app.root, 'dl-a', 'root', 3))).toBe(true);
    expect(r.bytes.equals(Buffer.from(V3, 'utf8'))).toBe(true);
    expect(r.bytes.toString('utf8')).not.toContain('この文に、作り物のコメント');
    // 通常の表示でも、同じ
    await u.docbar.locator('[data-mode="normal"]').click();
    await expect(u.docbar.locator('#btn-changes')).toHaveAttribute('aria-pressed', 'false');
    const again = await download(page);
    expect(again.bytes.equals(r.bytes)).toBe(true);

    // 過去の版（v1・v2）
    for (const v of [1, 2]) {
      await hashOf(page, `#/dl-a/root/v${v}`);
      await expect(u.docbar.locator('.pastver')).toContainText(`v${v}`);
      r = await download(page);
      expect(r.name).toBe(`dl-a-v${v}.md`);
      expect(r.bytes.equals(onDisk(app.root, 'dl-a', 'root', v))).toBe(true);
    }
    // v2 を、変更を重ねて見ている（過去の版でも、前の版との差分が出る）
    await u.docbar.locator('[data-mode="overlay"]').click();
    await expect(u.article.locator('.changed, .added').first()).toBeVisible();
    r = await download(page);
    expect(r.bytes.equals(onDisk(app.root, 'dl-a', 'root', 2))).toBe(true);

    // 子ページ（版が 1 つ）：名前に、ページの ID が入る
    await hashOf(page, '#/dl-a/sub-1');
    await expect(u.docbar.locator('.crumbs')).toContainText('日本語の子ページ');
    r = await download(page);
    expect(r.name).toBe('dl-a-sub-1-v1.md');
    expect(r.bytes.equals(onDisk(app.root, 'dl-a', 'sub-1', 1))).toBe(true);
    expect(r.bytes.toString('utf8')).toBe(CHILD);
  });

  test('BOM・CRLF・日本語・html-app の枠・末尾の改行なしも、1 バイトも変わらない。空の本文は、空のファイル。キーボード（Enter・Space）でも保存できる', async ({
    page,
    app,
  }) => {
    const BT = '```';
    const odd = `\uFEFF# 題：日本語\r\n\r\n作り物の段落。\r\n\r\n${BT}html-app height=100\r\n<p id="x">枠</p>\r\n${BT}\r\n\r\n最後の行（改行なし）`;
    await app.switchTopic(page, 'dl-b', '特殊な本文', DOC_BASIC);
    fs.writeFileSync(path.join(app.root, '.rikai', 'dl-b', 'pages', 'root', 'v1.md'), odd);
    await page.reload();
    await expect(save(page)).toBeEnabled();
    expect((await download(page, 'enter')).bytes.equals(Buffer.from(odd, 'utf8'))).toBe(true);
    expect((await download(page, 'space')).bytes.equals(onDisk(app.root, 'dl-b', 'root', 1))).toBe(true);
    expect(Array.from(onDisk(app.root, 'dl-b', 'root', 1).subarray(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    // 空の本文
    fs.writeFileSync(path.join(app.root, '.rikai', 'dl-b', 'pages', 'root', 'v1.md'), '');
    await page.reload();
    await expect(save(page)).toBeEnabled();
    const empty = await download(page);
    expect(empty.name).toBe('dl-b-v1.md');
    expect(empty.bytes.length).toBe(0);
  });

  test('Tab で届く：上のバーの、左の一覧の開閉の次', async ({ page, app }) => {
    await app.switchTopic(page, 'dl-c', 'キーボード', DOC_BASIC);
    await page.locator('#btn-side').focus();
    await page.keyboard.press('Tab');
    await expect(save(page)).toBeFocused();
  });
});

test.describe('保存：外へ出ない・CSP が妨げない・Blob の URL を解く', () => {
  test('押しても、新しい通信は起きない（Blob だけ）。CSP の違反なし。Blob の URL は、作った数だけ解く。外への通信は 0（フィクスチャも確認）', async ({
    page,
    app,
  }) => {
    await app.switchTopic(page, 'dl-d', '通信', DOC_BASIC);
    await app.apply({ revisions: [{ page: 'root', markdown: V2 }] });
    await expect(page.locator('#docbar select option')).toHaveCount(2);
    await page.evaluate(() => {
      const w = window as unknown as { __blob: { created: string[]; revoked: string[] } };
      w.__blob = { created: [], revoked: [] };
      const create = URL.createObjectURL.bind(URL);
      const revoke = URL.revokeObjectURL.bind(URL);
      URL.createObjectURL = (o: Blob | MediaSource) => {
        const u = create(o);
        w.__blob.created.push(u);
        return u;
      };
      URL.revokeObjectURL = (u: string) => {
        w.__blob.revoked.push(u);
        revoke(u);
      };
    });
    await expect(save(page)).toBeEnabled();
    const seen: string[] = [];
    const bad: string[] = [];
    page.on('request', (r) => seen.push(r.url()));
    page.on('console', (m) => {
      if (/content security policy|refused to/i.test(m.text())) bad.push(m.text());
    });
    const r = await download(page);
    expect(r.bytes.equals(onDisk(app.root, 'dl-d', 'root', 2))).toBe(true);
    // 本文は、画面が持っているものを使う：サーバーへ、新しく取りに行かない（Blob のダウンロードだけ）
    expect(seen.filter((u) => !u.startsWith('blob:'))).toEqual([]);
    expect(bad).toEqual([]);
    const blob = await page.evaluate(
      () => (window as unknown as { __blob: { created: string[]; revoked: string[] } }).__blob,
    );
    expect(blob.created).toHaveLength(1);
    expect(blob.revoked).toEqual(blob.created);
    expect(blob.created[0]).toMatch(/^blob:http:\/\/127\.0\.0\.1:\d+\//);
  });
});

test.describe('保存：押せない・出さない', () => {
  test('本文の取得が終わるまでは、押せない（前の版を、新しい版の名前で保存しない）。取得に失敗したら、押せないまま（成功に見せない）。届けば、押せる', async ({
    page,
    app,
  }) => {
    await app.switchTopic(page, 'dl-e', '読み込み中', DOC_BASIC);
    await app.apply({ revisions: [{ page: 'root', markdown: V2 }] });
    await app.apply({ revisions: [{ page: 'root', markdown: V3 }] });
    await expect(page.locator('#docbar select option')).toHaveCount(3);
    await page.reload(); // 取得済みの本文を、捨てる
    await expect(save(page)).toBeEnabled(); // 読み込むのは、v3（と、差分の相手の v2）だけ。v1 は、まだ
    // v1 の取得を止める
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    await page.route('**/api/page/dl-e/root/1', async (route) => {
      await gate;
      await route.continue();
    });
    await hashOf(page, '#/dl-e/root/v1');
    await expect(ui(page).docbar.locator('.pastver')).toBeVisible();
    await expect(save(page)).toBeDisabled();
    await expect(save(page)).toHaveAttribute('title', '本文を読み込み中です');
    release();
    await expect(save(page)).toBeEnabled();
    const ok = await download(page);
    expect(ok.name).toBe('dl-e-v1.md');
    expect(ok.bytes.equals(onDisk(app.root, 'dl-e', 'root', 1))).toBe(true);
    // 取得に失敗するページ：押せないまま。理由は title
    await app.apply({ pages: [{ id: 'sub-x', title: '壊れた子', parent: 'root', markdown: CHILD }] });
    await page.route('**/api/page/dl-e/sub-x/1', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{"ok":false,"error":"x"}' }),
    );
    await hashOf(page, '#/dl-e/sub-x');
    await expect(ui(page).docbar.locator('.crumbs')).toContainText('壊れた子');
    await expect(save(page)).toBeDisabled();
    await expect(save(page)).toHaveAttribute('title', '本文を取得できないため、保存できません');
    // 戻ると、押せる（取得済みの v3）
    await hashOf(page, '#/dl-e/root');
    await expect(save(page)).toBeEnabled();
    expect((await download(page)).name).toBe('dl-e-v3.md');
  });

  test('並べて比べる画面では、出さない。閉じると、また出る', async ({ page, app }) => {
    await app.switchTopic(page, 'dl-f', '比べる', DOC_BASIC);
    await app.apply({ revisions: [{ page: 'root', markdown: V2 }] });
    await expect(page.locator('#docbar select option')).toHaveCount(2);
    await expect(save(page)).toBeEnabled();
    await page.locator('#btn-compare').click();
    await expect(page.locator('#compare')).toBeVisible();
    await expect(save(page)).toHaveCount(0);
    await page.locator('#docbar [data-mode="normal"]').click();
    await expect(page.locator('#compare')).toHaveCount(0);
    await expect(save(page)).toBeEnabled();
  });
});

test.describe('保存のボタンを足した上のバー（#top）：1 行・はみ出さない・ほかのボタンを隠さない。#docbar は、変えない', () => {
  /** 上のバーの子（見えるもの）が、バーの中に収まり、互いに重ならない。名前の切れたボタンがない */
  const measure = (page: Page) =>
    page.evaluate(() => {
      const bar = document.querySelector('#top') as HTMLElement;
      const b = bar.getBoundingClientRect();
      const kids = Array.from(bar.children)
        .map((c) => ({ id: c.id || c.className, r: c.getBoundingClientRect() }))
        .filter((k) => k.r.width > 0);
      const overlaps: string[] = [];
      for (let i = 1; i < kids.length; i++) {
        const p = kids[i - 1];
        const k = kids[i];
        if (p && k && k.r.left < p.r.right - 0.5) overlaps.push(`${p.id}|${k.id}`);
      }
      const clipped = Array.from(bar.querySelectorAll('button'))
        .filter((x) => x.scrollWidth > x.clientWidth + 1)
        .map((x) => x.id);
      const last = kids[kids.length - 1];
      const title = document.getElementById('top-title') as HTMLElement;
      return {
        h: Math.round(b.height),
        scroll: bar.scrollWidth,
        client: bar.clientWidth,
        over: Math.round(((last?.r.right ?? 0) - b.right) * 10) / 10,
        overlaps,
        clipped,
        titleW: Math.round(title.getBoundingClientRect().width),
        saveW: Math.round(document.getElementById('btn-save-md')?.getBoundingClientRect().width ?? 0),
      };
    });

  test('窓 1360・1100・900・760・600・560・420・360 × 状態の札が多いとき（AI の返信待ち・コピー・未送信の数）：保存・外観・「AI に送る」・終了が、全部見えて、重ならない。バーは 1 行（高さ不変）', async ({
    page,
    app,
  }) => {
    test.setTimeout(120_000);
    const u = ui(page);
    await app.switchTopic(page, 'dl-g', '横幅の確認のための、少し長めの題名にしてみます', DOC_BASIC);
    await addTextComment(page, '猫は朝によく鳴きます', 'コメント');
    await submitAll(page); // AI の返信待ち（状態の札・コピー・案内）が出る
    await expect(u.top).toContainText('AI の返信待ち');
    await addTextComment(page, '猫は一日に十六時間', '未送信の数が出る'); // 「AI に送る（1）」
    let h0 = 0;
    for (const vw of [1360, 1100, 900, 760, 600, 560, 420, 360]) {
      await page.setViewportSize({ width: vw, height: 900 });
      await expect(save(page)).toBeVisible();
      const m = await measure(page);
      const where = `窓 ${vw}`;
      if (!h0) h0 = m.h;
      expect(m.h, `${where}：バーの高さ`).toBe(h0);
      expect(m.scroll, `${where}：scrollWidth ≤ clientWidth`).toBeLessThanOrEqual(m.client);
      expect(m.over, `${where}：右端`).toBeLessThanOrEqual(0.5);
      expect(m.overlaps, `${where}：重なり`).toEqual([]);
      expect(m.clipped, `${where}：名前が切れたボタン`).toEqual([]);
      // 560px 以下は、アイコンだけ（名前は、aria-label・title：上の `save` が、名前で引けている）。それより広い窓では、名前が見えて、縮まない
      if (vw > 560) expect(m.saveW, `${where}：保存のボタンの幅（縮まない）`).toBeGreaterThanOrEqual(130);
      else expect(m.saveW, `${where}：アイコンだけ`).toBeLessThanOrEqual(30);
      await expect(save(page)).toHaveAttribute('title', /Markdown を、dl-g-v1\.md として保存します/);
      for (const id of ['#btn-submit', '#btn-end', '#btn-theme', '#btn-save-md'])
        await expect(page.locator(id)).toBeInViewport({ ratio: 1 });
    }
  });

  test('#docbar は、変わらない：版が 1 つの、子でないページでは、出さない（高さ 0）。保存のボタンは、#docbar の中にない', async ({
    page,
    app,
  }) => {
    const u = ui(page);
    await app.switchTopic(page, 'dl-h', '一つだけ', DOC_BASIC);
    await expect(u.docbar).toBeHidden();
    await expect(save(page)).toBeVisible();
    await expect(u.docbar.locator('#btn-save-md')).toHaveCount(0);
    await expect(u.top.locator('#btn-save-md')).toHaveCount(1);
  });
});
