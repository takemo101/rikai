#!/usr/bin/env node
'use strict';
// rikai: 資料にコメントして Submit し、AI の返信と資料の修正で理解を深めるループ。
// ここは CLI の入口：引数を読み、各コマンドを lib/ のモジュールへ振り分ける。依存パッケージなし（Node 18+）。
// lib/ … util（共通）・store（.rikai の読み書き）・ask（質問の検証）・actions（画面からの操作）・agent（AI 向け：poll/apply）・server（HTTP）

const fs = require('fs');
const path = require('path');
const http = require('http');
const cp = require('child_process');
const { HttpError, out, sleep, now, readJSON, writeJSON } = require('./lib/util.js');
const { progressOf } = require('./public/progress.js'); // ビューアと同じ数え方（理解の進み具合）
const {
  setRoot, getRoot, getBase, tdir, serverFile, ensureBase, schemaOf, isSupported, topicTitle,
  loadMeta, loadThreads, pageFile, mutate, listTopics, countUnsent, newTopic,
} = require('./lib/store.js');
const { hooks } = require('./lib/actions.js');
const { peek, cmdApply } = require('./lib/agent.js');
const { startServer, shutdown } = require('./lib/server.js');

const SELF = __filename;

// ---------------------------------------------------------------- 引数

function parseArgs(argv) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      if (k === 'no-open' || k === 'force') flags[k] = true;
      else flags[k] = argv[++i];
    } else pos.push(a);
  }
  return { pos, flags };
}

function projectRoot(flags) {
  if (flags.root) return path.resolve(flags.root);
  try {
    return cp.execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch (_) {
    return process.cwd();
  }
}

// ---------------------------------------------------------------- コマンド

async function cmdPoll(slug, flags) {
  const deadline = Date.now() + (Number(flags.timeout) || 43200) * 1000;
  for (;;) {
    const r = peek(slug);
    if (r.status !== 'none') return out(r);
    if (Date.now() > deadline) return out({ status: 'timeout' });
    await sleep(500);
  }
}

// 待機しない版。poll を使えないエージェントが、ユーザーに「送った」と言われたあとに読みに行く
function cmdPull(slug) {
  return out(peek(slug));
}

function cmdStatus(slug) {
  const topics = slug ? [loadMeta(slug)] : listTopics();
  out(topics.map((m) => {
    if (!isSupported(m)) return { topic: m.slug, title: topicTitle(m), unsupported: true, schema: schemaOf(m) };
    const th = loadThreads(m.slug);
    return {
      topic: m.slug, title: m.title, closed: !!m.closed,
      pendingRounds: (m.pending || []),
      unsentInBrowser: countUnsent(th),
      progress: progressOf(th.threads),
      pages: Object.fromEntries(Object.entries(m.pages).map(([id, p]) => [id, { title: p.title, parent: p.parent, versions: p.versions, file: pageFile(m.slug, id, p.versions) }])),
    };
  }));
}

// ---------------------------------------------------------------- 起動まわり

function cmdServe() {
  // 全トピックが閉じたら、サーバーを終える（テストでは、差し替える）
  hooks.allClosed = () => setTimeout(shutdown, 800);
  // 合言葉を含むので、自分だけが読める権限（0600）で置く
  startServer().then(({ port, token }) => {
    writeJSON(serverFile(), { pid: process.pid, port, token, root: getRoot(), startedAt: now() }, 0o600);
  });
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

function pingServer(info) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: info.port, path: '/api/ping', headers: { 'x-rikai-token': info.token }, timeout: 1000 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

async function ensureServer() {
  ensureBase();
  const cur = readJSON(serverFile(), null);
  if (cur && (await pingServer(cur))) return cur;
  try { fs.unlinkSync(serverFile()); } catch (_) {}
  const log = fs.openSync(path.join(getBase(), '.server.log'), 'a');
  const child = cp.spawn(process.execPath, [SELF, 'serve', '--root', getRoot()], { detached: true, stdio: ['ignore', log, log] });
  child.unref();
  for (let i = 0; i < 50; i++) {
    await sleep(100);
    const info = readJSON(serverFile(), null);
    if (info && (await pingServer(info))) return info;
  }
  throw new Error(`サーバーを起動できませんでした。${path.join(getBase(), '.server.log')} を確認してください`);
}

function openBrowser(url) {
  if (process.env.NO_OPEN) return;
  const cmd = process.platform === 'darwin' ? ['open', url] : process.platform === 'win32' ? ['cmd', '/c', 'start', '', url] : ['xdg-open', url];
  try { cp.spawn(cmd[0], cmd.slice(1), { detached: true, stdio: 'ignore' }).on('error', () => {}).unref(); } catch (_) {}
}

async function cmdOpen(slug, flags) {
  loadMeta(slug);
  const info = await ensureServer();
  mutate(slug, (m) => { m.closed = false; return {}; });
  const url = `http://127.0.0.1:${info.port}/?t=${info.token}#/${slug}/root`;
  if (!flags['no-open']) openBrowser(url);
  out({ ok: true, url, root: getRoot(), dir: tdir(slug) });
}

function cmdStop() {
  const info = readJSON(serverFile(), null);
  if (!info) return out({ ok: true, stopped: false });
  try { process.kill(info.pid, 'SIGTERM'); } catch (_) {}
  try { fs.unlinkSync(serverFile()); } catch (_) {}
  out({ ok: true, stopped: true });
}

function readStdin() {
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

async function main() {
  const { pos, flags } = parseArgs(process.argv.slice(2));
  const cmd = pos[0];
  setRoot(projectRoot(flags));
  const slug = pos[1];
  try {
    switch (cmd) {
      case 'serve': return cmdServe();
      case 'new': {
        const meta = newTopic(slug, flags.title, flags.source, readStdin());
        return out({ ok: true, topic: meta.slug, dir: tdir(meta.slug), rootPage: pageFile(meta.slug, 'root', 1), assets: path.join(tdir(meta.slug), 'assets') });
      }
      case 'open': return await cmdOpen(slug, flags);
      case 'poll': return await cmdPoll(slug, flags);
      case 'pull': return cmdPull(slug);
      case 'apply': {
        let payload;
        try { payload = JSON.parse(readStdin()); } catch (e) { if (e instanceof HttpError) throw e; throw new HttpError(400, `JSON が不正です: ${e.message}`); }
        return out(cmdApply(slug, payload));
      }
      case 'status': return cmdStatus(slug);
      case 'stop': return cmdStop();
      default: console.log(HELP);
    }
  } catch (e) {
    out({ ok: false, errors: String(e.message).split('\n') });
    process.exit(1);
  }
}

main();
