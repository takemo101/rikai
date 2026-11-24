// 終了したトピックは、閲覧専用（F54）：書き込みの操作（comment・reply・answer・edit・delete・resolve・submit・attach）は、すべて 409 で断る（何も書かない）。
// 読み取り・もう一度の end は通る。開き直すと（meta.closed = false）、また書ける。サーバーの寿命（すべて閉じて、リクエストがない間だけ終わる）は、下の createIdleWatch。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { createIdleWatch } from '../../src/server/serve';
import { addComment, httpError, makeTopic, type Project, removeProject, tempProject } from './helpers';
import { request, startTestServer } from './http-helpers';

let p: Project;
beforeEach(() => {
  p = tempProject();
  makeTopic(p);
});
afterEach(() => {
  vi.useRealTimers();
  removeProject(p);
});

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(24, 1),
]).toString('base64');

/** 質問つきのスレッドと、未送信の自分のコメントがあるトピックにして、終了する。スレッド ID・メッセージ ID を返す */
function prepareThenEnd(): { tid: string; mid: string; qid: string } {
  const tid = addComment(p);
  const th = p.store.loadThreads('demo');
  th.threads[0]?.messages.push({
    id: 'q1',
    author: 'ai',
    kind: 'reply',
    at: 'x',
    text: '質問',
    sent: true,
    ask: { type: 'yes_no', question: 'q' },
  });
  th.seq = 9;
  p.store.saveThreads('demo', th);
  const mid = th.threads[0]?.messages[0]?.id as string;
  p.actions.end({ topic: 'demo' });
  return { tid, mid, qid: 'q1' };
}

const snapshot = () => ({
  threads: fs.readFileSync(`${p.dir}/.rikai/demo/threads.json`, 'utf8'),
  meta: fs.readFileSync(`${p.dir}/.rikai/demo/meta.json`, 'utf8'),
});

test('終了したトピックへの書き込みは、すべて 409 で断る。何も書かない（threads.json・meta.json は、そのまま）', () => {
  const { tid, mid, qid } = prepareThenEnd();
  const before = snapshot();
  const topic = 'demo';
  const refused = [
    () => p.actions.comment({ topic, page: 'root', version: 1, anchor: null, text: 'x' }),
    () => p.actions.reply({ topic, thread: tid, text: 'x' }),
    () => p.actions.answer({ topic, thread: tid, msg: qid, answer: { value: true } }),
    () => p.actions.edit({ topic, thread: tid, msg: mid, text: 'y' }),
    () => p.actions.delete({ topic, thread: tid, msg: mid }),
    () => p.actions.resolve({ topic, thread: tid, resolved: true }),
    () => p.actions.submit({ topic }),
    () => p.actions.attach({ topic, data: PNG }),
  ];
  for (const f of refused) assert.throws(f, httpError(409, /終了しています/), f.toString());
  assert.deepEqual(snapshot(), before);
  assert.equal(fs.existsSync(`${p.dir}/.rikai/demo/assets`) && fs.readdirSync(`${p.dir}/.rikai/demo/assets`).length, 0);
});

test('終了したトピック：もう一度の end は、エラーにしない。読み取りは通る。poll は closed のまま', () => {
  prepareThenEnd();
  assert.deepEqual(p.actions.end({ topic: 'demo' }), {});
  assert.equal(p.store.topicState('demo').meta.closed, true);
  assert.equal(p.store.topicState('demo').threads.length, 1);
  assert.equal(p.agent.peek('demo').status, 'closed');
});

test('開き直す（meta.closed を false に）と、また書ける。未送信は、残っている', () => {
  const { tid } = prepareThenEnd();
  p.store.mutate('demo', (m) => {
    m.closed = false;
    return {};
  });
  p.actions.reply({ topic: 'demo', thread: tid, text: '続き' });
  assert.equal(p.store.topicState('demo').unsent, 2);
});

