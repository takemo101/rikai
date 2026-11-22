// サーバーの起動と終了：127.0.0.1 の空きポートだけ・合言葉は起動ごとに違う・終了は、自分の .server.json だけ消す。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net, { type AddressInfo } from 'node:net';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { shutdown, startServer } from '../../src/server/serve';
import { writeJSON } from '../../src/server/util';
import { type Project, removeProject, tempProject } from './helpers';
import { PUBLIC_DIR, request } from './http-helpers';

let p: Project;
beforeEach(() => {
  p = tempProject();
});
afterEach(() => {
  vi.restoreAllMocks();
  removeProject(p);
});

test('startServer：127.0.0.1 の空きポートで待ち受け、合言葉は起動ごとに違う（48 文字の 16 進）', async () => {
  const a = await startServer(p.store, p.hooks, PUBLIC_DIR);
  const b = await startServer(p.store, p.hooks, PUBLIC_DIR);
  try {
    for (const s of [a, b]) {
      const addr = s.server.address() as AddressInfo;
      assert.equal(addr.address, '127.0.0.1', '外のインターフェースでは、待ち受けない');
      assert.equal(addr.port, s.port);
      assert.ok(s.port > 0);
      assert.match(s.token, /^[0-9a-f]{48}$/);
    }
    assert.notEqual(a.port, b.port);
    assert.notEqual(a.token, b.token);
    assert.ok(fs.existsSync(p.store.base), 'ensureBase：.rikai/ を作る');
    // 自分のポート・合言葉だけが通る（Host・Cookie の名前に、ポートが入る）
    assert.equal((await request(a.port, 'GET', '/api/ping', { headers: { 'x-rikai-token': a.token } })).status, 200);
    assert.equal((await request(a.port, 'GET', '/api/ping', { headers: { 'x-rikai-token': b.token } })).status, 403);
    assert.equal(
      (
        await request(a.port, 'GET', '/api/ping', {
          headers: { 'x-rikai-token': a.token, Host: `127.0.0.1:${b.port}` },
        })
      ).status,
      403,
    );
  } finally {
    for (const s of [a, b]) {
      s.server.closeAllConnections();
      s.server.close();
    }
  }
});

// 生のソケットで送って、応答の 1 行目（状態行）と本文を返す
function rawGet(port: number, head: string): Promise<{ line: string; body: string }> {
  const { promise, resolve } = Promise.withResolvers<{ line: string; body: string }>();
  const chunks: Buffer[] = [];
  const s = net.connect(port, '127.0.0.1', () => s.write(`${head}Connection: close\r\n\r\n`));
  s.on('data', (c: Buffer) => chunks.push(c));
  s.on('close', () => {
    const all = Buffer.concat(chunks).toString('utf8');
    resolve({ line: all.split('\r\n')[0] ?? '', body: all.slice(all.indexOf('\r\n\r\n') + 4) });
  });
  return promise;
}

test('startServer：Host がない・おかしくても、旧と同じ 403（ライブラリの 400 にしない）。要求の URL は、旧と同じ読み方', async () => {
  const s = await startServer(p.store, p.hooks, PUBLIC_DIR);
  try {
    const t = `x-rikai-token: ${s.token}\r\n`;
    for (const head of [
      `GET /api/topics HTTP/1.0\r\n${t}`, // Host なし
      `GET /api/topics HTTP/1.1\r\nHost: \r\n${t}`,
      `GET /api/topics HTTP/1.1\r\nHost: evil@127.0.0.1:${s.port}\r\n${t}`,
    ]) {
      const r = await rawGet(s.port, head);
      assert.equal(r.line.split(' ')[1], '403', head);
      assert.match(r.body, /ホスト名が違います/);
    }
    // 旧実装は、`new URL(req.url, 'http://localhost')` で読んだ。`//favicon.svg` は、ホストの付いた URL として、パス `/` になる
    const r = await rawGet(s.port, `GET //favicon.svg HTTP/1.1\r\nHost: 127.0.0.1:${s.port}\r\n`);
    assert.equal(r.line.split(' ')[1], '403');
    assert.match(r.body, /合言葉が必要です/);
  } finally {
    s.server.closeAllConnections();
    s.server.close();
  }
});

test('startServer：hooks（全トピックが閉じたとき）が、操作に渡る', async () => {
  const allClosed = vi.fn();
  p.hooks.allClosed = allClosed;
  p.store.newTopic('demo', '題', '試験', '# 題\n');
  const s = await startServer(p.store, p.hooks, PUBLIC_DIR);
  try {
    const end = await request(s.port, 'POST', '/api/end', {
      headers: { 'x-rikai-token': s.token },
      body: { topic: 'demo' },
    });
    assert.equal(end.status, 200);
    assert.equal(allClosed.mock.calls.length, 1);
  } finally {
    s.server.closeAllConnections();
    s.server.close();
  }
});

test('shutdown：.server.json が自分のものなら消して終わる。他のプロセスのものは、消さない', () => {
  const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as unknown as typeof process.exit);
  p.store.ensureBase();
  writeJSON(p.store.serverFile(), { pid: process.pid + 1, port: 1, token: 'x' });
  shutdown(p.store);
  assert.ok(fs.existsSync(p.store.serverFile()), '他のプロセスのものは、消さない');
  writeJSON(p.store.serverFile(), { pid: process.pid, port: 1, token: 'x' });
  shutdown(p.store);
  assert.ok(!fs.existsSync(p.store.serverFile()), '自分のものは、消す');
  fs.rmSync(p.store.base, { recursive: true, force: true });
  shutdown(p.store); // ファイルがなくても、終わる
  assert.equal(exit.mock.calls.length, 3);
  assert.deepEqual(exit.mock.calls[0], [0]);
});
