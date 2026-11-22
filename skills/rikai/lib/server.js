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
const { appsOfAsync, APP_MAX, DOC_MAX } = require('./htmlapp.js');

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

// 画面の CSP。枠（html-app）は、この画面のサーバーの `/appframe/` のものだけ、入れられる（同じオリジンの、ほかの URL〔/api・/asset など〕は、入れられない）。host は、検査済み（127.0.0.1:PORT か localhost:PORT）
const indexCsp = (host) => `default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-src http://${host}/appframe/; object-src 'none'; base-uri 'none'; form-action 'none'`;

// 実行できる枠（html-app）：AI が書いた JavaScript を、**隔離して**動かす。画面（indexCsp）とは、別の文書として配る。
// - `sandbox allow-scripts`（allow-same-origin なし）：オリジンのない文書になり、画面の DOM・Cookie・合言葉・localStorage に、触れない。
//   ポップアップ・上の画面の移動・フォームの送信・ダウンロード・ポインタのロックも、できない（枠の iframe 属性にも、同じ sandbox を付ける）
// - `default-src 'none'`・`connect-src 'none'`：外への通信（fetch・XHR・WebSocket・画像・フォント・外のスクリプト）を、すべて止める。
//   読めるのは、文書の中のものだけ（インラインのスクリプト・スタイル・data: の画像・フォント）。eval は、使えない
// - `frame-src 'none'`・`object-src 'none'`・`base-uri 'none'`・`form-action 'none'`・`frame-ancestors 'self'`（この画面の枠としてだけ、入れられる）
// - `X-DNS-Prefetch-Control: off`：DNS の先読みを止める（枠の中の `<link rel=dns-prefetch>` など）
// 止められないもの（既知の限界）：**WebRTC**（STUN・TURN への通信。CSP の `connect-src` の対象でなく、`webrtc` ディレクティブも、Chrome 150 では効かない〔実測〕。枠の中に、`srcdoc` の iframe を作ると、
// 子の文書は、新しい realm で、元の RTCPeerConnection を持つ。`frame-src` は、`about:srcdoc`・`about:blank` を止めない。直接呼ぶ道だけを塞ぐ補助は、迂回できるので、置かない）・（DNS の先読みの、一部）。
// 枠の中には、画面の秘密は渡らない（上のとおり、触れない）。枠の中で、利用者が入力した文字は、外へ出せる（枠の見出しで、秘密を入れないよう伝える）
const APP_CSP = "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";

// 枠の中身の取り出し：資料の字句解析は、別のスレッドで、時間を切って行う（AI が書いた資料は、非信頼。入れ子の箇条書きなどで、解析が、とても遅くなりうる）。
// 結果は、版ごとに覚える（版は変わらない。ファイルの更新時刻・大きさが変わったら、捨てる）。大きな結果は、覚えない。失敗（時間切れ・例外）も、60 秒、覚える
// （悪意のある資料が、枠を開くたびに、3 秒の worker を起こさないように）。同じ資料の、進行中の解析は、共有する。同時に動かす worker は、2 つまで
const APP_CACHE = new Map(); // `${トピック}/${ページ}/${版}` → { mtimeMs, size, apps } か { mtimeMs, size, error, at }
const APP_PENDING = new Map(); // `${鍵}#${更新時刻}/${大きさ}` → 進行中の解析（Promise）
const APP_FAIL_MS = 60 * 1000;
let appWorkers = 0;
const appWaiters = [];
async function withWorkerSlot(fn) {
  while (appWorkers >= 2) await new Promise((resolve) => appWaiters.push(resolve));
  appWorkers++;
  try { return await fn(); } finally { appWorkers--; const next = appWaiters.shift(); if (next) next(); }
}
async function appsOfPage(slug, page, v) {
  const file = pageFile(slug, page, v);
  const st = fs.statSync(file);
  if (st.size > DOC_MAX) throw new HttpError(413, '資料が大きすぎて、枠を取り出せません');
  const key = `${slug}/${page}/${v}`;
  const hit = APP_CACHE.get(key);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) {
    if (!hit.error) return hit.apps;
    if (Date.now() - hit.at < APP_FAIL_MS) throw new HttpError(422, hit.error);
  }
  const pendingKey = `${key}#${st.mtimeMs}/${st.size}`;
  let job = APP_PENDING.get(pendingKey);
  if (!job) {
    job = withWorkerSlot(() => appsOfAsync(fs.readFileSync(file, 'utf8')))
      .then((apps) => ({ apps }), (e) => ({ error: e && e.reason === 'timeout' ? '資料が複雑すぎて、枠を取り出せません（時間切れ）' : '資料が複雑すぎて、枠を取り出せません' }))
      .finally(() => APP_PENDING.delete(pendingKey));
    APP_PENDING.set(pendingKey, job);
  }
  const r = await job;
  const small = r.error || r.apps.reduce((n, a) => n + a.length, 0) <= 1024 * 1024;
  if (small) {
    if (APP_CACHE.size >= 32) APP_CACHE.delete(APP_CACHE.keys().next().value);
    APP_CACHE.set(key, { mtimeMs: st.mtimeMs, size: st.size, ...(r.error ? { error: r.error, at: Date.now() } : { apps: r.apps }) });
  }
  if (r.error) throw new HttpError(422, r.error);
  return r.apps;
}

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
      return serveFile(res, path.join(PUBLIC, 'index.html'), { 'Content-Security-Policy': indexCsp(host) });
    }

    if (req.method === 'GET' && (p === '/app.js' || p === '/anchor.js' || p === '/diff.js' || p === '/progress.js' || p === '/fmt.js' || p === '/style.css' || p === '/favicon.svg' || p.startsWith('/vendor/'))) {
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

    // 実行できる枠の中身：同じ版の資料から、n 番目の html-app フェンスを取り出して、隔離する CSP つきで配る（クライアントが送った中身は、使わない）
    if (req.method === 'GET' && p.startsWith('/appframe/')) {
      const deny = denyReason(req, url);
      if (deny) return send(res, 403, deny);
      const m = /^\/appframe\/([^/]+)\/([^/]+)\/(\d+)\/(\d+)$/.exec(p);
      if (!m) return send(res, 404, 'not found');
      let slug, page;
      try { slug = decodeURIComponent(m[1]); page = decodeURIComponent(m[2]); } catch (_) { return send(res, 404, 'not found'); }
      const [v, n] = [Number(m[3]), Number(m[4])];
      checkSlug(slug);
      const meta = loadMeta(slug);
      const pg = Object.prototype.hasOwnProperty.call(meta.pages, page) ? meta.pages[page] : null;
      if (!pg || v < 1 || v > pg.versions) return send(res, 404, 'not found');
      const apps = await appsOfPage(slug, page, v);
      const app = apps[n];
      if (app === undefined) return send(res, 404, 'not found');
      if (app.length > APP_MAX) return send(res, 413, '枠の中身が大きすぎます');
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer', 'X-DNS-Prefetch-Control': 'off', 'Content-Security-Policy': APP_CSP,
      });
      return res.end(`<!doctype html>\n<meta charset="utf-8">\n${app}`);
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
          return send(res, 200, { ...topicState(slug), appframe: true }); // appframe：この画面のサーバーが、実行できる枠（/appframe）を配れる（画面が、古いサーバーを見分ける）
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
