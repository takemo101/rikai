// 変更の通知（GET /api/events）：サーバー（watch.ts・app.ts・serve.ts）。実際に待ち受けて（startServer）、ストリームを読む。
// 別のプロセスの書き込みは、同じ .rikai/ を指す別の Store（と、バンドルした CLI）で作る。
import assert from 'node:assert/strict';
import cp from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { afterEach, beforeEach, describe, test, vi } from 'vitest';
import { createApp, MAX_EVENTS, PING_MS } from '../../src/server/app';
import { startServer } from '../../src/server/serve';
import { createStore, type Store } from '../../src/server/store';
import { createChangeFeed, type FeedOptions } from '../../src/server/watch';
import { changed, isChanged, openEvents, type SseClient, type SseEvent } from './events';
import { makeTopic, type Project, removeProject, runCli, tempProject } from './helpers';
import { PUBLIC_DIR, request } from './http-helpers';

// 条件を待つ上限（`WAIT_MS`）より、テストの制限時間を長くする（既定の 5 秒だと、負荷の下で fs.watch の通知が遅れたとき、待ちの上限に届く前に、制限時間で落ちる）
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });
let p: Project;
let other: Store; // 別のプロセスを模す（同じディレクトリを指す、別の Store）
const cleanups: Array<() => void> = [];
beforeEach(() => {
  p = tempProject();
  makeTopic(p);
  other = createStore(p.dir);
});
afterEach(() => {
  for (const c of cleanups.splice(0).reverse()) c();
  vi.useRealTimers();
  removeProject(p);
});

const touch = (store: Store, slug = 'demo') =>
  store.mutate(slug, (m) => {
    m.title = `${m.title}.`;
  });

/** 数えられる fs.watch（本物を包む）。ウォッチャーの開閉の数を見る */
function spyWatch() {
  const spy = { opened: 0, closed: 0, fn: null as unknown as typeof fs.watch };
  spy.fn = ((...args: Parameters<typeof fs.watch>) => {
    const w = fs.watch(...args);
    spy.opened++;
    const close = w.close.bind(w);
    w.close = () => {
      spy.closed++;
      close();
    };
    return w;
  }) as typeof fs.watch;
  return spy;
}

async function serve(feedOpts?: FeedOptions) {
  const feed = createChangeFeed(p.store, feedOpts);
  const s = await startServer(p.store, p.hooks, PUBLIC_DIR, feed);
  const stop = () => {
    s.server.closeAllConnections();
    s.server.close();
  };
  cleanups.push(stop);
  return { ...s, feed, stop };
}

const authed = (s: { token: string }) => ({ 'x-rikai-token': s.token });
const connect = async (s: { port: number; token: string }): Promise<SseClient> => {
  const c = await openEvents(s.port, authed(s));
  cleanups.push(() => c.close());
  return c;
};
const WAIT_MS = 10_000;
// 条件を待つ（上限は、負荷の下〔全体の並列実行・e2e と同時〕で、fs.watch〔FSEvents〕の通知が遅れても、足りる長さ。早く満たされれば、すぐ返る）
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (cond: () => boolean, ms = WAIT_MS): Promise<void> => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('時間内に満たされませんでした');
    await sleep(10);
  }
};

