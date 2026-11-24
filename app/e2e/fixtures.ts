// e2e のフィクスチャ：テストごとに、使い捨てのプロジェクト（os.tmpdir() の下）を作り、バンドルした CLI で new → open --no-open し、
// 合言葉つきの URL でページを開く。終わったら、サーバーを止めて、消す。
// - 資料・コメントは、すべて作り物。ログ・失敗の表示に、資料・コメントの中身を出さない
// - 合言葉は、ログ・失敗の表示に出さない（goto の失敗は、合言葉を隠して投げ直す）
// - どのテストも、終わりに、127.0.0.1 以外への通信が 0 件であることを確かめる（SPEC N1）
import { type ChildProcess, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test as base, expect, type Page } from '@playwright/test';
import { CHROME, CLI } from './env';
import { DOC_BASIC } from './samples';

export { expect };

// CLI・API の JSON。形は、テストごとに違うので、型は付けない
// biome-ignore lint/suspicious/noExplicitAny: 上のとおり
export type Json = any;

export interface CliResult {
  code: number;
  // CLI が標準出力に出した JSON（読めなければ null）
  json: Json;
  stdout: string;
}

export interface RikaiApp {
  readonly root: string;
  // いま、画面で使っているトピック（pull・apply などの既定の対象）
  readonly slug: string;
  // サーバーの origin（合言葉なし）
  readonly origin: string;
  // 127.0.0.1 以外へ出ようとした通信（あってはならない）
  readonly external: string[];
  // CLI を呼ぶ（--root は付く）。標準入力を渡せる
  cli(args: string[], stdin?: string): Promise<CliResult>;
  // 新しいトピックを作って、開く（同じサーバー）
  addTopic(slug: string, title: string, markdown: string): Promise<void>;
  // AI の返信などを、apply で反映する（失敗を期待するときは expectFail）
  apply(body: unknown, opts?: { topic?: string; expectFail?: boolean }): Promise<Json>;
  // 待たずに、届いた round を読む（なければ status: 'none'）
  pull(topic?: string): Promise<Json>;
  poll(topic?: string, timeoutSec?: number): Promise<Json>;
  status(topic?: string): Promise<Json>;
  // AI に送った後の round が届くまで待って、その内容を返す
  nextRound(topic?: string): Promise<Json>;
  // サーバーを止める
  stopServer(): Promise<void>;
  // 合言葉つきの URL で、ページを開く（本文のブロックが出るまで待つ）
  open(page: Page, hash?: string): Promise<void>;
  // 新しいトピックを作り、いまのページで、そのトピックへ移る（ハッシュだけ。合言葉の Cookie は、そのまま）。title は、ほかと重ならない題名
  switchTopic(
    page: Page,
    slug: string,
    title: string,
    markdown: string,
    assets?: Record<string, Buffer>,
  ): Promise<void>;
  // トピックの assets/ に、画像などを置く（資料の ![…](assets/名前) から参照できる）
  writeAsset(name: string, data: Buffer, topic?: string): void;
  // サーバーへの生の HTTP（node:http。Host・Origin を自由に付けられる）。auth: true で、合言葉（ヘッダー）を付ける
  http(
    pathname: string,
    opts?: { method?: string; headers?: Record<string, string>; auth?: boolean; body?: string },
  ): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }>;
}

const redact = (s: string, token: string): string => (token ? s.split(token).join('<token>') : s);

function runCli(args: string[], stdin: string | undefined): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child: ChildProcess = spawn(process.execPath, [CLI, ...args], {
      env: { ...process.env, NO_OPEN: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => {
      stdout += d;
    });
    child.stderr?.on('data', (d) => {
      stderr += d;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      let json: Json = null;
      try {
        json = JSON.parse(stdout);
      } catch {}
      resolve({ code: code ?? -1, json, stdout: stdout + stderr });
    });
    child.stdin?.end(stdin ?? '');
  });
}

