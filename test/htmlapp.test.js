'use strict';
// 実行できる枠（html-app）：資料の ```html-app フェンスの取り出し（ブラウザの数え方と同じか）と、隔離して配る経路（/appframe）。
// 枠の中身は、作り物の HTML・JavaScript。実際に枠の中で動かす確認は、ブラウザで行う（docs/verification.md）。
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const path = require('path');
const { rikai, tempProject, removeProject } = require('./helpers.js');
const { appsOf, appsOfAsync, kindOf, APP_MAX, DOC_MAX } = require(path.join(__dirname, '..', 'skills', 'rikai', 'lib', 'htmlapp.js'));
const { Marked } = require(path.join(__dirname, '..', 'skills', 'rikai', 'public', 'vendor', 'marked.min.js'));

// ブラウザの描画（app.js の renderer.code）と同じ順に、フェンスの中身を集める
function inRenderOrder(md) {
  const seen = [];
  const m = new Marked({ gfm: true, renderer: { code({ text, lang }) { if (kindOf(lang) === 'html-app') seen.push(text); return false; } } });
  m.parse(md);
  return seen;
}

test('フェンスの数え方は、ブラウザの描画の順と同じ（入れ子・引用・情報文字列・大文字・CRLF でも）', () => {
  const docs = [
    '```html-app\n<b>1</b>\n```\n\n本文\n\n```html-app height=500\n<i>2</i>\n```\n',
    '- 項目\n\n  ```html-app\n  <u>入れ子</u>\n  ```\n\n> ```html-app\n> <s>引用</s>\n> ```\n\n```html-app\n<b>最後</b>\n```\n',
    '~~~html-app\n<p>チルダ</p>\n~~~\n\n````html-app\n```\n中に 3 つのフェンス\n```\n````\n',
    '```HTML-APP\n<b>大文字</b>\n```\n\n```html\n<b>ふつうの html</b>\n```\n\n    html-app（インデントのコード）\n',
    '```html-app\r\n<b>crlf</b>\r\n```\r\n\r\n```mermaid\r\ngraph LR; A-->B\r\n```\r\n',
    '```html-app\n```\n\n```html-app\n<b>閉じていない\n',
    '1. 手順\n   - 入れ子の箇条書き\n\n     ```html-app\n     <b>深い</b>\n     ```\n',
    '- タブ\n\n\t```html-app\n\t<b>tab</b>\n\t```\n\n```html-app\n<b>after tab</b>\n```\n',
  ];
  let total = 0;
  for (const md of docs) {
    assert.deepEqual(appsOf(md), inRenderOrder(md), md);
    total += appsOf(md).length;
  }
  assert.ok(total >= 10, '取り出せている（空の比較で通らない）');
  assert.deepEqual(appsOf('```html\n<b>x</b>\n```\n'), [], 'html は、枠にしない');
  assert.deepEqual(appsOf(''), []);
  assert.deepEqual(appsOf(null), []);
});

let dir, server, port, token;
const MD = '# 題\n\n```html-app\n<button id="b">押す</button><script>document.getElementById("b").onclick = () => { document.title = "押された"; };</script>\n```\n\n```html-app height=200\n<p>2 つ目</p>\n```\n';

test.before(async () => {
  dir = tempProject();
  rikai.newTopic('demo', '題', '試験', MD);
  rikai.newTopic('big', '大きい', '試験', `\`\`\`html-app\n${'x'.repeat(APP_MAX + 1)}\n\`\`\`\n`);
  ({ server, port, token } = await rikai.startServer());
});
test.after(() => { server.closeAllConnections(); server.close(); removeProject(dir); });