describe('接続', () => {
  test('text/event-stream・no-store・圧縮なし。つながった直後に ready。切断で購読が解ける', async () => {
    const s = await serve();
    const c = await connect(s);
    assert.equal(c.status, 200);
    assert.match(String(c.headers['content-type']), /^text\/event-stream/);
    assert.equal(c.headers['cache-control'], 'no-store');
    assert.equal(c.headers['content-encoding'], undefined);
    assert.equal(c.headers['x-content-type-options'], 'nosniff');
    assert.ok(await c.waitFor((e) => e.event === 'ready'), 'ready が届く');
    assert.equal(c.events[0]?.event, 'ready', 'ready が最初');
    assert.equal(s.feed.size, 1);
    c.close();
    await until(() => s.feed.size === 0);
  });

  test('認証：合言葉なし・不正な合言葉・不正な Host・不正な Origin は 403（既存の /api/ と同じ文言）。購読は増えない', async () => {
    const s = await serve();
    const get = (headers: Record<string, string>) => request(s.port, 'GET', '/api/events', { headers });
    const noToken = await get({});
    assert.equal(noToken.status, 403);
    assert.equal(noToken.body, '{"ok":false,"error":"合言葉が違います。rikai の URL から開き直してください。"}');
    assert.equal((await get({ 'x-rikai-token': 'x'.repeat(48) })).status, 403);
    const badHost = await get({ ...authed(s), Host: 'evil.example:80' });
    assert.equal(badHost.status, 403);
    assert.match(badHost.body, /ホスト名が違います/);
    const badOrigin = await get({ ...authed(s), Origin: 'http://evil.example' });
    assert.equal(badOrigin.status, 403);
    assert.match(badOrigin.body, /別のページからは操作できません/);
    assert.equal(s.feed.size, 0);
    // Cookie の合言葉でも通る（EventSource は、Cookie を送る）。Origin は、同じオリジンなら通る
    const viaCookie = await openEvents(s.port, {
      Cookie: `rikai_t_${s.port}=${s.token}`,
      Origin: `http://127.0.0.1:${s.port}`,
    });
    cleanups.push(() => viaCookie.close());
    assert.equal(viaCookie.status, 200);
  });

  test('接続数の上限：超えたら 503（既存の JSON の形）。閉じれば、また入れる', async () => {
    vi.useFakeTimers();
    const feed = createChangeFeed(p.store, { watch: null, pollMs: 0 });
    const app = createApp({
      store: p.store,
      token: 'a'.repeat(48),
      port: 4321,
      publicDir: PUBLIC_DIR,
      actions: p.actions,
      feed,
      maxEvents: 2,
    });
    // 切断は、応答の本体の cancel（node-server が、ソケットが閉じたときにすることと同じ）
    const open = (): Promise<Response> =>
      Promise.resolve(
        app.request('http://127.0.0.1:4321/api/events', {
          headers: { Host: '127.0.0.1:4321', 'x-rikai-token': 'a'.repeat(48) },
        }),
      );
    const a = await open();
    const b = await open();
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.equal(feed.size, 2);
    const over = await open();
    assert.equal(over.status, 503);
    assert.deepEqual(await over.json(), { ok: false, error: '接続が多すぎます' });
    assert.equal(feed.size, 2, '断った接続は、購読にならない');
    await a.body?.cancel();
    await vi.advanceTimersByTimeAsync(10);
    assert.equal(feed.size, 1);
    const c = await open();
    assert.equal(c.status, 200);
    await b.body?.cancel();
    await c.body?.cancel();
    await vi.advanceTimersByTimeAsync(10);
    assert.equal(feed.size, 0);
    assert.equal(vi.getTimerCount(), 0, 'ping・確認のタイマーが、残らない');
    assert.equal(MAX_EVENTS, 20);
  });
});

// 検知の経路：fs.watch・確認の間隔（stat）。どちらか 1 つでも動けば届く。両方なければ、届かない
const PATHS: Array<[string, FeedOptions, boolean]> = [
  ['fs.watch と確認の両方', { pollMs: 100 }, true],
  ['fs.watch だけ（確認なし）', { pollMs: 0 }, true],
  ['確認だけ（fs.watch なし）', { watch: null, pollMs: 100 }, true],
  [
    '確認だけ（fs.watch が起動で失敗）',
    {
      watch: () => {
        throw new Error('ENOSPC');
      },
      pollMs: 100,
    },
    true,
  ],
  ['どちらもなし', { watch: null, pollMs: 0 }, false],
];

describe.each(PATHS)('別の Store の mutate → changed：%s', (_name, feedOpts, delivered) => {
  test(delivered ? 'changed（slug・rev）が届く' : '届かない（検知の経路がない）', async () => {
    const s = await serve(feedOpts);
    const c = await connect(s);
    await c.waitFor((e) => e.event === 'ready');
    const before = p.store.loadMeta('demo').rev;
    if (!delivered) {
      touch(other);
      assert.equal(await c.waitFor(isChanged, 700), null);
      return;
    }
    // fs.watch（macOS の FSEvents）は、購読のあと、非同期で始まる：`ready` の直後の書き込みは、負荷が高いと、見逃される（確認の間隔がないとき）。届くまで、書き直す
    let hit: SseEvent | null = null;
    let touches = 0;
    while (!hit && touches < 5) {
      touch(other);
      touches++;
      hit = await c.waitFor(isChanged, WAIT_MS / 5);
    }
    const got = JSON.parse(hit?.data ?? 'null') as { slug: string; rev: number };
    assert.equal(got.slug, 'demo');
    assert.ok(got.rev > before && got.rev <= before + touches, `rev ${got.rev}（書き込み ${touches} 回）`);
  });
});

