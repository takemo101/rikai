#!/usr/bin/env node
'use strict';
// rikai: 資料にコメントして Submit し、AI の返信と資料の修正で理解を深めるループ。
// CLI（AI が使う）とローカルサーバー（ブラウザ用）を1ファイルにまとめている。依存パッケージなし（Node 18+）。

const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const cp = require('child_process');
const { progressOf } = require('./public/progress.js'); // ビューアと同じ数え方（理解の進み具合）

const SELF = __filename;
const PUBLIC = path.join(__dirname, 'public');
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,47}$/;
const ASK_TYPES = ['single_choice', 'multi_choice', 'yes_no', 'scale', 'free_text'];
const MAX_BODY = 2 * 1024 * 1024;

let ROOT = '';
let BASE = '';
let PORT = 0;
let TOKEN = '';

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// ---------------------------------------------------------------- 引数・共通

function parseArgs(argv) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      if (k === 'no-open' || k === 'force') flags[k] = true;
      else flags[k] = argv[++i];
    } else pos.push(a);
  }
  return { pos, flags };
}

function projectRoot(flags) {
  if (flags.root) return path.resolve(flags.root);
  try {
    return cp.execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch (_) {
    return process.cwd();
  }
}

function out(obj) { console.log(JSON.stringify(obj, null, 2)); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function sleepSync(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
const now = () => new Date().toISOString();

function readJSON(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return fallback; throw e; }
}
function writeJSON(p, v, mode) {
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(v, null, 2), mode ? { mode } : undefined);
  fs.renameSync(tmp, p);
}

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

// ---------------------------------------------------------------- ストア

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

// ---------------------------------------------------------------- ask の検証

function normAsk(ask, where, errs) {
  if (ask == null) return null;
  if (typeof ask !== 'object' || !ASK_TYPES.includes(ask.type)) {
    errs.push(`${where}.ask.type は ${ASK_TYPES.join(' / ')} のどれか`);
    return null;
  }
  const out = { type: ask.type, question: String(ask.question || '').trim() };
  if (!out.question) errs.push(`${where}.ask.question が空です`);
  if (ask.type === 'single_choice' || ask.type === 'multi_choice') {
    const opts = Array.isArray(ask.options) ? ask.options : [];
    if (opts.length < 2 || opts.length > 8) errs.push(`${where}.ask.options は2〜8個`);
    const ids = new Set();
    out.options = [];
    for (const o of opts) {
      const id = String(o && o.id || '').trim();
      const label = String(o && o.label || '').trim();
      if (!id || !label) { errs.push(`${where}.ask.options の id と label は必須`); continue; }
      if (ids.has(id)) errs.push(`${where}.ask.options の id が重複: ${id}`);
      ids.add(id);
      out.options.push({ id, label, ...(o.detail ? { detail: String(o.detail) } : {}) });
    }
    out.allowOther = !!ask.allowOther;
  } else if (ask.type === 'scale') {
    const min = ask.min == null ? 1 : ask.min;
    const max = ask.max == null ? 5 : ask.max;
    if (!Number.isInteger(min) || !Number.isInteger(max) || max <= min || max - min > 9) errs.push(`${where}.ask の min/max は整数で、幅は1〜9`);
    out.min = min; out.max = max;
    if (ask.minLabel) out.minLabel = String(ask.minLabel);
    if (ask.maxLabel) out.maxLabel = String(ask.maxLabel);
  } else if (ask.type === 'free_text') {
    if (ask.placeholder) out.placeholder = String(ask.placeholder);
  }
  return out;
}

function normAnswer(ask, a) {
  const bad = (m) => { throw new HttpError(400, m); };
  if (!a || typeof a !== 'object') bad('回答が不正です');
  switch (ask.type) {
    case 'single_choice': {
      const other = String(a.other || '').trim();
      if (a.choice != null && ask.options.some((o) => o.id === a.choice)) return { choice: a.choice };
      if (ask.allowOther && other) return { other };
      return bad('選択肢を選んでください');
    }
    case 'multi_choice': {
      const choices = (Array.isArray(a.choices) ? a.choices : []).filter((c) => ask.options.some((o) => o.id === c));
      const other = ask.allowOther ? String(a.other || '').trim() : '';
      if (!choices.length && !other) bad('1つ以上選んでください');
      return { choices, ...(other ? { other } : {}) };
    }
    case 'yes_no':
      if (typeof a.value !== 'boolean') bad('はい／いいえを選んでください');
      return { value: a.value };
    case 'scale':
      if (!Number.isInteger(a.value) || a.value < ask.min || a.value > ask.max) bad('範囲内の数値を選んでください');
      return { value: a.value };
    default: {
      const text = String(a.text || '').trim();
      if (!text) bad('回答を入力してください');
      return { text };
    }
  }
}

// ---------------------------------------------------------------- 画面からの操作

const str = (v, max = 20000) => String(v == null ? '' : v).slice(0, max);

function normAnchor(a) {
  if (!a || typeof a !== 'object') return null;
  return {
    blockId: str(a.blockId, 40), blockHash: str(a.blockHash, 40), blockTag: str(a.blockTag, 16), blockText: str(a.blockText, 200),
    quote: str(a.quote, 2000), prefix: str(a.prefix, 64), suffix: str(a.suffix, 64), label: str(a.label, 120),
  };
}

function findThread(th, id) {
  const t = th.threads.find((x) => x.id === id);
  if (!t) throw new HttpError(404, `スレッドがありません: ${id}`);
  return t;
}
function findUnsentUserMsg(t, id) {
  const m = t.messages.find((x) => x.id === id);
  if (!m || m.author !== 'user') throw new HttpError(404, 'メッセージがありません');
  if (m.sent) throw new HttpError(400, '送信済みのメッセージは変更できません');
  return m;
}

// 解決の状態を変える（「解決」・「再開」・返信による再開で共通）。AI が最後に知っている状態と比べて、AI に送る変更かを決める。
// 知っている状態は、変更が未送信（resolveSent が false）ならいまの逆、送信済みならいまと同じ。
// 「解決」→「再開」のように元に戻したときは、送る変更にしない（何も変わっていないのに通知になるため）
function setResolved(t, want) {
  const known = t.resolveSent ? t.resolved : !t.resolved;
  t.resolved = want;
  t.resolveSent = want === known;
}

// 全トピックが閉じたときの動き。テストでは差し替える
const hooks = { allClosed: () => setTimeout(shutdown, 800) };

const actions = {
  comment(b) {
    return mutate(b.topic, (meta, th) => {
      const pg = meta.pages[b.page];
      if (!pg) throw new HttpError(400, 'ページがありません');
      if (Number(b.version) !== pg.versions) throw new HttpError(400, '最新版にだけコメントできます');
      const text = str(b.text).trim();
      if (!text) throw new HttpError(400, 'コメントが空です');
      const t = {
        id: nextId(th, 't'), page: b.page, version: pg.versions, anchor: normAnchor(b.anchor),
        resolved: false, resolveSent: true, createdAt: now(), origin: 'user',
        messages: [{ id: nextId(th, 'm'), author: 'user', kind: 'comment', at: now(), text, sent: false }],
      };
      th.threads.push(t);
      return { thread: t.id };
    });
  },
  reply(b) {
    return mutate(b.topic, (meta, th) => {
      const t = findThread(th, b.thread);
      const text = str(b.text).trim();
      if (!text) throw new HttpError(400, '返信が空です');
      if (t.resolved) setResolved(t, false);
      t.messages.push({ id: nextId(th, 'm'), author: 'user', kind: 'followup', at: now(), text, sent: false });
      return {};
    });
  },
  answer(b) {
    return mutate(b.topic, (meta, th) => {
      const t = findThread(th, b.thread);
      const q = t.messages.find((m) => m.id === b.msg && m.author === 'ai' && m.ask);
      if (!q) throw new HttpError(404, '質問がありません');
      if (t.messages.some((m) => m.kind === 'answer' && m.to === q.id && m.sent)) throw new HttpError(400, '送信済みの回答は変えられません');
      const old = t.messages.find((m) => m.kind === 'answer' && m.to === q.id && !m.sent);
      if (b.answer == null) {
        if (old) t.messages.splice(t.messages.indexOf(old), 1);
        return {};
      }
      const answer = normAnswer(q.ask, b.answer);
      if (old) { old.answer = answer; old.at = now(); }
      else t.messages.push({ id: nextId(th, 'm'), author: 'user', kind: 'answer', at: now(), to: q.id, answer, sent: false });
      return {};
    });
  },
  edit(b) {
    return mutate(b.topic, (meta, th) => {
      const t = findThread(th, b.thread);
      const m = findUnsentUserMsg(t, b.msg);
      if (m.kind === 'answer') throw new HttpError(400, '回答は選び直してください');
      const text = str(b.text).trim();
      if (!text) throw new HttpError(400, '空にはできません');
      m.text = text;
      return {};
    });
  },
  delete(b) {
    return mutate(b.topic, (meta, th) => {
      const t = findThread(th, b.thread);
      const m = findUnsentUserMsg(t, b.msg);
      t.messages.splice(t.messages.indexOf(m), 1);
      if (!t.messages.length) th.threads.splice(th.threads.indexOf(t), 1);
      return {};
    });
  },
  resolve(b) {
    return mutate(b.topic, (meta, th) => {
      const t = findThread(th, b.thread);
      setResolved(t, !!b.resolved);
      return {};
    });
  },
  submit(b) {
    return mutate(b.topic, (meta, th) => {
      const compact = (m) => {
        const o = { id: m.id, author: m.author, kind: m.kind };
        for (const k of ['text', 'ask', 'answer', 'to', 'page', 'revision']) if (m[k] != null) o[k] = m[k];
        return o;
      };
      const items = [];
      const files = {};
      for (const t of th.threads) {
        const fresh = t.messages.filter((m) => m.author === 'user' && !m.sent);
        const resolveChange = t.resolveSent === false;
        if (!fresh.length && !resolveChange) continue;
        const pg = meta.pages[t.page];
        files[t.page] = { title: pg.title, version: pg.versions, file: pageFile(meta.slug, t.page, pg.versions) };
        items.push({
          thread: t.id, page: t.page, createdOnVersion: t.version, latestVersion: pg.versions,
          anchor: t.anchor ? { quote: t.anchor.quote, label: t.anchor.label, prefix: t.anchor.prefix, suffix: t.anchor.suffix } : null,
          ...(resolveChange ? { userMarked: t.resolved ? 'resolved' : 'reopened' } : {}),
          history: t.messages.filter((m) => !fresh.includes(m)).map(compact),
          new: fresh.map(compact),
        });
      }
      const note = str(b.note, 5000).trim();
      if (!items.length && !note) throw new HttpError(400, '送るコメントがありません');
      const round = ++meta.round;
      for (const t of th.threads) {
        for (const m of t.messages) if (m.author === 'user' && !m.sent) { m.sent = true; m.round = round; }
        t.resolveSent = true;
      }
      meta.pending = [...(meta.pending || []), round];
      const rec = { round, status: 'pending', submittedAt: now(), topic: meta.slug, ...(note ? { overallNote: note } : {}), pages: files, items };
      fs.mkdirSync(path.join(tdir(meta.slug), 'rounds'), { recursive: true });
      writeJSON(path.join(tdir(meta.slug), 'rounds', `${String(round).padStart(3, '0')}.json`), rec);
      return { round };
    });
  },
  end(b) {
    const r = mutate(b.topic, (meta) => { meta.closed = true; return {}; });
    // 読めない形のトピックは、閉じられないので、数えない（数えると、サーバーが終わらない）
    if (listTopics().filter(isSupported).every((t) => t.closed)) hooks.allClosed();
    return r;
  },
};

// ---------------------------------------------------------------- AI 向け: poll / apply / status

function listRounds(slug) {
  const dir = path.join(tdir(slug), 'rounds');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => /^\d+\.json$/.test(f)).sort().map((f) => readJSON(path.join(dir, f), null)).filter(Boolean);
}

