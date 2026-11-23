// Hono のアプリを、ポートを開かずに（app.request()）確かめる：認証（Host・Origin・合言葉）・パスの外への出口・本文の上限・旧と同じ応答。
// 実際に待ち受ける試験は、server.test.ts ほか（旧と同じ）。ここは、同じ入口を、直接、呼ぶ。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { hc } from 'hono/client';
import { afterEach, beforeEach, test } from 'vitest';
import { type AppType, createApp } from '../../src/server/app';
import { makeTopic, type Project, removeProject, tempProject } from './helpers';
import { builtAsset, PUBLIC_DIR } from './http-helpers';

const PORT = 4321;
const TOKEN = 'a'.repeat(48);
const HOST = `127.0.0.1:${PORT}`;

let p: Project;
let app: AppType;
beforeEach(() => {
  p = tempProject();
  makeTopic(p);
  fs.writeFileSync(path.join(p.dir, '.rikai', 'demo', 'assets', 'dot.png'), Buffer.from('PNG'));
  app = createApp({ store: p.store, token: TOKEN, port: PORT, publicDir: PUBLIC_DIR, actions: p.actions });
});
afterEach(() => removeProject(p));

interface Init {
  method?: string;
  headers?: Record<string, string | null>;
  body?: string | object;
}
// Host は、既定で、検査を通る値。null を渡すと、そのヘッダーを付けない。本文は、Content-Type なしで送る（旧実装は、見なかった）
const call = (pth: string, { method = 'GET', headers = {}, body }: Init = {}): Promise<Response> => {
  const h: Record<string, string> = {};
  for (const [k, v] of Object.entries({ Host: HOST, ...headers })) if (v !== null) h[k] = v;
  return Promise.resolve(
    app.request(`http://127.0.0.1:${PORT}${pth}`, {
      method,
      headers: h,
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );
};
const authed = (extra: Record<string, string | null> = {}) => ({ 'x-rikai-token': TOKEN, ...extra });
const text = async (r: Response) => ({ status: r.status, body: await r.text() });

test('認証：合言葉・Host・Origin。旧と同じ状態コード・文言（JSON）', async () => {
  assert.deepEqual(await text(await call('/api/topics')), {
    status: 403,
    body: '{"ok":false,"error":"合言葉が違います。rikai の URL から開き直してください。"}',
  });
  assert.equal((await call('/api/topics', { headers: authed() })).status, 200);
  assert.equal((await call('/api/topics', { headers: { 'x-rikai-token': 'a'.repeat(47) } })).status, 403, '長さが違う');
  assert.equal(
    (await call('/api/topics', { headers: { 'x-rikai-token': 'b'.repeat(48) } })).status,
    403,
    '同じ長さの別',
  );
  assert.equal(
    (await call('/api/topics', { headers: { 'x-rikai-token': 'é'.repeat(48) } })).status,
    403,
    '同じ文字数でバイト数が違う合言葉も、403（内部エラーにしない）',
  );
  assert.deepEqual(await text(await call('/api/topics', { headers: authed({ Host: 'evil.example' }) })), {
    status: 403,
    body: '{"ok":false,"error":"ホスト名が違います。rikai の URL から開き直してください。"}',
  });
  assert.equal((await call('/api/topics', { headers: authed({ Host: null }) })).status, 403, 'Host がない');
  assert.equal((await call('/api/topics', { headers: authed({ Host: `localhost:${PORT}` }) })).status, 200);
  assert.equal((await call('/api/topics', { headers: authed({ Host: `127.0.0.1:${PORT + 1}` }) })).status, 403);
  assert.deepEqual(await text(await call('/api/topics', { headers: authed({ Origin: 'http://evil.example' }) })), {
    status: 403,
    body: '{"ok":false,"error":"別のページからは操作できません。rikai の URL から開き直してください。"}',
  });
  assert.equal((await call('/api/topics', { headers: authed({ Origin: 'null' }) })).status, 403);
  assert.equal((await call('/api/topics', { headers: authed({ Origin: `http://localhost:${PORT}` }) })).status, 200);
  assert.equal((await call('/api/topics', { headers: { Cookie: `rikai_t_${PORT}=${TOKEN}` } })).status, 200);
  assert.equal((await call('/api/topics', { headers: { Cookie: `rikai_t_${PORT + 1}=${TOKEN}` } })).status, 403);
});

test('認証は、パスの見え方が、照合と同じ：符号を戻した別名で、合言葉なしの道に入れない', async () => {
  for (const pth of ['/%61pi/topics', '/api%2Ftopics', '/api/%74opics', '/api/topics/', '/api', '/API/topics']) {
    const r = await call(pth);
    assert.equal(r.status === 403 || r.status === 404, true, `${pth}: ${r.status}`);
    assert.ok(!(await r.text()).includes('demo'), `${pth}: 一覧を返さない`);
  }
  assert.equal(
    (await call('/%61pi/topics', { headers: authed() })).status,
    404,
    '符号を戻した別名は、ルートに当たらない',
  );
  assert.equal((await call('/asset/demo/dot.png')).status, 403);
  assert.equal((await call('/%61sset/demo/dot.png')).status, 404);
  assert.equal((await call('/appframe/demo/root/1/0')).status, 403);
});

test('GET・POST 以外は、/api/ では検査のあと 404（HEAD も）。合言葉がなければ 403', async () => {
  assert.equal((await call('/api/topics', { method: 'HEAD', headers: authed() })).status, 404);
  assert.equal((await call('/api/topics', { method: 'HEAD' })).status, 403);
  assert.equal((await call('/api/topics', { method: 'PUT', headers: authed(), body: '{}' })).status, 404);
  assert.equal((await call('/api/topics', { method: 'DELETE', headers: authed() })).status, 404);
  assert.deepEqual(await text(await call('/api/nothing', { headers: authed() })), {
    status: 404,
    body: '{"ok":false,"error":"not found"}',
  });
  assert.deepEqual(await text(await call('/nothing')), { status: 404, body: 'not found' });
  assert.equal(
    (await call('/asset/demo/dot.png', { method: 'POST', body: '{}' })).status,
    404,
    'POST は、合言葉なしでも 404',
  );
});

test('画面：URL の合言葉を Cookie に移す（属性・名前）。画面の CSP', async () => {
  assert.equal((await call('/')).status, 403);
  assert.equal((await call(`/?t=${'b'.repeat(48)}`)).status, 403);
  assert.equal(
    (await call(`/?t=${TOKEN}`, { headers: { Host: 'evil.example' } })).status,
    403,
    'Host が違えば、合言葉があっても 403',
  );
  const r = await call(`/?t=${TOKEN}`);
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/');
  assert.equal(r.headers.get('set-cookie'), `rikai_t_${PORT}=${TOKEN}; HttpOnly; SameSite=Strict; Path=/`);
  assert.equal(r.headers.get('cache-control'), 'no-store');

  const page = await call('/', { headers: { Cookie: `rikai_t_${PORT}=${TOKEN}`, Host: `localhost:${PORT}` } });
  assert.equal(page.status, 200);
  assert.equal(
    page.headers.get('content-security-policy'),
    `default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-src http://localhost:${PORT}/appframe/; object-src 'none'; base-uri 'none'; form-action 'none'`,
  );
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
  assert.match(await page.text(), /<title>rikai<\/title>/);
});

test('静的ファイル・画像：パスの外へ出ない。画像は sandbox', async () => {
  assert.equal((await call(builtAsset())).status, 200);
  assert.equal((await call('/favicon.svg')).status, 200);
  assert.equal((await call('/assets/')).status, 404);
  // 絶対パス（`//` のあと）は、path.resolve が、public の外へ出す：403（検査を消すと、/etc/hosts が返る）
  assert.equal((await call('/assets//etc/hosts')).status, 403);
  assert.equal((await call('/assets//etc/passwd')).status, 403);
  assert.equal((await call('/assets///etc/hosts')).status, 403);
  assert.equal((await call('/assets/..%2F..%2Frikai.js')).status, 404);
  assert.equal(
    (await call('/assets/../../rikai.js')).status,
    404,
    'URL の正規化のあとは、public の外のパス（配らない）',
  );
  assert.equal((await call('/app.js')).status, 404, '旧 UI のファイルは、もう配らない');
  assert.equal((await call('/rikai.js')).status, 404);
  assert.equal((await call('/SKILL.md')).status, 404);

  const ok = await call('/asset/demo/dot.png', { headers: authed() });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('content-security-policy'), 'sandbox');
  assert.equal(ok.headers.get('content-type'), 'image/png');
  assert.equal(await ok.text(), 'PNG');
  assert.equal((await call('/asset/demo/..%2F..%2Fmeta.json', { headers: authed() })).status, 403);
  assert.equal((await call('/asset/demo/..%2F..%2F..%2F..%2Fetc%2Fhosts', { headers: authed() })).status, 403);
  assert.equal((await call('/asset/demo/missing.png', { headers: authed() })).status, 404);
  assert.equal((await call('/asset/Bad_Slug/dot.png', { headers: authed() })).status, 400);
  assert.equal((await call('/asset/nope/dot.png', { headers: authed() })).status, 404);
});

test('POST：本文の上限（2MB。attach は画像の base64）・JSON・Content-Type なしでも読む', async () => {
  const comment = { topic: 'demo', page: 'root', version: 1, text: '質問' };
  assert.equal(
    (await call('/api/comment', { method: 'POST', headers: authed(), body: comment })).status,
    200,
    'Content-Type なし',
  );
  assert.equal(
    (await call('/api/comment', { method: 'POST', headers: authed({ 'Content-Type': 'text/plain' }), body: comment }))
      .status,
    200,
  );
  assert.deepEqual(await text(await call('/api/comment', { method: 'POST', headers: authed(), body: '{壊れた' })), {
    status: 400,
    body: '{"ok":false,"error":"JSON が不正です"}',
  });
  assert.equal(
    (await call('/api/comment', { method: 'POST', headers: authed(), body: `\uFEFF${JSON.stringify(comment)}` }))
      .status,
    400,
    '先頭の BOM は、JSON ではない',
  );
  assert.deepEqual(await text(await call('/api/comment', { method: 'POST', headers: authed() })), {
    status: 400,
    body: '{"ok":false,"error":"トピック名は英小文字・数字・ハイフンで48字以内にしてください: undefined"}',
  });

  const padded = (n: number) => {
    const pre = '{"topic":"demo","page":"root","version":1,"text":"x","pad":"';
    return `${pre}${'A'.repeat(n - pre.length - 2)}"}`;
  };
  const limit = 2 * 1024 * 1024;
  assert.equal(
    (await call('/api/comment', { method: 'POST', headers: authed(), body: padded(limit) })).status,
    200,
    'ちょうど 2MB',
  );
  assert.deepEqual(
    await text(await call('/api/comment', { method: 'POST', headers: authed(), body: padded(limit + 1) })),
    {
      status: 413,
      body: '{"ok":false,"error":"大きすぎます"}',
    },
  );
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(3 * 1024 * 1024, 7),
  ]);
  assert.equal(
    (
      await call('/api/attach', {
        method: 'POST',
        headers: authed(),
        body: { topic: 'demo', data: png.toString('base64') },
      })
    ).status,
    200,
    '3MB の画像は、attach なら通る',
  );
  const attachLimit = Math.ceil((5 * 1024 * 1024) / 3) * 4 + 4096;
  const attachBody = (n: number) => {
    const pre = '{"topic":"demo","data":"';
    return `${pre}${'A'.repeat(n - pre.length - 2)}"}`;
  };
  assert.equal(
    (await call('/api/attach', { method: 'POST', headers: authed(), body: attachBody(attachLimit) })).status,
    400,
    '上限ちょうどは、読まれる（画像でなく 400）',
  );
  assert.equal(
    (await call('/api/attach', { method: 'POST', headers: authed(), body: attachBody(attachLimit + 1) })).status,
    413,
  );
});

