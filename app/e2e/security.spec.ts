// 安全・隔離（N1・N2・N3・F17・F28）：合言葉なしで 403・Cookie・画面の CSP・外への通信が 0 件・html-app の iframe が sandbox="allow-scripts" だけ
import type { Page } from '@playwright/test';
import { expect, type RikaiApp, test } from './fixtures';
import { makePng } from './samples';
import { addTextComment, submitAll, ui } from './ui';

const BT = '```';
const lines = (...l: string[]) => `${l.join('\n')}\n`;
const json = { 'content-type': 'application/json' };

test.describe('合言葉（N2）', () => {
  test('合言葉なしでは、画面も API も資産も、403（N2）', async ({ app }) => {
    app.writeAsset('x.png', makePng(8, 8));
    for (const p of [
      '/',
      '/api/topics',
      `/api/topic/${app.slug}`,
      `/api/page/${app.slug}/root/1`,
      `/asset/${app.slug}/x.png`,
      `/appframe/${app.slug}/root/1/0`,
    ]) {
      const res = await app.http(p);
      expect(res.status, p).toBe(403);
    }
    // 合言葉が違う
    expect((await app.http('/?t=wrong-token')).status).toBe(403);
    expect((await app.http('/api/topics', { headers: { 'x-rikai-token': 'wrong-token' } })).status).toBe(403);
    // 合言葉があれば 200
    expect((await app.http('/api/topics', { auth: true })).status).toBe(200);
    expect((await app.http(`/asset/${app.slug}/x.png`, { auth: true })).status).toBe(200);
  });

  test('Host・Origin が違うと、合言葉があっても断る。POST も同じ（N2）', async ({ app }) => {
    const port = new URL(app.origin).port;
    // Host
    expect((await app.http('/api/topics', { auth: true, headers: { host: 'evil.example' } })).status).toBe(403);
    expect((await app.http('/api/topics', { auth: true, headers: { host: `evil.example:${port}` } })).status).toBe(403);
    expect((await app.http('/api/topics', { auth: true, headers: { host: `localhost:${port}` } })).status).toBe(200);
    // Origin
    expect((await app.http('/api/topics', { auth: true, headers: { origin: 'http://evil.example' } })).status).toBe(
      403,
    );
    expect((await app.http('/api/topics', { auth: true, headers: { origin: app.origin } })).status).toBe(200);
    const post = (origin?: string) =>
      app.http('/api/submit', {
        method: 'POST',
        auth: true,
        headers: { ...json, ...(origin ? { origin } : {}) },
        body: JSON.stringify({ topic: app.slug, note: '' }),
      });
    expect((await post('http://evil.example')).status).toBe(403);
    // 別のページからの操作が通らなかったので、何も書かれていない
    expect((await app.pull()).status).toBe('none');
  });

  test('合言葉は、URL から外れ、HttpOnly・SameSite=Strict の Cookie（名前にポート）に移る。画面の JavaScript からは読めない（N2）', async ({
    page,
    app,
  }) => {
    expect(page.url()).not.toContain('t=');
    const port = new URL(app.origin).port;
    const cookies = await page.context().cookies(app.origin);
    const c = cookies.find((x) => x.name === `rikai_t_${port}`);
    expect(c, 'Cookie の名前にポートが入っている').toBeTruthy();
    expect(c?.httpOnly).toBe(true);
    expect(c?.sameSite).toBe('Strict');
    expect(await page.evaluate(() => document.cookie)).toBe('');
    // 開き直しは Cookie だけで通る。Cookie がなければ 403（画面に、説明）
    const ok = await page.reload();
    expect(ok?.status()).toBe(200);
    await page.context().clearCookies();
    const denied = await page.reload();
    expect(denied?.status()).toBe(403);
    await expect(page.locator('body')).toContainText('合言葉が必要です');
  });
});

