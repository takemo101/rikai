'use strict';
// ローカルの HTTP サーバー（127.0.0.1 だけ）：画面の配信・読み取りの API・画面からの操作（actions）。
// 合言葉（TOKEN）・Host・Origin を確かめる。PORT と TOKEN は、このモジュールの状態。
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { HttpError, readJSON } = require('./util.js');
const {
  getRoot, tdir, serverFile, ensureBase, checkSlug, isSupported, topicTitle, loadMeta, pageFile,
  listTopics, topicState, progressOrNull,
} = require('./store.js');
const { actions } = require('./actions.js');
const { IMG_MAX } = require('./image.js');

const PUBLIC = path.join(__dirname, '..', 'public');
const MAX_BODY = 2 * 1024 * 1024;
const MAX_ATTACH_BODY = Math.ceil(IMG_MAX / 3) * 4 + 4096; // 画像（base64 で 4/3 倍）と、JSON の枠

let PORT = 0;
let TOKEN = '';

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
// 合言葉の Cookie の名前に、ポートを入れる。ブラウザの Cookie は、ポートで分かれない（127.0.0.1 で共有）ので、
// 名前が固定だと、別のプロジェクトの rikai サーバーを開いたとき、先に開いていた画面の Cookie が上書きされて 403 になる
const cookieName = () => `rikai_t_${PORT}`;
function tokenOk(given) {
  const g = String(given || '');
  return g.length === TOKEN.length && crypto.timingSafeEqual(Buffer.from(g), Buffer.from(TOKEN));
}
function denyReason(req, url) {
  const host = (req.headers.host || '').trim();
  if (host !== `127.0.0.1:${PORT}` && host !== `localhost:${PORT}`) return 'ホスト名が違います';
  const origin = req.headers.origin;
  if (origin && origin !== `http://127.0.0.1:${PORT}` && origin !== `http://localhost:${PORT}`) return '別のページからは操作できません';
  const given = req.headers['x-rikai-token'] || parseCookies(req)[cookieName()] || '';
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

function readBody(req, max = MAX_BODY) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > max) { reject(new HttpError(413, '大きすぎます')); req.destroy(); return; }
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
        return send(res, 302, '', { Location: '/', 'Set-Cookie': `${cookieName()}=${TOKEN}; HttpOnly; SameSite=Strict; Path=/` });
      }
      if (!tokenOk(parseCookies(req)[cookieName()])) return send(res, 403, 'rikai の URL から開き直してください（合言葉が必要です）');
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
        if (p === '/api/ping') return send(res, 200, { ok: true, root: getRoot() });
        if (p === '/api/topics') {
          return send(res, 200, listTopics().map((m) => (isSupported(m)
            ? { slug: m.slug, title: m.title, closed: !!m.closed, pending: (m.pending || []).length, rev: m.rev, progress: progressOrNull(m.slug), unsupported: false }
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
        const b = await readBody(req, name === 'attach' ? MAX_ATTACH_BODY : MAX_BODY);
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

module.exports = { startServer, shutdown };
