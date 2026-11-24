// rikai: 資料にコメントして Submit し、AI の返信と資料の修正で理解を深めるループ。
// ここは CLI の入口：引数を読み、各コマンドを server/ のモジュールへ振り分ける。
// 配布するときは、依存を含めて 1 つの CJS にバンドルする（`node rikai.js`。利用者の環境に、npm install は要らない）。
// server/ … util（共通）・store（.rikai の読み書き）・ask（質問の検証）・actions（画面からの操作）・agent（AI 向け：poll/apply）・serve（HTTP）
import cp from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { ActionHooks } from '../server/actions';
import { createAgent } from '../server/agent';
import { createIdleWatch, IDLE_EXIT_MS, shutdown, startServer } from '../server/serve';
import { allTopicsClosed, createStore, type Store } from '../server/store';
import { HttpError, now, out, readJSON, sleep, writeJSON } from '../server/util';
import { createChangeFeed } from '../server/watch';
import { type Flags, parseArgs, projectRoot } from './args';
import { infoReply } from './help';
import { readStdin } from './stdin';

// 起動したサーバーの情報（.rikai/.server.json）
interface ServerInfo {
  pid: number;
  port: number;
  token: string;
}

// 自分自身（バンドルした 1 ファイル）。サーバーは、これを子プロセスで起こす
const SELF = process.argv[1] as string;

// ---------------------------------------------------------------- 起動まわり

/** サーバーが終わるまでの待ち（ミリ秒）。環境変数 RIKAI_IDLE_MS で、試験のために短くできる（正の整数だけ。それ以外は、既定の 10 分） */
function idleExitMs(): number {
  const n = Number(process.env.RIKAI_IDLE_MS);
  return Number.isInteger(n) && n > 0 ? n : IDLE_EXIT_MS;
}

function cmdServe(store: Store): void {
  // 終了したトピックも、閲覧できる（F54）：すべて閉じても、すぐには終わらない。すべて閉じて、かつ待ちの間、リクエストがないとき（開いているタブがない）に、終わる
  const feed = createChangeFeed(store);
  const idle = createIdleWatch({
    ms: idleExitMs(),
    allClosed: () => allTopicsClosed(store),
    busy: () => feed.size > 0,
    onIdle: () => shutdown(store),
  });
  const hooks: ActionHooks = { allClosed: () => idle.touch() };
  idle.touch(); // 起動した直後から数える（閉じたトピックを見るために起動した〔open --view〕まま、誰も来ないとき）
  // 合言葉を含むので、自分だけが読める権限（0600）で置く
  startServer(store, hooks, undefined, feed, () => idle.touch()).then(({ port, token }) => {
    writeJSON(store.serverFile(), { pid: process.pid, port, token, root: store.root, startedAt: now() }, 0o600);
  });
  process.on('SIGTERM', () => shutdown(store));
  process.on('SIGINT', () => shutdown(store));
}

function pingServer(info: ServerInfo): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(
      {
        host: '127.0.0.1',
        port: info.port,
        path: '/api/ping',
        headers: { 'x-rikai-token': info.token },
        timeout: 1000,
      },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      },
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function ensureServer(store: Store): Promise<ServerInfo> {
  store.ensureBase();
  const cur = readJSON<ServerInfo | null>(store.serverFile(), null);
  if (cur && (await pingServer(cur))) return cur;
  try {
    fs.unlinkSync(store.serverFile());
  } catch {}
  const log = fs.openSync(path.join(store.base, '.server.log'), 'a');
  const child = cp.spawn(process.execPath, [SELF, 'serve', '--root', store.root], {
    detached: true,
    stdio: ['ignore', log, log],
  });
  child.unref();
  for (let i = 0; i < 50; i++) {
    await sleep(100);
    const info = readJSON<ServerInfo | null>(store.serverFile(), null);
    if (info && (await pingServer(info))) return info;
  }
  throw new Error(`サーバーを起動できませんでした。${path.join(store.base, '.server.log')} を確認してください`);
}

function openBrowser(url: string): void {
  if (process.env.NO_OPEN) return;
  const cmd =
    process.platform === 'darwin'
      ? ['open', url]
      : process.platform === 'win32'
        ? ['cmd', '/c', 'start', '', url]
        : ['xdg-open', url];
  try {
    cp.spawn(cmd[0] as string, cmd.slice(1), { detached: true, stdio: 'ignore' })
      .on('error', () => {})
      .unref();
  } catch {}
}

async function cmdOpen(store: Store, slug: string, flags: Flags): Promise<void> {
  const view = !!flags.view && store.loadMeta(slug).closed; // --view：終了したトピックを、開き直さず（`closed` を変えず）、閲覧専用で見る
  const info = await ensureServer(store);
  if (!view)
    store.mutate(slug, (m) => {
      m.closed = false;
      return {};
    });
  const url = `http://127.0.0.1:${info.port}/?t=${info.token}#/${slug}/root`;
  if (!flags['no-open']) openBrowser(url);
  out({ ok: true, url, root: store.root, dir: store.tdir(slug) });
}

function cmdStop(store: Store): void {
  const info = readJSON<ServerInfo | null>(store.serverFile(), null);
  if (!info) {
    out({ ok: true, stopped: false });
    return;
  }
  try {
    process.kill(info.pid, 'SIGTERM');
  } catch {}
  try {
    fs.unlinkSync(store.serverFile());
  } catch {}
  out({ ok: true, stopped: true });
}

/** 色（ANSI）は、端末への出力で、かつ NO_COLOR（空でない）がないときだけ。パイプ・リダイレクトは、プレーンテキスト */
function wantsColor(stream: { isTTY?: boolean }): boolean {
  return !!stream.isTTY && !process.env.NO_COLOR;
}

async function main(): Promise<void> {
  const { pos, flags } = parseArgs(process.argv.slice(2));
  // ヘルプ・バージョン・未知のコマンドは、ストアを作る前に答えて終わる（プロジェクトに、何も書かない）
  const info = infoReply(pos, flags, { stdout: wantsColor(process.stdout), stderr: wantsColor(process.stderr) });
  if (info) {
    if (info.stdout) process.stdout.write(info.stdout);
    if (info.stderr) process.stderr.write(info.stderr);
    process.exitCode = info.code;
    return;
  }
  const cmd = pos[0];
  const store = createStore(projectRoot(flags));
  const agent = createAgent(store);
  const slug = pos[1] as string;
  try {
    switch (cmd) {
      case 'serve':
        return cmdServe(store);
      case 'new': {
        const meta = store.newTopic(slug, flags.title as string, flags.source as string, await readStdin());
        return out({
          ok: true,
          topic: meta.slug,
          dir: store.tdir(meta.slug),
          rootPage: store.pageFile(meta.slug, 'root', 1),
          assets: path.join(store.tdir(meta.slug), 'assets'),
        });
      }
      case 'open':
        return await cmdOpen(store, slug, flags);
      case 'poll':
        return await agent.cmdPoll(slug, flags);
      case 'pull':
        return agent.cmdPull(slug);
      case 'apply': {
        let payload: unknown;
        try {
          payload = JSON.parse(await readStdin());
        } catch (e) {
          if (e instanceof HttpError) throw e;
          throw new HttpError(400, `JSON が不正です: ${(e as Error).message}`);
        }
        return out(agent.cmdApply(slug, payload));
      }
      case 'status':
        return agent.cmdStatus(slug);
      case 'stop':
        return cmdStop(store);
    }
  } catch (e) {
    out({ ok: false, errors: String((e as Error).message).split('\n') });
    process.exit(1);
  }
}

main();
