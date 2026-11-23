// サーバーからの通知（SSE：GET /api/events）：CLI（別のプロセス）の apply が、すぐ画面に出る・つながっている間は定期の取得がない・
// 切れたら取得に戻り、つながり直したら、また通知で更新される・**接続は、ブラウザ全体で 1 本（SharedWorker）：何タブ開いても、枠を使い切らない**・認証・外への通信 0（fixtures）。
// サーバー側の接続の数は、サーバーの前に置いた中継（relay.ts）で数える。
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { type Relay, startProxy } from './relay';
import { addTextComment, submitAll, ui } from './ui';

const READ_RE = /\/api\/(topics|topic\/)/;

// 画面の、定期の取得（一覧・トピックの GET）の記録。fetch の GET だけ数える
function countReads(page: Page) {
  const seen: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'GET' && READ_RE.test(new URL(r.url()).pathname)) seen.push(new URL(r.url()).pathname);
  });
  return seen;
}

/** 中継の前で、ページを開き、通知につながる（サーバー側の接続が 1 本になる）のと、ready の取り直しが済むのを、待つ */
async function openLive(px: Relay, page: Page, slug: string): Promise<void> {
  await px.open(page, `#/${slug}/root`);
  await expect.poll(() => px.sse(), { timeout: 10_000 }).toBe(1);
  await page.waitForTimeout(500);
}

const ANCHOR = {
  blockId: 'b0',
  blockHash: 'h',
  blockTag: 'P',
  blockText: '猫',
  quote: '猫は朝によく鳴きます',
  prefix: '',
  suffix: '',
  label: '',
};

/** ページ（のオリジン）へ、コメントを 1 件入れて Submit する（fetch）。かかった時間（ms）を返す */
async function commentAndSubmit(page: Page, slug: string): Promise<number> {
  return page.evaluate(
    async ([topic, anchor]) => {
      const post = (path: string, body: unknown) =>
        fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const t = performance.now();
      const r = await post('/api/comment', { topic, page: 'root', version: 1, anchor, text: '質問です' });
      if (!(await r.json()).ok) throw new Error('comment');
      const ms = performance.now() - t;
      if (!(await (await post('/api/submit', { topic })).json()).ok) throw new Error('submit');
      return ms;
    },
    [slug, ANCHOR] as const,
  );
}