test.describe('画面の CSP と、外への通信（N1・N3）', () => {
  test('画面の CSP：自分のオリジンだけ・枠は /appframe/ だけ・インラインのスクリプトは動かない（N3）', async ({
    page,
    app,
  }) => {
    const res = await page.reload();
    const csp = res?.headers()['content-security-policy'] ?? '';
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("img-src 'self' data:");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("form-action 'none'");
    expect(csp).toContain(`frame-src ${app.origin}/appframe/`);
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-(inline|eval)'/);
    expect(res?.headers()['cache-control']).toContain('no-store');
    await page.locator('#article .blk').first().waitFor();

    // 実際に効いている：インラインのスクリプトは動かない
    await page.evaluate(() => {
      const s = document.createElement('script');
      s.textContent = 'window.__csp = 1';
      document.head.append(s);
    });
    expect(await page.evaluate(() => (window as unknown as { __csp?: number }).__csp)).toBeUndefined();
  });

  test('外への通信は、画面の CSP が止める（fetch・画像）。ネットワークには出ない（N1）', async ({ page, app }) => {
    const failures: string[] = [];
    const responded: string[] = [];
    page.context().on('requestfailed', (r) => {
      if (!r.url().startsWith(app.origin)) failures.push(r.failure()?.errorText ?? '');
    });
    page.context().on('response', (r) => {
      if (!r.url().startsWith(app.origin) && !/^(data|blob|about):/.test(r.url())) responded.push(r.url());
    });
    const fetched = await page.evaluate(() =>
      fetch('https://example.com/').then(
        () => 'ok',
        () => 'blocked',
      ),
    );
    expect(fetched).toBe('blocked');
    const img = await page.evaluate(
      () =>
        new Promise<string>((resolve) => {
          const i = new Image();
          i.onload = () => resolve('loaded');
          i.onerror = () => resolve('blocked');
          i.src = 'https://example.com/x.png';
        }),
    );
    expect(img).toBe('blocked');
    // 外へ出ようとした通信（fetch。画像は、要求の前に止まる）は、すべて、CSP が止める（失敗として終わる）
    await expect.poll(() => failures.length).toBeGreaterThanOrEqual(1);
    for (const f of failures) expect(f).toMatch(/csp/i);
    expect(failures.length).toBe(app.external.length);
    expect(responded).toEqual([]);
    app.external.length = 0; // 試した通信（CSP が止めた）は、数えない
  });

  test('使っている間の通信は、すべて 127.0.0.1（このサーバー）だけ。外部の画像・Mermaid・コメント・Submit を含む（N1・F17）', async ({
    page,
    app,
  }) => {
    const origins = new Set<string>();
    page.context().on('request', (r) => {
      if (!/^(data|blob|about):/.test(r.url())) origins.add(new URL(r.url()).origin);
    });
    const u = ui(page);
    await app.switchTopic(
      page,
      'net',
      '通信の確認',
      lines(
        '# 通信の確認',
        '',
        '![外部の画像](https://example.com/a.png)',
        '',
        '<img src="//example.org/b.png">',
        '',
        `${BT}mermaid`,
        'flowchart LR',
        '  A[始] --> B[終]',
        BT,
        '',
        '本文の段落です。',
      ),
    );
    await expect(u.article.locator('.mermaid-block svg')).toBeVisible();
    await expect(u.article).toContainText('外部画像は表示しません');
    await expect(u.article.locator('img')).toHaveCount(0);
    await addTextComment(page, '本文の段落です', 'ネットワークの確認');
    await submitAll(page);
    await app.nextRound();
    expect([...origins]).toEqual([app.origin]);
  });

  test('/asset/ は、直接開かれても、スクリプトを動かさない（CSP sandbox）。資産の外は配らない（N3・F17）', async ({
    app,
  }) => {
    app.writeAsset('x.png', makePng(8, 8));
    const res = await app.http(`/asset/${app.slug}/x.png`, { auth: true });
    expect(res.status).toBe(200);
    expect(res.headers['content-security-policy']).toBe('sandbox');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(String(res.headers['content-type'])).toContain('image/png');
    for (const p of [
      `/asset/${app.slug}/..%2Fmeta.json`,
      `/asset/${app.slug}/%2e%2e/meta.json`,
      `/asset/${app.slug}/../meta.json`,
    ]) {
      const r = await app.http(p, { auth: true });
      expect(r.status, p).not.toBe(200);
    }
  });
});

test.describe('html-app の隔離（F28・N3）', () => {
  const DOC = lines(
    '# 枠',
    '',
    `${BT}html-app`,
    '<p id="hi">こんにちは</p>',
    BT,
    '',
    `${BT}html-app height=200`,
    '<p>二つ目</p>',
    BT,
  );

  async function openApp(page: Page, app: RikaiApp) {
    await app.switchTopic(page, 'app', '枠の資料', DOC);
    await expect(page.locator('iframe')).toHaveCount(2);
  }

  test('画面の中の iframe は、枠だけ。どれも sandbox="allow-scripts" だけ（allow-same-origin を足さない）・allow は空（F28）', async ({
    page,
    app,
  }) => {
    await openApp(page, app);
    const info = await page.locator('iframe').evaluateAll((els) =>
      els.map((e) => ({
        sandbox: e.getAttribute('sandbox'),
        allow: e.getAttribute('allow'),
        src: e.getAttribute('src'),
        inApp: !!e.closest('.htmlapp'),
      })),
    );
    expect(info).toHaveLength(2);
    for (const i of info) {
      expect((i.sandbox ?? '').trim().split(/\s+/)).toEqual(['allow-scripts']);
      expect(i.allow ?? '').toBe('');
      expect(i.inApp).toBe(true);
      expect(i.src).toMatch(/^\/appframe\/app\/root\/1\/[01]\?mode=(light|dark)$/);
    }
    // ブラウザの目から見ても、枠は、オリジンのない文書
    await expect.poll(() => page.frames().some((f) => f.url().includes('/appframe/'))).toBe(true);
    const frame = page.frames().find((f) => f.url().includes('/appframe/'));
    expect(await frame?.evaluate(() => window.origin)).toBe('null');
  });

  test('枠の中身は、別の文書として、隔離する CSP つきで配る。数は、資料にある枠だけ（F28）', async ({ page, app }) => {
    await openApp(page, app);
    const res = await app.http('/appframe/app/root/1/0', { auth: true });
    expect(res.status).toBe(200);
    const csp = String(res.headers['content-security-policy']);
    expect(csp).toContain('sandbox allow-scripts');
    expect(csp).not.toContain('allow-same-origin');
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("frame-src 'none'");
    expect(csp).toContain("form-action 'none'");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(res.body).toContain('こんにちは');
    // 資料にない枠・版・ページは、配らない
    for (const p of ['/appframe/app/root/1/2', '/appframe/app/root/9/0', '/appframe/app/nope/1/0']) {
      expect((await app.http(p, { auth: true })).status, p).toBeGreaterThanOrEqual(400);
    }
    // 画面を経由せず、直接 ブラウザの別のページで開いても、スクリプトに、画面の合言葉は渡らない
    const direct = await page.context().newPage();
    const r = await direct.goto(`${app.origin}/appframe/app/root/1/0`);
    expect(r?.status()).toBe(200); // Cookie があるので配られる（合言葉つきの利用者本人）
    expect(await direct.evaluate(() => window.origin)).toBe('null');
    await direct.close();
  });
});
