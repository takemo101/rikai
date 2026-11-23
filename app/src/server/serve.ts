// サーバーの起動と終了：127.0.0.1 の空きポートで待ち受ける（Hono の app.ts を、Node の HTTP サーバーに載せる）。
// 合言葉は、起動のたびに作る。ストア・フックは、引数で渡す（モジュールの状態を持たない）。
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { getRequestListener } from '@hono/node-server';
import { type ActionHooks, createActions } from './actions';
import { createApp } from './app';
import type { Store } from './store';
import { readJSON } from './util';
import { type ChangeFeed, createChangeFeed } from './watch';

export interface RunningServer {
  server: http.Server;
  port: number;
  token: string;
}

/**
 * サーバーを起こして、待ち受けを始める（ポートは空きポート）。テストも使う。
 * ポートは、待ち受けが始まってから分かる（Host・Origin の検査と Cookie の名前に使うので、そのあとで、アプリを作る）。
 * 先にポートだけ取って閉じる方法は、閉じてから開くまでの間に、ほかのプロセスに取られうるので、使わない。
 * publicDir：画面（旧 UI）の置き場。省略すると、バンドル（rikai.js）の横の public/
 * feed：変更の通知（SSE）の元。省略すると、ここで作る（テストは、`fs.watch` の差し替えなどのために渡す）
 */
export function startServer(
  store: Store,
  hooks: ActionHooks = {},
  publicDir: string = path.join(__dirname, 'public'),
  feed: ChangeFeed = createChangeFeed(store),
): Promise<RunningServer> {
  store.ensureBase();
  const token = crypto.randomBytes(24).toString('hex');
  const server = http.createServer();
  const { promise, resolve } = Promise.withResolvers<RunningServer>();
  server.listen(0, '127.0.0.1', () => {
    const port = (server.address() as AddressInfo).port;
    const app = createApp({ store, token, port, publicDir, actions: createActions(store, hooks), feed });
    // 待ち受けが始まった、同じ回のうちに取りつける（要求は、このあとにしか来ない）
    const listener = getRequestListener((req, env) => app.fetch(req, env));
    server.on('request', (incoming, outgoing) => {
      // 要求の URL は、旧実装と同じ読み方（`new URL(req.url, 'http://localhost')` のパスと問い合わせ）で、自分の待ち受け先の URL にする。
      // node-server は、Host から URL を組み、おかしな Host を 400 で断るが、Host の検査は、app が行う（403。旧と同じ応答）
      try {
        const u = new URL(incoming.url ?? '/', 'http://localhost');
        incoming.url = `http://127.0.0.1:${port}${u.pathname}${u.search}`;
      } catch {
        outgoing.writeHead(400).end();
        return;
      }
      void listener(incoming, outgoing);
    });
    resolve({ server, port, token });
  });
  return promise;
}

/** .server.json が自分のものなら消して、プロセスを終える */
export function shutdown(store: Store): never {
  try {
    const info = readJSON<{ pid?: number } | null>(store.serverFile(), null);
    if (info && info.pid === process.pid) fs.unlinkSync(store.serverFile());
  } catch {
    // 消せなくても、終わる
  }
  process.exit(0);
}