describe('検知', () => {
  test('バンドルした CLI（別のプロセス）の apply が、届く', async () => {
    const s = await serve();
    const c = await connect(s);
    await c.waitFor((e) => e.event === 'ready');
    const id = p.actions.comment({
      topic: 'demo',
      page: 'root',
      version: 1,
      anchor: null,
      text: '質問です',
    }).thread;
    p.actions.submit({ topic: 'demo' });
    await c.waitFor(isChanged); // 自分の操作の通知
    const n = c.events.filter(isChanged).length;
    runCli(p.dir, ['apply', 'demo'], JSON.stringify({ replies: [{ thread: id, body: '返信' }] }));
    const rev = p.store.loadMeta('demo').rev;
    assert.ok(await c.waitFor((e) => isChanged(e) && JSON.parse(e.data).rev === rev), 'apply の rev が届く');
    assert.ok(c.events.filter(isChanged).length > n);
  });

  test('同じ rev は、二重に送らない（書き込みのない間は、何も来ない）', async () => {
    const s = await serve({ pollMs: 50 });
    const c = await connect(s);
    await c.waitFor((e) => e.event === 'ready');
    touch(other);
    await c.waitFor(isChanged);
    assert.equal(await c.quiet(500), null, 'fs.watch の通知と確認が重なっても、1 回だけ');
    assert.equal(changed(c).length, 1);
    touch(other);
    await c.waitFor((e) => isChanged(e) && changed(c).length === 2);
    assert.equal(await c.quiet(300), null);
  });

  test('トピックの新規・閉じる・消える', async () => {
    const s = await serve({ pollMs: 50 });
    const c = await connect(s);
    await c.waitFor((e) => e.event === 'ready');
    // 新規：一覧の変化。作る側は別の Store
    other.newTopic('second', '2 つめ', '試験', '# 2\n');
    assert.ok(await c.waitFor((e) => e.data === '{"topics":true}'), '新規 → topics');
    // 閉じる：rev が進む
    const t = c.events.length;
    other.mutate('demo', (m) => {
      m.closed = true;
    });
    const rev = p.store.loadMeta('demo').rev;
    assert.ok(await c.waitFor((e) => e.data === JSON.stringify({ slug: 'demo', rev })), '閉じる → slug・rev');
    assert.ok(c.events.length > t);
    // 消える
    const n = changed(c).filter((e) => 'topics' in (e as object)).length;
    fs.rmSync(other.tdir('second'), { recursive: true, force: true });
    await until(() => changed(c).filter((e) => 'topics' in (e as object)).length === n + 1);
  });

  test('巨大な数の変更は、まとめる（最後の rev が届き、通知は、変更の数よりずっと少ない）', async () => {
    const s = await serve();
    const c = await connect(s);
    await c.waitFor((e) => e.event === 'ready');
    for (let i = 0; i < 500; i++) touch(other);
    const rev = p.store.loadMeta('demo').rev;
    assert.ok(await c.waitFor((e) => isChanged(e) && JSON.parse(e.data).rev === rev, WAIT_MS), '最後の rev が届く');
    await c.quiet(300);
    const n = changed(c).length;
    assert.ok(n <= 10, `通知は ${n} 回（500 回の変更を、まとめた）`);
    // 通知の rev は、増える一方（古い rev が、あとから来ない）
    const revs = (changed(c) as Array<{ rev: number }>).map((e) => e.rev);
    assert.deepEqual(
      revs,
      [...revs].sort((a, b) => a - b),
    );
  });

  test('続けて起きる変更は、まとめる（30ms のまとめ。書き込みの数ではなく、時間で、通知の数が決まる）', async () => {
    // fs.watch の通知は、書き込みのたびに、こちらで起こす（本物の fs.watch は、OS が、自分でまとめることがある）
    let fire: () => void = () => {};
    const fake = ((_dir: string, _opts: unknown, cb: () => void) => {
      fire = cb;
      return { close() {}, on() {} };
    }) as unknown as typeof fs.watch;
    const s = await serve({ watch: fake, pollMs: 0 });
    const c = await connect(s);
    await c.waitFor((e) => e.event === 'ready');
    const t0 = Date.now();
    for (let i = 0; i < 100; i++) {
      touch(other);
      fire();
      await sleep(2);
    }
    const elapsed = Date.now() - t0;
    const rev = p.store.loadMeta('demo').rev;
    assert.ok(await c.waitFor((e) => isChanged(e) && JSON.parse(e.data).rev === rev), '最後の rev が届く');
    const n = changed(c).length;
    assert.ok(n >= 2 && n <= elapsed / 30 + 3, `100 回の書き込みが、${elapsed}ms の間に、通知 ${n} 回`);
  });

  test('1 回の確認の間に、トピックが 1 つ消えて 1 つ増えても（数は同じ）、一覧の変化を通知する', async () => {
    let fire: () => void = () => {};
    const fake = ((_dir: string, _opts: unknown, cb: () => void) => {
      fire = cb;
      return { close() {}, on() {} };
    }) as unknown as typeof fs.watch;
    const s = await serve({ watch: fake, pollMs: 0 });
    const c = await connect(s);
    await c.waitFor((e) => e.event === 'ready');
    fs.rmSync(other.tdir('demo'), { recursive: true, force: true });
    other.newTopic('second', '2 つめ', '試験', '# 2\n');
    fire(); // 1 回の調べで、demo が消え、second が増える
    assert.ok(await c.waitFor((e) => e.data === '{"topics":true}'));
  });

  test('fs.watch の error：サーバーは落ちず、ウォッチャーを閉じて、確認だけで続ける', async () => {
    const w = Object.assign(new EventEmitter(), {
      closed: 0,
      close() {
        this.closed++;
      },
    });
    const fake = (() => w) as unknown as typeof fs.watch;
    const s = await serve({ watch: fake, pollMs: 50 });
    const c = await connect(s);
    await c.waitFor((e) => e.event === 'ready');
    w.emit('error', Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' })); // リスナーがなければ、プロセスが落ちる
    assert.equal(w.closed, 1);
    const rev = p.store.loadMeta('demo').rev;
    touch(other);
    assert.ok(await c.waitFor((e) => isChanged(e) && JSON.parse(e.data).rev === rev + 1), '確認が、続ける');
  });

  test('購読した時点より前の変更は、通知しない（ready のあとの変化だけ）', async () => {
    touch(other);
    const s = await serve({ pollMs: 50 });
    const c = await connect(s);
    await c.waitFor((e) => e.event === 'ready');
    assert.equal(await c.quiet(300), null);
  });

  test('複数の購読者に、それぞれ届く', async () => {
    const s = await serve();
    const [a, b] = [await connect(s), await connect(s)];
    await Promise.all([a, b].map((c) => c.waitFor((e) => e.event === 'ready')));
    touch(other);
    assert.ok(await a.waitFor(isChanged));
    assert.ok(await b.waitFor(isChanged));
  });
});

describe('後始末', () => {
  test('切断で、ウォッチャー・タイマーが解ける（購読が 0 に戻る）。接続を繰り返しても、増えない', async () => {
    const spy = spyWatch();
    const s = await serve({ watch: spy.fn, pollMs: 50 });
    for (let i = 0; i < 20; i++) {
      const c = await openEvents(s.port, authed(s));
      await c.waitFor((e) => e.event === 'ready');
      c.close();
    }
    await until(() => s.feed.size === 0);
    assert.ok(spy.opened >= 1);
    assert.equal(spy.opened, spy.closed, 'ウォッチャーは、開いた数だけ閉じる');
    // 0 人になったら、確認も止まる：.rikai/ を変えても、何も読まない（再接続すれば、新しい基準から）
    touch(other);
    const c = await connect(s);
    await c.waitFor((e) => e.event === 'ready');
    assert.equal(await c.quiet(300), null, '切れている間の変更は、通知しない（再接続の ready で、画面が取り直す）');
  });

  test('接続が 1 つでもある間は、ウォッチャーは 1 つだけ（接続ごとに増えない）', async () => {
    const spy = spyWatch();
    const s = await serve({ watch: spy.fn, pollMs: 0 });
    const cs = [await connect(s), await connect(s), await connect(s)];
    assert.equal(spy.opened, 1);
    for (const c of cs) c.close();
    await until(() => s.feed.size === 0);
    assert.equal(spy.closed, 1);
  });

  test('サーバーを止めると、全部の接続が閉じ、購読・ウォッチャーが解ける', async () => {
    const spy = spyWatch();
    const s = await serve({ watch: spy.fn, pollMs: 50 });
    const cs = [await connect(s), await connect(s)];
    await Promise.all(cs.map((c) => c.waitFor((e) => e.event === 'ready')));
    s.stop();
    await Promise.all(cs.map((c) => c.ended));
    assert.equal(s.feed.size, 0);
    assert.equal(spy.opened, spy.closed);
  });
});

test('rikai stop：サーバーのプロセスが終わり、通知の接続も閉じる（実際の serve を、子プロセスで）', async () => {
  const cli = process.env.RIKAI_CLI as string;
  const child = cp.spawn('node', [cli, 'serve', '--root', p.dir], { stdio: 'ignore' });
  cleanups.push(() => child.kill('SIGKILL'));
  const exited = new Promise<void>((r) => child.on('exit', () => r()));
  let info: { port: number; token: string } | null = null;
  await until(() => {
    try {
      info = JSON.parse(fs.readFileSync(p.store.serverFile(), 'utf8'));
    } catch {}
    return info !== null;
  }, 10_000);
  const { port, token } = info as unknown as { port: number; token: string };
  const c = await openEvents(port, { 'x-rikai-token': token });
  cleanups.push(() => c.close());
  assert.ok(await c.waitFor((e) => e.event === 'ready'));
  runCli(p.dir, ['stop']);
  await Promise.all([c.ended, exited]);
});

describe('ping・タイマー（偽のタイマー。ポートを開かない）', () => {
  const TOKEN = 'a'.repeat(48);
  const read = async (reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> => {
    const r = await reader.read();
    return new TextDecoder().decode(r.value);
  };

  test('15 秒ごとに `: ping`。切断で、ping・確認・まとめのタイマーが、全部解ける（200 回つないでも）', async () => {
    vi.useFakeTimers();
    const spy = spyWatch();
    const feed = createChangeFeed(p.store, { watch: spy.fn, pollMs: 300 });
    const app = createApp({
      store: p.store,
      token: TOKEN,
      port: 4321,
      publicDir: PUBLIC_DIR,
      actions: p.actions,
      feed,
    });
    const open = async () => {
      const res = await app.request('http://127.0.0.1:4321/api/events', {
        headers: { Host: '127.0.0.1:4321', 'x-rikai-token': TOKEN },
      });
      assert.equal(res.status, 200);
      const reader = (res.body as ReadableStream<Uint8Array>).getReader();
      assert.match(await read(reader), /^event: ready\ndata: \{\}\n\n$/);
      return reader;
    };

    const reader = await open();
    const ping = read(reader);
    await vi.advanceTimersByTimeAsync(PING_MS - 1);
    // まだ ping は来ていない（確認の間隔・まとめの時間のあいだに、何も変わらないので、ほかのデータもない）
    let got = false;
    void ping.then(() => {
      got = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    assert.equal(got, false);
    await vi.advanceTimersByTimeAsync(1);
    assert.equal(await ping, ': ping\n\n');
    await reader.cancel();
    await vi.advanceTimersByTimeAsync(10);
    assert.equal(feed.size, 0);
    assert.equal(vi.getTimerCount(), 0);
    assert.equal(spy.opened, spy.closed);

    // つないで切る、を 200 回
    for (let i = 0; i < 200; i++) {
      await (await open()).cancel();
      await vi.advanceTimersByTimeAsync(1);
    }
    assert.equal(feed.size, 0);
    assert.equal(vi.getTimerCount(), 0, 'タイマーが、増えていない');
    assert.equal(spy.opened, spy.closed, 'ウォッチャーが、増えていない');
    assert.equal(spy.opened, 201);
  });
});
