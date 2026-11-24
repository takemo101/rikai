// ローカルの HTTP アプリ（Hono）：画面の配信・読み取りの API・画面からの操作（actions）。
// 合言葉（token）・Host・Origin を確かめる。ストア・合言葉・ポート・操作は、createApp の引数で渡す（モジュールの状態を持たない）。
// 待ち受け（127.0.0.1・ポート）は serve.ts。ここは、要求を受けて応答を返すだけなので、`app.request()` で、ポートを開かずに試せる。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { zValidator } from '@hono/zod-validator';
import { type Context, Hono, type MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { streamSSE } from 'hono/streaming';
import { apiBodies, topicQuery } from '../shared/api';
import { FRESH_TOPICS_MAX, freshWindow } from '../shared/fresh';
import { IMG_MAX_BYTES } from '../shared/image';
import type { PageInfo } from '../shared/types';
import type { Actions } from './actions';
import { createAppFrames } from './appframe';
import { frameDocument, parseMode } from './appframe-bridge';
import { APP_MAX } from './htmlapp';
import { checkSlug, isSupported, type Store, topicTitle } from './store';
import { HttpError } from './util';
import { type ChangeFeed, createChangeFeed } from './watch';

export interface AppOptions {
  store: Store;
  /** 合言葉。画面を開く URL の `?t=` か、Cookie・`x-rikai-token` で、受ける */
  token: string;
  /** 待ち受けているポート。Host・Origin の検査と、Cookie の名前に使う */
  port: number;
  /** 画面（Vite のビルド：index.html・favicon.svg・assets/）の置き場。この下の、`/assets/*` と `/favicon.svg` だけを配る */
  publicDir: string;
  actions: Actions;
  /** 変更の通知（`GET /api/events`）。省略すると、このアプリが作る（`serve.ts` は、自分で作って渡す。テストが、`fs.watch` の差し替えなどをするため。閉じる関数はない：購読は、切断で解け、終了は、プロセスの終了） */
  feed?: ChangeFeed;
  /** `GET /api/events` の、同時接続の上限（既定 20）。超えたら 503 */
  maxEvents?: number;
  /** `GET /api/events` の、`: ping`（コメント行。途中の機器に切られない・切れたことに気づく）を送る間隔（ミリ秒。既定 15 秒） */
  pingMs?: number;
}

export const MAX_EVENTS = 20;
export const PING_MS = 15_000;

const MAX_BODY = 2 * 1024 * 1024;
const MAX_ATTACH_BODY = Math.ceil(IMG_MAX_BYTES / 3) * 4 + 4096; // 画像（base64 で 4/3 倍）と、JSON の枠

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.json': 'application/json; charset=utf-8',
};

// 画面が配る、public/ の中のもの：`/favicon.svg` と、Vite の出力の `/assets/*`（ファイル名にハッシュは付けない。どの応答も `no-store`）（それ以外は、配らない。index.html は、別の経路）
const FAVICON_PATH = '/favicon.svg';
const ASSETS_PREFIX = '/assets/';

// 画面の CSP。枠（html-app）は、この画面のサーバーの `/appframe/` のものだけ、入れられる（同じオリジンの、ほかの URL〔/api・/asset など〕は、入れられない）。host は、検査済み（127.0.0.1:PORT か localhost:PORT）
const indexCsp = (host: string): string =>
  `default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-src http://${host}/appframe/; object-src 'none'; base-uri 'none'; form-action 'none'`;

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
const APP_CSP =
  "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";

// ---- 応答（`send`・`serveFile`）。どの応答も、Cache-Control: no-store・nosniff を付ける ----
const BASE_HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } as const;
const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', ...BASE_HEADERS } as const;

const textResponse = (status: number, body: string, headers: Record<string, string> = {}): Response =>
  new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', ...BASE_HEADERS, ...headers } });
const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
const notFoundText = (): Response => textResponse(404, 'not found');

function serveFile(file: string, extra: Record<string, string> = {}): Response {
  let st: fs.Stats;
  try {
    st = fs.statSync(file);
  } catch {
    return notFoundText();
  }
  if (!st.isFile()) return notFoundText();
  const body = Readable.toWeb(fs.createReadStream(file)) as unknown as ReadableStream<Uint8Array>;
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': String(st.size),
      ...BASE_HEADERS,
      ...extra,
    },
  });
}