function request(p, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'GET', path: p, headers: { Connection: 'close', ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}
const authed = (extra = {}) => ({ 'x-rikai-token': token, ...extra });

test('枠の中身は、資料から取り出して、隔離する CSP つきで配る', async () => {
  const r = await request('/appframe/demo/root/1/0', authed());
  assert.equal(r.status, 200);
  assert.match(r.headers['content-type'], /^text\/html/);
  const csp = r.headers['content-security-policy'];
  assert.ok(csp.startsWith('sandbox allow-scripts;'), csp);
  assert.ok(!/allow-same-origin/.test(csp), '同じオリジンとして扱わせない');
  for (const need of ["default-src 'none'", "connect-src 'none'", "frame-src 'none'", "object-src 'none'", "base-uri 'none'", "form-action 'none'", "media-src 'none'", "frame-ancestors 'self'", 'img-src data:']) assert.ok(csp.includes(need), need);
  assert.equal(r.headers['x-dns-prefetch-control'], 'off');
  assert.ok(!/https?:|\*/.test(csp), '外のものを、許さない');
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
  assert.equal(r.headers['cache-control'], 'no-store');
  assert.equal(r.headers['referrer-policy'], 'no-referrer');
  assert.ok(r.body.startsWith('<!doctype html>\n<meta charset="utf-8">\n'));
  assert.ok(r.body.includes('document.title = "押された"'), '資料の中身が、そのまま入る');
  const second = await request('/appframe/demo/root/1/1', authed());
  assert.equal(second.status, 200);
  assert.ok(second.body.includes('<p>2 つ目</p>') && !second.body.includes('押す'), '2 つ目は、2 つ目の中身');
});

test('枠の配信は、合言葉・Host・資料の中の枠だけ。ないものは 404。大きすぎるものは 413', async () => {
  assert.equal((await request('/appframe/demo/root/1/0')).status, 403, '合言葉なし');
  assert.equal((await request('/appframe/demo/root/1/0', authed({ Host: 'evil.example' }))).status, 403, 'Host が違う');
  assert.equal((await request('/appframe/demo/root/1/0', authed({ Origin: 'http://evil.example' }))).status, 403, '別の Origin');
  assert.equal((await request('/appframe/demo/root/1/2', authed())).status, 404, '3 つ目はない');
  assert.equal((await request('/appframe/demo/root/2/0', authed())).status, 404, '版がない');
  assert.equal((await request('/appframe/demo/root/0/0', authed())).status, 404, '版 0');
  assert.equal((await request('/appframe/demo/nope/1/0', authed())).status, 404, 'ページがない');
  assert.equal((await request('/appframe/demo/__proto__/1/0', authed())).status, 404, 'Object のプロパティ名を、ページとして読まない');
  assert.equal((await request('/appframe/demo/%E0%A4%A/1/0', authed())).status, 404, '壊れた % の符号');
  assert.equal((await request('/appframe/demo/root/1/0/extra', authed())).status, 404, '余計なパス');
  assert.equal((await request('/appframe/Bad_Slug/root/1/0', authed())).status, 400, 'トピック名の検査');
  assert.equal((await request('/appframe/big/root/1/0', authed())).status, 413, '上限を超える中身');
});

// 入れ子の箇条書き：1500 段（約 2MB。上限の 4MB 以内）で、marked の解析が、数秒以上かかる（実測：1200 段で 4 秒。大きさの 2 乗に近く増える）
const NASTY = Array.from({ length: 1500 }, (_, i) => `${' '.repeat(i * 2)}- a`).join('\n');

test('解析が遅い・壊れる資料でも、別のスレッドで、時間を切って、断る（サーバーを止めない）', async () => {
  const t0 = Date.now();
  await assert.rejects(appsOfAsync(NASTY, 400), (e) => e.reason === 'timeout');
  assert.ok(Date.now() - t0 < 3000, '時間内に、止まる');
  const deep = await appsOfAsync('> '.repeat(5000) + 'x', 5000).then(() => 'ok', (e) => e.reason); // 深い入れ子：例外で拒否か、取り出せる。どちらでも、返ってくる
  assert.ok(deep === 'ok' || deep === 'error', String(deep));
  assert.deepEqual(await appsOfAsync('```html-app\n<b>x</b>\n```\n'), ['<b>x</b>'], '正しい資料は、取り出せる');
});

test('枠の配信：解析が遅い資料は 422。同時の要求は、解析を共有する。失敗は、少しの間、覚える。その間も、ほかの要求に答える。大きすぎる資料は 413', async () => {
  const nasty = `${NASTY}\n\n\`\`\`html-app\n<b>x</b>\n\`\`\`\n`;
  rikai.newTopic('nasty', '遅い', '試験', nasty);
  rikai.newTopic('nasty2', '遅い 2', '試験', nasty);
  rikai.newTopic('huge', '巨大', '試験', `# 題\n\n${'あ'.repeat(DOC_MAX + 1)}\n`);
  // 1 つだけの要求にかかる時間（解析は、時間切れか、メモリの上限で、2〜3 秒で終わる）
  const t0 = Date.now();
  assert.equal((await request('/appframe/nasty2/root/1/0', authed())).status, 422);
  const single = Date.now() - t0;
  // 同じ資料への、同時の 4 要求：1 つの解析を共有する（共有しないと、worker は 2 つずつで、single の 2 倍）。解析の間も、ほかの要求に答える
  const t1 = Date.now();
  const slow = [0, 1, 2, 3].map(() => request('/appframe/nasty/root/1/0', authed()));
  await new Promise((r) => setTimeout(r, 300));
  assert.equal((await request('/api/ping', authed())).status, 200);
  assert.ok(Date.now() - t1 < single, '解析の間も、サーバーは、ほかの要求に答える');
  assert.deepEqual((await Promise.all(slow)).map((r) => r.status), [422, 422, 422, 422]);
  assert.ok(Date.now() - t1 < single * 1.7, `同時の 4 要求が、1 つの解析を共有する（${Date.now() - t1}ms。1 つだと ${single}ms）`);
  // 失敗を覚えているので、解析し直さない
  const t2 = Date.now();
  assert.equal((await request('/appframe/nasty/root/1/0', authed())).status, 422);
  assert.ok(Date.now() - t2 < 500, '失敗を覚えている');
  assert.equal((await request('/appframe/huge/root/1/0', authed())).status, 413);
});

test('画面（index.html）の CSP は、枠を、このサーバーの /appframe/ だけ、許す。画面のスクリプトは、自分のものだけ', async () => {
  const r = await request('/', { Cookie: `rikai_t_${port}=${token}` });
  assert.equal(r.status, 200);
  const csp = r.headers['content-security-policy'];
  assert.ok(csp.includes(`frame-src http://127.0.0.1:${port}/appframe/;`), csp);
  assert.ok(!/frame-src[^;]*'self'/.test(csp), '同じオリジンの、ほかの URL は、枠にできない');
  assert.ok(csp.includes("script-src 'self'") && !/script-src[^;]*unsafe/.test(csp), '画面のスクリプトは、inline を許さない');
  assert.ok(csp.includes("connect-src 'self'"));
});
