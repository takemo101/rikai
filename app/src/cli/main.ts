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
import { shutdown, startServer } from '../server/serve';
import { createStore, type Store } from '../server/store';
import { HttpError, now, out, readJSON, sleep, writeJSON } from '../server/util';
import { type Flags, parseArgs, projectRoot } from './args';

// 起動したサーバーの情報（.rikai/.server.json）
interface ServerInfo {
  pid: number;
  port: number;
  token: string;
}

// 自分自身（バンドルした 1 ファイル）。サーバーは、これを子プロセスで起こす
const SELF = process.argv[1] as string;

// ---------------------------------------------------------------- 起動まわり

function cmdServe(store: Store): void {
  // 全トピックが閉じたら、サーバーを終える
  const hooks: ActionHooks = { allClosed: () => setTimeout(() => shutdown(store), 800) };
  // 合言葉を含むので、自分だけが読める権限（0600）で置く
  startServer(store, hooks).then(({ port, token }) => {
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
  store.loadMeta(slug);
  const info = await ensureServer(store);
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

function readStdin(): string {
  if (process.stdin.isTTY) throw new HttpError(400, '標準入力で渡してください');
  return fs.readFileSync(0, 'utf8');
}

const HELP = `rikai <command>
  new <topic> --title <題名> [--source <対象>]   標準入力のMarkdownから新しいトピックを作る
  open <topic> [--no-open]                       ビューアを起動して URL を出す
  poll <topic> [--timeout 秒]                    Submit されるまで待ち、コメントのバッチを出力する（Claude Code 向け）
  pull <topic>                                   待たずに、未処理のバッチがあれば出力する（「送った」と言われたとき）
  apply <topic>                                  標準入力のJSONで返信・新版・子ページを反映する
  status [topic]                                 未処理のバッチなどを出す
  stop                                           サーバーを止める
  共通: --root <dir>  プロジェクトルート（省略時は git のルート、なければ cwd）`;

async function main(): Promise<void> {
  const { pos, flags } = parseArgs(process.argv.slice(2));
  const cmd = pos[0];
  const store = createStore(projectRoot(flags));
  const agent = createAgent(store);
  const slug = pos[1] as string;
  try {
    switch (cmd) {
      case 'serve':
        return cmdServe(store);
      case 'new': {
        const meta = store.newTopic(slug, flags.title as string, flags.source as string, readStdin());
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
          payload = JSON.parse(readStdin());
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
      default:
        console.log(HELP);
    }
  } catch (e) {
    out({ ok: false, errors: String((e as Error).message).split('\n') });
    process.exit(1);
  }
}

main();