// Submit されたものがあるか。poll（待つ）と pull（待たない）が共有する。
// 出力の status（feedback / closed / none）は、round のレコードの status（pending / handled）とは別の語なので、必ずレコードの後に置く
function peek(slug) {
  const meta = loadMeta(slug);
  const pend = listRounds(slug).find((r) => r.status === 'pending');
  if (pend) return { ...pend, status: 'feedback', nextStep: 'コメントごとに返信し、rikai apply で反映する。Claude Code は、そのあと、もう一度 rikai poll をバックグラウンドで起動する' };
  if (meta.closed) return { status: 'closed', unsent: countUnsent(loadThreads(slug)) };
  return { status: 'none', message: 'まだ Submit されたコメントはありません', unsent: countUnsent(loadThreads(slug)) };
}

async function cmdPoll(slug, flags) {
  const deadline = Date.now() + (Number(flags.timeout) || 43200) * 1000;
  for (;;) {
    const r = peek(slug);
    if (r.status !== 'none') return out(r);
    if (Date.now() > deadline) return out({ status: 'timeout' });
    await sleep(500);
  }
}

// 待機しない版。poll を使えないエージェントが、ユーザーに「送った」と言われたあとに読みに行く
function cmdPull(slug) {
  return out(peek(slug));
}

function cmdApply(slug, payload) {
  const P = payload || {};
  const asArr = (v) => (Array.isArray(v) ? v : []);
  return mutate(slug, (meta, th) => {
    const errs = [];
    const newPages = asArr(P.pages);
    const revisions = asArr(P.revisions);
    const replies = asArr(P.replies);
    const newThreads = asArr(P.threads);
    const known = new Set(Object.keys(meta.pages));
    const created = new Set();
    const hasPage = (id) => known.has(id) || created.has(id);

    newPages.forEach((p, i) => {
      const w = `pages[${i}]`;
      if (!SLUG_RE.test(String(p.id || ''))) errs.push(`${w}.id は英小文字・数字・ハイフン`);
      else if (hasPage(p.id)) errs.push(`${w}.id が既存: ${p.id}`);
      if (!String(p.title || '').trim()) errs.push(`${w}.title が空`);
      if (!String(p.markdown || '').trim()) errs.push(`${w}.markdown が空`);
      const parent = p.parent || 'root';
      if (!hasPage(parent)) errs.push(`${w}.parent が存在しない: ${parent}`);
      if (SLUG_RE.test(String(p.id || ''))) created.add(p.id);
    });

    const revised = {};
    revisions.forEach((r, i) => {
      const w = `revisions[${i}]`;
      if (!known.has(r.page)) errs.push(`${w}.page が既存ページではない: ${r.page}`);
      else if (revised[r.page]) errs.push(`${w}.page を1回の apply で2回直せない: ${r.page}`);
      else revised[r.page] = meta.pages[r.page].versions + 1;
      if (!String(r.markdown || '').trim()) errs.push(`${w}.markdown が空`);
    });

    const normReplies = replies.map((r, i) => {
      const w = `replies[${i}]`;
      if (!th.threads.some((t) => t.id === r.thread)) errs.push(`${w}.thread が存在しない: ${r.thread}`);
      if (!String(r.body || '').trim()) errs.push(`${w}.body が空`);
      if (r.page != null && !hasPage(r.page)) errs.push(`${w}.page が存在しない: ${r.page}`);
      return { ...r, ask: normAsk(r.ask, w, errs) };
    });
    const normNew = newThreads.map((r, i) => {
      const w = `threads[${i}]`;
      if (!hasPage(r.page)) errs.push(`${w}.page が存在しない: ${r.page}`);
      if (!String(r.body || '').trim()) errs.push(`${w}.body が空`);
      if (r.link != null && !hasPage(r.link)) errs.push(`${w}.link が存在しない: ${r.link}`);
      return { ...r, ask: normAsk(r.ask, w, errs) };
    });

    const pendingRounds = listRounds(slug).filter((r) => r.status === 'pending');
    let handle = pendingRounds;
    if (P.round != null) {
      handle = pendingRounds.filter((r) => r.round === Number(P.round));
      if (!handle.length) errs.push(`round ${P.round} は未処理ではありません`);
    }
    if (errs.length) throw new HttpError(400, errs.join('\n'));

    // ここから書き込み
    for (const p of newPages) {
      fs.mkdirSync(path.join(tdir(slug), 'pages', p.id), { recursive: true });
      fs.writeFileSync(pageFile(slug, p.id, 1), p.markdown);
      meta.pages[p.id] = { title: String(p.title).trim(), parent: p.parent || 'root', versions: 1, createdAt: now() };
    }
    for (const r of revisions) {
      const pg = meta.pages[r.page];
      pg.versions += 1;
      if (r.title) pg.title = String(r.title).trim();
      fs.writeFileSync(pageFile(slug, r.page, pg.versions), r.markdown);
    }
    const replied = [];
    for (const r of normReplies) {
      const t = th.threads.find((x) => x.id === r.thread);
      t.messages.push({
        id: nextId(th, 'm'), author: 'ai', kind: 'reply', at: now(), text: String(r.body), sent: true,
        ...(r.ask ? { ask: r.ask } : {}), ...(r.page ? { page: r.page } : {}),
        ...(revised[t.page] ? { revision: revised[t.page] } : {}),
      });
      replied.push(t.id);
    }
    const started = [];
    for (const r of normNew) {
      const pg = meta.pages[r.page] || { versions: 1 };
      const t = {
        id: nextId(th, 't'), page: r.page, version: pg.versions, anchor: normAnchor(r.anchor), resolved: false, resolveSent: true,
        createdAt: now(), origin: 'ai',
        messages: [{
          id: nextId(th, 'm'), author: 'ai', kind: 'reply', at: now(), text: String(r.body), sent: true,
          ...(r.ask ? { ask: r.ask } : {}), ...(r.link ? { page: r.link } : {}),
        }],
      };
      th.threads.push(t);
      started.push(t.id);
    }
    const handledNos = handle.map((r) => r.round);
    const unanswered = [];
    for (const r of handle) {
      r.status = 'handled';
      r.handledAt = now();
      writeJSON(path.join(tdir(slug), 'rounds', `${String(r.round).padStart(3, '0')}.json`), r);
      // 返信が要るのは、新しい発言があるとき、または再開されたとき（「解決」だけの通知には、返信しなくてよい）
      for (const it of r.items) if (!replied.includes(it.thread) && (it.new.length || it.userMarked === 'reopened')) unanswered.push(it.thread);
    }
    meta.pending = (meta.pending || []).filter((n) => !handledNos.includes(n));
    return {
      ok: true, handledRounds: handledNos, newPages: [...created], revised, repliedThreads: replied, newThreads: started,
      ...(unanswered.length ? { unansweredThreads: unanswered, warning: '返信していないスレッドがあります' } : {}),
    };
  });
}