function parseCookies(header: string | undefined): Map<string, string> {
  const o = new Map<string, string>();
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) o.set(part.slice(0, i).trim(), part.slice(i + 1).trim());
  }
  return o;
}

// URL のパスの部分の、%XX の符号を戻す。壊れた符号は、URIError（呼ぶ側が、404 にするか、内部エラーにする）
const decode = (s: string): string => decodeURIComponent(s);

// 本文の読み込み：上限を、読みながら数える（Content-Length を信用しない）。超えたら 413。空の本文は `{}`。
// zValidator('json') は、JSON の Content-Type の要求しか読まない（本文の Content-Type は見ない）ので、読んだ文字列を、
// Content-Type を足した要求に載せ直す。JSON が不正なら、zValidator が 400 の例外にする（onError で、400 'JSON が不正です' にそろえる）
function jsonBody(max: number): MiddlewareHandler {
  return async (c, next) => {
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = c.req.raw.body?.getReader();
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > max) {
          void reader.cancel();
          throw new HttpError(413, '大きすぎます');
        }
        chunks.push(value);
      }
    }
    // 先頭の BOM は、JSON ではない（JSON.parse が落として 400）。載せ直すと、Request の本文の読み取りが BOM を落とすので、ここで断る
    const text = Buffer.concat(chunks).toString('utf8');
    if (text.startsWith('\uFEFF')) throw new HttpError(400, 'JSON が不正です');
    const headers = new Headers(c.req.raw.headers);
    headers.set('Content-Type', 'application/json');
    headers.delete('Content-Length');
    headers.delete('Transfer-Encoding');
    c.req.raw = new Request(c.req.raw.url, { method: c.req.raw.method, headers, body: text || '{}' });
    await next();
  };
}

/** 操作を実行する。トピック名の検査（checkSlug）が先。形（Zod）は、型のためで、意味の検査は、操作が行う */
function run<B extends { topic: string }, R extends object>(fn: (b: B) => R, b: B): R {
  checkSlug(b.topic);
  return fn(b);
}

/**
 * Zod の形に合わない本文の扱い。形は見ずに、checkSlug → 操作の検査へ進める（文言・状態コードは、そこで決まる）。
 * 同じ応答にそろえるため、失敗しても、同じ道（run）へ、受け取ったままの本文を流す（Zod は、hc の型のため）
 */
const lenient =
  <B extends { topic: string }, R extends object>(fn: (b: B) => R) =>
  (r: { success: boolean; data: unknown }): Response | undefined =>
    r.success ? undefined : jsonResponse(200, { ok: true, ...run(fn, r.data as B) });

