import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'vitest';
import { checkSlug, SCHEMA } from '../../src/server/store';
import type { Thread } from '../../src/shared/types';
import { httpError, makeTopic, type Project, removeProject, runCli, tempProject } from './helpers';

// CLI の status の出力のうち、ここで見る項目
interface StatusEntry {
  topic: string;
  unsupported?: boolean;
  pages?: Record<string, unknown>;
  progress?: unknown;
}

let p: Project;
beforeEach(() => {
  p = tempProject();
});
afterEach(() => removeProject(p));

const read = (...parts: string[]) => fs.readFileSync(path.join(p.dir, '.rikai', ...parts), 'utf8');

test('トピックを作ると、v1・メタ・スレッド・assets・rounds ができ、.rikai は git に入らない', () => {
  makeTopic(p);
  assert.match(read('demo', 'pages', 'root', 'v1.md'), /本文です/);
  assert.equal(p.store.loadMeta('demo').pages.root.versions, 1);
  assert.deepEqual(p.store.loadThreads('demo').threads, []);
  assert.ok(fs.statSync(path.join(p.dir, '.rikai', 'demo', 'assets')).isDirectory());
  assert.equal(read('.gitignore'), '*\n');
});

test('同じ名前のトピック・不正な名前・空の資料は作れない', () => {
  makeTopic(p);
  assert.throws(() => makeTopic(p), httpError(409, /既にあります/));
  assert.throws(() => p.store.newTopic('Bad_Name', 't', '', '# x'), httpError(400, /英小文字/));
  assert.throws(() => p.store.newTopic('../escape', 't', '', '# x'), httpError(400));
  assert.throws(() => p.store.newTopic('empty', 't', '', '  \n'), httpError(400, /空/));
});

test('mutate は、失敗したら、メタもスレッドも書き換えない', () => {
  makeTopic(p);
  const meta = read('demo', 'meta.json');
  const threads = read('demo', 'threads.json');
  assert.throws(
    () =>
      p.store.mutate('demo', (m, th) => {
        m.title = '壊れた';
        th.threads.push({ id: 'tX', page: 'root', messages: [] } as unknown as Thread);
        throw new Error('途中で失敗');
      }),
    /途中で失敗/,
  );
  assert.equal(read('demo', 'meta.json'), meta);
  assert.equal(read('demo', 'threads.json'), threads);
});

test('mutate は、成功するたびに rev を進め、失敗のあとでもロックを残さない', () => {
  makeTopic(p);
  const before = p.store.loadMeta('demo').rev;
  assert.throws(() =>
    p.store.mutate('demo', () => {
      throw new Error('x');
    }),
  );
  assert.equal(fs.existsSync(path.join(p.dir, '.rikai', 'demo', '.lock')), false);
  p.store.mutate('demo', () => ({}));
  assert.equal(p.store.loadMeta('demo').rev, before + 1);
});

test('存在しないトピックは 404', () => {
  assert.throws(() => p.store.loadMeta('nothing'), httpError(404));
});

// ---- データの形の版 ----

const metaPath = () => path.join(p.dir, '.rikai', 'demo', 'meta.json');
const writeMeta = (edit: (m: Record<string, unknown>) => void) => {
  const m = JSON.parse(fs.readFileSync(metaPath(), 'utf8'));
  edit(m);
  fs.writeFileSync(metaPath(), JSON.stringify(m, null, 2));
};

test('新しく作ったトピックには、形の版が入る', () => {
  makeTopic(p);
  assert.equal(JSON.parse(fs.readFileSync(metaPath(), 'utf8')).schema, SCHEMA);
});

test('版のない古い形は読め、次の保存で版が入る', () => {
  makeTopic(p);
  writeMeta((m) => {
    delete m.schema;
  });
  assert.equal(p.store.loadMeta('demo').slug, 'demo');
  p.store.mutate('demo', () => ({}));
  assert.equal(JSON.parse(fs.readFileSync(metaPath(), 'utf8')).schema, SCHEMA);
});