function cmdStatus(slug) {
  const topics = slug ? [loadMeta(slug)] : listTopics();
  out(topics.map((m) => {
    if (!isSupported(m)) return { topic: m.slug, title: topicTitle(m), unsupported: true, schema: schemaOf(m) };
    const th = loadThreads(m.slug);
    return {
      topic: m.slug, title: m.title, closed: !!m.closed,
      pendingRounds: (m.pending || []),
      unsentInBrowser: countUnsent(th),
      openThreads: th.threads.filter((t) => !t.resolved).length,
      progress: progressOf(th.threads),
      pages: Object.fromEntries(Object.entries(m.pages).map(([id, p]) => [id, { title: p.title, parent: p.parent, versions: p.versions, file: pageFile(m.slug, id, p.versions) }])),
    };
  }));
}

// ---------------------------------------------------------------- サーバー

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.json': 'application/json; charset=utf-8',
};

function parseCookies(req) {
  const o = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) o[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return o;
}
function tokenOk(given) {
  const g = String(given || '');
  return g.length === TOKEN.length && crypto.timingSafeEqual(Buffer.from(g), Buffer.from(TOKEN));
}
function denyReason(req, url) {
  const host = (req.headers.host || '').trim();
  if (host !== `127.0.0.1:${PORT}` && host !== `localhost:${PORT}`) return 'ホスト名が違います';
  const origin = req.headers.origin;
  if (origin && origin !== `http://127.0.0.1:${PORT}` && origin !== `http://localhost:${PORT}`) return '別のページからは操作できません';
  const given = req.headers['x-rikai-token'] || parseCookies(req).rikai_t || '';
  if (!tokenOk(given)) return '合言葉が違います';
  return null;
}

