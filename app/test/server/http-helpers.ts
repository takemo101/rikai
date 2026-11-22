// HTTP の試験の道具。実際に待ち受けて（startServer。127.0.0.1 の空きポート）要求を送る。
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../../src/server/serve';
import type { Project } from './helpers';

/** 画面（Vite のビルド：index.html・favicon.svg・assets/）の置き場。サーバーが、そのまま配る */
export const PUBLIC_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'skills',
  'rikai',
  'public',
);

/** ビルドした、画面の本体（assets/index-<ハッシュ>.js）のパス。ハッシュは、ビルドのたびに変わるので、探す */
export function builtAsset(): string {
  const name = fs.readdirSync(path.join(PUBLIC_DIR, 'assets')).find((f) => /^index-.*\.js$/.test(f));
  if (!name) throw new Error('skills/rikai/public/assets/index-*.js がない（pnpm run build:web）');
  return `/assets/${name}`;
}

export interface TestServer {
  port: number;
  token: string;
  close(): void;
}

export async function startTestServer(p: Project): Promise<TestServer> {
  const { server, port, token } = await startServer(p.store, p.hooks, PUBLIC_DIR);
  return {
    port,
    token,
    close() {
      server.closeAllConnections();
      server.close();
    },
  };
}

export interface HttpResult {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
  /** 本文のバイト（画像など、文字でないもの） */
  raw: Buffer;
}

export interface RequestOptions {
  headers?: Record<string, string>;
  body?: string | object;
}

/** 要求を送る。接続が切られたとき（本文が大きすぎるときなど）は、status 0 と error（コード）を返す */
export function request(
  port: number,
  method: string,
  p: string,
  { headers = {}, body }: RequestOptions = {},
): Promise<HttpResult & { error?: string }> {
  const { promise, resolve } = Promise.withResolvers<HttpResult & { error?: string }>();
  const req = http.request(
    { host: '127.0.0.1', port, method, path: p, headers: { Connection: 'close', ...headers } },
    (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body: raw.toString('utf8'), raw });
      });
    },
  );
  req.on('error', (e: NodeJS.ErrnoException) =>
    resolve({ status: 0, headers: {}, body: '', raw: Buffer.alloc(0), error: e.code }),
  );
  if (body !== undefined) req.write(typeof body === 'string' ? body : JSON.stringify(body));
  req.end();
  return promise;
}
