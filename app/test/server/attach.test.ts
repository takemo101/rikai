// コメントへの画像の添付：形式・大きさ・名前の検査、保存（ロックの下・中身から名前）、Submit で AI にファイルの場所が届くこと、
// HTTP の入口（合言葉・大きさの上限）。作り物の画像（先頭のバイトだけ本物）を使う。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'vitest';
import type { PeekResult } from '../../src/server/agent';
import type { Thread } from '../../src/shared/types';
import {
  addComment,
  httpError,
  makeTopic,
  type Project,
  readThreads,
  removeProject,
  submit,
  tempProject,
  textAnchor,
} from './helpers';
import { request, startTestServer } from './http-helpers';

let p: Project;
beforeEach(() => {
  p = tempProject();
  makeTopic(p);
});
afterEach(() => removeProject(p));

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('作り物の画像の中身'),
]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('jpeg')]);
const GIF = Buffer.concat([Buffer.from('GIF89a'), Buffer.from('gif')]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([1, 2, 3, 4]), Buffer.from('WEBPVP8 ')]);
const b64 = (b: Buffer) => b.toString('base64');
const assetsDir = () => path.join(p.dir, '.rikai', 'demo', 'assets');
const assetFiles = () => fs.readdirSync(assetsDir()).sort();
const attach = (buf: Buffer) => p.actions.attach({ topic: 'demo', data: b64(buf) }).name;
// 見つからないときは undefined。使う側が、あるものとして読む
const thread = (id: string): Thread => readThreads(p).threads.find((t) => t.id === id) as Thread;

test('png・jpeg・gif・webp を、中身から決めた名前で保存する。同じ画像は、同じ名前で、重ならない', () => {
  const names = [PNG, JPG, GIF, WEBP].map(attach);
  assert.deepEqual(
    names.map((n) => n.split('.')[1]),
    ['png', 'jpg', 'gif', 'webp'],
  );
  for (const n of names) assert.match(n, /^c-[0-9a-f]{16}\.(png|jpg|gif|webp)$/);
  assert.deepEqual(fs.readFileSync(path.join(assetsDir(), names[0] as string)), PNG, '中身が、そのまま保存される');
  assert.equal(attach(PNG), names[0], '同じ中身は、同じ名前');
  assert.equal(assetFiles().length, 4);
  assert.ok(!assetFiles().some((f) => f.endsWith('.tmp')), '一時のファイルが残らない');
});

test('画像でないもの・壊れたデータ・大きすぎるものは、400 で、何も書かない', () => {
  const before = assetFiles();
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  for (const bad of [
    Buffer.from('ただの文字'),
    svg,
    Buffer.from('<html></html>'),
    Buffer.from([0x89, 0x50]),
    Buffer.from('RIFF....WAVE'),
  ]) {
    assert.throws(
      () => p.actions.attach({ topic: 'demo', data: b64(bad) }),
      httpError(400, /png・jpeg・gif・webp/),
      '先頭のバイトが、画像でない',
    );
  }
  for (const bad of [undefined, null, 42, '', '***', 'abc def', `${b64(PNG)}\n`, { x: 1 }]) {
    assert.throws(
      () => p.actions.attach({ topic: 'demo', data: bad }),
      httpError(400, /不正/),
      `base64 でない: ${JSON.stringify(bad)}`,
    );
  }
  const big = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]);
  assert.throws(() => p.actions.attach({ topic: 'demo', data: b64(big) }), httpError(400, /大きすぎ/));
  assert.deepEqual(assetFiles(), before, '失敗では、何も書かない');
  assert.throws(() => p.actions.attach({ topic: 'nope', data: b64(PNG) }), httpError(404));
});

test('画像だけのコメント・返信を付けられ、メッセージに名前が残る', () => {
  const n = attach(PNG);
  const id = addComment(p, { text: '', images: [n] });
  const m = thread(id).messages[0];
  assert.deepEqual(m?.images, [n]);
  assert.equal(m?.text, '');
  const n2 = attach(JPG);
  p.actions.reply({ topic: 'demo', thread: id, text: '', images: [n2, n2] });
  const msgs = thread(id).messages;
  assert.deepEqual(msgs[1]?.images, [n2], '同じ名前は、1 つにまとめる');
  assert.equal(msgs[1]?.kind, 'followup');
  const plain = addComment(p, { text: '画像なし' });
  assert.equal('images' in (thread(plain).messages[0] as object), false, '画像がなければ、キーを足さない');
});

test('名前の検査：形式・パスの抜け・ないファイル・枚数。失敗では、スレッドも増えない', () => {
  const n = attach(PNG);
  const count = () => readThreads(p).threads.length;
  const start = count();
  const extra = Array.from({ length: 5 }, (_, i) => `c-${String(i).repeat(16)}.png`); // 枚数の上限（4）を超える
  for (const bad of [
    ['../meta.json'],
    ['..%2Fmeta.json'],
    ['c-0000000000000000.png'],
    ['dot.png'],
    [`../assets/${n}`],
    [`${n}/../${n}`],
    [{ a: 1 }],
    'c-0000000000000000.png',
    [n, ...extra],
  ]) {
    assert.throws(
      () =>
        p.actions.comment({ topic: 'demo', page: 'root', version: 1, anchor: textAnchor(), text: 'x', images: bad }),
      httpError(400),
      JSON.stringify(bad),
    );
  }
  assert.equal(count(), start, '失敗では、何も書かない');
  const id = addComment(p, { images: [n] });
  assert.throws(
    () => p.actions.reply({ topic: 'demo', thread: id, text: 'x', images: ['../meta.json'] }),
    httpError(400),
  );
  assert.throws(
    () => p.actions.reply({ topic: 'demo', thread: id, text: '', images: [] }),
    httpError(400, /空/),
    '文字も画像もない返信は、受けない',
  );
});