export const test = base.extend<{ app: RikaiApp }>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright は、第 1 引数の分割代入から、依存するフィクスチャを読む
  app: async ({}, use) => {
    test.skip(!fs.existsSync(CHROME), `Chrome がありません（RIKAI_CHROME で指定する）`);
    test.skip(!fs.existsSync(CLI), `rikai.js がありません（RIKAI_CLI で指定する）`);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rikai-e2e-'));
    // 既定のトピック。switchTopic で移ったら、そのトピックになる（pull・apply などの既定の対象）
    let slug = 'demo';
    const external: string[] = [];
    const cli = (args: string[], stdin?: string) => runCli(['--root', root, ...args], stdin);
    let token = '';
    let origin = '';
    let urlWithToken = '';

    const ok = async (args: string[], stdin?: string) => {
      const r = await cli(args, stdin);
      if (r.code !== 0 || !r.json || r.json.ok === false) {
        throw new Error(`rikai ${args[0]} が失敗しました: ${redact(r.stdout.slice(0, 300), token)}`);
      }
      return r.json;
    };
    const openUrl = async (topic: string) => {
      const j = await ok(['open', topic, '--no-open']);
      const u = new URL(j.url);
      token = u.searchParams.get('t') ?? '';
      origin = u.origin;
      urlWithToken = `${u.origin}/?t=${token}`;
    };

    await ok(['new', slug, '--title', '猫の観察日記'], DOC_BASIC);
    await openUrl(slug);

    const app: RikaiApp = {
      root,
      get slug() {
        return slug;
      },
      get origin() {
        return origin;
      },
      external,
      cli,
      async addTopic(s, title, markdown) {
        await ok(['new', s, '--title', title], markdown);
        await openUrl(s);
      },
      async apply(body, opts = {}) {
        const r = await cli(['apply', opts.topic ?? slug], JSON.stringify(body));
        if (opts.expectFail) {
          expect(r.code).toBe(1);
          return r.json;
        }
        if (r.code !== 0 || !r.json || r.json.ok === false) {
          throw new Error(`apply が失敗しました: ${redact(r.stdout.slice(0, 600), token)}`);
        }
        return r.json;
      },
      async pull(topic) {
        return (await cli(['pull', topic ?? slug])).json;
      },
      async poll(topic, timeoutSec = 5) {
        return (await cli(['poll', topic ?? slug, '--timeout', String(timeoutSec)])).json;
      },
      async status(topic) {
        const r = (await cli(['status', topic ?? slug])).json;
        return Array.isArray(r) ? r[0] : r;
      },
      async nextRound(topic) {
        let got: Json = null;
        await expect
          .poll(
            async () => {
              got = await app.pull(topic);
              return got?.status;
            },
            { timeout: 10_000 },
          )
          .toBe('feedback');
        return got;
      },
      async stopServer() {
        await cli(['stop']);
      },
      async switchTopic(page, s, title, markdown, assets = {}) {
        slug = s;
        await ok(['new', s, '--title', title], markdown);
        for (const [name, data] of Object.entries(assets)) app.writeAsset(name, data, s);
        await openUrl(s);
        await page.evaluate((h) => {
          location.hash = h;
        }, `#/${s}/root`);
        await expect(page.locator('#top-title')).toHaveText(title);
        await page.locator('#article .blk').first().waitFor();
      },
      writeAsset(name, data, topic) {
        const dir = path.join(root, '.rikai', topic ?? slug, 'assets');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, name), data);
      },
      http(pathname, opts = {}) {
        return new Promise((resolve, reject) => {
          const u = new URL(origin);
          const headers: Record<string, string> = { ...(opts.headers ?? {}) };
          if (opts.auth) headers['x-rikai-token'] = token;
          const req = http.request(
            { host: u.hostname, port: u.port, path: pathname, method: opts.method ?? 'GET', headers },
            (res) => {
              let body = '';
              res.setEncoding('utf8');
              res.on('data', (d) => {
                body += d;
              });
              res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
            },
          );
          req.on('error', reject);
          req.end(opts.body);
        });
      },
      async open(page, hash) {
        try {
          await page.goto(`${urlWithToken}${hash ?? `#/${slug}/root`}`);
        } catch (e) {
          throw new Error(redact(String((e as Error).message), token));
        }
        await page.locator('#article .blk').first().waitFor();
      },
    };

    await use(app);

    await cli(['stop']).catch(() => {});
    fs.rmSync(root, { recursive: true, force: true });
    expect(external, '127.0.0.1 以外への通信').toEqual([]);
  },

  // ページは、app（合言葉つきの URL）を開いた状態で渡す。外への通信を数える
  page: async ({ app, page }, use) => {
    page.context().on('request', (req) => {
      const u = req.url();
      if (/^(data|blob|about):/i.test(u)) return;
      const host = new URL(u).hostname;
      if (host !== '127.0.0.1' && host !== 'localhost') app.external.push(new URL(u).origin);
    });
    await app.open(page);
    await use(page);
  },
});
