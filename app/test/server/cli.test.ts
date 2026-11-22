// CLI（バンドルした 1 ファイル）を、子プロセスで動かして確かめる。実際にサーバーを起こす（127.0.0.1 の空きポートだけ）。
// 旧 server.test.js のうち、CLI を使う 2 つ。HTTP だけを試すものは、server.test.ts にある。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'vitest';
import { addComment, cliResult, makeTopic, removeProject, runCli, singleAsk, submit, tempProject } from './helpers';

interface ServerInfo {
  pid: number;
  port: number;
  token: string;
}

test('rikai open が置く .server.json は、自分だけが読める権限（0600）', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rikai-open-'));
  const run = (...args: string[]) => runCli(root, args, '# 題\n');
  try {
    run('new', 'perm', '--title', '権限');
    const opened = JSON.parse(run('open', 'perm', '--no-open')) as { url: string };
    assert.match(opened.url, /^http:\/\/127\.0\.0\.1:\d+\/\?t=[0-9a-f]+#\/perm\/root$/);
    const mode = fs.statSync(path.join(root, '.rikai', '.server.json')).mode & 0o777;
    assert.equal(mode.toString(8), '600');
  } finally {
    try {
      run('stop');
    } catch {
      /* 起動に失敗していても、片付けを続ける */
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rikai serve は、すべてのトピックが閉じたら、自分で終わる（終了の処理を、serve が取りつける）', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rikai-exit-'));
  const run = (...args: string[]) => runCli(root, args, '# 題\n');
  const alive = (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  let pid = 0;
  try {
    run('new', 'one', '--title', '一');
    run('new', 'two', '--title', '二');
    run('open', 'one', '--no-open');
    const info = JSON.parse(fs.readFileSync(path.join(root, '.rikai', '.server.json'), 'utf8')) as ServerInfo;
    pid = info.pid;
    const end = (topic: string) =>
      fetch(`http://127.0.0.1:${info.port}/api/end`, {
        method: 'POST',
        headers: { 'x-rikai-token': info.token, 'content-type': 'application/json' },
        body: JSON.stringify({ topic }),
      });
    assert.equal((await end('one')).status, 200);
    await new Promise((r) => setTimeout(r, 1500));
    assert.equal(alive(pid), true, 'まだ開いているトピックがあるので、終わらない');
    assert.equal((await end('two')).status, 200);
    for (let i = 0; i < 50 && alive(pid); i++) await new Promise((r) => setTimeout(r, 100));
    assert.equal(alive(pid), false, 'すべて閉じたら、サーバーのプロセスが終わる');
    assert.equal(fs.existsSync(path.join(root, '.rikai', '.server.json')), false, '.server.json も消える');
  } finally {
    if (pid && alive(pid)) {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        /* すでに終わっている */
      }
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---- 追加：移植で足した検査（CLI の入口：引数・出力・終了コード。サーバーを起こさない部分） ----

test('引数なし・知らないコマンドは、使い方を出して、終了コード 0', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rikai-help-'));
  try {
    for (const args of [[], ['nothing']]) {
      const r = cliResult(root, args);
      assert.equal(r.status, 0);
      assert.match(r.stdout, /^rikai <command>\n {2}new <topic>/);
      assert.match(r.stdout, /共通: --root <dir>/);
    }
    assert.equal(fs.existsSync(path.join(root, '.rikai')), false, '使い方を出すだけで、.rikai は作らない');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('失敗は、{ ok: false, errors } を標準出力に出して、終了コード 1（行ごとの誤りに分ける）', () => {
  const p = tempProject();
  try {
    const missing = cliResult(p.dir, ['status', 'nothing']);
    assert.equal(missing.status, 1);
    assert.deepEqual(JSON.parse(missing.stdout), { ok: false, errors: ['トピックがありません: nothing'] });

    makeTopic(p);
    const bad = cliResult(p.dir, ['apply', 'demo'], '{壊れた');
    assert.equal(bad.status, 1);
    const err = JSON.parse(bad.stdout) as { ok: boolean; errors: string[] };
    assert.equal(err.ok, false);
    assert.match(err.errors[0] ?? '', /^JSON が不正です: /);

    const many = cliResult(
      p.dir,
      ['apply', 'demo'],
      JSON.stringify({
        pages: [{ id: 'Bad_ID', title: '', markdown: '' }],
        revisions: [{ page: 'nope', markdown: 'x' }],
      }),
    );
    assert.equal(many.status, 1);
    assert.equal((JSON.parse(many.stdout) as { errors: string[] }).errors.length, 4, '誤りは、すべて、1 行ずつ返す');
  } finally {
    removeProject(p);
  }
});

test('new → (画面の操作) → pull → apply → status が、CLI で通る。pull の出力は、peek と同じ', () => {
  const p = tempProject();
  try {
    const made = JSON.parse(
      runCli(p.dir, ['new', 'demo', '--title', '題', '--source', '試験'], '# 題\n\n本文です。\n'),
    ) as {
      ok: boolean;
      topic: string;
      rootPage: string;
    };
    assert.equal(made.ok, true);
    assert.equal(made.rootPage, p.store.pageFile('demo', 'root', 1));

    assert.deepEqual(JSON.parse(runCli(p.dir, ['pull', 'demo'])), {
      status: 'none',
      message: 'まだ Submit されたコメントはありません',
      unsent: 0,
    });

    const id = addComment(p);
    submit(p, 'メモ');
    const pulled = JSON.parse(runCli(p.dir, ['pull', 'demo']));
    assert.deepEqual(pulled, JSON.parse(JSON.stringify(p.agent.peek('demo'))));
    assert.equal(pulled.status, 'feedback');
    // poll は、届いているものが、すでにあれば、待たずに同じものを出す
    assert.deepEqual(JSON.parse(runCli(p.dir, ['poll', 'demo', '--timeout', '5'])), pulled);

    const applied = JSON.parse(
      runCli(p.dir, ['apply', 'demo'], JSON.stringify({ replies: [{ thread: id, body: '返信', ask: singleAsk }] })),
    );
    assert.deepEqual(applied, {
      ok: true,
      handledRounds: [1],
      newPages: [],
      revised: {},
      repliedThreads: [id],
      newThreads: [],
    });

    const [status] = JSON.parse(runCli(p.dir, ['status', 'demo'])) as Record<string, unknown>[];
    assert.deepEqual(status?.pendingRounds, []);
    assert.deepEqual(status?.progress, {
      threads: { total: 1, resolved: 0, open: 1 },
      asks: { total: 1, answered: 0 },
    });
    assert.equal(JSON.parse(runCli(p.dir, ['pull', 'demo'])).status, 'none');
  } finally {
    removeProject(p);
  }
});

test('poll は、時間内に Submit がなければ timeout を出す', () => {
  const p = tempProject();
  try {
    makeTopic(p);
    const r = cliResult(p.dir, ['poll', 'demo', '--timeout', '1']);
    assert.equal(r.status, 0);
    assert.deepEqual(JSON.parse(r.stdout), { status: 'timeout' });
  } finally {
    removeProject(p);
  }
});

test('open は、--no-open がなければ、ブラウザを開くコマンドを起動する。--no-open なら、起動しない', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rikai-browser-'));
  // 偽のブラウザ起動コマンド（macOS は open、Windows は cmd、ほかは xdg-open）を PATH の先頭に置き、呼ばれたら、記録する
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'rikai-bin-'));
  const log = path.join(bin, 'called.log');
  const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
  fs.writeFileSync(path.join(bin, opener), `#!/bin/sh\necho "$1" >> ${JSON.stringify(log)}\n`, { mode: 0o755 });
  const env = { PATH: `${bin}${path.delimiter}${process.env.PATH}`, NO_OPEN: '' };
  try {
    runCli(root, ['new', 'br', '--title', 'ブラウザ'], '# 題\n');
    cliResult(root, ['open', 'br', '--no-open'], '', env);
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(fs.existsSync(log), false, '--no-open では、開かない');

    const r = cliResult(root, ['open', 'br'], '', env);
    assert.equal(r.status, 0);
    const url = (JSON.parse(r.stdout) as { url: string }).url;
    for (let i = 0; i < 50 && !fs.existsSync(log); i++) await new Promise((res) => setTimeout(res, 100));
    assert.equal(fs.readFileSync(log, 'utf8').trim(), url, '出力した URL を、開く');
  } finally {
    try {
      runCli(root, ['stop']);
    } catch {
      /* 起動に失敗していても、片付けを続ける */
    }
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(bin, { recursive: true, force: true });
  }
});