export function createApp(opts: AppOptions) {
  const { store, token, port, actions } = opts;
  const feed = opts.feed ?? createChangeFeed(store);
  const maxEvents = opts.maxEvents ?? MAX_EVENTS;
  const pingMs = opts.pingMs ?? PING_MS;
  const publicDir = path.resolve(opts.publicDir);
  const frames = createAppFrames(store);
  const tokenBuf = Buffer.from(token);

  // 合言葉の Cookie の名前に、ポートを入れる。ブラウザの Cookie は、ポートで分かれない（127.0.0.1 で共有）ので、
  // 名前が固定だと、別のプロジェクトの rikai サーバーを開いたとき、先に開いていた画面の Cookie が上書きされて 403 になる
  const cookieName = `rikai_t_${port}`;
  // 合言葉の、定数時間の比較（長さが違えば、比べずに、不一致）
  const tokenOk = (given: unknown): boolean => {
    const g = Buffer.from(String(given || ''));
    return g.length === tokenBuf.length && crypto.timingSafeEqual(g, tokenBuf);
  };
  const hostOf = (c: Context): string => (c.req.header('host') ?? '').trim();
  const hostOk = (host: string): boolean => host === `127.0.0.1:${port}` || host === `localhost:${port}`;
  function denyReason(c: Context): string | null {
    if (!hostOk(hostOf(c))) return 'ホスト名が違います';
    const origin = c.req.header('origin');
    if (origin && origin !== `http://127.0.0.1:${port}` && origin !== `http://localhost:${port}`)
      return '別のページからは操作できません';
    const given = c.req.header('x-rikai-token') || parseCookies(c.req.header('cookie')).get(cookieName) || '';
    if (!tokenOk(given)) return '合言葉が違います';
    return null;
  }

  // 読み取りの API と、画面からの操作（POST）。パスは、/api の下（hc の型は、ここから）
  const api = new Hono()
    .get('/ping', (c) => c.json({ ok: true as const, root: store.root }, 200, JSON_HEADERS))
    .get('/topics', (c) => {
      // fresh（新着の判定に使う ID。F46）：通知の対象（閉じていない・読める形式）の**すべてに**付ける。窓（各項目の上限）は、対象の数で割った大きさ（`fresh.window`。画面が、窓の変化を見分ける）。
      // 対象が `FRESH_TOPICS_MAX` を超えるときだけ、予算を超える：更新が新しいトピックから順に、その数だけ付ける
      const metas = store.listTopics();
      const targets = metas.filter((m) => isSupported(m) && !m.closed);
      const window = freshWindow(targets.length);
      const withFresh = new Set(
        (targets.length > FRESH_TOPICS_MAX
          ? [...targets].sort((x, y) => store.updatedAt(y.slug) - store.updatedAt(x.slug)).slice(0, FRESH_TOPICS_MAX)
          : targets
        ).map((m) => m.slug),
      );
      return c.json(
        metas.map((m) => {
          if (!isSupported(m)) return { slug: m.slug, title: topicTitle(m), unsupported: true as const };
          const sum = store.summaryOrNull(m, window);
          const fresh = sum && withFresh.has(m.slug) ? sum.fresh : undefined;
          return {
            slug: m.slug,
            title: m.title,
            closed: !!m.closed,
            pending: (m.pending || []).length,
            rev: m.rev,
            progress: sum?.progress ?? null,
            ...(fresh ? { fresh } : {}),
            unsupported: false as const,
          };
        }),
        200,
        JSON_HEADERS,
      );
    })
    // since：画面が、前に受け取った rev。同じなら、`{ unchanged: true }` だけを返す（型のための Zod。読み取りは、下で行う）
    .get(
      '/topic/:slug',
      zValidator('query', topicQuery, () => undefined),
      (c) => {
        const slug = decode(c.req.path.slice('/api/topic/'.length));
        const since = Number(new URL(c.req.url).searchParams.get('since'));
        const meta = store.loadMeta(slug);
        if (since && since === meta.rev) return c.json({ unchanged: true as const, rev: meta.rev }, 200, JSON_HEADERS);
        // appframe：この画面のサーバーが、実行できる枠（/appframe）を配れる（画面が、古いサーバーを見分ける）
        return c.json({ ...store.topicState(slug), appframe: true as const }, 200, JSON_HEADERS);
      },
    )
    // 変更の通知（SSE）：「変わった」という通知だけを送る（データは送らない。画面は、既存の取得をすぐ実行する）。
    // `ready`：つながった直後（再接続のあとも。画面が全体を取り直す合図）・`changed`：`{topics:true}` か `{slug,rev}`（shared/api.ts の ChangedEvent）・`: ping`：15 秒ごと。
    // 認証は、/api/ の入口の検査（Host・Origin・合言葉）が済んでいる。切断・終了で、購読とタイマーを解く
    .get('/events', (c) => {
      if (feed.size >= maxEvents) return jsonResponse(503, { ok: false, error: '接続が多すぎます' });
      const res = streamSSE(c, async (stream) => {
        const end = Promise.withResolvers<void>();
        // 書き込みの失敗（切断）は、Hono の StreamingApi が握りつぶす。後始末は、下の onAbort（切断）で行う
        const send = (event: string, data: unknown): void => {
          void stream.writeSSE({ event, data: JSON.stringify(data) });
        };
        // 購読を、`ready` より先に始める（このあとの変化を、取りこぼさない）。ここは、上の上限の確認と、同じ回の中
        const unsubscribe = feed.subscribe((e) => send('changed', e));
        const ping = setInterval(() => {
          void stream.write(': ping\n\n');
        }, pingMs);
        stream.onAbort(end.resolve);
        try {
          send('ready', {});
          await end.promise;
        } finally {
          clearInterval(ping);
          unsubscribe();
        }
      });
      res.headers.set('Cache-Control', 'no-store'); // streamSSE は no-cache にする。ほかの応答と同じ
      res.headers.set('X-Content-Type-Options', 'nosniff');
      return res;
    })
    .get('/page/:slug/:page/:v', (c) => {
      const parts = c.req.path.slice('/api/page/'.length).split('/');
      if (parts.length !== 3 || !/^\d+$/.test(parts[2] as string)) throw new HttpError(404, 'not found'); // 版は、数字だけ
      const [slug, page, v] = [decode(parts[0] as string), decode(parts[1] as string), Number(parts[2])];
      const meta = store.loadMeta(slug);
      const pg = meta.pages[page] as PageInfo | undefined;
      if (!pg || v < 1 || v > pg.versions) throw new HttpError(404, 'ページがありません');
      return c.json({ markdown: fs.readFileSync(store.pageFile(slug, page, v), 'utf8') }, 200, JSON_HEADERS);
    })
    // 操作の本文：上限（attach は、画像の base64 の大きさ）→ JSON の形（Zod）→ トピック名 → 操作
    .post('/attach', jsonBody(MAX_ATTACH_BODY), zValidator('json', apiBodies.attach, lenient(actions.attach)), (c) =>
      c.json({ ok: true as const, ...run(actions.attach, c.req.valid('json')) }, 200, JSON_HEADERS),
    )
    .post('/comment', jsonBody(MAX_BODY), zValidator('json', apiBodies.comment, lenient(actions.comment)), (c) =>
      c.json({ ok: true as const, ...run(actions.comment, c.req.valid('json')) }, 200, JSON_HEADERS),
    )
    .post('/reply', jsonBody(MAX_BODY), zValidator('json', apiBodies.reply, lenient(actions.reply)), (c) =>
      c.json({ ok: true as const, ...run(actions.reply, c.req.valid('json')) }, 200, JSON_HEADERS),
    )
    .post('/answer', jsonBody(MAX_BODY), zValidator('json', apiBodies.answer, lenient(actions.answer)), (c) =>
      c.json({ ok: true as const, ...run(actions.answer, c.req.valid('json')) }, 200, JSON_HEADERS),
    )
    .post('/edit', jsonBody(MAX_BODY), zValidator('json', apiBodies.edit, lenient(actions.edit)), (c) =>
      c.json({ ok: true as const, ...run(actions.edit, c.req.valid('json')) }, 200, JSON_HEADERS),
    )
    .post('/delete', jsonBody(MAX_BODY), zValidator('json', apiBodies.delete, lenient(actions.delete)), (c) =>
      c.json({ ok: true as const, ...run(actions.delete, c.req.valid('json')) }, 200, JSON_HEADERS),
    )
    .post('/resolve', jsonBody(MAX_BODY), zValidator('json', apiBodies.resolve, lenient(actions.resolve)), (c) =>
      c.json({ ok: true as const, ...run(actions.resolve, c.req.valid('json')) }, 200, JSON_HEADERS),
    )
    .post('/submit', jsonBody(MAX_BODY), zValidator('json', apiBodies.submit, lenient(actions.submit)), (c) =>
      c.json({ ok: true as const, ...run(actions.submit, c.req.valid('json')) }, 200, JSON_HEADERS),
    )
    .post('/end', jsonBody(MAX_BODY), zValidator('json', apiBodies.end, lenient(actions.end)), (c) =>
      c.json({ ok: true as const, ...run(actions.end, c.req.valid('json')) }, 200, JSON_HEADERS),
    );

  const indexPage = (c: Context): Response => {
    const host = hostOf(c);
    if (!hostOk(host)) return textResponse(403, 'forbidden');
    const t = new URL(c.req.url).searchParams.get('t');
    if (t && tokenOk(t)) {
      return textResponse(302, '', {
        Location: '/',
        'Set-Cookie': `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/`,
      });
    }
    if (!tokenOk(parseCookies(c.req.header('cookie')).get(cookieName)))
      return textResponse(403, 'rikai の URL から開き直してください（合言葉が必要です）');
    return serveFile(path.join(publicDir, 'index.html'), { 'Content-Security-Policy': indexCsp(host) });
  };

  const staticFile = (c: Context): Response => {
    const p = c.req.path;
    if (p === FAVICON_PATH) return serveFile(path.join(publicDir, 'favicon.svg'));
    if (!p.startsWith(ASSETS_PREFIX)) return notFoundText();
    const dir = path.join(publicDir, 'assets');
    const file = path.resolve(dir, p.slice(ASSETS_PREFIX.length));
    if (file !== dir && !file.startsWith(dir + path.sep)) return textResponse(403, 'forbidden'); // `/assets/` 自体は、パスの外ではない（ディレクトリなので、配らない：404）
    return serveFile(file);
  };

  const app = new Hono({
    // パスは、符号を戻さない、そのままの形で照合する（`%2F` などが、パスの区切りや、別の名前に化けない）。
    // 認証（下の use）も、この同じパスで決める（照合と認証で、パスの見え方が、ずれない）
    getPath: (req) => new URL(req.url).pathname,
  });

  app.onError((e) => {
    if (e instanceof HttpError) return jsonResponse(e.status, { ok: false, error: e.message });
    // zValidator('json') が、本文の JSON を読めなかったときの例外（これ以外に、HTTPException を投げるものはない）
    if (e instanceof HTTPException && e.status === 400)
      return jsonResponse(400, { ok: false, error: 'JSON が不正です' });
    console.error(e);
    return jsonResponse(500, { ok: false, error: '内部エラー' });
  });

  // /api/ の GET・POST で、どの道にも当たらないものは JSON の 404。それ以外は、文字の 404
  app.notFound((c) => {
    const m = c.req.method;
    if (c.req.path.startsWith('/api/') && (m === 'GET' || m === 'POST'))
      return jsonResponse(404, { ok: false, error: 'not found' });
    return notFoundText();
  });

  // 入口の検査：/api/（どの方法でも）・/asset/・/appframe/（GET）は、Host・Origin・合言葉を確かめる。
  // GET・POST 以外（HEAD など）は、検査のあと、404（Hono が、HEAD を GET として扱わないように）
  app.use(async (c, next) => {
    const p = c.req.path;
    const m = c.req.method;
    const inApi = p.startsWith('/api/');
    if (inApi || (m === 'GET' && (p.startsWith('/asset/') || p.startsWith('/appframe/')))) {
      const deny = denyReason(c);
      if (deny) {
        return inApi
          ? jsonResponse(403, { ok: false, error: `${deny}。rikai の URL から開き直してください。` })
          : textResponse(403, deny);
      }
    }
    if (m !== 'GET' && m !== 'POST') return notFoundText();
    await next();
  });

  app.get('/', indexPage);
  app.get('/index.html', indexPage);
  app.get(FAVICON_PATH, staticFile);
  app.get(`${ASSETS_PREFIX}*`, staticFile);

  // 画像：assets の中だけ。直接開かれても、中のスクリプトを動かさない（sandbox）
  app.get('/asset/*', (c) => {
    const m = /^\/asset\/([^/]+)\/(.+)$/.exec(c.req.path);
    if (!m) return notFoundText();
    const slug = decode(m[1] as string);
    checkSlug(slug);
    store.loadMeta(slug); // 読めない形のトピックの画像も、配らない（409）
    const dir = path.resolve(store.tdir(slug), 'assets');
    const file = path.resolve(dir, decode(m[2] as string));
    if (!file.startsWith(dir + path.sep)) return textResponse(403, 'forbidden');
    return serveFile(file, { 'Content-Security-Policy': 'sandbox' });
  });

  // 実行できる枠の中身：同じ版の資料から、n 番目の html-app フェンスを取り出して、隔離する CSP つきで配る（クライアントが送った中身は、使わない）。
  // 中身の前に、橋と土台のスタイルを差し込む（appframe-bridge.ts）。`?mode=light|dark` は、検査して、その外観で始める（それ以外は、無視）
  app.get('/appframe/*', async (c) => {
    const m = /^\/appframe\/([^/]+)\/([^/]+)\/(\d+)\/(\d+)$/.exec(c.req.path);
    if (!m) return notFoundText();
    let slug: string;
    let page: string;
    try {
      slug = decode(m[1] as string);
      page = decode(m[2] as string);
    } catch {
      return notFoundText();
    }
    const [v, n] = [Number(m[3]), Number(m[4])];
    checkSlug(slug);
    const meta = store.loadMeta(slug);
    const pg = Object.hasOwn(meta.pages, page) ? meta.pages[page] : null;
    if (!pg || v < 1 || v > pg.versions) return notFoundText();
    const apps = await frames.appsOfPage(slug, page, v);
    const frame = apps[n];
    if (frame === undefined) return notFoundText();
    if (frame.length > APP_MAX) return textResponse(413, '枠の中身が大きすぎます');
    return new Response(frameDocument(frame, parseMode(c.req.queries('mode'))), {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        ...BASE_HEADERS,
        'Referrer-Policy': 'no-referrer',
        'X-DNS-Prefetch-Control': 'off',
        'Content-Security-Policy': APP_CSP,
      },
    });
  });

  return app.route('/api', api);
}

/** 画面が使う、Hono RPC（`hc<AppType>`）の型 */
export type AppType = ReturnType<typeof createApp>;