test('HTTP：終了したトピックへの POST は、409（{ ok: false, error }）。読み取りは 200', async () => {
  const { tid } = prepareThenEnd();
  const s = await startTestServer(p);
  try {
    const headers = { 'x-rikai-token': s.token, 'content-type': 'application/json' };
    const post = (name: string, body: object) => request(s.port, 'POST', `/api/${name}`, { headers, body });
    for (const [name, body] of [
      ['comment', { topic: 'demo', page: 'root', version: 1, anchor: null, text: 'x' }],
      ['reply', { topic: 'demo', thread: tid, text: 'x' }],
      ['resolve', { topic: 'demo', thread: tid, resolved: true }],
      ['submit', { topic: 'demo' }],
      ['attach', { topic: 'demo', data: PNG }],
    ] as const) {
      const r = await post(name, body);
      assert.equal(r.status, 409, name);
      assert.match(JSON.parse(r.body).error, /終了しています/, name);
    }
    assert.equal((await post('end', { topic: 'demo' })).status, 200);
    const get = await request(s.port, 'GET', '/api/topic/demo', { headers });
    assert.equal(get.status, 200);
    assert.equal(JSON.parse(get.body).meta.closed, true);
  } finally {
    s.close();
  }
});

// ---- サーバーの寿命：すべて閉じて、かつ待ちの間リクエストがないときだけ終わる ----

function watch(state: { closed: boolean; busy: boolean }, ms = 1000) {
  const onIdle = vi.fn();
  const w = createIdleWatch({ ms, allClosed: () => state.closed, busy: () => state.busy, onIdle });
  return { w, onIdle };
}

test('寿命：すべて閉じて、待ちの間、リクエストがなければ、終わる（すぐには終わらない）', () => {
  vi.useFakeTimers();
  const { w, onIdle } = watch({ closed: true, busy: false });
  w.touch();
  vi.advanceTimersByTime(999);
  assert.equal(onIdle.mock.calls.length, 0, '待ちの間は、終わらない（旧：800ms で終わった）');
  vi.advanceTimersByTime(2);
  assert.equal(onIdle.mock.calls.length, 1);
});

test('寿命：リクエストがあるたびに、待ちが延びる', () => {
  vi.useFakeTimers();
  const { w, onIdle } = watch({ closed: true, busy: false });
  w.touch();
  for (let i = 0; i < 5; i++) {
    vi.advanceTimersByTime(800);
    w.touch();
  }
  assert.equal(onIdle.mock.calls.length, 0);
  vi.advanceTimersByTime(1001);
  assert.equal(onIdle.mock.calls.length, 1);
});

test('寿命：開いているトピックがあれば、終わらない。開いているトピックができる（`new`・`open`）と、待ちは解ける', () => {
  vi.useFakeTimers();
  const state = { closed: true, busy: false };
  const { w, onIdle } = watch(state);
  w.touch();
  vi.advanceTimersByTime(500);
  state.closed = false; // 待っている間に、開いているトピックができた
  vi.advanceTimersByTime(5000);
  assert.equal(onIdle.mock.calls.length, 0);
  assert.equal(vi.getTimerCount(), 0, '待ちは解けて、タイマーは残らない（次のリクエストで、また始まる）');
  state.closed = true; // また、すべて閉じた：`end` が、待ちを始める
  w.touch();
  vi.advanceTimersByTime(1001);
  assert.equal(onIdle.mock.calls.length, 1);
});

test('寿命：開いているタブ（変更の通知の購読）がある間は、終わらない。閉じると、終わる', () => {
  vi.useFakeTimers();
  const state = { closed: true, busy: true };
  const { w, onIdle } = watch(state);
  w.touch();
  vi.advanceTimersByTime(10_000);
  assert.equal(onIdle.mock.calls.length, 0);
  state.busy = false;
  vi.advanceTimersByTime(1001);
  assert.equal(onIdle.mock.calls.length, 1);
});

test('寿命：stop で待ちを解く。タイマーは unref（これだけで、プロセスを生かさない）', () => {
  const onIdle = vi.fn();
  const w = createIdleWatch({ ms: 60_000, allClosed: () => true, busy: () => false, onIdle });
  w.touch();
  w.stop();
  w.stop();
  assert.equal(onIdle.mock.calls.length, 0);
  // unref の確認：実際のタイマーを作って、参照が外れていること
  const w2 = createIdleWatch({ ms: 60_000, allClosed: () => true, busy: () => false, onIdle });
  const spy = vi.spyOn(globalThis, 'setTimeout');
  w2.touch();
  const t = spy.mock.results[0]?.value as NodeJS.Timeout;
  assert.equal(t.hasRef(), false);
  spy.mockRestore();
  w2.stop();
});
