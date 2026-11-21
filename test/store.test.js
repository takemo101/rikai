'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
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

    assert.throws(() => rikai.loadMeta(slug), httpError(409, /読めない形/), `schema=${JSON.stringify(bad)}`);
    assert.throws(() => rikai.mutate(slug, () => ({})), httpError(409));
    assert.throws(() => rikai.actions.comment({ topic: slug, page: 'root', version: 1, anchor: null, text: 'x' }), httpError(409));
    assert.throws(() => rikai.peek(slug), httpError(409));
    assert.throws(() => rikai.cmdApply(slug, { replies: [] }), httpError(409));
    assert.equal(fs.readFileSync(file, 'utf8'), before, 'meta.json は、そのまま');
    assert.equal(fs.readFileSync(path.join(dir, '.rikai', slug, 'threads.json'), 'utf8'), threads, 'threads.json も、そのまま');
  }
});
