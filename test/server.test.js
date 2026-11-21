'use strict';
// サーバーの入口（合言葉・Host・Origin・配信のパス）を、実際に待ち受けて確かめる。127.0.0.1 の空きポートだけを使う。
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { rikai, tempProject, removeProject, makeTopic } = require('./helpers.js');

let dir, server, port, token;

test.before(async () => {
  dir = tempProject();
  makeTopic();
  fs.writeFileSync(path.join(dir, '.rikai', 'demo', 'assets', 'dot.png'), Buffer.from('PNG'));
  ({ server, port, token } = await rikai.startServer());
});
test.after(() => {
  server.closeAllConnections();
  server.close();
  removeProject(dir);
});

function request(method, p, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers: { Connection: 'close', ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}
const authed = (extra = {}) => ({ 'x-rikai-token': token, ...extra });

test('合言葉がなければ、API は 403。あれば通る', async () => {
  assert.equal((await request('GET', '/api/topics')).status, 403);
  assert.equal((await request('GET', '/api/topics', { headers: { 'x-rikai-token': 'x'.repeat(token.length) } })).status, 403, '長さが同じ別の合言葉');
  assert.equal((await request('GET', '/api/topics', { headers: { 'x-rikai-token': 'short' } })).status, 403, '長さが違う合言葉');
  const ok = await request('GET', '/api/topics', { headers: authed() });
  assert.equal(ok.status, 200);
  assert.deepEqual(JSON.parse(ok.body).map((t) => t.slug), ['demo']);
});

test('Host が違う・Origin が別のページなら、合言葉があっても 403', async () => {
  assert.equal((await request('GET', '/api/topics', { headers: authed({ Host: 'evil.example' }) })).status, 403);
  assert.equal((await request('GET', '/api/topics', { headers: authed({ Host: `127.0.0.1:${port + 1}` }) })).status, 403);
  assert.equal((await request('POST', '/api/comment', { headers: authed({ Origin: 'http://evil.example', 'Content-Type': 'application/json' }), body: {} })).status, 403);
  const same = await request('GET', '/api/topics', { headers: authed({ Origin: `http://127.0.0.1:${port}` }) });
  assert.equal(same.status, 200);
});

test('画面は、URL の合言葉を Cookie に移して、URL から外す。Cookie がなければ 403', async () => {
  assert.equal((await request('GET', '/')).status, 403);
  assert.equal((await request('GET', '/?t=wrong')).status, 403);
  const redirect = await request('GET', `/?t=${token}`);
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.location, '/');
  const cookie = redirect.headers['set-cookie'][0];
  assert.match(cookie, /^rikai_t=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);

  const page = await request('GET', '/', { headers: { Cookie: cookie.split(';')[0] } });
  assert.equal(page.status, 200);
  assert.match(page.headers['content-security-policy'], /script-src 'self'/);
  assert.match(page.headers['content-security-policy'], /frame-src 'none'/);
  assert.match(page.body, /<title>rikai<\/title>/);
});

test('Cookie でも API を呼べる', async () => {
  const r = await request('GET', '/api/topics', { headers: { Cookie: `rikai_t=${token}` } });
  assert.equal(r.status, 200);
});

test('画像の配信：assets の中だけ。外へ出る名前は断る。直接開かれても sandbox', async () => {
  const ok = await request('GET', '/asset/demo/dot.png', { headers: authed() });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers['content-security-policy'], 'sandbox');
  assert.equal(ok.headers['x-content-type-options'], 'nosniff');

  assert.equal((await request('GET', '/asset/demo/..%2F..%2Fmeta.json', { headers: authed() })).status, 403);
  assert.equal((await request('GET', '/asset/demo/..%2F..%2F..%2F..%2Fetc%2Fhosts', { headers: authed() })).status, 403);
  assert.equal((await request('GET', '/asset/demo/missing.png', { headers: authed() })).status, 404);
  assert.equal((await request('GET', '/asset/Bad_Slug/dot.png', { headers: authed() })).status, 400);
  assert.equal((await request('GET', '/asset/demo/dot.png')).status, 403, '合言葉なし');
});

