// 実行できる枠（html-app）の橋（F28・F40）：枠の文書（対応を示した資料だけ、土台・data-theme が付く〔オプトイン〕。示さない従来の資料は、橋のスクリプトだけを足した、従来の文書）・
// `?mode=` の検査・隔離の CSP が変わっていないこと・土台のスタイルは、すべて詳細度 0（`:where()`）・橋のスクリプトの動き
// （本物のコードを、疑似の窓で動かす：揺れ防止・報告の回数・theme の検査〔by・data-follow〕）。
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { createApp } from '../../src/server/app';
import { BASE_STYLE, BRIDGE_SOURCE, frameDocument, parseMode } from '../../src/server/appframe-bridge';
import { BRIDGE_COLORS } from '../../src/shared/htmlapp-theme';
import { makeTopic, type Project, removeProject, tempProject } from './helpers';
import { PUBLIC_DIR } from './http-helpers';

// ---- 文書 ----

test('parseMode：light か dark が、ちょうど 1 つのときだけ。それ以外は、指定なし', () => {
  assert.equal(parseMode(['light']), 'light');
  assert.equal(parseMode(['dark']), 'dark');
  for (const bad of [
    undefined,
    [],
    [''],
    ['Dark'],
    ['evil"><script>alert(1)</script>'],
    ['light', 'dark'],
    ['dark', 'dark'],
    ['dark ', 'x'],
    [' dark'],
  ])
    assert.equal(parseMode(bad), null, JSON.stringify(bad));
});

const OPT_IN = '<p id="x" style="color:var(--color-ink)">中身 `$' + '{1}` </script-like> <b>1</b>';

test('frameDocument（対応を示した中身）：doctype・html（data-follow・data-theme）・文字コード・土台のスタイル・橋・AI の中身（そのまま、最後）の順', () => {
  const doc = frameDocument(OPT_IN, 'dark');
  assert.ok(doc.startsWith('<!doctype html>\n<html data-follow data-theme="dark">\n<meta charset="utf-8">\n<style>'));
  assert.ok(doc.endsWith(`</script>\n${OPT_IN}`), '中身が、そのまま、最後');
  const [style, script, body] = [doc.indexOf('<style>'), doc.indexOf('<script>'), doc.indexOf(OPT_IN)];
  assert.ok(0 < style && style < script && script < body, '土台・橋・中身の順');
  assert.ok(doc.includes(`<style>${BASE_STYLE}</style>`) && doc.includes(`<script>${BRIDGE_SOURCE}</script>`));
  assert.ok(frameDocument(OPT_IN, 'light').includes('<html data-follow data-theme="light">'));
  assert.ok(
    frameDocument(OPT_IN, null).startsWith('<!doctype html>\n<html data-follow>\n'),
    'mode なし：data-theme を付けない',
  );
  assert.ok(!BRIDGE_SOURCE.includes('</script'), '橋が、script を閉じない');
  assert.ok(!BASE_STYLE.includes('</style'));
});

test('frameDocument（対応を示さない従来の中身）：従来の文書に、橋の <script> だけを足したもの。土台・data-theme・data-follow・color-scheme・<html> を、入れない。mode は、使わない', () => {
  for (const content of [
    '<p>何も書かない資料</p>',
    '<style>body{margin:0;background:#f4f4f5;color:#222;font:16px serif}</style><div class="card">カード</div>',
    '<!doctype html><html lang="ja"><head><style>.c{background:#fff}</style></head><body><p class="c">全部書いた</p></body></html>',
  ]) {
    for (const mode of ['dark', 'light', null] as const) {
      const doc = frameDocument(content, mode);
      // Before（0.20.0）の文書：`<!doctype html>\n<meta charset="utf-8">\n${中身}`。違いは、橋の <script> だけ
      assert.equal(
        doc.replace(`<script>${BRIDGE_SOURCE}</script>\n`, ''),
        `<!doctype html>\n<meta charset="utf-8">\n${content}`,
      );
    }
  }
});