test('新しい形・不正な版のトピックは、読み書きを 409 で断り、何も書き換えない', () => {
  for (const bad of [SCHEMA + 1, 0, '1', null, 1.5]) {
    makeTopic(p, `t${String(bad).replace(/\W/g, '')}`);
  }
  for (const bad of [SCHEMA + 1, 0, '1', null, 1.5]) {
    const slug = `t${String(bad).replace(/\W/g, '')}`;
    const file = path.join(p.dir, '.rikai', slug, 'meta.json');
    const m = JSON.parse(fs.readFileSync(file, 'utf8'));
    m.schema = bad;
    fs.writeFileSync(file, JSON.stringify(m));
    const before = fs.readFileSync(file, 'utf8');
    const threads = fs.readFileSync(path.join(p.dir, '.rikai', slug, 'threads.json'), 'utf8');

    assert.throws(
      () => p.store.loadMeta(slug),
      httpError(409, bad === SCHEMA + 1 ? /新しい rikai に更新/ : /不正です/),
      `schema=${JSON.stringify(bad)}`,
    );
    assert.throws(() => p.store.mutate(slug, () => ({})), httpError(409));
    assert.throws(
      () => p.actions.comment({ topic: slug, page: 'root', version: 1, anchor: null, text: 'x' }),
      httpError(409),
    );
    assert.throws(() => p.agent.peek(slug), httpError(409));
    assert.throws(() => p.agent.cmdApply(slug, { replies: [] }), httpError(409));
    assert.equal(fs.readFileSync(file, 'utf8'), before, 'meta.json は、そのまま');
    assert.equal(
      fs.readFileSync(path.join(p.dir, '.rikai', slug, 'threads.json'), 'utf8'),
      threads,
      'threads.json も、そのまま',
    );
  }
});

test('読めない形のトピックが 1 つあっても、status（トピック名なし）は落ちず、読めるトピックを出す', () => {
  makeTopic(p);
  makeTopic(p, 'future');
  const { thread } = p.actions.comment({ topic: 'demo', page: 'root', version: 1, anchor: null, text: '進み具合' });
  p.actions.resolve({ topic: 'demo', thread, resolved: true });
  // 新しい形では、pages などの形が違い、slug・title も持たないかもしれない
  fs.writeFileSync(
    path.join(p.dir, '.rikai', 'future', 'meta.json'),
    JSON.stringify({ schema: SCHEMA + 1, nodes: [] }),
  );
  const out = JSON.parse(runCli(p.dir, ['status'])) as StatusEntry[];
  const byName = Object.fromEntries(out.map((t) => [t.topic, t]));
  assert.equal(byName.demo?.unsupported, undefined);
  assert.deepEqual(Object.keys(byName.demo?.pages ?? {}), ['root']);
  assert.deepEqual(byName.demo?.progress, {
    threads: { total: 1, resolved: 1, open: 0 },
    asks: { total: 0, answered: 0 },
  });
  assert.deepEqual(
    byName.future,
    { topic: 'future', title: 'future', unsupported: true, schema: SCHEMA + 1 },
    '名前は、ディレクトリのもの',
  );
});

test('読めない形のトピックがあっても、すべての（読める）トピックが閉じたら、サーバーを終える合図が出る', () => {
  makeTopic(p);
  makeTopic(p, 'future');
  fs.writeFileSync(
    path.join(p.dir, '.rikai', 'future', 'meta.json'),
    JSON.stringify({ schema: SCHEMA + 1, closed: false }),
  );
  let calls = 0;
  const original = p.hooks.allClosed;
  p.hooks.allClosed = () => {
    calls += 1;
  };
  try {
    p.actions.end({ topic: 'demo' });
    assert.equal(calls, 1);
  } finally {
    p.hooks.allClosed = original;
  }
});

// ---- 追加：移植で足した検査（旧テストにない境界） ----

test('checkSlug：英小文字・数字・ハイフン、先頭は英小文字か数字、48 字まで', () => {
  for (const ok of ['a', '0', 'demo', 'a-b-c', 'a'.repeat(48)]) assert.equal(checkSlug(ok), ok);
  for (const bad of ['', 'A', 'a_b', '-a', 'a'.repeat(49), '../x', 'a/b', 'a b', undefined, null]) {
    assert.throws(() => checkSlug(bad), httpError(400, /英小文字・数字・ハイフンで48字以内/), String(bad));
  }
  assert.throws(() => checkSlug('X', '名前'), httpError(400, /^名前は/));
});

test('存在しないトピックへの mutate は、404 で、ロックのフォルダも作らない', () => {
  assert.throws(() => p.store.mutate('nothing', () => ({})), httpError(404));
  assert.equal(fs.existsSync(path.join(p.dir, '.rikai', 'nothing')), false);
});

test('新しい形・不正な版は、loadMeta・mutate・操作が 409 で断り、ファイルを書き換えない（agent を使わない部分）', () => {
  makeTopic(p);
  const file = path.join(p.dir, '.rikai', 'demo', 'meta.json');
  for (const bad of [SCHEMA + 1, 0, '1', null, 1.5]) {
    const m = JSON.parse(fs.readFileSync(file, 'utf8'));
    m.schema = bad;
    fs.writeFileSync(file, JSON.stringify(m));
    const before = fs.readFileSync(file, 'utf8');
    assert.throws(
      () => p.store.loadMeta('demo'),
      httpError(409, bad === SCHEMA + 1 ? /新しい rikai に更新/ : /不正です/),
    );
    assert.throws(() => p.store.mutate('demo', () => ({})), httpError(409));
    assert.throws(() => p.actions.end({ topic: 'demo' }), httpError(409));
    assert.equal(fs.readFileSync(file, 'utf8'), before);
  }
});