test('編集：文字を空にできるのは、画像が付いているときだけ', () => {
  const n = attach(PNG);
  const withImg = addComment(p, { text: 'あり', images: [n] });
  const plain = addComment(p, { text: 'なし' });
  const mid = (id: string) => thread(id).messages[0]?.id as string;
  p.actions.edit({ topic: 'demo', thread: withImg, msg: mid(withImg), text: '' });
  assert.equal(thread(withImg).messages[0]?.text, '');
  assert.throws(
    () => p.actions.edit({ topic: 'demo', thread: plain, msg: mid(plain), text: ' ' }),
    httpError(400, /空/),
  );
});

// 届いている round（status: feedback）の中身。まだなら、試験を落とす
const feedback = (): Extract<PeekResult, { status: 'feedback' }> => {
  const r = p.agent.peek('demo');
  assert.equal(r.status, 'feedback');
  return r as Extract<PeekResult, { status: 'feedback' }>;
};

test('Submit：AI が読める、画像のファイルの絶対パスが、new にも history にも届く', () => {
  const n = attach(PNG);
  const id = addComment(p, { text: '図です', images: [n] });
  submit(p);
  const r1 = feedback();
  const want = path.join(p.dir, '.rikai', 'demo', 'assets', n);
  assert.deepEqual(r1.items[0]?.new[0]?.images, [want]);
  assert.ok(path.isAbsolute(want) && fs.existsSync(want), '指す先が、実際にある');
  p.agent.cmdApply('demo', { replies: [{ thread: id, body: '見ました' }] });
  const n2 = attach(JPG);
  p.actions.reply({ topic: 'demo', thread: id, text: '続き', images: [n2] });
  submit(p);
  const item = feedback().items[0];
  assert.deepEqual(item?.new[0]?.images, [path.join(p.dir, '.rikai', 'demo', 'assets', n2)]);
  assert.deepEqual(
    item?.history.find((m) => m.author === 'user')?.images,
    [want],
    '前の round の画像も、history に残る',
  );
  assert.equal(
    readThreads(p).threads[0]?.messages[0]?.images?.[0],
    n,
    '保存されるのは、名前だけ（パスは、出力のときに付ける）',
  );
});

test('assets/ がなくても、保存できる（git は空のフォルダを持たない）。ちょうど 4 枚は付けられる', () => {
  fs.rmSync(assetsDir(), { recursive: true });
  const names = [PNG, JPG, GIF, WEBP].map(attach);
  assert.equal(assetFiles().length, 4);
  const id = addComment(p, { images: names });
  assert.deepEqual(thread(id).messages[0]?.images, names, '4 枚は、上限の内');
});

test('HTTP：合言葉がなければ 403・画像は保存され /asset/ で配られる・上限を超える本文は拒否する', async () => {
  const srv = await startTestServer(p);
  const { port, token } = srv;
  // 本文は、Content-Type を付けずに送る（旧実装は、Content-Type を見なかった）
  const post = (pth: string, body: string | object, headers: Record<string, string> = {}) =>
    request(port, 'POST', pth, { headers: { 'x-rikai-token': token, ...headers }, body });
  try {
    assert.equal(
      (
        await request(port, 'POST', '/api/attach', {
          headers: { 'x-rikai-token': 'x'.repeat(token.length) },
          body: { topic: 'demo', data: b64(PNG) },
        })
      ).status,
      403,
    );
    assert.deepEqual(assetFiles(), [], '合言葉がなければ、書かない');

    const ok = await post('/api/attach', { topic: 'demo', data: b64(PNG) });
    assert.equal(ok.status, 200);
    const { name } = JSON.parse(ok.body) as { name: string };
    const got = await request(port, 'GET', `/asset/demo/${name}`, { headers: { 'x-rikai-token': token } });
    assert.equal(got.status, 200);
    assert.equal(got.headers['content-type'], 'image/png');
    assert.equal(got.headers['content-security-policy'], 'sandbox', '直接開かれても、中のスクリプトを動かさない');
    assert.deepEqual(got.raw, PNG);

    // 実際のスクリーンショットは、1.5MB（base64 で 2MB）を超える。attach の本文の上限が、ほかの API の 2MB なら、ここで 413 になる
    const large = Buffer.concat([PNG, Buffer.alloc(3 * 1024 * 1024, 7)]);
    const bigOk = await post('/api/attach', { topic: 'demo', data: b64(large) });
    assert.equal(bigOk.status, 200, `3MB の画像: ${bigOk.status} ${bigOk.error || ''}`);
    const bigName = (JSON.parse(bigOk.body) as { name: string }).name;
    assert.equal(fs.statSync(path.join(assetsDir(), bigName)).size, large.length);

    // 画像の上限（5MB）を、base64 で超えるものは、読み込みの途中で拒否される。ほかの API の 2MB の上限は、変わらない
    const over = await post('/api/attach', `{"topic":"demo","data":"${'A'.repeat(7 * 1024 * 1024)}"}`);
    assert.ok(over.status === 413 || over.status === 0, `上限を超えた本文は、拒否: ${over.status} ${over.error || ''}`);
    const mid = await post('/api/comment', `{"topic":"demo","text":"x","pad":"${'A'.repeat(3 * 1024 * 1024)}"}`);
    assert.ok(mid.status === 413 || mid.status === 0, 'ほかの API は、2MB のまま');
    assert.equal(assetFiles().length, 2, '拒否されたものは、書かれない（保存したのは、PNG と 3MB の画像だけ）');
  } finally {
    srv.close();
  }
});
