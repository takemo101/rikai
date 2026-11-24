// CLI（バンドルした 1 ファイル）を、子プロセスで動かして確かめる。実際にサーバーを起こす（127.0.0.1 の空きポートだけ）。
// 旧 server.test.js のうち、CLI を使う 2 つ。HTTP だけを試すものは、server.test.ts にある。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';
import { COMMAND_NAMES, infoReply, topHelp } from '../../src/cli/help';
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

// 意図した変更（0.1.4・F54）：旧「すべて閉じたら、800ms で自分で終わる」は、やめた（終了したトピックを、閲覧できる）。
// いまは、すべて閉じて、かつ待ちの間（既定 10 分。試験では RIKAI_IDLE_MS で短く）リクエストがないときに、終わる。
const IDLE_MS = 1500;
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const waitDead = async (pid: number, ms: number) => {
  for (let i = 0; i < ms / 100 && alive(pid); i++) await new Promise((r) => setTimeout(r, 100));
  return !alive(pid);
};
const idleEnv = { NO_OPEN: '1', RIKAI_IDLE_MS: String(IDLE_MS) };
const serverInfo = (root: string) =>
  JSON.parse(fs.readFileSync(path.join(root, '.rikai', '.server.json'), 'utf8')) as ServerInfo;
const post = (info: ServerInfo, name: string, topic: string) =>
  fetch(`http://127.0.0.1:${info.port}/api/${name}`, {
    method: 'POST',
    headers: { 'x-rikai-token': info.token, 'content-type': 'application/json' },
    body: JSON.stringify({ topic }),
  });
const killServer = (root: string, pid: number) => {
  if (pid && alive(pid)) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      /* すでに終わっている */
    }
  }
  fs.rmSync(root, { recursive: true, force: true });
};

test('rikai serve：すべて閉じても、すぐには終わらない（閲覧できる）。リクエストがあれば延びる。待ちの間、リクエストがなければ、終わる', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rikai-exit-'));
  const run = (...args: string[]) => runCli(root, args, '# 題\n');
  let pid = 0;
  try {
    run('new', 'one', '--title', '一');
    run('new', 'two', '--title', '二');
    assert.equal(cliResult(root, ['open', 'one', '--no-open'], '', idleEnv).status, 0);
    const info = serverInfo(root);
    pid = info.pid;
    assert.equal((await post(info, 'end', 'one')).status, 200);
    await new Promise((r) => setTimeout(r, 1000));
    assert.equal(alive(pid), true, 'まだ開いているトピック（two）があるので、終わらない');
    assert.equal((await post(info, 'end', 'two')).status, 200);
    // すべて閉じた：旧は 800ms で終わった。いまは、リクエストが続く間、生きている（閲覧できる）
    for (let i = 0; i < 4; i++) {
      await new Promise((r) => setTimeout(r, 700));
      assert.equal(
        (await fetch(`http://127.0.0.1:${info.port}/api/topic/one`, { headers: { 'x-rikai-token': info.token } }))
          .status,
        200,
      );
      assert.equal(alive(pid), true, `閉じたあとも、閲覧できる（${i + 1} 回目）`);
    }
    assert.equal(await waitDead(pid, 6000), true, 'リクエストが止まって、待ちが過ぎると、サーバーのプロセスが終わる');
    assert.equal(fs.existsSync(path.join(root, '.rikai', '.server.json')), false, '.server.json も消える');
  } finally {
    killServer(root, pid);
  }
}, 40_000);

test('rikai serve：待っている間に、開いているトピックができたら、終わらない（待ちが解ける）。また、すべて閉じると、待ちが始まる', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rikai-exit-'));
  const run = (...args: string[]) => runCli(root, args, '# 題\n');
  let pid = 0;
  try {
    run('new', 'one', '--title', '一');
    assert.equal(cliResult(root, ['open', 'one', '--no-open'], '', idleEnv).status, 0);
    const info = serverInfo(root);
    pid = info.pid;
    assert.equal((await post(info, 'end', 'one')).status, 200);
    run('new', 'three', '--title', '三'); // 開いているトピックができた
    assert.equal(cliResult(root, ['open', 'three', '--no-open'], '', idleEnv).status, 0);
    await new Promise((r) => setTimeout(r, IDLE_MS * 3));
    assert.equal(alive(pid), true, '開いているトピックがある間は、待ちが過ぎても終わらない');
    assert.equal((await post(info, 'end', 'three')).status, 200);
    assert.equal(await waitDead(pid, 6000), true, 'すべて閉じて、リクエストがなければ、終わる');
  } finally {
    killServer(root, pid);
  }
}, 40_000);