function send(res, status, body, headers = {}) {
  const isObj = typeof body === 'object' && !Buffer.isBuffer(body);
  res.writeHead(status, {
    'Content-Type': isObj ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers,
  });
  res.end(isObj ? JSON.stringify(body) : body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new HttpError(413, '大きすぎます')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (_) { reject(new HttpError(400, 'JSON が不正です')); }
    });
    req.on('error', reject);
  });
}

function serveFile(res, file, extra = {}) {
  let st;
  try { st = fs.statSync(file); } catch (_) { return send(res, 404, 'not found'); }
  if (!st.isFile()) return send(res, 404, 'not found');
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Content-Length': st.size, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra,
  });
  fs.createReadStream(file).pipe(res);
}

const INDEX_CSP = "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  try {
    const p = url.pathname;

    if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
      const host = (req.headers.host || '').trim();
      if (host !== `127.0.0.1:${PORT}` && host !== `localhost:${PORT}`) return send(res, 403, 'forbidden');
      const t = url.searchParams.get('t');
      if (t && tokenOk(t)) {
        return send(res, 302, '', { Location: '/', 'Set-Cookie': `rikai_t=${TOKEN}; HttpOnly; SameSite=Strict; Path=/` });
      }
      if (!tokenOk(parseCookies(req).rikai_t)) return send(res, 403, 'rikai の URL から開き直してください（合言葉が必要です）');
      return serveFile(res, path.join(PUBLIC, 'index.html'), { 'Content-Security-Policy': INDEX_CSP });
    }

    if (req.method === 'GET' && (p === '/app.js' || p === '/anchor.js' || p === '/diff.js' || p === '/progress.js' || p === '/style.css' || p === '/favicon.svg' || p.startsWith('/vendor/'))) {
      const file = path.resolve(PUBLIC, '.' + p);
      if (!file.startsWith(PUBLIC + path.sep)) return send(res, 403, 'forbidden');
      return serveFile(res, file);
    }

    if (req.method === 'GET' && p.startsWith('/asset/')) {
      const deny = denyReason(req, url);
      if (deny) return send(res, 403, deny);
      const m = /^\/asset\/([^/]+)\/(.+)$/.exec(p);
      if (!m) return send(res, 404, 'not found');
      const slug = decodeURIComponent(m[1]);
      checkSlug(slug);
      loadMeta(slug); // 読めない形のトピックの画像も、配らない（409）
      const dir = path.join(tdir(slug), 'assets');
      const file = path.resolve(dir, decodeURIComponent(m[2]));
      if (!file.startsWith(dir + path.sep)) return send(res, 403, 'forbidden');
      // 直接開かれても中のスクリプトを動かさない
      return serveFile(res, file, { 'Content-Security-Policy': 'sandbox' });
    }

    if (p.startsWith('/api/')) {
      const deny = denyReason(req, url);
      if (deny) return send(res, 403, { ok: false, error: `${deny}。rikai の URL から開き直してください。` });

      if (req.method === 'GET') {
        if (p === '/api/ping') return send(res, 200, { ok: true, root: ROOT });
        if (p === '/api/topics') {
          return send(res, 200, listTopics().map((m) => (isSupported(m)
            ? { slug: m.slug, title: m.title, closed: !!m.closed, pending: (m.pending || []).length, rev: m.rev, progress: progressOf(loadThreads(m.slug).threads), unsupported: false }
            : { slug: m.slug, title: topicTitle(m), unsupported: true })));
        }
        let m = /^\/api\/topic\/([^/]+)$/.exec(p);
        if (m) {
          const slug = decodeURIComponent(m[1]);
          const since = Number(url.searchParams.get('since'));
          const meta = loadMeta(slug);
          if (since && since === meta.rev) return send(res, 200, { unchanged: true, rev: meta.rev });
          return send(res, 200, topicState(slug));
        }
        m = /^\/api\/page\/([^/]+)\/([^/]+)\/(\d+)$/.exec(p);
        if (m) {
          const [slug, page, v] = [decodeURIComponent(m[1]), decodeURIComponent(m[2]), Number(m[3])];
          const meta = loadMeta(slug);
          const pg = meta.pages[page];
          if (!pg || v < 1 || v > pg.versions) throw new HttpError(404, 'ページがありません');
          return send(res, 200, { markdown: fs.readFileSync(pageFile(slug, page, v), 'utf8') });
        }
        throw new HttpError(404, 'not found');
      }

      if (req.method === 'POST') {
        const name = p.slice('/api/'.length);
        if (!Object.prototype.hasOwnProperty.call(actions, name)) throw new HttpError(404, 'not found');
        const b = await readBody(req);
        checkSlug(b.topic);
        return send(res, 200, { ok: true, ...actions[name](b) });
      }
    }
    send(res, 404, 'not found');
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.status, { ok: false, error: e.message });
    console.error(e);
    send(res, 500, { ok: false, error: '内部エラー' });
  }
}