test('土台のスタイル：どの規則も、詳細度 0（:where()）。配色・フォントの変数がある。ライトは、白地・黒に近い文字', () => {
  // 規則（`{…}` の前）を、すべて取り出す。`@` の規則は使っていない
  const rules = BASE_STYLE.split('}')
    .map((r) => r.trim())
    .filter(Boolean);
  assert.ok(rules.length >= 8);
  for (const r of rules) assert.match(r, /^:where\(/, r.slice(0, 60));
  for (const sel of rules.map((r) => r.slice(0, r.indexOf('{'))))
    assert.equal(
      sel.replace(/:where\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\)/g, ''),
      '',
      `:where() の外に、セレクタがない：${sel}`,
    );
  // 橋が配る色は、全部（followsTheme の名前と、同じ定数 BRIDGE_COLORS から作る）
  for (const [v, pair] of Object.entries(BRIDGE_COLORS as Record<string, readonly string[]>))
    assert.ok(
      BASE_STYLE.includes(
        pair.length === 2 ? `--color-${v}:light-dark(${pair[0]},${pair[1]})` : `--color-${v}:${pair[0]}`,
      ),
      v,
    );
  for (const v of ['--font-sans:', '--font-mono:', '--radius:']) assert.ok(BASE_STYLE.includes(v), v);
  assert.match(BASE_STYLE, /--color-bg:light-dark\(#fff,/, 'ライトの地は白');
  assert.match(BASE_STYLE, /:where\(body\)\{margin:0;padding:12px;/);
  assert.match(BASE_STYLE, /:where\(:root\[data-theme="dark"\]\)\{color-scheme:dark\}/);
  assert.ok(!BASE_STYLE.includes('!important'), 'AI の CSS を、important で、押さえない');
});

// ---- /appframe の応答（app.request()） ----

const PORT = 4321;
const TOKEN = 'a'.repeat(48);
const HOST = `127.0.0.1:${PORT}`;
const APP_CSP =
  "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";

let p: Project;
let app: ReturnType<typeof createApp>;
beforeEach(() => {
  p = tempProject();
  makeTopic(p);
  p.store.newTopic(
    'frames',
    '枠',
    '試験',
    '# 題\n\n```html-app\n<b id="one" style="color:var(--color-ink)">1</b><script>var x = 1;</script>\n```\n',
  );
  p.store.newTopic(
    'legacy',
    '従来',
    '試験',
    '# 題\n\n```html-app\n<b id="one">1</b><script>var x = 1;</script>\n```\n',
  );
  app = createApp({ store: p.store, token: TOKEN, port: PORT, publicDir: PUBLIC_DIR, actions: p.actions });
});
afterEach(() => removeProject(p));

const frame = async (query = '', topic = 'frames'): Promise<{ doc: string; csp: string | null; status: number }> => {
  const r = await app.request(`http://${HOST}/appframe/${topic}/root/1/0${query}`, {
    headers: { Host: HOST, 'x-rikai-token': TOKEN },
  });
  return { doc: await r.text(), csp: r.headers.get('content-security-policy'), status: r.status };
};

test('/appframe：?mode の検査。light・dark だけ data-theme になる。細工した値は、文書に、現れない。CSP は、どの場合も、同じ全文', async () => {
  const dark = await frame('?mode=dark');
  assert.equal(dark.status, 200);
  assert.ok(dark.doc.startsWith('<!doctype html>\n<html data-follow data-theme="dark">\n'));
  assert.ok((await frame('?mode=light')).doc.startsWith('<!doctype html>\n<html data-follow data-theme="light">\n'));
  const none = await frame();
  assert.ok(none.doc.startsWith('<!doctype html>\n<html data-follow>\n'));
  for (const q of [
    '?mode=',
    '?mode=evil%22%3E%3Cscript%3Ealert(1)%3C/script%3E',
    '?mode=light&mode=dark',
    '?mode=dark&mode=evil',
    '?mode=DARK',
    '?x=dark',
    '?mode[]=dark',
  ]) {
    const r = await frame(q);
    assert.equal(r.status, 200, q);
    assert.ok(r.doc.startsWith('<!doctype html>\n<html data-follow>\n'), `${q}：指定なし`);
    assert.ok(!r.doc.includes('evil') && !r.doc.includes('alert(1)'), `${q}：値が、文書に出ない`);
  }
  for (const r of [dark, none, await frame('?mode=light')]) assert.equal(r.csp, APP_CSP, '隔離の CSP は、変えない');
  // 中身（資料のとおり）は、橋の後ろに、そのまま続く
  assert.ok(
    dark.doc.endsWith('</script>\n<b id="one" style="color:var(--color-ink)">1</b><script>var x = 1;</script>'),
  );
  // 橋・土台は、1 つずつ
  assert.equal(dark.doc.split('<style>').length, 2);
  assert.equal(dark.doc.split('__rikai').length - 1, BRIDGE_SOURCE.split('__rikai').length - 1);
});

test('/appframe：対応を示さない従来の資料は、?mode=dark でも、土台・data-theme が付かない（常にライト）。CSP は同じ', async () => {
  for (const q of ['', '?mode=dark', '?mode=light']) {
    const r = await frame(q, 'legacy');
    assert.equal(r.status, 200);
    assert.equal(r.doc, frameDocument('<b id="one">1</b><script>var x = 1;</script>', null), q);
    assert.ok(!r.doc.includes('data-theme="') && !r.doc.includes('<style>'), q);
    assert.equal(r.csp, APP_CSP);
  }
});

test('/appframe：合言葉なしは 403（?mode を付けても）', async () => {
  const r = await app.request(`http://${HOST}/appframe/frames/root/1/0?mode=dark`, { headers: { Host: HOST } });
  assert.equal(r.status, 403);
});

// ---- 橋のスクリプト：本物のコードを、疑似の窓で動かす ----

type Msg = { data: Record<string, unknown>; origin: string; at: number };
type Fake = { style: Record<string, string>; [k: string]: unknown };

/**
 * 橋を、疑似の窓の中で動かす。時計・タイマーは、テストが進める。`layout(h)`：枠の高さが h のときの、中身（body）の高さ。
 * 親の役：橋の報告を受けたら、30ms 後に、枠の高さを、その値にして、ResizeObserver を呼ぶ（本物の、画面の反映の、まねごと）
 */
function runBridge(
  layout: (iframeHeight: number) => number,
  opts: { initial?: number; reflect?: boolean; follow?: boolean; preScript?: string } = {},
) {
  const rootStyle: Record<string, string> = {};
  const computed: Record<string, string> = {};
  const listenerOptions: Record<string, unknown> = {};
  const appended: Fake[] = [];
  let nodeCount = 10;
  let now = 100_000;
  let viewport = opts.initial ?? 360;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const posts: Msg[] = [];
  const listeners: Record<string, Array<(e: unknown) => void>> = {};
  const on = (t: string, fn: (e: unknown) => void): void => {
    listeners[t] = [...(listeners[t] ?? []), fn];
  };
  const roCallbacks: Array<() => void> = [];
  const attrs: Record<string, string> = {};
  const parentWin = {
    postMessage(data: Record<string, unknown>, origin: string) {
      posts.push({ data, origin, at: now });
      if (opts.reflect !== false) setT(() => resize(data.height as number), 30);
    },
  };
  const setT = (fn: () => void, ms: number): number => {
    const id = ++seq;
    timers.set(id, { at: now + ms, fn });
    return id;
  };
  const sandbox: Record<string, unknown> = {
    Date: { now: () => now },
    Math,
    parseFloat,
    setTimeout: (fn: () => void, ms: number) => setT(fn, ms),
    clearTimeout: (id: number) => void timers.delete(id),
    parent: parentWin,
    ResizeObserver: class {
      constructor(cb: () => void) {
        roCallbacks.push(cb);
      }
      observe(): void {}
    },
    getComputedStyle: () => ({ marginBottom: '0px', getPropertyValue: (k: string) => computed[k] ?? '' }),
    Event: FakeEvent,
    TextEncoder,
    JSON,
    String,
    Object,
    scrollY: 0,
    addEventListener: (t: string, fn: (e: unknown) => void, o?: unknown) => {
      listenerOptions[t] = o;
      on(t, fn);
    },
    document: {
      documentElement: {
        setAttribute: (k: string, v: string) => {
          attrs[k] = v;
        },
        hasAttribute: (k: string) => k === 'data-follow' && opts.follow !== false,
        style: rootStyle,
        appendChild: (el: Fake) => {
          appended.push(el);
          return el;
        },
      },
      createElement: (): Fake => ({
        style: {},
        setAttribute() {},
        parentNode: { removeChild: (el: Fake) => void appended.splice(appended.indexOf(el), 1) },
      }),
      querySelectorAll: () => [0],
      getElementsByTagName: () => ({ length: nodeCount }),
      body: {
        getBoundingClientRect: () => ({ top: 0 }),
        get scrollHeight() {
          return layout(viewport);
        },
      },
      addEventListener: (t: string, fn: (e: unknown) => void) => on(`doc:${t}`, fn),
      fonts: undefined,
    },
  };
  Object.defineProperty(sandbox, 'innerHeight', { get: () => viewport });
  sandbox.innerWidth = 634.4;
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  function resize(h: number): void {
    viewport = h;
    for (const cb of roCallbacks) cb();
  }
  const fire = (t: string, e: unknown = {}): void => {
    for (const fn of listeners[t] ?? []) fn(e);
  };
  if (opts.preScript) vm.runInContext(opts.preScript, sandbox); // 橋より前に、その窓の中で動かす（窓の中の関数・prototype を、用意する）
  vm.runInContext(BRIDGE_SOURCE, sandbox);
  // 最初の ResizeObserver の通知（observe した直後に来る）。DOMContentLoaded・load も
  for (const cb of roCallbacks) cb();
  fire('doc:DOMContentLoaded');
  fire('load');
  const advance = (ms: number): void => {
    const end = now + ms;
    for (;;) {
      let next: [number, { at: number; fn: () => void }] | null = null;
      for (const t of timers) if (t[1].at <= end && (!next || t[1].at < next[1].at)) next = t;
      if (!next) break;
      timers.delete(next[0]);
      now = Math.max(now, next[1].at);
      next[1].fn();
    }
    now = end;
  };
  return {
    setNodeCount: (n: number) => {
      nodeCount = n;
    },
    listenerOptions,
    context: sandbox,
    computed,
    appended,
    rikai: () => (sandbox.window as { rikai: { state: (o: unknown) => boolean } }).rikai,
    rootStyle,
    parentWin,
    posts,
    attrs,
    advance,
    fire,
    resize,
    pokeObserver: () => {
      for (const cb of roCallbacks) cb();
    },
    get viewport() {
      return viewport;
    },
    set viewport(v: number) {
      viewport = v;
    },
    heights: () => posts.map((m) => m.data.height),
    now: () => now,
  };
}

/** どの 1 秒の窓にも、報告が、`max` 回を超えない */
function maxPerSecond(posts: Msg[]): number {
  let worst = 0;
  for (const a of posts) worst = Math.max(worst, posts.filter((b) => b.at >= a.at && b.at < a.at + 1000).length);
  return worst;
}

test('橋：安定した中身は、高さを 1 回だけ知らせる（形：__rikai・resize・height。送り先は *）', () => {
  const b = runBridge(() => 500);
  b.advance(4000);
  assert.deepEqual(b.heights(), [500]);
  assert.deepEqual({ ...b.posts[0]?.data }, { __rikai: 1, type: 'resize', height: 500 }); // 疑似の窓の object は、別の realm：複製して比べる
  assert.equal(b.posts[0]?.origin, '*');
});

test('橋：中身が、本当に伸びたら、知らせる（クリックで増える・ふつうの変化は、遅れずに）', () => {
  let content = 300;
  const b = runBridge(() => content);
  b.advance(2000);
  content = 700;
  b.pokeObserver();
  b.advance(1000);
  content = 200;
  b.pokeObserver();
  b.advance(1000);
  assert.deepEqual(b.heights(), [300, 700, 200]);
});

test('橋：1 回だけの往復（開いて、すぐ閉じた：A → B → A）は、A へ戻ったことを、ふつうに知らせる（枠の高さが理由の、続く往復ではない）', () => {
  let content = 300;
  const b = runBridge(() => content);
  b.advance(2000);
  content = 700;
  b.pokeObserver();
  b.advance(300);
  content = 300; // 開いた直後に、すぐ閉じた（枠の高さの変更と、同じ測りの間に、起きる）
  b.pokeObserver();
  b.advance(2000);
  assert.deepEqual(b.heights(), [300, 700, 300]);
});

test('橋：開いてすぐ閉じる操作が、枠の高さの変更と、同じ測りに重なっても（driven）、1 回目の戻りは、知らせる。続けて往復したら、大きい方に留まる', () => {
  let content = 300;
  const b = runBridge(() => content, { reflect: false });
  b.advance(2000);
  content = 700;
  b.pokeObserver();
  b.advance(260); // 700 を知らせた
  b.viewport = 700; // 画面が、枠を伸ばした
  content = 300; // 同時に、中身は、縮んだ
  b.pokeObserver();
  b.advance(1000);
  assert.deepEqual(b.heights(), [300, 700, 300], '1 回戻るのは、知らせる');
  // 続けて 2 回、往復（枠を伸ばすと縮み、縮めると伸びる）：大きい方で、止まる
  for (let i = 0; i < 8; i++) {
    b.viewport = b.heights().at(-1) as number;
    content = b.viewport >= 700 ? 300 : 700;
    b.pokeObserver();
    b.advance(300);
  }
  assert.ok(b.posts.length <= 6, b.heights().join(','));
  assert.equal(b.heights().at(-1), 700);
});

test('橋：100vh（枠の高さが、そのまま、中身の高さ）でも、揺れない。報告は、1 回', () => {
  const b = runBridge((h) => h);
  b.advance(5000);
  assert.deepEqual(b.heights(), [360]);
});

test('橋：100vh + 余白（枠を伸ばすと、中身が、同じだけ伸びる循環）：最後に測った高さ（大きい側）を報告して、止める。枠の中は、縦にスクロールしない。再び測っても、伸び続けない', () => {
  const b = runBridge((h) => h + 32);
  b.advance(5000);
  assert.deepEqual(
    b.heights(),
    [392, 424, 456],
    '2 回続いた増えかたで止める：最後に測った 456（大きい側）を、報告する',
  );
  assert.equal(b.rootStyle.overflowY, 'hidden', '止めたあとは、枠の中の縦のスクロールバーを出さない');
  // 止めたあと、測りが何度来ても（読み込み・遅延・利用者の操作）、同じ増えかたは、無視する
  for (let i = 0; i < 20; i++) {
    b.pokeObserver();
    b.advance(1500);
  }
  assert.deepEqual(b.heights(), [392, 424, 456]);
  assert.ok(maxPerSecond(b.posts) <= 4);
});

test('橋：止めるとき、超える分が大きい（100vh のヒーローの下に、本物の節が続く：枠の高さに、500px 足した高さ）ときは、隠さず（auto）、枠の中を、スクロールできるようにする', () => {
  const b = runBridge((h) => h + 500);
  b.advance(5000);
  assert.deepEqual(b.heights(), [860, 1360, 1860], '最後に測った高さ（大きい側）で止める');
  assert.equal(b.rootStyle.overflowY, 'auto', '超える分（500px）が、余白を超える：枠の中で、スクロールする');
  for (let i = 0; i < 10; i++) {
    b.pokeObserver();
    b.advance(1500);
  }
  assert.deepEqual(b.heights(), [860, 1360, 1860], '止めたあとは、伸び続けない');
});

test('橋：超える分が小さくても（余白だけ）、報告する高さが上限（2400）を超えるときは、隠さない', () => {
  const b = runBridge((h) => h + 32, { initial: 2380 });
  b.advance(5000);
  assert.equal(b.rootStyle.overflowY, 'auto');
});

test('橋：止めたあとでも、増えかたが違う（ほんとうの変化）測りは、ふつうに知らせて、止めを解く（overflow も戻す）', () => {
  let coupled = true;
  const b = runBridge((h) => (coupled ? h + 32 : 800));
  b.advance(5000);
  assert.equal(b.rootStyle.overflowY, 'hidden');
  coupled = false; // 枠の高さに、追従しなくなった：中身は、800
  b.pokeObserver();
  b.advance(1000);
  assert.equal(b.rootStyle.overflowY, '');
  assert.equal((b.heights() as number[]).at(-1), 800);
});

test('橋：A → B → A の往復（枠が高いと中身が縮み、低いと伸びる）：大きい方に、留まる。小さい方へ戻る報告を、しない', () => {
  const B = 650;
  const A = 500;
  const b = runBridge((h) => (h >= 600 ? A : B)); // 650 の枠では 500・500 の枠では 650
  b.advance(10_000);
  const hs = b.heights() as number[];
  assert.ok(hs.length <= 4, hs.join(','));
  assert.equal(hs.at(-1), B, `最後に報告した高さは、大きい方：${hs.join(',')}`);
  assert.equal(b.viewport, B, '枠は、大きい方で止まる');
  assert.ok(maxPerSecond(b.posts) <= 4);
  // もう 1 回、同じ測りが来ても（タイマー・遅延の測り）、小さい方へ戻らない
  b.pokeObserver();
  b.advance(3000);
  assert.equal((b.heights() as number[]).at(-1), B);
});

test('橋：激しく変わり続ける中身（毎フレーム、高さが変わる）でも、報告は、1 秒に 4 回まで。250ms 以上あく', () => {
  let t = 0;
  const b = runBridge(() => 300 + ((t * 7919) % 400), { reflect: false });
  for (let i = 0; i < 5 * 60; i++) {
    t++;
    b.pokeObserver();
    b.advance(16);
  }
  assert.ok(b.posts.length > 3, '変化は、知らせる');
  assert.ok(maxPerSecond(b.posts) <= 4, `1 秒あたり：${maxPerSecond(b.posts)}`);
  for (let i = 1; i < b.posts.length; i++)
    assert.ok((b.posts[i] as Msg).at - (b.posts[i - 1] as Msg).at >= 250, '250ms 以上あく');
});

test('橋：theme を受けて、data-theme と color-scheme を更新する。検査：e.source が親・__rikai・type・mode（2 値）・by（2 値）が、すべて合うときだけ', () => {
  const b = runBridge(() => 300);
  const fromParent = (data: unknown) => b.fire('message', { source: b.parentWin, data });
  fromParent({ __rikai: 1, type: 'theme', mode: 'dark', by: 'auto' });
  assert.equal(b.attrs['data-theme'], 'dark');
  assert.equal(b.rootStyle.colorScheme, 'dark');
  fromParent({ __rikai: 1, type: 'theme', mode: 'light', by: 'user', extra: 1 });
  assert.equal(b.attrs['data-theme'], 'light', '余分なキーは、無視');
  assert.equal(b.rootStyle.colorScheme, 'light');
  for (const bad of [
    { __rikai: 1, type: 'theme', mode: 'evil"><script>', by: 'auto' },
    { __rikai: 1, type: 'theme', mode: 'DARK', by: 'auto' },
    { __rikai: 1, type: 'theme', mode: ['dark'], by: 'auto' },
    { __rikai: 1, type: 'theme', by: 'auto' },
    { __rikai: 1, type: 'theme', mode: 'dark' },
    { __rikai: 1, type: 'theme', mode: 'dark', by: 'robot' },
    { __rikai: 1, type: 'theme', mode: 'dark', by: ['user'] },
    { __rikai: 2, type: 'theme', mode: 'dark', by: 'auto' },
    { type: 'theme', mode: 'dark', by: 'auto' },
    { __rikai: 1, type: 'resize', mode: 'dark', by: 'auto' },
    'dark',
    null,
    42,
  ]) {
    b.attrs['data-theme'] = 'light';
    fromParent(bad);
    assert.equal(b.attrs['data-theme'], 'light', JSON.stringify(bad));
  }
  // 親ではない窓からは、受けない
  b.attrs['data-theme'] = 'light';
  b.fire('message', { source: {}, data: { __rikai: 1, type: 'theme', mode: 'dark', by: 'user' } });
  b.fire('message', { source: null, data: { __rikai: 1, type: 'theme', mode: 'dark', by: 'user' } });
  assert.equal(b.attrs['data-theme'], 'light');
});

test('橋：画面の外観の変化（by: auto）は、資料が対応を示した枠（<html data-follow>）だけに効く。by: user（ツールバー）は、どちらでも効く', () => {
  const legacy = runBridge(() => 300, { follow: false });
  const send = (b: typeof legacy, mode: string, by: string) =>
    b.fire('message', { source: b.parentWin, data: { __rikai: 1, type: 'theme', mode, by } });
  send(legacy, 'dark', 'auto');
  assert.equal(legacy.attrs['data-theme'], undefined, '従来の枠は、画面の外観の変化に、従わない');
  assert.equal(legacy.rootStyle.colorScheme, undefined);
  send(legacy, 'dark', 'user');
  assert.equal(legacy.attrs['data-theme'], 'dark', '利用者の明示の操作は、従来の枠でも効く');
  assert.equal(legacy.rootStyle.colorScheme, 'dark');
  send(legacy, 'light', 'auto');
  assert.equal(legacy.attrs['data-theme'], 'dark', 'そのあとの auto は、また、効かない');
  const follow = runBridge(() => 300, { follow: true });
  send(follow, 'dark', 'auto');
  assert.equal(follow.attrs['data-theme'], 'dark');
  send(follow, 'light', 'user');
  assert.equal(follow.attrs['data-theme'], 'light');
});

// ---- 書き戻し（F42）：rikai.state・要素を選ぶ（選択モード） ----

// 疑似のイベント：止める関数は、prototype にある（本物と同じ。橋は、動いた時点のものを退避する）
class FakeEvent {
  calls = { prevented: 0, stopped: 0 };
  preventDefault(): void {
    this.calls.prevented++;
  }
  stopImmediatePropagation(): void {
    this.calls.stopped++;
  }
}
const ev = (type: string, extra: Record<string, unknown> = {}) => Object.assign(new FakeEvent(), { type, ...extra });
const button = () => ({
  nodeType: 1,
  tagName: 'BUTTON',
  id: '',
  classList: ['primary', 'big', 'third'],
  parentElement: null,
  firstElementChild: null,
  textContent: `  ログ\n  イン  ${'あ'.repeat(200)}`,
  getBoundingClientRect: () => ({ left: 24.4, top: 312.6, width: 320.2, height: 40 }),
});
const states = (b: ReturnType<typeof runBridge>) =>
  b.posts.filter((m) => m.data.type === 'state').map((m) => m.data.json);

test('橋：rikai.state(obj)：object・配列だけ true。プリミティブ・循環・8KB（UTF-8）超・JSON にできないものは false（何も送らない）', () => {
  const b = runBridge(() => 300);
  const st = b.rikai().state;
  expect(st({ step: 1 })).toBe(true);
  expect(st([1, 2])).toBe(true);
  expect(st(5)).toBe(false);
  expect(st('x')).toBe(false);
  expect(st(null)).toBe(false);
  expect(st(undefined)).toBe(false);
  expect(st(() => 1)).toBe(false);
  const loop: Record<string, unknown> = {};
  loop.self = loop;
  expect(st(loop)).toBe(false);
  expect(st({ big: 1n })).toBe(false); // JSON にできない（BigInt）
  expect(st({ a: 'x'.repeat(9000) })).toBe(false);
  expect(st({ a: 'あ'.repeat(3000) })).toBe(false); // 9000 バイト
  expect(st({ a: 'あ'.repeat(2600) })).toBe(true); // 7800 バイト
  b.advance(1000);
  assert.deepEqual(states(b), [`{"a":"${'あ'.repeat(2600)}"}`], '最新の 1 つだけ（超えたものは、送らない）');
});

test('橋：rikai.state：最新の 1 つだけ送る。同じ内容は、送らない。1 秒に 4 回まで。window.rikai は、書き換えられない', () => {
  const b = runBridge(() => 300);
  const st = b.rikai().state;
  for (let i = 1; i <= 50; i++) {
    st({ n: i });
    b.advance(20);
  }
  b.advance(1000);
  const sent = states(b) as string[];
  expect(sent.at(-1)).toBe('{"n":50}');
  assert.ok(sent.length <= 6, `${sent.length}`); // 約 1 秒に 4 回
  assert.ok(maxPerSecond(b.posts.filter((m) => m.data.type === 'state')) <= 5);
  const before = states(b).length;
  st({ n: 50 }); // 同じ内容
  b.advance(1000);
  expect(states(b).length).toBe(before);
  expect(() => {
    (b.rikai() as { state: unknown }).state = () => true;
  }).toThrow();
  const w = vm.runInContext('window', b.context) as Record<string, unknown>;
  expect(() => Object.defineProperty(w, 'rikai', { value: {} })).toThrow();
});

test('橋：pick-start は、親（e.source === parent）からだけ。そうでない窓からは、選択モードに入らない（クリックは、そのまま、要素に届く）', () => {
  const b = runBridge(() => 300);
  const click = ev('click', { target: button() });
  b.fire('message', { source: {}, data: { __rikai: 1, type: 'pick-start' } });
  b.fire('message', { source: null, data: { __rikai: 1, type: 'pick-start' } });
  b.fire('message', { source: b.parentWin, data: { __rikai: 2, type: 'pick-start' } });
  b.fire('click', click);
  expect(click.calls.prevented).toBe(0);
  expect(b.appended).toHaveLength(0);
  b.fire('message', { source: b.parentWin, data: { __rikai: 1, type: 'pick-start' } });
  expect(b.appended).toHaveLength(1); // 要素を示す層
});

test('橋：選択モードの間、クリック・マウス・ポインタ・キー・submit は、要素に届かない（キャプチャで止める）。選ぶと、モードが終わり、クリックは、また届く', () => {
  const b = runBridge(() => 300);
  b.fire('message', { source: b.parentWin, data: { __rikai: 1, type: 'pick-start' } });
  const types = [
    'click',
    'dblclick',
    'auxclick',
    'mousedown',
    'mouseup',
    'pointerdown',
    'pointerup',
    'touchstart',
    'touchend',
    'contextmenu',
    'submit',
    'keydown',
    'keypress',
    'keyup',
    'dragstart',
  ];
  for (const t of types) {
    expect(b.listenerOptions[t], `${t}：キャプチャで登録`).toMatchObject({ capture: true, passive: false });
    const e = ev(t, { target: button(), key: 'Enter' });
    if (t === 'click') continue; // click は、あとで
    b.fire(t, e);
    expect(e.calls.prevented, t).toBe(1);
    expect(e.calls.stopped, t).toBe(1);
  }
  const click = ev('click', { target: button() });
  b.fire('click', click);
  expect(click.calls.prevented).toBe(1);
  expect(click.calls.stopped).toBe(1);
  const picks = b.posts.filter((m) => m.data.type === 'pick');
  expect(picks).toHaveLength(1);
  expect(b.appended).toHaveLength(0); // 層は、外れた
  const after = ev('click', { target: button() });
  b.fire('click', after);
  expect(after.calls.prevented).toBe(0); // モードが終わった：要素に届く
});

test('橋：選ぶと、pick を 1 つ送る：セレクタ・タグ・文字（80 字・空白を整える）・位置（整数）・見た目（許可リストだけ）・枠の大きさ', () => {
  const b = runBridge(() => 300);
  b.computed.display = 'inline-block';
  b.computed['background-color'] = 'rgb(37, 99, 235)';
  b.computed['font-family'] = 'x'.repeat(400); // 300 字に切る（text は 80 字のまま）
  b.computed.content = '"邪魔"'; // 許可リストにない：送らない
  b.computed['background-image'] = 'url(x)';
  b.fire('message', { source: b.parentWin, data: { __rikai: 1, type: 'pick-start' } });
  b.fire('click', ev('click', { target: button() }));
  const m = b.posts.find((p) => p.data.type === 'pick')?.data as Record<string, unknown>;
  assert.equal(m.__rikai, 1);
  assert.equal(m.selector, 'button.primary.big');
  assert.equal(m.tag, 'button');
  assert.equal((m.text as string).length, 80);
  assert.ok((m.text as string).startsWith('ログ イン'));
  assert.deepEqual({ ...(m.rect as object) }, { x: 24, y: 313, w: 320, h: 40 });
  const styles = { ...(m.styles as Record<string, string>) };
  assert.equal(styles.display, 'inline-block');
  assert.equal(styles['font-family']?.length, 300);
  assert.ok(!('content' in styles) && !('background-image' in styles));
  assert.deepEqual(Object.keys(styles).sort(), ['background-color', 'display', 'font-family']);
  assert.deepEqual({ ...(m.frame as object) }, { w: 634, h: 360 });
});

test('橋：選択モードで Esc：中止して、pick-cancel を送る（モードが終わる）。モードでないときの Esc は、止めない。Esc 以外のキーは、止める', () => {
  const b = runBridge(() => 300);
  const idle = ev('keydown', { key: 'Escape' });
  b.fire('keydown', idle);
  expect(idle.calls.prevented).toBe(0);
  b.fire('message', { source: b.parentWin, data: { __rikai: 1, type: 'pick-start' } });
  const tab = ev('keydown', { key: 'Tab' });
  b.fire('keydown', tab);
  expect(tab.calls.prevented).toBe(1);
  const esc = ev('keydown', { key: 'Escape' });
  b.fire('keydown', esc);
  expect(esc.calls.prevented).toBe(1);
  expect(b.posts.filter((m) => m.data.type === 'pick-cancel')).toHaveLength(1);
  expect(b.posts.filter((m) => m.data.type === 'pick')).toHaveLength(0);
  expect(b.appended).toHaveLength(0);
  const again = ev('click', { target: button() });
  b.fire('click', again);
  expect(again.calls.prevented).toBe(0);
});

test('橋：枠の中の Esc を、親へ転送する（esc。形は、これだけ）：150ms に 1 回まで・Esc 以外・押しっぱなしは、送らない。止めない（枠の中の処理は、そのまま）', () => {
  const b = runBridge(() => 300);
  const escs = () => b.posts.filter((m) => m.data.type === 'esc');
  const e1 = ev('keydown', { key: 'Escape' });
  b.fire('keydown', e1);
  expect(escs()).toHaveLength(1);
  expect({ ...escs()[0]?.data }).toEqual({ __rikai: 1, type: 'esc' });
  expect(e1.calls.prevented).toBe(0);
  expect(e1.calls.stopped).toBe(0);
  b.fire('keydown', ev('keydown', { key: 'Escape' })); // 150ms 以内
  expect(escs()).toHaveLength(1);
  b.advance(400);
  b.fire('keydown', ev('keydown', { key: 'Escape', repeat: true })); // 押しっぱなし
  b.fire('keydown', ev('keydown', { key: 'Enter' }));
  b.fire('keydown', ev('keydown', { key: 'a' }));
  expect(escs()).toHaveLength(1);
  b.fire('keydown', ev('keydown', { key: 'Escape' }));
  expect(escs()).toHaveLength(2);
});

test('橋：変換中（isComposing・keyCode 229）の Esc は、親へ転送しない', () => {
  const b = runBridge(() => 300);
  b.fire('keydown', ev('keydown', { key: 'Escape', isComposing: true }));
  b.fire('keydown', ev('keydown', { key: 'Escape', keyCode: 229 }));
  expect(b.posts.filter((m) => m.data.type === 'esc')).toHaveLength(0);
  b.fire('keydown', ev('keydown', { key: 'Escape', isComposing: false, keyCode: 27 }));
  expect(b.posts.filter((m) => m.data.type === 'esc')).toHaveLength(1);
});

test('橋：選択モードの Esc は、pick-cancel だけ（esc を送らない：親が、二重に、閉じない）。モードが終わったあとの Esc は、転送する', () => {
  const b = runBridge(() => 300);
  b.fire('message', { source: b.parentWin, data: { __rikai: 1, type: 'pick-start' } });
  b.fire('keydown', ev('keydown', { key: 'Escape' }));
  expect(b.posts.filter((m) => m.data.type === 'pick-cancel')).toHaveLength(1);
  expect(b.posts.filter((m) => m.data.type === 'esc')).toHaveLength(0);
  b.advance(400);
  b.fire('keydown', ev('keydown', { key: 'Escape' }));
  expect(b.posts.filter((m) => m.data.type === 'esc')).toHaveLength(1);
});

test('橋：親の pick-cancel でも、モードが終わる（親以外からの pick-cancel は、効かない）', () => {
  const b = runBridge(() => 300);
  b.fire('message', { source: b.parentWin, data: { __rikai: 1, type: 'pick-start' } });
  b.fire('message', { source: {}, data: { __rikai: 1, type: 'pick-cancel' } });
  const stillBlocked = ev('click', { target: button() });
  b.fire('click', stillBlocked);
  expect(stillBlocked.calls.prevented).toBe(1);
  b.fire('message', { source: b.parentWin, data: { __rikai: 1, type: 'pick-start' } });
  b.fire('message', { source: b.parentWin, data: { __rikai: 1, type: 'pick-cancel' } });
  const free = ev('click', { target: button() });
  b.fire('click', free);
  expect(free.calls.prevented).toBe(0);
});

test('橋：snapshot-req は、親からだけ・id が決まった形のときだけ。要素が 3000 を超える文書は、png: null（失敗）で、同じ id を返す', () => {
  const b = runBridge(() => 300);
  const snaps = () => b.posts.filter((m) => m.data.type === 'snapshot');
  b.setNodeCount(3001);
  b.fire('message', { source: {}, data: { __rikai: 1, type: 'snapshot-req', id: 's1' } }); // 親でない
  b.fire('message', { source: null, data: { __rikai: 1, type: 'snapshot-req', id: 's1' } });
  b.fire('message', { source: b.parentWin, data: { __rikai: 1, type: 'snapshot-req', id: 'x1' } }); // id の形が違う
  b.fire('message', { source: b.parentWin, data: { __rikai: 1, type: 'snapshot-req', id: 's1; alert(1)' } });
  b.fire('message', { source: b.parentWin, data: { __rikai: 1, type: 'snapshot-req', id: 5 } });
  b.fire('message', { source: b.parentWin, data: { __rikai: 2, type: 'snapshot-req', id: 's1' } });
  expect(snaps()).toHaveLength(0);
  b.fire('message', { source: b.parentWin, data: { __rikai: 1, type: 'snapshot-req', id: 's42' } });
  expect(snaps()).toHaveLength(1);
  expect({ ...(snaps()[0]?.data as object) }).toEqual({ __rikai: 1, type: 'snapshot', id: 's42', png: null });
});

test('橋：snapshot：画像にできない環境（描画の部品がない）でも、例外を出さず、png: null で、応答する', () => {
  const b = runBridge(() => 300);
  b.fire('message', { source: b.parentWin, data: { __rikai: 1, type: 'snapshot-req', id: 's7' } });
  const snap = b.posts.find((m) => m.data.type === 'snapshot');
  expect(snap?.data.id).toBe('s7');
  expect(snap?.data.png).toBeNull();
});

test('橋：選択モードで、中身のコードが Event.prototype の止める関数を置き換えても（あとから）、退避した本物で止める（click は、要素に届かない）', () => {
  const b = runBridge(() => 300);
  const proto = FakeEvent.prototype;
  const [pd, sip] = [proto.preventDefault, proto.stopImmediatePropagation];
  try {
    proto.preventDefault = () => {};
    proto.stopImmediatePropagation = () => {};
    b.fire('message', { source: b.parentWin, data: { __rikai: 1, type: 'pick-start' } });
    const click = ev('click', { target: button() });
    b.fire('click', click);
    expect(click.calls.prevented).toBe(1);
    expect(click.calls.stopped).toBe(1);
    expect(b.posts.filter((m) => m.data.type === 'pick')).toHaveLength(1);
    b.fire('message', { source: b.parentWin, data: { __rikai: 1, type: 'pick-start' } });
    const esc = ev('keydown', { key: 'Escape' });
    b.fire('keydown', esc);
    expect(esc.calls.stopped).toBe(1);
  } finally {
    proto.preventDefault = pd;
    proto.stopImmediatePropagation = sip;
  }
});

test('橋：選択モードで、中身のコードが Function.prototype の call・apply・bind を置き換えても（あとから）、退避した Reflect.apply で止める（click は、要素に届かない）', () => {
  // 止める関数は、橋と同じ窓（vm の窓）の関数にする：`.call` は、その窓の Function.prototype のもの（中身のコードが、置き換えるもの）
  const b = runBridge(() => 300, {
    preScript:
      'Event=function(){};Event.prototype.preventDefault=function(){this.calls.prevented++};Event.prototype.stopImmediatePropagation=function(){this.calls.stopped++};',
  });
  const mk = vm.runInContext(
    '(function(t,x){var e=Object.create(Event.prototype);e.calls={prevented:0,stopped:0};e.type=t;for(var k in x)e[k]=x[k];return e;})',
    b.context,
  ) as (t: string, x: Record<string, unknown>) => { calls: { prevented: number; stopped: number } };
  const fp = vm.runInContext('Function.prototype', b.context) as typeof Function.prototype;
  const [call, apply, bind] = [fp.call, fp.apply, fp.bind];
  const noop = () => undefined;
  try {
    fp.call = noop as typeof fp.call;
    fp.apply = noop as typeof fp.apply;
    fp.bind = noop as typeof fp.bind;
    b.fire('message', { source: b.parentWin, data: { __rikai: 1, type: 'pick-start' } });
    const click = mk('click', { target: button() });
    b.fire('click', click);
    expect(click.calls.prevented).toBe(1);
    expect(click.calls.stopped).toBe(1);
    expect(b.posts.filter((m) => m.data.type === 'pick')).toHaveLength(1);
    b.fire('message', { source: b.parentWin, data: { __rikai: 1, type: 'pick-start' } });
    const esc = mk('keydown', { key: 'Escape' });
    b.fire('keydown', esc);
    expect(esc.calls.prevented).toBe(1);
    expect(esc.calls.stopped).toBe(1);
  } finally {
    fp.call = call;
    fp.apply = apply;
    fp.bind = bind;
  }
});

test('橋：スクリプトの中で、.call(・.apply(・.bind( を使わない（中身のコードに置き換えられる）。Reflect.apply を、先頭で退避する', () => {
  expect(BRIDGE_SOURCE).not.toMatch(/\.(call|apply|bind)\(/);
  expect(BRIDGE_SOURCE).toContain('var RA=Reflect.apply');
});