test('rikai serve：閉じたトピックだけで起動して（open --view）、誰も来なくても、ゾンビにならない（待ちが過ぎると終わる）', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rikai-exit-'));
  const run = (...args: string[]) => runCli(root, args, '# 題\n');
  let pid = 0;
  try {
    run('new', 'one', '--title', '一');
    run('open', 'one', '--no-open');
    pid = serverInfo(root).pid;
    run('stop'); // いったん止めて、閉じた状態で起動し直す
    await waitDead(pid, 3000);
    const meta = JSON.parse(fs.readFileSync(path.join(root, '.rikai', 'one', 'meta.json'), 'utf8'));
    meta.closed = true;
    fs.writeFileSync(path.join(root, '.rikai', 'one', 'meta.json'), JSON.stringify(meta));
    assert.equal(cliResult(root, ['open', 'one', '--view', '--no-open'], '', idleEnv).status, 0);
    pid = serverInfo(root).pid;
    assert.equal(await waitDead(pid, 8000), true);
  } finally {
    killServer(root, pid);
  }
}, 40_000);

test('open --view：終了したトピックを、開き直さずに見る（closed は変わらない）。--view なしの open は、これまでどおり開き直す', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rikai-view-'));
  const run = (...args: string[]) => runCli(root, args, '# 題\n');
  const closedOf = () => JSON.parse(fs.readFileSync(path.join(root, '.rikai', 'one', 'meta.json'), 'utf8')).closed;
  let pid = 0;
  try {
    run('new', 'one', '--title', '一');
    const plain = JSON.parse(run('open', 'one', '--no-open')) as Record<string, unknown>;
    const info = serverInfo(root);
    pid = info.pid;
    assert.equal((await post(info, 'end', 'one')).status, 200);
    assert.equal(closedOf(), true);
    assert.equal(JSON.parse(run('poll', 'one', '--timeout', '1')).status, 'closed');

    const viewed = JSON.parse(run('open', 'one', '--view', '--no-open')) as Record<string, unknown>;
    assert.equal(closedOf(), true, '--view は、終了のまま');
    assert.deepEqual(Object.keys(viewed), Object.keys(plain), '出力の形は、これまでと同じ');
    assert.match(viewed.url as string, /^http:\/\/127\.0\.0\.1:\d+\/\?t=[0-9a-f]+#\/one\/root$/);
    assert.equal(JSON.parse(run('poll', 'one', '--timeout', '1')).status, 'closed', 'AI から見ても、終了のまま');
    const topic = await fetch(`http://127.0.0.1:${info.port}/api/topic/one`, {
      headers: { 'x-rikai-token': info.token },
    });
    assert.equal(((await topic.json()) as { meta: { closed: boolean } }).meta.closed, true);

    run('open', 'one', '--no-open'); // フラグなし：開き直す
    assert.equal(closedOf(), false);
    run('open', 'one', '--view', '--no-open'); // 開いているトピックに付けても、開くだけ
    assert.equal(closedOf(), false);
    // 存在しないトピックは、失敗（--view でも）
    const r = cliResult(root, ['open', 'nothing', '--view', '--no-open']);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /トピックがありません/);
  } finally {
    killServer(root, pid);
  }
}, 40_000);

// ---- 追加：移植で足した検査（CLI の入口：引数・出力・終了コード。サーバーを起こさない部分） ----

// ---- ヘルプ・バージョン：ストアを作らない（プロジェクトに、何も書かない）・終了コード・標準出力と標準エラー ----

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const pkgVersion = (JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as { version: string })
  .version;