test.describe('サーバーからの通知（SSE）', () => {
  test('CLI の apply の返信が、500ms 以内に画面に出る（以前は、最大 1.5 秒）', async ({ page, app }) => {
    const u = ui(page);
    const px = await startProxy(app.root);
    try {
      await openLive(px, page, app.slug);

      await addTextComment(page, '猫は朝によく鳴きます', '朝に鳴く理由は？');
      await submitAll(page);
      const r1 = await app.nextRound();
      const tid = r1.items[0].thread;
      await page.waitForTimeout(400);

      // 1 回目：round の返信。2 回目からは、同じスレッドへの追加の返信。取得の周期の、どの位置でも、500ms 以内
      for (let i = 1; i <= 5; i++) {
        await app.apply(
          i === 1
            ? { round: 1, replies: [{ thread: tid, body: `返信${i}` }] }
            : { replies: [{ thread: tid, body: `返信${i}` }] },
        );
        await expect(u.threads.first().locator('.msg.ai')).toHaveCount(i, { timeout: 500 });
        await expect(u.threads.first()).toContainText(`返信${i}`, { timeout: 500 });
        await page.waitForTimeout(137 * i); // 次の apply の位置を、ずらす
      }
    } finally {
      await px.down();
    }
  });

  test('つながっている間は、一覧・トピックの定期の GET が 0 件', async ({ page, app }) => {
    const px = await startProxy(app.root);
    try {
      const reads = countReads(page);
      await openLive(px, page, app.slug);
      reads.length = 0;
      await page.waitForTimeout(4600); // 以前なら、3 回の取得
      expect(reads).toEqual([]);
    } finally {
      await px.down();
    }
  });

  test('ワーカーは /assets/ から配られ、CSP に違反しない。外への通信は 0（fixtures が、終わりに確かめる）', async ({
    page,
    app,
  }) => {
    const bad: string[] = [];
    page.on('console', (m) => {
      if (/Content Security Policy|Refused to (connect|create a worker)/i.test(m.text()))
        bad.push(m.text().slice(0, 200));
    });
    const px = await startProxy(app.root);
    try {
      await openLive(px, page, app.slug);
      const res = px.served.find((r) => /^\/assets\/eventsWorker-[^/]+\.js$/.test(r.path));
      expect(res?.status).toBe(200);
      expect(res?.type).toMatch(/javascript/);
      expect(bad).toEqual([]);
    } finally {
      await px.down();
    }
  });

  test('合言葉なし・不正な Host・不正な Origin の /api/events は、403', async ({ app }) => {
    expect((await app.http('/api/events')).status).toBe(403);
    expect((await app.http('/api/events', { headers: { Host: 'evil.example' }, auth: true })).status).toBe(403);
    expect((await app.http('/api/events', { headers: { Origin: 'http://evil.example' }, auth: true })).status).toBe(
      403,
    );
  });

  test('切れたら、すぐ「サーバーに接続できません」が出て、つながり直したら、回復して、更新が通知で届く', async ({
    page,
    app,
  }) => {
    const u = ui(page);
    const px = await startProxy(app.root);
    try {
      await openLive(px, page, app.slug);
      await expect(u.top).not.toContainText('サーバーに接続できません');

      // 切る → すぐ、取得が失敗して、表示が出る（1.5 秒を待たない）。画面は残る
      const t0 = Date.now();
      await px.down();
      await expect(u.top).toContainText('サーバーに接続できません', { timeout: 10_000 });
      expect(Date.now() - t0, '切れてから、表示が出るまで').toBeLessThan(1200);
      await expect(u.article).toContainText('猫は朝によく鳴きます');

      // つなぎ直す → 取得が成功して、表示が消える → 通知に、つながり直す（EventSource が、自動で）
      await px.up();
      await expect(u.top).not.toContainText('サーバーに接続できません', { timeout: 10_000 });
      await expect.poll(() => px.sse(), { timeout: 10_000 }).toBe(1);
      await page.waitForTimeout(800); // ready の取り直し

      // つながり直したら、定期の GET は、また 0 件。更新は、通知で、すぐ届く
      const reads = countReads(page);
      await addTextComment(page, '猫は朝によく鳴きます', '回復後のコメント');
      await submitAll(page);
      const r1 = await app.nextRound();
      await page.waitForTimeout(300);
      reads.length = 0;
      await app.apply({ round: 1, replies: [{ thread: r1.items[0].thread, body: '回復後の返信' }] });
      await expect(u.threads.first().locator('.msg.ai')).toContainText('回復後の返信', { timeout: 500 });
      await page.waitForTimeout(3600);
      expect(reads.filter((p) => !/\/api\/(topics|topic\/demo)$/.test(p))).toEqual([]);
      expect(reads.length, '通知の分（一覧とトピックを 1 回ずつ）だけで、定期の取得は、ない').toBeLessThanOrEqual(2);
    } finally {
      await px.down();
    }
  });

  test('7 つのタブ（同じブラウザ）：すべてが開き、サーバー側の接続は 1 本。操作は 1 秒以内に返り、返信が、全部のタブに 500ms 以内に出る', async ({
    page,
    app,
  }) => {
    const px = await startProxy(app.root);
    try {
      const pages = [page];
      for (let i = 0; i < 6; i++) pages.push(await page.context().newPage());
      for (const p of pages) await px.open(p, `#/${app.slug}/root`); // 7 つ目も、開く（Chrome は、1 オリジン 6 接続まで）
      await expect.poll(() => px.sse(), { timeout: 10_000 }).toBe(1);
      await page.waitForTimeout(500);
      expect(px.sse(), '接続は、タブの数でなく、1 本').toBe(1);

      // 1 つ目のタブの操作（POST）が、1 秒以内に返る
      const ms = await commentAndSubmit(pages[0] as Page, app.slug);
      expect(ms, 'POST /api/comment').toBeLessThan(1000);
      for (const p of pages) await expect(ui(p).threads).toHaveCount(1, { timeout: 2000 });
      const r1 = await app.nextRound();

      await app.apply({ round: 1, replies: [{ thread: r1.items[0].thread, body: '全部のタブへ' }] });
      await Promise.all(
        pages.map((p) =>
          expect(ui(p).threads.first().locator('.msg.ai')).toContainText('全部のタブへ', { timeout: 500 }),
        ),
      );
      expect(px.sse()).toBe(1);
    } finally {
      await px.down();
    }
  });

  test('ワーカーを持っていたタブを、閉じても、残りのタブの更新は、止まらない。最後のタブが閉じれば、接続も閉じる', async ({
    page,
    app,
  }) => {
    const px = await startProxy(app.root);
    try {
      const pages = [page, await page.context().newPage(), await page.context().newPage()];
      await openLive(px, pages[0] as Page, app.slug); // 最初のタブが、ワーカーを作る
      for (const p of pages.slice(1)) await px.open(p, `#/${app.slug}/root`);
      await (pages[1] as Page).waitForTimeout(500);
      expect(px.sse()).toBe(1);
      await commentAndSubmit(pages[1] as Page, app.slug);
      const r1 = await app.nextRound();
      for (const p of pages) await expect(ui(p).threads).toHaveCount(1, { timeout: 2000 });

      await (pages[0] as Page).close();
      await (pages[1] as Page).waitForTimeout(300);
      await app.apply({ round: 1, replies: [{ thread: r1.items[0].thread, body: '1 つ目を閉じたあと' }] });
      for (const p of pages.slice(1))
        await expect(ui(p).threads.first().locator('.msg.ai')).toContainText('1 つ目を閉じたあと', { timeout: 500 });
      expect(px.sse()).toBe(1);

      await (pages[1] as Page).close();
      await (pages[2] as Page).waitForTimeout(300);
      await app.apply({ replies: [{ thread: r1.items[0].thread, body: '2 つ目も閉じたあと' }] });
      await expect(
        ui(pages[2] as Page)
          .threads.first()
          .locator('.msg.ai'),
      ).toHaveCount(2, { timeout: 500 });

      await (pages[2] as Page).close();
      await expect.poll(() => px.sse(), { timeout: 10_000 }).toBe(0);
    } finally {
      await px.down();
    }
  });

  test('SharedWorker がない環境：SSE は使わず（/api/events への要求 0）、取得だけで動く', async ({ page, app }) => {
    const u = ui(page);
    const px = await startProxy(app.root);
    try {
      await page.addInitScript(() => {
        delete (window as unknown as { SharedWorker?: unknown }).SharedWorker;
      });
      const events: string[] = [];
      page.on('request', (r) => {
        if (new URL(r.url()).pathname === '/api/events') events.push(r.url());
      });
      const reads = countReads(page);
      await px.open(page, `#/${app.slug}/root`);
      expect(await page.evaluate(() => typeof SharedWorker)).toBe('undefined');
      await addTextComment(page, '猫は朝によく鳴きます', 'ポーリングで届く');
      await submitAll(page);
      const r1 = await app.nextRound();
      reads.length = 0;
      await app.apply({ round: 1, replies: [{ thread: r1.items[0].thread, body: 'ポーリングの返信' }] });
      await expect(u.threads.first().locator('.msg.ai')).toContainText('ポーリングの返信', { timeout: 3000 });
      await page.waitForTimeout(1600);
      expect(reads.length, '定期の取得は、続く').toBeGreaterThanOrEqual(2);
      expect(events, '/api/events への要求').toEqual([]);
      expect(px.sse()).toBe(0);
    } finally {
      await px.down();
    }
  });
});