function shutdown() {
  try {
    const info = readJSON(serverFile(), null);
    if (info && info.pid === process.pid) fs.unlinkSync(serverFile());
  } catch (_) {}
  process.exit(0);
}

// サーバーを起こして、待ち受けを始める（ポートは空きポート）。テストも使う
function startServer() {
  ensureBase();
  TOKEN = crypto.randomBytes(24).toString('hex');
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      PORT = server.address().port;
      resolve({ server, port: PORT, token: TOKEN });
    });
  });
}

function cmdServe() {
  // 合言葉を含むので、自分だけが読める権限（0600）で置く
  startServer().then(({ port, token }) => {
    writeJSON(serverFile(), { pid: process.pid, port, token, root: ROOT, startedAt: now() }, 0o600);
  });
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

// ---------------------------------------------------------------- 起動まわり

function pingServer(info) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: info.port, path: '/api/ping', headers: { 'x-rikai-token': info.token }, timeout: 1000 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

async function ensureServer() {
  ensureBase();
  const cur = readJSON(serverFile(), null);
  if (cur && (await pingServer(cur))) return cur;
  try { fs.unlinkSync(serverFile()); } catch (_) {}
  const log = fs.openSync(path.join(BASE, '.server.log'), 'a');
  const child = cp.spawn(process.execPath, [SELF, 'serve', '--root', ROOT], { detached: true, stdio: ['ignore', log, log] });
  child.unref();
  for (let i = 0; i < 50; i++) {
    await sleep(100);
    const info = readJSON(serverFile(), null);
    if (info && (await pingServer(info))) return info;
  }
  throw new Error(`サーバーを起動できませんでした。${path.join(BASE, '.server.log')} を確認してください`);
}

function openBrowser(url) {
  if (process.env.NO_OPEN) return;
  const cmd = process.platform === 'darwin' ? ['open', url] : process.platform === 'win32' ? ['cmd', '/c', 'start', '', url] : ['xdg-open', url];
  try { cp.spawn(cmd[0], cmd.slice(1), { detached: true, stdio: 'ignore' }).on('error', () => {}).unref(); } catch (_) {}
}

async function cmdOpen(slug, flags) {
  loadMeta(slug);
  const info = await ensureServer();
  mutate(slug, (m) => { m.closed = false; return {}; });
  const url = `http://127.0.0.1:${info.port}/?t=${info.token}#/${slug}/root`;
  if (!flags['no-open']) openBrowser(url);
  out({ ok: true, url, root: ROOT, dir: tdir(slug) });
}

function cmdStop() {
  const info = readJSON(serverFile(), null);
  if (!info) return out({ ok: true, stopped: false });
  try { process.kill(info.pid, 'SIGTERM'); } catch (_) {}
  try { fs.unlinkSync(serverFile()); } catch (_) {}
  out({ ok: true, stopped: true });
}

function readStdin() {
  if (process.stdin.isTTY) throw new HttpError(400, '標準入力で渡してください');
  return fs.readFileSync(0, 'utf8');
}

const HELP = `rikai <command>
  new <topic> --title <題名> [--source <対象>]   標準入力のMarkdownから新しいトピックを作る
  open <topic> [--no-open]                       ビューアを起動して URL を出す
  poll <topic> [--timeout 秒]                    Submit されるまで待ち、コメントのバッチを出力する（Claude Code 向け）
  pull <topic>                                   待たずに、未処理のバッチがあれば出力する（「送った」と言われたとき）
  apply <topic>                                  標準入力のJSONで返信・新版・子ページを反映する
  status [topic]                                 未処理のバッチなどを出す
  stop                                           サーバーを止める
  共通: --root <dir>  プロジェクトルート（省略時は git のルート、なければ cwd）`;

function setRoot(root) {
  ROOT = root;
  BASE = path.join(ROOT, '.rikai');
}

async function main() {
  const { pos, flags } = parseArgs(process.argv.slice(2));
  const cmd = pos[0];
  setRoot(projectRoot(flags));
  const slug = pos[1];
  try {
    switch (cmd) {
      case 'serve': return cmdServe();
      case 'new': {
        const meta = newTopic(slug, flags.title, flags.source, readStdin());
        return out({ ok: true, topic: meta.slug, dir: tdir(meta.slug), rootPage: pageFile(meta.slug, 'root', 1), assets: path.join(tdir(meta.slug), 'assets') });
      }
      case 'open': return await cmdOpen(slug, flags);
      case 'poll': return await cmdPoll(slug, flags);
      case 'pull': return cmdPull(slug);
      case 'apply': {
        let payload;
        try { payload = JSON.parse(readStdin()); } catch (e) { if (e instanceof HttpError) throw e; throw new HttpError(400, `JSON が不正です: ${e.message}`); }
        return out(cmdApply(slug, payload));
      }
      case 'status': return cmdStatus(slug);
      case 'stop': return cmdStop();
      default: console.log(HELP);
    }
  } catch (e) {
    out({ ok: false, errors: String(e.message).split('\n') });
    process.exit(1);
  }
}

if (require.main === module) main();

module.exports = {
  setRoot, HttpError, SCHEMA, checkSlug, newTopic, mutate, loadMeta, loadThreads, listRounds, pageFile, tdir,
  normAsk, normAnswer, actions, hooks, peek, cmdApply, cmdStatus, startServer,
};
