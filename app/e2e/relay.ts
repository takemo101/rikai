// e2e の道具：サーバーの前に置く、止められる中継（HTTP）。
// - `/api/events`（SSE）の、つながっている数を数える（サーバー側の接続の数。ブラウザの外から見る）
// - 止める・また起こす（`down`・`up`）：別のプロセスのサーバーは、再起動すると、ポートも合言葉も変わるので、同じ画面は、つなぎ直せない。中継なら、同じポートで、つなぎ直せる
// サーバーの Host・Origin の検査を通すため、Host・Origin だけ書き換えて、そのまま流す（SSE も、そのまま流す）。Cookie は、そのまま。
import fs from 'node:fs';
import http from 'node:http';
import type net from 'node:net';
import path from 'node:path';
import type { Page } from '@playwright/test';

export interface Relay {
  readonly origin: string;
  /** いま、つながっている /api/events の数 */
  sse(): number;
  /** 流した応答の記録（パス・状態・Content-Type） */
  readonly served: Array<{ path: string; status: number; type: string }>;
  /** 中継を止める（つながっている接続も、切る） */
  down(): Promise<void>;
  /** 同じポートで、また起こす */
  up(): Promise<void>;
  /** 合言葉つきの URL で、ページを開く（本文のブロックが出るまで待つ） */
  open(page: Page, hash: string): Promise<void>;
}

export async function startProxy(root: string): Promise<Relay> {
  const { port, token } = JSON.parse(fs.readFileSync(path.join(root, '.rikai', '.server.json'), 'utf8')) as {
    port: number;
    token: string;
  };
  const sockets = new Set<net.Socket>();
  let server: http.Server | null = null;
  let sse = 0;
  const served: Array<{ path: string; status: number; type: string }> = [];
  let at = 0;

  const listen = (): Promise<void> =>
    new Promise((resolve) => {
      const s = http.createServer((req, res) => {
        const isSse = req.url === '/api/events';
        if (isSse) {
          sse++;
          res.on('close', () => sse--);
        }
        const up = http.request(
          {
            host: '127.0.0.1',
            port,
            path: req.url,
            method: req.method,
            headers: {
              ...req.headers,
              host: `127.0.0.1:${port}`,
              ...(req.headers.origin ? { origin: `http://127.0.0.1:${port}` } : {}),
            },
          },
          (ur) => {
            served.push({
              path: req.url ?? '',
              status: ur.statusCode ?? 0,
              type: String(ur.headers['content-type'] ?? ''),
            });
            res.writeHead(ur.statusCode ?? 502, ur.headers);
            ur.pipe(res);
          },
        );
        up.on('error', () => res.destroy());
        res.on('close', () => up.destroy());
        req.pipe(up);
      });
      s.on('connection', (c) => {
        sockets.add(c);
        c.on('close', () => sockets.delete(c));
      });
      s.listen(at, '127.0.0.1', () => {
        server = s;
        at = (s.address() as net.AddressInfo).port;
        resolve();
      });
    });
  await listen();

  return {
    get origin() {
      return `http://127.0.0.1:${at}`;
    },
    sse: () => sse,
    served,
    async down() {
      for (const c of sockets) c.destroy();
      await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
      server = null;
    },
    up: listen,
    async open(page, hash) {
      await page.goto(`http://127.0.0.1:${at}/?t=${token}${hash}`);
      await page.locator('#article .blk').first().waitFor();
    },
  };
}