test('静的ファイルは、public の外へ出ない。知らないファイルは配らない', async () => {
  assert.equal((await request('GET', '/anchor.js')).status, 200);
  assert.equal((await request('GET', '/vendor/marked.min.js')).status, 200);
  assert.notEqual((await request('GET', '/vendor/..%2F..%2Frikai.js')).status, 200);
  assert.equal((await request('GET', '/rikai.js')).status, 404);
  assert.equal((await request('GET', '/SKILL.md')).status, 404);
});

test('画面からの操作：JSON が不正・トピック名が不正・存在しない操作は断る。正しければ書ける', async () => {
  const json = authed({ 'Content-Type': 'application/json' });
  assert.equal((await request('POST', '/api/comment', { headers: json, body: '{壊れた' })).status, 400);
  assert.equal((await request('POST', '/api/comment', { headers: json, body: { topic: '../x', text: 'a' } })).status, 400);
  assert.equal((await request('POST', '/api/nothing', { headers: json, body: { topic: 'demo' } })).status, 404);
  assert.equal((await request('POST', '/api/__proto__', { headers: json, body: { topic: 'demo' } })).status, 404);
  assert.equal((await request('POST', '/api/comment', { headers: json, body: { topic: 'nothing', page: 'root', version: 1, text: 'a' } })).status, 404);

  const made = await request('POST', '/api/comment', { headers: json, body: { topic: 'demo', page: 'root', version: 1, anchor: { quote: '本文' }, text: '質問' } });
  assert.equal(made.status, 200);
  const state = JSON.parse((await request('GET', '/api/topic/demo', { headers: authed() })).body);
  assert.equal(state.unsent, 1);
  assert.equal(state.threads[0].messages[0].text, '質問');
  const same = await request('GET', `/api/topic/demo?since=${state.rev}`, { headers: authed() });
  assert.deepEqual(JSON.parse(same.body), { unchanged: true, rev: state.rev });
});

test('資料の取得：存在する版だけ', async () => {
  const ok = await request('GET', '/api/page/demo/root/1', { headers: authed() });
  assert.match(JSON.parse(ok.body).markdown, /本文です/);
  assert.equal((await request('GET', '/api/page/demo/root/2', { headers: authed() })).status, 404);
  assert.equal((await request('GET', '/api/page/demo/nope/1', { headers: authed() })).status, 404);
});

test('新しい形のトピックは、一覧に印つきで出て、操作は 409（内部エラーにならない）', async () => {
  makeTopic('future');
  const file = path.join(dir, '.rikai', 'future', 'meta.json');
  const m = JSON.parse(fs.readFileSync(file, 'utf8'));
  m.schema = rikai.SCHEMA + 1;
  fs.writeFileSync(file, JSON.stringify(m));
  const json = authed({ 'Content-Type': 'application/json' });
  try {
    const list = JSON.parse((await request('GET', '/api/topics', { headers: authed() })).body);
    assert.deepEqual(list.map((t) => [t.slug, t.unsupported]), [['demo', false], ['future', true]]);
    assert.equal((await request('GET', '/api/topic/future', { headers: authed() })).status, 409);
    assert.equal((await request('GET', '/api/page/future/root/1', { headers: authed() })).status, 409);
    assert.equal((await request('POST', '/api/comment', { headers: json, body: { topic: 'future', page: 'root', version: 1, text: 'x' } })).status, 409);
  } finally {
    fs.rmSync(path.join(dir, '.rikai', 'future'), { recursive: true, force: true });
  }
});

test('rikai open が置く .server.json は、自分だけが読める権限（0600）', () => {
  const root = fs.mkdtempSync(path.join(require('os').tmpdir(), 'rikai-open-'));
  const cli = path.join(__dirname, '..', 'skill', 'rikai', 'rikai.js');
  const run = (...args) => cp.execFileSync(process.execPath, [cli, ...args, '--root', root], { input: '# 題\n', encoding: 'utf8', env: { ...process.env, NO_OPEN: '1' } });
  try {
    run('new', 'perm', '--title', '権限');
    const opened = JSON.parse(run('open', 'perm', '--no-open'));
    assert.match(opened.url, /^http:\/\/127\.0\.0\.1:\d+\/\?t=[0-9a-f]+#\/perm\/root$/);
    const mode = fs.statSync(path.join(root, '.rikai', '.server.json')).mode & 0o777;
    assert.equal(mode.toString(8), '600');
  } finally {
    try { run('stop'); } catch (_) { /* 起動に失敗していても、片付けを続ける */ }
    fs.rmSync(root, { recursive: true, force: true });
  }
});
