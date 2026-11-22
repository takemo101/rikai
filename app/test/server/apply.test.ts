import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'vitest';
import { HttpError } from '../../src/server/util';
import type { Thread } from '../../src/shared/types';
import {
  addComment,
  httpError,
  makeTopic,
  type Project,
  readThreads,
  removeProject,
  singleAsk,
  submit,
  tempProject,
} from './helpers';

let p: Project;
beforeEach(() => {
  p = tempProject();
  makeTopic(p);
});
afterEach(() => removeProject(p));

const files = () => fs.readdirSync(path.join(p.dir, '.rikai', 'demo', 'pages')).sort();
const snapshot = () =>
  JSON.stringify([
    fs.readFileSync(path.join(p.dir, '.rikai', 'demo', 'meta.json'), 'utf8'),
    fs.readFileSync(path.join(p.dir, '.rikai', 'demo', 'threads.json'), 'utf8'),
    files(),
    p.agent.listRounds('demo'),
  ]);

test('誤りがあれば、すべての誤りを返し、何も書かない', () => {
  const id = addComment(p);
  submit(p);
  const before = snapshot();
  assert.throws(
    () =>
      p.agent.cmdApply('demo', {
        replies: [
          { thread: 't99', body: '' },
          { thread: id, body: '有効な返信' },
        ],
        revisions: [{ page: 'nope', markdown: 'x' }],
        pages: [{ id: 'Bad_ID', title: '', markdown: '' }],
      }),
    (e) => e instanceof HttpError && e.status === 400 && e.message.split('\n').length >= 5,
  );
  assert.equal(snapshot(), before, '有効な返信も書かれず、round も pending のまま');
});

test('返信・新版・子ページ・質問を 1 回で反映し、round を handled にする', () => {
  const id = addComment(p);
  submit(p);
  const r = p.agent.cmdApply('demo', {
    round: 1,
    replies: [{ thread: id, body: '返信です', page: 'detail', ask: singleAsk }],
    revisions: [{ page: 'root', markdown: '# 題\n\n直した本文です。\n' }],
    pages: [{ id: 'detail', title: '詳細', markdown: '# 詳細\n' }],
    threads: [
      { page: 'root', anchor: { quote: '直した' }, body: '確認です', ask: { type: 'yes_no', question: 'いい？' } },
    ],
  });
  assert.deepEqual(r.handledRounds, [1]);
  assert.deepEqual(r.newPages, ['detail']);
  assert.deepEqual(r.revised, { root: 2 });
  assert.deepEqual(r.repliedThreads, [id]);
  assert.equal(r.unansweredThreads, undefined);

  const meta = p.store.loadMeta('demo');
  assert.equal(meta.pages.root?.versions, 2);
  assert.equal(meta.pages.detail?.parent, 'root');
  assert.deepEqual(meta.pending, []);
  assert.equal(p.agent.listRounds('demo')[0]?.status, 'handled');
  assert.match(fs.readFileSync(p.store.pageFile('demo', 'root', 2), 'utf8'), /直した本文/);
  assert.match(fs.readFileSync(p.store.pageFile('demo', 'root', 1), 'utf8'), /本文です/, '古い版は残る');

  const [t1, t2] = readThreads(p).threads as [Thread, Thread];
  const reply = t1.messages.find((m) => m.author === 'ai');
  assert.equal(reply?.revision, 2, '資料を直した返信には、新しい版が付く');
  assert.equal(reply?.page, 'detail');
  assert.equal(reply?.ask?.type, 'single_choice');
  assert.equal(t2.origin, 'ai');
  assert.equal(t2.messages[0]?.ask?.type, 'yes_no');
});

test('返信し忘れたスレッドを知らせる（解決・再開の通知だけのものは除く）', () => {
  const a = addComment(p);
  const b = addComment(p, { text: '別の質問' });
  submit(p);
  const r = p.agent.cmdApply('demo', { replies: [{ thread: a, body: '返信' }] });
  assert.deepEqual(r.unansweredThreads, [b]);
  assert.match(r.warning ?? '', /返信していない/);
});

