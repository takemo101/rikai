// 一覧の API の `fresh` の窓（F46）：通知の対象のトピック（閉じていないもの）の数で割る。すべてのトピックに付ける（予算で、後ろのトピックが、静かに外れない）。窓の大きさは、`fresh.window`
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'vitest';
import { FRESH_MAX, FRESH_MIN, FRESH_TOPICS_MAX, FRESH_TOTAL_MAX, freshWindow } from '../../src/shared/fresh';
import type { Message } from '../../src/shared/types';
import { makeTopic, type Project, removeProject, tempProject } from './helpers';
import { request as rawRequest, startTestServer, type TestServer } from './http-helpers';

let p: Project;
let srv: TestServer;
beforeEach(async () => {
  p = tempProject();
  srv = await startTestServer(p);
});
afterEach(() => {
  srv.close();
  removeProject(p);
});

interface Item {
  slug: string;
  closed?: boolean;
  fresh?: { replies: string[]; asks: string[]; openAsks: string[]; versions: string[]; window?: number };
}
const list = async (): Promise<Item[]> =>
  JSON.parse((await rawRequest(srv.port, 'GET', '/api/topics', { headers: { 'x-rikai-token': srv.token } })).body);
const fill = (slug: string, n: number): void => {
  p.store.mutate(slug, (_meta, th) => {
    const messages: Message[] = [];
    for (let i = 0; i < n; i++)
      messages.push({ id: `m${++th.seq}`, author: 'ai', kind: 'reply', at: '', text: '返信', sent: true });
    th.threads.push({
      id: `t${++th.seq}`,
      page: 'root',
      version: 1,
      anchor: null,
      resolved: false,
      resolveSent: true,
      createdAt: '',
      origin: 'ai',
      messages,
    });
  });
};

test('窓の式：対象の数で割る（下限 20・上限 200）', () => {
  assert.equal(FRESH_TOPICS_MAX, FRESH_TOTAL_MAX / FRESH_MIN);
  assert.deepEqual([1, 5, 20, 21, 40, 100, 200, 201, 1000].map(freshWindow), [200, 200, 200, 190, 100, 40, 20, 20, 20]);
  assert.equal(FRESH_MAX, 200);
});

test('20 トピック × 各 200 件の返信：すべてのトピックに fresh が付く（後ろのトピックも）。窓は 200', async () => {
  for (let i = 1; i <= 20; i++) {
    makeTopic(p, `z${String(i).padStart(2, '0')}`);
    fill(`z${String(i).padStart(2, '0')}`, 230);
  }
  const all = await list();
  assert.equal(all.length, 20);
  for (const t of all) {
    assert.ok(t.fresh, t.slug);
    assert.equal(t.fresh.window, 200);
    assert.equal(t.fresh.replies.length, 200);
  }
  assert.ok(all.find((t) => t.slug === 'z20')?.fresh);
});

test('トピックが増えると、窓は縮む（全員が同じ窓）。閉じたトピックは、数えない（fresh も付かない）。減ると、広がる', async () => {
  for (let i = 1; i <= 40; i++) {
    makeTopic(p, `t${String(i).padStart(2, '0')}`);
    fill(`t${String(i).padStart(2, '0')}`, 230);
  }
  let all = await list();
  assert.ok(all.every((t) => t.fresh?.window === 100 && t.fresh.replies.length === 100));
  p.hooks.allClosed = () => {};
  for (let i = 1; i <= 20; i++) p.actions.end({ topic: `t${String(i).padStart(2, '0')}` });
  all = await list();
  const open = all.filter((t) => !t.closed);
  assert.equal(open.length, 20);
  assert.ok(open.every((t) => t.fresh?.window === 200 && t.fresh.replies.length === 200)); // 対象が 20：窓は、200 に広がる
  assert.ok(all.filter((t) => t.closed).every((t) => !t.fresh));
});

test('通知の対象が 200 を超えるときだけ、予算を超える：更新が新しいトピックから順に、200 個に付ける。窓は 20', async () => {
  const slugs = Array.from({ length: 205 }, (_, i) => `s${String(i).padStart(3, '0')}`);
  for (const s of slugs) makeTopic(p, s);
  // meta.json の更新時刻を、s000 が最も古く、s204 が最も新しくなるように、決める
  const t0 = Date.now() / 1000 - 10_000;
  for (const [i, s] of slugs.entries()) fs.utimesSync(path.join(p.dir, '.rikai', s, 'meta.json'), t0 + i, t0 + i);
  const all = await list();
  assert.equal(all.length, 205);
  const withFresh = all.filter((t) => t.fresh).map((t) => t.slug);
  assert.equal(withFresh.length, FRESH_TOPICS_MAX);
  assert.ok(all.every((t) => !t.fresh || t.fresh.window === FRESH_MIN));
  assert.deepEqual(
    all
      .filter((t) => !t.fresh)
      .map((t) => t.slug)
      .sort(),
    ['s000', 's001', 's002', 's003', 's004'], // 更新が古い 5 つが、外れる
  );
});