test('POST：形（Zod）に合わない本文も、旧と同じ道（checkSlug → 操作の検査）で、同じ応答', async () => {
  const post = (body: object | string) => call('/api/comment', { method: 'POST', headers: authed(), body });
  assert.deepEqual(await text(await post({ topic: {}, text: 'a' })), {
    status: 400,
    body: '{"ok":false,"error":"トピック名は英小文字・数字・ハイフンで48字以内にしてください: [object Object]"}',
  });
  assert.deepEqual(await text(await post({ topic: 'demo', page: 5, version: 1, text: 'a' })), {
    status: 400,
    body: '{"ok":false,"error":"ページがありません"}',
  });
  assert.deepEqual(await text(await post({ topic: 'demo', page: 'root', version: null, text: 'a' })), {
    status: 400,
    body: '{"ok":false,"error":"最新版にだけコメントできます"}',
  });
  assert.deepEqual(await text(await post({ topic: 'nothing', page: 'root', version: 1, text: 'a' })), {
    status: 404,
    body: '{"ok":false,"error":"トピックがありません: nothing"}',
  });
  assert.deepEqual(
    await text(
      await call('/api/attach', { method: 'POST', headers: authed(), body: { topic: 'Bad_Slug', data: '***' } }),
    ),
    {
      status: 400,
      body: '{"ok":false,"error":"トピック名は英小文字・数字・ハイフンで48字以内にしてください: Bad_Slug"}',
    },
    'トピック名の検査が先（画像の検査より）',
  );
  assert.equal((await post('[]')).status, 400);
  assert.equal((await post('"str"')).status, 400);
  assert.equal(
    (await post({ topic: 'demo', page: 'root', version: '1', text: '文字の版' })).status,
    200,
    '数の文字列の版は、旧と同じく通る',
  );
  for (const name of ['nothing', '__proto__', 'constructor', 'ping']) {
    assert.deepEqual(
      await text(await call(`/api/${name}`, { method: 'POST', headers: authed(), body: { topic: 'demo' } })),
      {
        status: 404,
        body: '{"ok":false,"error":"not found"}',
      },
    );
  }
});

