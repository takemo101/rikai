'use strict';
// ストア：.rikai/<topic>/ の読み書き。変更は、すべて mutate を通す（ロック・検証してから書く）。
// プロジェクトのルート（ROOT）と .rikai（BASE）は、このモジュールの状態。setRoot で決める。
const fs = require('fs');
const path = require('path');
const { progressOf } = require('../public/progress.js'); // ビューアと同じ数え方（理解の進み具合）
const { HttpError, now, sleepSync, readJSON, writeJSON } = require('./util.js');

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,47}$/;

let ROOT = '';
let BASE = '';

function setRoot(root) {
  ROOT = root;
  BASE = path.join(ROOT, '.rikai');
}
const getRoot = () => ROOT;
const getBase = () => BASE;

function ensureBase() {
  fs.mkdirSync(BASE, { recursive: true });
  const gi = path.join(BASE, '.gitignore');
  // 既定ではコミットしない。共有したいときはこのファイルを消す
  if (!fs.existsSync(gi)) fs.writeFileSync(gi, '*\n');
}

const tdir = (slug) => path.join(BASE, slug);
const serverFile = () => path.join(BASE, '.server.json');

function checkSlug(s, what = 'トピック名') {
  if (!SLUG_RE.test(String(s || ''))) throw new HttpError(400, `${what}は英小文字・数字・ハイフンで48字以内にしてください: ${s}`);
  return s;
}

function withLock(slug, fn) {
  const dir = path.join(tdir(slug), '.lock');
  const start = Date.now();
  for (;;) {
    try { fs.mkdirSync(dir); break; } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try { if (Date.now() - fs.statSync(dir).mtimeMs > 15000) fs.rmdirSync(dir); } catch (_) {}
      if (Date.now() - start > 8000) throw new Error('ロックを取得できませんでした');
      sleepSync(30);
    }
  }
  try { return fn(); } finally { try { fs.rmdirSync(dir); } catch (_) {} }
}

// データ（meta.json）の形の版。形を変えるときは、ここを上げて、古い形を読み替える処理を足す（docs/development.md）。
// 版のない古い形は、版 1 として読む。このコードより新しい版は、読み書きを断る（新しい形を、古いコードが壊さないように）。
const SCHEMA = 1;
const schemaOf = (m) => (m.schema === undefined ? 1 : m.schema);
const isSupported = (m) => Number.isInteger(schemaOf(m)) && schemaOf(m) >= 1 && schemaOf(m) <= SCHEMA;

const topicTitle = (m) => (typeof m.title === 'string' ? m.title : String(m.slug));

function loadMeta(slug) {
  checkSlug(slug);
  const m = readJSON(path.join(tdir(slug), 'meta.json'), null);
  if (!m) throw new HttpError(404, `トピックがありません: ${slug}`);
  if (!isSupported(m)) {
    const v = schemaOf(m);
    // 新しい形式と、壊れた値は、直し方が違う（更新しても、壊れた値は直らない）
    if (Number.isInteger(v) && v > SCHEMA) {
      throw new HttpError(409, `このトピックは、この rikai が読めない新しい形式（データの版 ${v}）です。この rikai は、版 ${SCHEMA} までです。新しい rikai に更新してください（${slug}）`);
    }
    throw new HttpError(409, `このトピックの meta.json の schema の値（${JSON.stringify(m.schema)}）が不正です。ファイルが壊れています（${slug}）`);
  }
  return m;
}
function saveMeta(m) {
  m.schema = SCHEMA;
  m.rev = (m.rev || 0) + 1;
  writeJSON(path.join(tdir(m.slug), 'meta.json'), m);
}
const loadThreads = (slug) => readJSON(path.join(tdir(slug), 'threads.json'), { seq: 0, threads: [] });
const saveThreads = (slug, t) => writeJSON(path.join(tdir(slug), 'threads.json'), t);
const pageFile = (slug, page, v) => path.join(tdir(slug), 'pages', page, `v${v}.md`);

// 変更はすべてここを通す。fn が投げたら何も書かない
function mutate(slug, fn) {
  loadMeta(slug); // 存在しないトピックは、ロックのフォルダを作る前に 404（作ろうとすると、内部エラーの 500 になる）
  return withLock(slug, () => {
    const meta = loadMeta(slug);
    const th = loadThreads(slug);
    const res = fn(meta, th);
    saveThreads(slug, th);
    saveMeta(meta);
    return res;
  });
}

const nextId = (th, prefix) => `${prefix}${++th.seq}`;

function listTopics() {
  if (!fs.existsSync(BASE)) return [];
  return fs.readdirSync(BASE, { withFileTypes: true })
    .filter((d) => d.isDirectory() && SLUG_RE.test(d.name) && fs.existsSync(path.join(BASE, d.name, 'meta.json')))
    .map((d) => {
      const m = readJSON(path.join(BASE, d.name, 'meta.json'), null);
      // 名前はディレクトリのものを使う（読めない形のメタの中身は、信用しない）
      return m ? { ...m, slug: d.name } : null;
    })
    .filter(Boolean);
}

function countUnsent(th) {
  let n = 0;
  for (const t of th.threads) {
    n += t.messages.filter((m) => m.author === 'user' && !m.sent).length;
    if (t.resolveSent === false) n += 1;
  }
  return n;
}

function topicState(slug) {
  const meta = loadMeta(slug);
  const th = loadThreads(slug);
  return { rev: meta.rev, meta, threads: th.threads, unsent: countUnsent(th) };
}

function newTopic(slug, title, source, markdown) {
  checkSlug(slug);
  if (!String(markdown || '').trim()) throw new HttpError(400, '資料(Markdown)が空です。標準入力で渡してください');
  if (fs.existsSync(path.join(tdir(slug), 'meta.json'))) {
    throw new HttpError(409, `トピックは既にあります: ${slug}。版を進めるには apply の revisions を使ってください`);
  }
  ensureBase();
  for (const d of ['pages/root', 'assets', 'rounds']) fs.mkdirSync(path.join(tdir(slug), d), { recursive: true });
  fs.writeFileSync(pageFile(slug, 'root', 1), markdown);
  const meta = {
    slug, title: String(title || slug), source: String(source || ''), createdAt: now(), rev: 0, round: 0,
    closed: false, pending: [],
    pages: { root: { title: String(title || slug), parent: null, versions: 1, createdAt: now() } },
  };
  saveMeta(meta);
  saveThreads(slug, { seq: 0, threads: [] });
  return meta;
}

// 一覧に付ける、理解の進み具合。threads.json が壊れたトピックがあっても、一覧全体を 500 にしない（そのトピックは、数なし）。
// 警告は、トピックごとに 1 回だけ。壊れたファイルの中身が、エラーの文に入ることがあるので、種類（name）だけを出す
const warnedThreads = new Set();
function progressOrNull(slug) {
  try {
    return progressOf(loadThreads(slug).threads);
  } catch (e) {
    if (!warnedThreads.has(slug)) { warnedThreads.add(slug); console.error(`threads.json を読めません（${slug}: ${e.name}）`); }
    return null;
  }
}

module.exports = {
  SLUG_RE, setRoot, getRoot, getBase, tdir, serverFile, ensureBase, checkSlug,
  SCHEMA, schemaOf, isSupported, topicTitle, loadMeta, loadThreads, saveThreads, pageFile,
  mutate, nextId, listTopics, countUnsent, topicState, newTopic, progressOrNull,
};
