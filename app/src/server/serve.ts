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

/** すべてのトピックが閉じていて、リクエストが来なくなってから、サーバーが終わるまでの時間（ミリ秒）：10 分。終了したトピックは、閲覧できる（F54）ので、すぐには終わらない */
export const IDLE_EXIT_MS = 10 * 60 * 1000;

export interface IdleWatch {
  /** リクエストがあった（待ちを始める・延ばす） */
  touch(): void;
  /** 待ちを解く（以後、終わらない） */
  stop(): void;
}

export interface IdleWatchOptions {
  /** 待つ時間（ミリ秒） */
  ms: number;
  /** すべての（読める）トピックが閉じているか。待ちが終わったときに、そのつど読む */
  allClosed: () => boolean;
  /** 開いているタブがあるか（変更の通知〔SSE〕の購読が 1 つ以上）。あれば、終わらない */
  busy: () => boolean;
  onIdle: () => void;
}

/**
 * 「すべて閉じて、かつ ms の間、リクエストがない」とき、onIdle を呼ぶ。待ちは 1 つのタイマー（`unref`：これだけでは、プロセスを生かさない）。
 * 開いているトピックがあれば、待ちが終わったとき、何もせず、解く（次のリクエストで、また始まる）：`rikai new`・`rikai open` は、サーバーへ疎通の確認（リクエスト）を送るので、開いているトピックができれば、終わらない。
 * タブが開いている間（busy）は、待ちを延ばす。
 */
export function createIdleWatch({ ms, allClosed, busy, onIdle }: IdleWatchOptions): IdleWatch {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let last = Date.now();
  const arm = (wait: number): void => {
    timer = setTimeout(fire, wait);
    timer.unref();
  };
  function fire(): void {
    timer = null;
    const left = last + ms - Date.now();
    if (left > 0) {
      arm(left); // 待っている間に、リクエストがあった
      return;
    }
    // 開いているトピックがある：終わらない（待ちは解く。次のリクエストで、また始まる）
    if (!allClosed()) return;
    // 開いているタブがある間は、待ちを延ばす
    if (busy()) arm(ms);
    else onIdle();
  }
  return {
    touch() {
      last = Date.now();
      if (!timer) arm(ms);
    },
    stop() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

/**
 * サーバーを起こして、待ち受けを始める（ポートは空きポート）。テストも使う。
 * ポートは、待ち受けが始まってから分かる（Host・Origin の検査と Cookie の名前に使うので、そのあとで、アプリを作る）。
 * 先にポートだけ取って閉じる方法は、閉じてから開くまでの間に、ほかのプロセスに取られうるので、使わない。
 * publicDir：画面の置き場。省略すると、バンドル（rikai.js）の横の public/
 * feed：変更の通知（SSE）の元。省略すると、ここで作る（テストは、`fs.watch` の差し替えなどのために渡す）
 * onRequest：リクエストが来るたびに呼ぶ（`rikai serve` が、終わるまでの待ちを延ばす）
 */
export function startServer(
  store: Store,
  hooks: ActionHooks = {},
  publicDir: string = path.join(__dirname, 'public'),
  feed: ChangeFeed = createChangeFeed(store),
  onRequest?: () => void,
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
      onRequest?.();
      // 要求の URL は、`new URL(req.url, 'http://localhost')` のパスと問い合わせで、自分の待ち受け先の URL にする。
      // node-server は、Host から URL を組み、おかしな Host を 400 で断るが、Host の検査は、app が行う（403）
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