const ESC = '\u001b';

/** 空のディレクトリで、cliResult を流し、終わったら、`.rikai` が、できていないことを確かめる */
function inEmptyProject<T>(fn: (root: string) => T): T {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rikai-info-'));
  try {
    const r = fn(root);
    assert.deepEqual(
      fs.readdirSync(root),
      [],
      'ヘルプ・バージョン・未知のコマンドで、プロジェクトに、何も作らない（.rikai も）',
    );
    return r;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('--version・-v・version は、「rikai <package.json の version>」の 1 行だけを出して、終了コード 0。プロジェクトに何も作らない', () => {
  assert.match(pkgVersion, /^\d+\.\d+\.\d+/);
  inEmptyProject((root) => {
    for (const args of [['--version'], ['-v'], ['version'], ['version', '--root', root], ['--version', 'poll']]) {
      const r = cliResult(root, args);
      assert.equal(r.status, 0, args.join(' '));
      assert.equal(r.stdout, `rikai ${pkgVersion}\n`, args.join(' '));
      assert.equal(r.stderr, '');
    }
  });
});

test('--help・-h・help・引数なしは、全体のヘルプを標準出力に出して、終了コード 0。パイプでは、色（ANSI）がなく、プロジェクトに何も作らない', () => {
  inEmptyProject((root) => {
    const outputs = [['--help'], ['-h'], ['help'], [], ['help', 'help']].map((args) => {
      const r = cliResult(root, args);
      assert.equal(r.status, 0, args.join(' '));
      assert.equal(r.stderr, '');
      assert.ok(!r.stdout.includes(ESC), 'パイプ（端末でない）では、色を付けない');
      return r.stdout;
    });
    for (const o of outputs) assert.equal(o, outputs[0]);
    const text = outputs[0] as string;
    assert.match(
      text,
      /^rikai — 資料にコメントして AI と理解を深めるツール\n\n使い方: rikai <コマンド> \[オプション\]\n/,
    );
    for (const name of COMMAND_NAMES.filter((n) => n !== 'serve')) assert.match(text, new RegExp(`^  ${name}\\b`, 'm'));
    for (const flag of ['--root', '--title', '--source', '--no-open', '--view', '--timeout', '--help', '--version'])
      assert.ok(text.includes(flag), `${flag} が、オプションの一覧にない`);
    assert.ok(text.includes('43200'), '--timeout の既定（43200 秒＝12 時間）');
    assert.match(text, /rikai <コマンド> --help/);
    assert.match(text, /https:\/\/github\.com\/takemo101\/rikai/);
    assert.doesNotMatch(text, /Submit/, '画面の名前は「AI に送る」');
  });
});

test('コマンドごとのヘルプ：`<コマンド> --help`・`-h`・`help <コマンド>` が同じで、使い方・オプション・出力・例がある', () => {
  inEmptyProject((root) => {
    for (const name of COMMAND_NAMES) {
      const a = cliResult(root, [name, '--help']);
      assert.equal(a.status, 0, name);
      assert.equal(a.stderr, '');
      assert.equal(cliResult(root, [name, '-h']).stdout, a.stdout);
      assert.equal(cliResult(root, ['help', name]).stdout, a.stdout);
      assert.equal(cliResult(root, ['--help', name]).stdout, a.stdout);
      assert.match(a.stdout, new RegExp(`^rikai ${name} — `), name);
      assert.match(a.stdout, new RegExp(`^使い方: rikai ${name}\\b`, 'm'), name);
      for (const h of ['オプション', '出力']) assert.match(a.stdout, new RegExp(`^${h}$`, 'm'), `${name}: ${h}`);
      if (name !== 'serve') assert.match(a.stdout, /^例$/m, name);
    }
    // 入力は、標準入力を読むコマンドだけ（待たずに、ヘルプが出る：標準入力は空のまま）
    for (const name of ['new', 'apply']) assert.match(cliResult(root, [name, '--help']).stdout, /^入力$/m, name);
    // 実際の挙動と同じ数値・名前
    const poll = cliResult(root, ['poll', '--help']).stdout;
    assert.match(poll, /--timeout <秒>.*43200 ＝ 12 時間/);
    for (const s of ['feedback', 'closed', 'timeout']) assert.ok(poll.includes(s), `poll の出力の status: ${s}`);
    assert.match(cliResult(root, ['pull', '--help']).stdout, /"none"/);
    const open = cliResult(root, ['open', '--help']).stdout;
    assert.match(open, /--no-open/);
    assert.match(open, /使い方: rikai open <topic> \[--view\] \[--no-open\]/);
    assert.match(open, /--view .*終了したトピックを、開き直さずに/);
  });
});

test('未知のコマンドは、「未知のコマンド: xxx」とヘルプを標準エラーに出して、終了コード 1（標準出力は空。--help を付けても、help の対象でも同じ）', () => {
  inEmptyProject((root) => {
    for (const args of [
      ['nothing'],
      ['nothing', '--help'],
      ['help', 'nothing'],
      ['--version', 'nothing'],
      ['submit'],
    ]) {
      const r = cliResult(root, args);
      assert.equal(r.status, 1, args.join(' '));
      assert.equal(r.stdout, '', args.join(' '));
      assert.match(
        r.stderr,
        new RegExp(`^未知のコマンド: ${args.find((a) => !a.startsWith('-') && a !== 'help')}\\n\\nrikai — `),
        args.join(' '),
      );
      assert.match(r.stderr, /使い方: rikai <コマンド> \[オプション\]/);
      assert.ok(!r.stderr.includes(ESC));
    }
  });
});

test('ヘルプの一覧は、main.ts が実際に振り分けるコマンドと、読むオプションに、一致する（足し忘れ・消し忘れで、食い違わない）', () => {
  const read = (...p: string[]) => fs.readFileSync(path.join(repoRoot, 'app', 'src', ...p), 'utf8');
  const main = read('cli', 'main.ts');
  const dispatched = [...main.matchAll(/^ {6}case '(\w+)':/gm)].map((m) => m[1]).sort();
  assert.deepEqual([...COMMAND_NAMES].sort(), dispatched, 'help.ts の COMMANDS と、main.ts の switch の case');
  // コードが読む --オプション（flags.名前・flags['名前']）：すべて、ヘルプの一覧に載っている
  const flagsRead = new Set<string>();
  for (const f of [main, read('cli', 'args.ts'), read('server', 'agent.ts')])
    for (const m of f.matchAll(/flags(?:\.(\w+)|\['([\w-]+)'\])/g)) flagsRead.add((m[1] ?? m[2]) as string);
  assert.ok(
    ['root', 'title', 'source', 'no-open', 'view', 'timeout'].every((k) => flagsRead.has(k)),
    [...flagsRead].join(),
  );
  const top = topHelp(false);
  for (const k of flagsRead) assert.ok(top.includes(`--${k}`), `--${k} を、コードは読むが、ヘルプにない`);
});

test('色（ANSI）は、端末への出力のときだけ（topHelp・infoReply の style）。見出しは太字・コマンド名は色。外すと、完全なプレーンテキスト', () => {
  const plain = topHelp(false);
  const colored = topHelp(true);
  assert.ok(!plain.includes(ESC));
  assert.ok(colored.includes(`${ESC}[1m使い方:`));
  assert.ok(colored.includes(`${ESC}[36mnew <topic>`));
  assert.equal(colored.replace(new RegExp(`${ESC}\\[[0-9;]*m`, 'g'), ''), plain, '色の違いだけ：文字は、同じ');
  assert.ok(infoReply([], { help: true }, { stdout: true, stderr: false })?.stdout?.includes(ESC));
  assert.ok(
    !infoReply(['x'], {}, { stdout: true, stderr: false })?.stderr?.includes(ESC),
    'エラーは、標準エラーが端末のときだけ',
  );
  assert.ok(infoReply(['x'], {}, { stdout: false, stderr: true })?.stderr?.includes(ESC));
  assert.equal(infoReply(['poll', 'demo'], {}, { stdout: true, stderr: true }), null, 'コマンドは、そのまま実行する');
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