test('枠（/appframe）：隔離する CSP の全文。ないものは 404。失敗は覚える（app ごと）', async () => {
  p.store.newTopic('frames', '枠', '試験', '# 題\n\n```html-app\n<b>1</b>\n```\n');
  const r = await call('/appframe/frames/root/1/0', { headers: authed() });
  assert.equal(r.status, 200);
  assert.equal(
    r.headers.get('content-security-policy'),
    "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
  );
  assert.equal(r.headers.get('x-dns-prefetch-control'), 'off');
  assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
  // 文書：橋が、資料の中身（<b>1</b>）より前に入る。この資料は、配色への対応を示さない（従来）ので、土台のスタイルは、入らない（appframe-bridge.test.ts が、中身を確かめる）
  const body = await r.text();
  assert.ok(body.startsWith('<!doctype html>\n<meta charset="utf-8">\n<script>'), body.slice(0, 80));
  assert.ok(!body.includes('<style>'));
  assert.ok(body.endsWith('</script>\n<b>1</b>'));
  assert.equal((await call('/appframe/frames/root/1/1', { headers: authed() })).status, 404);
  assert.equal((await call('/appframe/frames/root/2/0', { headers: authed() })).status, 404);
  assert.equal((await call('/appframe/frames/__proto__/1/0', { headers: authed() })).status, 404);
  assert.equal((await call('/appframe/frames/%E0%A4%A/1/0', { headers: authed() })).status, 404);
  assert.equal((await call('/appframe/frames/root/1/0', { headers: authed({ Host: 'evil.example' }) })).status, 403);
});