test('同じページは、1 回の apply で 1 回しか直せない。存在しない参照は断る', () => {
  assert.throws(
    () =>
      p.agent.cmdApply('demo', {
        revisions: [
          { page: 'root', markdown: 'a' },
          { page: 'root', markdown: 'b' },
        ],
      }),
    httpError(400, /2回直せない/),
  );
  assert.throws(
    () => p.agent.cmdApply('demo', { pages: [{ id: 'x', title: 't', parent: 'nope', markdown: 'm' }] }),
    httpError(400, /parent/),
  );
  assert.throws(
    () => p.agent.cmdApply('demo', { pages: [{ id: 'root', title: 't', markdown: 'm' }] }),
    httpError(400, /既存/),
  );
  const id = addComment(p);
  assert.throws(
    () => p.agent.cmdApply('demo', { replies: [{ thread: id, body: 'b', page: 'nope' }] }),
    httpError(400, /page/),
  );
});

test('同じ呼び出しで作った子ページへ、返信からリンクできる。孫ページも作れる', () => {
  const id = addComment(p);
  p.agent.cmdApply('demo', {
    replies: [{ thread: id, body: 'b', page: 'child' }],
    pages: [
      { id: 'child', title: '子', markdown: 'c' },
      { id: 'grand', title: '孫', parent: 'child', markdown: 'g' },
    ],
  });
  assert.equal(p.store.loadMeta('demo').pages.grand?.parent, 'child');
  assert.deepEqual(files(), ['child', 'grand', 'root']);
});

test('round を指定すると、その round だけを処理する。未処理でない round は断る', () => {
  const id = addComment(p);
  submit(p);
  p.actions.reply({ topic: 'demo', thread: id, text: '追加' });
  submit(p);
  assert.deepEqual(p.store.loadMeta('demo').pending, [1, 2]);
  // 読んでいない round を、巻き込まない：poll・pull が出すのは、いちばん古い round だけ。round を省いたとき、未処理が複数なら、断る（何も書かない）
  const first = p.agent.peek('demo');
  assert.equal('round' in first && first.round, 1);
  const before = JSON.stringify(p.store.loadMeta('demo').pending);
  assert.throws(
    () => p.agent.cmdApply('demo', { replies: [{ thread: id, body: '返信' }] }),
    httpError(400, /未処理の round が複数.*1・2/),
  );
  assert.equal(JSON.stringify(p.store.loadMeta('demo').pending), before, '断ったときは、何も書かない');
  assert.throws(() => p.agent.cmdApply('demo', { round: 9, replies: [] }), httpError(400, /未処理ではありません/));
  const r = p.agent.cmdApply('demo', { round: 1, replies: [{ thread: id, body: '返信' }] });
  assert.deepEqual(r.handledRounds, [1]);
  assert.deepEqual(p.store.loadMeta('demo').pending, [2]);
  assert.deepEqual(p.agent.cmdApply('demo', {}).handledRounds, [2], '未処理が 1 つなら、round を省いてよい');
});

test('質問が不正なら、apply 全体を断る', () => {
  const id = addComment(p);
  assert.throws(
    () =>
      p.agent.cmdApply('demo', {
        replies: [
          { thread: id, body: 'b', ask: { type: 'single_choice', question: 'q', options: [{ id: 'a', label: 'A' }] } },
        ],
      }),
    httpError(400, /options/),
  );
  assert.equal(readThreads(p).threads[0]?.messages.length, 1);
});

test('返信が要るのは、新しい発言か再開があるスレッド。「解決」だけの通知には要らない', () => {
  const a = addComment(p);
  submit(p);
  p.agent.cmdApply('demo', { replies: [{ thread: a, body: '返信' }] });
  p.actions.resolve({ topic: 'demo', thread: a, resolved: true });
  submit(p);
  assert.equal(p.agent.cmdApply('demo', {}).unansweredThreads, undefined, '「解決」だけなら、返信しなくてよい');

  p.actions.resolve({ topic: 'demo', thread: a, resolved: false });
  submit(p);
  assert.deepEqual(p.agent.cmdApply('demo', {}).unansweredThreads, [a], '再開されたのに、返信がない');
});
