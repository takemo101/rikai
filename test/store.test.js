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
