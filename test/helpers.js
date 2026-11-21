'use strict';
// テスト共通の道具。作り物の資料・コメントだけを使い、一時のプロジェクトで動かす（利用者の .rikai には触れない）。
const fs = require('fs');
const os = require('os');
const path = require('path');
const lib = path.join(__dirname, '..', 'skill', 'rikai', 'lib');
// テストが使う、lib/ のモジュールの束（rikai.js は CLI の入口で、読み込むと動き出すので、require しない）
const rikai = {
  ...require(path.join(lib, 'util.js')),
  ...require(path.join(lib, 'store.js')),
  ...require(path.join(lib, 'ask.js')),
  ...require(path.join(lib, 'actions.js')),
  ...require(path.join(lib, 'agent.js')),
  ...require(path.join(lib, 'server.js')),
};

const ROOT_MD = '# 題\n\n本文です。\n\n| 項目 | 値 |\n| --- | --- |\n| 有効期限 | 15分 |\n';

function tempProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rikai-test-'));
  rikai.setRoot(dir);
  return dir;
}

function removeProject(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function makeTopic(slug = 'demo', md = ROOT_MD) {
  return rikai.newTopic(slug, '題', '試験', md);
}

function textAnchor(quote = '本文') {
  return { blockId: 'b1', blockHash: 'h1', blockTag: 'P', blockText: '本文です。', quote, prefix: '', suffix: '', label: '' };
}

// 人間のコメントを 1 件つける。スレッド ID を返す
function addComment(over = {}) {
  const r = rikai.actions.comment({ topic: 'demo', page: 'root', version: 1, anchor: textAnchor(), text: '質問です', ...over });
  return r.thread;
}

// 人間の操作から Submit まで。round の番号を返す
function submit(note) {
  return rikai.actions.submit({ topic: 'demo', note }).round;
}

function readThreads(slug = 'demo') {
  return rikai.loadThreads(slug);
}

// 例外が HttpError で、状態コードと文言が合うこと
function httpError(status, pattern) {
  return (e) => e instanceof rikai.HttpError && e.status === status && (!pattern || pattern.test(e.message));
}

const singleAsk = {
  type: 'single_choice',
  question: '冪等なのは？',
  options: [{ id: 'a', label: '足す' }, { id: 'b', label: 'セットする' }],
};

module.exports = { rikai, tempProject, removeProject, makeTopic, textAnchor, addComment, submit, readThreads, httpError, singleAsk, ROOT_MD };
