'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { rikai, tempProject, removeProject, makeTopic, httpError } = require('./helpers.js');

let dir;
test.beforeEach(() => { dir = tempProject(); });
test.afterEach(() => removeProject(dir));

const read = (...p) => fs.readFileSync(path.join(dir, '.rikai', ...p), 'utf8');

test('トピックを作ると、v1・メタ・スレッド・assets・rounds ができ、.rikai は git に入らない', () => {
  makeTopic();
  assert.match(read('demo', 'pages', 'root', 'v1.md'), /本文です/);
  assert.equal(rikai.loadMeta('demo').pages.root.versions, 1);
  assert.deepEqual(rikai.loadThreads('demo').threads, []);
  assert.ok(fs.statSync(path.join(dir, '.rikai', 'demo', 'assets')).isDirectory());
  assert.equal(read('.gitignore'), '*\n');
});

test('同じ名前のトピック・不正な名前・空の資料は作れない', () => {
  makeTopic();
  assert.throws(() => makeTopic(), httpError(409, /既にあります/));
  assert.throws(() => rikai.newTopic('Bad_Name', 't', '', '# x'), httpError(400, /英小文字/));
  assert.throws(() => rikai.newTopic('../escape', 't', '', '# x'), httpError(400));
  assert.throws(() => rikai.newTopic('empty', 't', '', '  \n'), httpError(400, /空/));
});

test('mutate は、失敗したら、メタもスレッドも書き換えない', () => {
  makeTopic();
  const meta = read('demo', 'meta.json');
  const threads = read('demo', 'threads.json');
  assert.throws(() => rikai.mutate('demo', (m, th) => {
    m.title = '壊れた';
    th.threads.push({ id: 'tX', page: 'root', messages: [] });
    throw new Error('途中で失敗');
  }), /途中で失敗/);
  assert.equal(read('demo', 'meta.json'), meta);
  assert.equal(read('demo', 'threads.json'), threads);
});

test('mutate は、成功するたびに rev を進め、失敗のあとでもロックを残さない', () => {
  makeTopic();
  const before = rikai.loadMeta('demo').rev;
  assert.throws(() => rikai.mutate('demo', () => { throw new Error('x'); }));
  assert.equal(fs.existsSync(path.join(dir, '.rikai', 'demo', '.lock')), false);
  rikai.mutate('demo', () => ({}));
  assert.equal(rikai.loadMeta('demo').rev, before + 1);
});

test('存在しないトピックは 404', () => {
  assert.throws(() => rikai.loadMeta('nothing'), httpError(404));
});

// ---- データの形の版 ----

const metaPath = () => path.join(dir, '.rikai', 'demo', 'meta.json');
const writeMeta = (edit) => {
  const m = JSON.parse(fs.readFileSync(metaPath(), 'utf8'));
  edit(m);
  fs.writeFileSync(metaPath(), JSON.stringify(m, null, 2));
};

test('新しく作ったトピックには、形の版が入る', () => {
  makeTopic();
  assert.equal(JSON.parse(fs.readFileSync(metaPath(), 'utf8')).schema, rikai.SCHEMA);
});

test('版のない古い形は読め、次の保存で版が入る', () => {
  makeTopic();
  writeMeta((m) => { delete m.schema; });
  assert.equal(rikai.loadMeta('demo').slug, 'demo');
  rikai.mutate('demo', () => ({}));
  assert.equal(JSON.parse(fs.readFileSync(metaPath(), 'utf8')).schema, rikai.SCHEMA);
});

test('新しい形・不正な版のトピックは、読み書きを 409 で断り、何も書き換えない', () => {
  for (const bad of [rikai.SCHEMA + 1, 0, '1', null, 1.5]) {
    makeTopic(`t${String(bad).replace(/\W/g, '')}`);
  }
  for (const bad of [rikai.SCHEMA + 1, 0, '1', null, 1.5]) {
    const slug = `t${String(bad).replace(/\W/g, '')}`;
    const file = path.join(dir, '.rikai', slug, 'meta.json');
    const m = JSON.parse(fs.readFileSync(file, 'utf8'));
    m.schema = bad;
    fs.writeFileSync(file, JSON.stringify(m));
    const before = fs.readFileSync(file, 'utf8');
    const threads = fs.readFileSync(path.join(dir, '.rikai', slug, 'threads.json'), 'utf8');

    assert.throws(() => rikai.loadMeta(slug), httpError(409, bad === rikai.SCHEMA + 1 ? /新しい rikai に更新/ : /不正です/), `schema=${JSON.stringify(bad)}`);
    assert.throws(() => rikai.mutate(slug, () => ({})), httpError(409));
    assert.throws(() => rikai.actions.comment({ topic: slug, page: 'root', version: 1, anchor: null, text: 'x' }), httpError(409));
    assert.throws(() => rikai.peek(slug), httpError(409));
    assert.throws(() => rikai.cmdApply(slug, { replies: [] }), httpError(409));
    assert.equal(fs.readFileSync(file, 'utf8'), before, 'meta.json は、そのまま');
    assert.equal(fs.readFileSync(path.join(dir, '.rikai', slug, 'threads.json'), 'utf8'), threads, 'threads.json も、そのまま');
  }
});

test('読めない形のトピックが 1 つあっても、status（トピック名なし）は落ちず、読めるトピックを出す', () => {
  makeTopic();
  makeTopic('future');
  const { thread } = rikai.actions.comment({ topic: 'demo', page: 'root', version: 1, anchor: null, text: '進み具合' });
  rikai.actions.resolve({ topic: 'demo', thread, resolved: true });
  // 新しい形では、pages などの形が違い、slug・title も持たないかもしれない
  fs.writeFileSync(path.join(dir, '.rikai', 'future', 'meta.json'), JSON.stringify({ schema: rikai.SCHEMA + 1, nodes: [] }));
  const cli = path.join(__dirname, '..', 'skills', 'rikai', 'rikai.js');
  const out = JSON.parse(cp.execFileSync(process.execPath, [cli, 'status', '--root', dir], { encoding: 'utf8' }));
  const byName = Object.fromEntries(out.map((t) => [t.topic, t]));
  assert.equal(byName.demo.unsupported, undefined);
  assert.deepEqual(Object.keys(byName.demo.pages), ['root']);
  assert.deepEqual(byName.demo.progress, { threads: { total: 1, resolved: 1, open: 0 }, asks: { total: 0, answered: 0 } });
  assert.deepEqual(byName.future, { topic: 'future', title: 'future', unsupported: true, schema: rikai.SCHEMA + 1 }, '名前は、ディレクトリのもの');
});

test('読めない形のトピックがあっても、すべての（読める）トピックが閉じたら、サーバーを終える合図が出る', () => {
  makeTopic();
  makeTopic('future');
  fs.writeFileSync(path.join(dir, '.rikai', 'future', 'meta.json'), JSON.stringify({ schema: rikai.SCHEMA + 1, closed: false }));
  let calls = 0;
  const original = rikai.hooks.allClosed;
  rikai.hooks.allClosed = () => { calls += 1; };
  try {
    rikai.actions.end({ topic: 'demo' });
    assert.equal(calls, 1);
  } finally {
    rikai.hooks.allClosed = original;
  }
});