test('Hono RPC：hc<AppType> の型が通り、型どおりに呼べる', async () => {
  const client = hc<AppType>(`http://127.0.0.1:${PORT}`, {
    headers: { 'x-rikai-token': TOKEN, Host: HOST },
    fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise.resolve(app.request(input, init)),
  });
  const ping = await client.api.ping.$get();
  assert.equal(ping.status, 200);
  assert.deepEqual(await ping.json(), { ok: true, root: p.dir });

  const made = await client.api.comment.$post({ json: { topic: 'demo', page: 'root', version: 1, text: '質問' } });
  assert.equal(made.status, 200);
  const { thread } = await made.json();
  assert.match(thread, /^t\d+$/);

  const state = await client.api.topic[':slug'].$get({ param: { slug: 'demo' }, query: { since: '1' } });
  assert.equal(state.status, 200);
  const page = await client.api.page[':slug'][':page'][':v'].$get({
    param: { slug: 'demo', page: 'root', v: '1' },
  });
  assert.equal(page.status, 200);

  const resolved = await client.api.resolve.$post({ json: { topic: 'demo', thread, resolved: true } });
  assert.equal(resolved.status, 200);
  // 型：本文の形が違えば、コンパイルが通らない（実行時は、旧と同じ道で、400）
  // @ts-expect-error topic は文字列
  const bad = await client.api.comment.$post({ json: { topic: {}, page: 'root', version: 1 } });
  assert.equal(bad.status, 400);
});
