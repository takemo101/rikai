// 一覧の API（/api/topics）の `fresh`（F46）：ほかのトピックの新着の判定に使う ID。省略できる項目（古い画面は、無視する）・閉じたトピックには付けない・上限・走査の使い回し
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, test } from 'vitest';
import { makeTopic, type Project, removeProject, tempProject } from './helpers';
import { request as rawRequest, startTestServer, type TestServer } from './http-helpers';

let p: Project;
let srv: TestServer;
beforeAll(async () => {
  p = tempProject();
  srv = await startTestServer(p);
});
afterAll(() => {
  srv.close();
  removeProject(p);
});

interface Item {
  slug: string;
  closed?: boolean;
  progress?: unknown;
  fresh?: { replies: string[]; asks: string[]; openAsks: string[]; versions: string[] };
  unsupported: boolean;
}
const list = async (): Promise<Item[]> =>
  JSON.parse((await rawRequest(srv.port, 'GET', '/api/topics', { headers: { 'x-rikai-token': srv.token } })).body);
const find = async (slug: string): Promise<Item> => (await list()).find((t) => t.slug === slug) as Item;
test('fresh：AI の返信・質問・未回答・ページごとの版のキーが入る。progress など、これまでの項目は、そのまま', async () => {
  makeTopic(p, 'a');
  const empty = await find('a');
  assert.deepEqual(empty.fresh, { replies: [], asks: [], openAsks: [], versions: ['root@1'], window: 200 });
  assert.equal(empty.unsupported, false);
  assert.ok('progress' in empty);
  const t = p.actions.comment({ topic: 'a', page: 'root', version: 1, anchor: null, text: '質問です' }).thread;
  p.actions.submit({ topic: 'a' });
  p.agent.cmdApply('a', {
    replies: [
      { thread: t, body: '返信です' },
      { thread: t, body: '質問です', ask: { type: 'yes_no', question: '理解できましたか？' } },
    ],
    revisions: [{ page: 'root', markdown: '# 新しい版\n\n本文' }],
  });
  const a = await find('a');
  const th = p.store.loadThreads('a').threads[0]?.messages ?? [];
  const reply = th.find((m) => m.author === 'ai' && !m.ask)?.id;
  const ask = th.find((m) => m.author === 'ai' && m.ask)?.id;
  assert.deepEqual(a.fresh, {
    replies: [reply],
    asks: [ask],
    openAsks: [ask],
    versions: ['root@1', 'root@2'],
    window: 200,
  });
  // 利用者が答える（保存）と、未回答でなくなる。asks には、残る（回答した質問が、あとから、新着にならない）
  p.actions.answer({ topic: 'a', thread: t, msg: ask as string, answer: { value: true } });
  assert.deepEqual((await find('a')).fresh?.openAsks, []);
  assert.deepEqual((await find('a')).fresh?.asks, [ask]);
});

test('閉じたトピックには、fresh を付けない（新着がない）。読めない形式にも付けない', async () => {
  makeTopic(p, 'closed1');
  p.hooks.allClosed = () => {};
  p.actions.end({ topic: 'closed1' });
  const c = await find('closed1');
  assert.equal(c.closed, true);
  assert.ok(!('fresh' in c));
  const dir = path.join(p.dir, '.rikai', 'future');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ slug: 'future', title: '新しい形式', schema: 99 }));
  const f = await find('future');
  assert.equal(f.unsupported, true);
  assert.ok(!('fresh' in f));
});

test('走査の使い回し：rev・threads.json の更新時刻・大きさが同じなら、前の結果（同じ参照）。変更・手で書き換えたあとは、取り直す。壊れた threads.json は、要約なし（一覧は、落ちない）', () => {
  makeTopic(p, 'cache1');
  const meta = () => p.store.loadMeta('cache1');
  const s1 = p.store.summaryOrNull(meta());
  assert.equal(p.store.summaryOrNull(meta()), s1);
  p.actions.comment({ topic: 'cache1', page: 'root', version: 1, anchor: null, text: '変更' });
  const s2 = p.store.summaryOrNull(meta());
  assert.notEqual(s2, s1);
  assert.equal(p.store.summaryOrNull(meta()), s2);
  // 手で書き換えた（rev は変わらない）：大きさが変わる
  const file = path.join(p.dir, '.rikai', 'cache1', 'threads.json');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  raw.threads[0].resolved = true;
  fs.writeFileSync(file, `${JSON.stringify(raw, null, 4)}\n`);
  const s3 = p.store.summaryOrNull(meta());
  assert.notEqual(s3, s2);
  assert.equal(s3?.progress.threads.resolved, 1);
  // 手で書き換えたが、更新時刻は同じ・大きさだけが違う（大きさが、キーに入っている）
  const T = new Date(Math.floor(Date.now() / 1000) * 1000); // 秒単位の更新時刻（書き戻しで、ミリ秒の端数が、変わらない）
  fs.utimesSync(file, T, T);
  const s3b = p.store.summaryOrNull(meta());
  const before = fs.statSync(file);
  const raw2 = JSON.parse(fs.readFileSync(file, 'utf8'));
  raw2.threads[0].resolved = false;
  fs.writeFileSync(file, `${JSON.stringify(raw2)}\n`);
  fs.utimesSync(file, T, T);
  assert.equal(fs.statSync(file).mtimeMs, before.mtimeMs);
  assert.notEqual(fs.statSync(file).size, before.size);
  const s4 = p.store.summaryOrNull(meta());
  assert.notEqual(s4, s3b);
  assert.equal(s4?.progress.threads.resolved, 0);
  // 同じ大きさで、更新時刻だけが違う（更新時刻が、キーに入っている）
  const same = fs.readFileSync(file, 'utf8').replace('"resolved":false', '"resolved":true ');
  assert.equal(same.length, fs.readFileSync(file, 'utf8').length);
  fs.writeFileSync(file, same);
  fs.utimesSync(file, new Date(before.mtimeMs + 5000), new Date(before.mtimeMs + 5000));
  assert.equal(p.store.summaryOrNull(meta())?.progress.threads.resolved, 1);
  // ファイルは同じで、rev だけが増えた（rev が、キーに入っている）
  const s5 = p.store.summaryOrNull(meta());
  assert.equal(p.store.summaryOrNull(meta()), s5);
  assert.notEqual(p.store.summaryOrNull({ ...meta(), rev: meta().rev + 1 }), s5);
  // 窓が違えば、別の結果
  assert.notEqual(p.store.summaryOrNull(meta(), 20), p.store.summaryOrNull(meta(), 200));
  fs.writeFileSync(file, '{壊れた');
  const spy = console.error;
  console.error = () => {};
  try {
    assert.equal(p.store.summaryOrNull(meta()), null);
  } finally {
    console.error = spy;
  }
});
