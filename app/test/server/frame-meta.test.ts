// 枠から取った情報（`frameMeta`。F45）：サーバーが受けて・検査して・保存して・poll に出すところ。
// サーバーは、画面を信用しない（同じ検査関数 `parseFrameMeta` を、もう一度かける）。見えない文字は見える形にして保存する。不正・大きすぎるものは、拒否して、何も書かない。
// 古いデータ（`frameMeta` なし。本文に見出しと JSON）は、そのまま読める。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, test } from 'vitest';
import { STYLE_KEYS } from '../../src/shared/htmlapp-bridge';
import type { FrameMeta, Round, ThreadsFile } from '../../src/shared/types';
import {
  addComment,
  httpError,
  makeTopic,
  type Project,
  readThreads,
  removeProject,
  submit,
  tempProject,
} from './helpers';
import { request as rawRequest, startTestServer, type TestServer } from './http-helpers';

let p: Project;
beforeEach(() => {
  p = tempProject();
  makeTopic(p);
});
afterEach(() => removeProject(p));

const PICK = {
  selector: 'button.primary',
  tag: 'button',
  text: 'ログイン',
  rect: { x: 24, y: 312, w: 320, h: 40 },
  styles: { display: 'inline-block', color: 'rgb(255, 255, 255)' },
  frame: { w: 634, h: 400 },
};
const META: FrameMeta = { pick: PICK, state: '{"step":2}' };
const threadsRaw = (): string => fs.readFileSync(path.join(p.dir, '.rikai', 'demo', 'threads.json'), 'utf8');

test('frameMeta は、メッセージに保存される。本文（text）は、利用者の言葉だけ。poll の出力では、別の項目', () => {
  const id = addComment(p, { text: 'この色を変えたい', frameMeta: META });
  const m = readThreads(p).threads.find((t) => t.id === id)?.messages[0];
  assert.equal(m?.text, 'この色を変えたい');
  assert.deepEqual(m?.frameMeta, META);
  submit(p);
  const r = p.agent.peek('demo');
  assert.ok('items' in r);
  const sent = r.items[0]?.new[0];
  assert.equal(sent?.text, 'この色を変えたい'); // 本文に、機械的な文章・JSON は入らない
  assert.deepEqual(sent?.frameMeta, META);
  assert.ok(!sent?.text?.includes('枠から'));
  assert.ok(!sent?.text?.includes('selector'));
  // 返信が付いて、次の round では、history にも frameMeta が出る
  p.agent.cmdApply('demo', { replies: [{ thread: id, body: '直しました' }] });
  p.actions.reply({ topic: 'demo', thread: id, text: 'もう少し' });
  submit(p);
  const r2 = p.agent.peek('demo');
  assert.ok('items' in r2);
  assert.deepEqual(r2.items[0]?.history[0]?.frameMeta, META);
  assert.equal(r2.items[0]?.new[0]?.frameMeta, undefined); // 追加の返信は、frameMeta を持たない
});

test('frameMeta なしの comment（旧い形・枠と関係のないコメント）は、そのまま動く（frameMeta の項目は、出ない）', () => {
  const id = addComment(p, { text: 'ふつうのコメント' });
  const m = readThreads(p).threads.find((t) => t.id === id)?.messages[0];
  assert.ok(m && !('frameMeta' in m));
  submit(p);
  const r = p.agent.peek('demo');
  assert.ok('items' in r);
  assert.ok(!('frameMeta' in (r.items[0]?.new[0] ?? {})));
  addComment(p, { text: 'null も、なしと同じ', frameMeta: null });
});

test('旧い形のコメント（frameMeta なし・本文に見出しと JSON）を含む threads.json を、そのまま読める。編集・Submit・poll も動く', () => {
  const id = addComment(p, { text: 'ひな形' });
  const legacy =
    '【枠から】要素を選びました（枠の自己申告。下の JSON）：button（x:24 y:312 w:320 h:40）\n\n```json\n{\n  "selector": "button.primary"\n}\n```\n\n色を変えたい';
  const file = path.join(p.dir, '.rikai', 'demo', 'threads.json');
  const th = JSON.parse(fs.readFileSync(file, 'utf8')) as ThreadsFile;
  const t = th.threads.find((x) => x.id === id);
  assert.ok(t);
  t.messages[0].text = legacy;
  fs.writeFileSync(file, JSON.stringify(th, null, 2));
  const loaded = readThreads(p).threads.find((x) => x.id === id);
  assert.equal(loaded?.messages[0].text, legacy);
  assert.ok(!('frameMeta' in (loaded?.messages[0] ?? {})));
  p.actions.edit({ topic: 'demo', thread: id, msg: loaded?.messages[0].id as string, text: `${legacy}\n追記` });
  submit(p);
  const r = p.agent.peek('demo');
  assert.ok('items' in r);
  assert.equal(r.items[0]?.new[0]?.text, `${legacy}\n追記`);
});

test('編集しても、frameMeta は変わらない（本文だけが変わる）', () => {
  const id = addComment(p, { frameMeta: META });
  const mid = readThreads(p).threads[0]?.messages[0].id as string;
  p.actions.edit({ topic: 'demo', thread: id, msg: mid, text: '書き直した' });
  const m = readThreads(p).threads[0]?.messages[0];
  assert.equal(m?.text, '書き直した');
  assert.deepEqual(m?.frameMeta, META);
});

// 不正：すべて、拒否（HttpError）して、何も書かない（threads.json は、変わらない）
const hugeState = JSON.stringify({ a: 'x'.repeat(9000) });
const deep = (n: number): unknown => (n === 0 ? 1 : { a: deep(n - 1) });
const BAD: Array<[string, unknown, number]> = [
  ['オブジェクトでない', 'frameMeta', 400],
  ['配列', [META], 400],
  ['数', 5, 400],
  ['空', {}, 400],
  ['余分なキー', { ...META, extra: 1 }, 400],
  ['__proto__', JSON.parse('{"__proto__":{"polluted":true},"imageFromFrame":true}'), 400],
  ['pick の余分なキー', { pick: { ...PICK, extra: 1 } }, 400],
  ['pick の __proto__', { pick: JSON.parse(`${JSON.stringify(PICK).slice(0, -1)},"__proto__":{"x":1}}`) }, 400],
  ['pick の型違い', { pick: { ...PICK, rect: { x: 'a', y: 0, w: 1, h: 1 } } }, 400],
  ['pick の rect が小数', { pick: { ...PICK, rect: { x: 0.5, y: 0, w: 1, h: 1 } } }, 400],
  ['selector が長い', { pick: { ...PICK, selector: 'a'.repeat(201) } }, 400],
  ['許可リスト外のスタイル', { pick: { ...PICK, styles: { 'x-evil': 'a' } } }, 400],
  ['state がオブジェクト（JSON の文字列でない）', { state: { a: 1 } }, 400],
  ['state が壊れた JSON', { state: '{x' }, 400],
  ['state が巨大（8KB 超）', { state: hugeState }, 400],
  ['state が深い', { state: JSON.stringify(deep(9)) }, 400],
  ['state の要素が多い', { state: JSON.stringify(Array.from({ length: 501 }, (_, i) => i)) }, 400],
  ['state の文字列が長い', { state: JSON.stringify({ t: 'x'.repeat(1001) }) }, 400],
  ['imageFromFrame が true でない', { imageFromFrame: 'true' }, 400],
  [
    '合計が大きい（16KB 超）',
    {
      pick: {
        ...PICK,
        selector: '\u200B'.repeat(200),
        text: '\u200B'.repeat(80),
        styles: Object.fromEntries(STYLE_KEYS.map((k) => [k, '\u200B'.repeat(80)])),
      },
      state: JSON.stringify(Array.from({ length: 6 }, () => 'a'.repeat(980))),
    },
    413,
  ],
];

test('不正な frameMeta は、拒否（400。大きすぎるのは 413）して、何も書かない', () => {
  const before = threadsRaw();
  for (const [name, bad, status] of BAD) {
    assert.throws(
      () => p.actions.comment({ topic: 'demo', page: 'root', version: 1, anchor: null, text: '本文', frameMeta: bad }),
      httpError(status, /frameMeta/),
      name,
    );
  }
  assert.equal(threadsRaw(), before, '拒否したら、threads.json は、変わらない');
  assert.equal(readThreads(p).threads.length, 0);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test('見えない文字（タグ文字・異体字セレクタ・RLO・ゼロ幅）は、見える形にして保存する（サーバーでも）。生の文字は、ファイルに残らない', () => {
  const evil = {
    pick: {
      ...PICK,
      selector: `div\u{E0049}\u{E0047}\u{E0100}`,
      text: `OK\u202Etxt\u200B`,
      styles: { color: `red\uFE0F` },
    },
    state: JSON.stringify({ 'k\u{E0041}': `v\u202E`, list: [`\u{E0042}`] }),
  };
  const id = addComment(p, { frameMeta: evil });
  const m = readThreads(p).threads.find((t) => t.id === id)?.messages[0];
  assert.equal(m?.frameMeta?.pick?.selector, 'div\\u{E0049}\\u{E0047}\\u{E0100}');
  assert.equal(m?.frameMeta?.pick?.text, 'OK\\u202Etxt\\u200B');
  assert.equal(m?.frameMeta?.pick?.styles.color, 'red\\uFE0F');
  const raw = threadsRaw();
  assert.ok(!/[\p{Cf}\p{Cn}\p{Co}\p{Cs}\p{Default_Ignorable_Code_Point}]/u.test(raw), '生の見えない文字は、ない');
  assert.ok(m?.frameMeta?.state?.includes('\\\\u{E0041}'));
});

test('state の `__proto__` キーは、ただのデータ（prototype を汚さない）。poll にも、そのまま出る', () => {
  const id = addComment(p, { frameMeta: { state: '{"__proto__":{"polluted":true},"a":1}' } });
  const m = readThreads(p).threads.find((t) => t.id === id)?.messages[0];
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
  const parsed = JSON.parse(m?.frameMeta?.state as string) as Record<string, unknown>;
  assert.equal(Object.getPrototypeOf(parsed), Object.prototype);
  assert.equal(parsed.a, 1);
  submit(p);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test('rounds/001.json（poll の元）にも、frameMeta が、text とは別に入る', () => {
  addComment(p, { text: '一言', frameMeta: META });
  submit(p);
  const round = JSON.parse(fs.readFileSync(path.join(p.dir, '.rikai', 'demo', 'rounds', '001.json'), 'utf8')) as Round;
  assert.deepEqual(round.items[0]?.new[0]?.frameMeta, META);
  assert.equal(round.items[0]?.new[0]?.text, '一言');
});

// ---- 実際の HTTP（合言葉つき）----
describe('実際の HTTP（合言葉つき）', () => {
  let srv: TestServer;
  let hp: Project;
  beforeAll(async () => {
    hp = tempProject();
    makeTopic(hp);
    srv = await startTestServer(hp);
  });
  afterAll(() => {
    srv.close();
    removeProject(hp);
  });
  const post = (body: object | string, headers: Record<string, string> = {}) =>
    rawRequest(srv.port, 'POST', '/api/comment', {
      headers: { 'x-rikai-token': srv.token, 'Content-Type': 'application/json', ...headers },
      body,
    });
  const comment = (frameMeta: unknown) => ({
    topic: 'demo',
    page: 'root',
    version: 1,
    anchor: null,
    text: '本文',
    frameMeta,
  });
  const countThreads = (): number => hp.store.loadThreads('demo').threads.length;

  test('HTTP：合言葉つきの正しい frameMeta は保存される。合言葉なしは 403（何も書かない）', async () => {
    const no = await rawRequest(srv.port, 'POST', '/api/comment', {
      headers: { 'Content-Type': 'application/json' },
      body: comment(META),
    });
    assert.equal(no.status, 403);
    assert.equal(countThreads(), 0);
    const ok = await post(comment(META));
    assert.equal(ok.status, 200);
    assert.deepEqual(hp.store.loadThreads('demo').threads[0]?.messages[0]?.frameMeta, META);
  });

  test('HTTP：不正な frameMeta（余分なキー・巨大・__proto__・型違い・深い・長い）は、400/413 と明示的なエラー。何も書かない', async () => {
    const before = countThreads();
    const cases: Array<[string, unknown, number]> = BAD.map(([n, b, s]) => [n, b, s]);
    for (const [name, bad, status] of cases) {
      const r = await post(comment(bad));
      assert.equal(r.status, status, name);
      const j = JSON.parse(r.body) as { ok: boolean; error: string };
      assert.equal(j.ok, false, name);
      assert.match(j.error, /frameMeta/, name);
    }
    // 生の JSON 文字列で `__proto__` を送る（JSON.stringify では作れない）
    const raw = `{"topic":"demo","page":"root","version":1,"anchor":null,"text":"x","frameMeta":{"__proto__":{"polluted":true},"imageFromFrame":true}}`;
    assert.equal((await post(raw)).status, 400);
    assert.equal(countThreads(), before, '何も書かれていない');
    assert.equal(({} as Record<string, unknown>).polluted, undefined);
  });

  test('HTTP：本体が大きすぎる frameMeta は 413（本体の上限）。何も書かない', async () => {
    const before = countThreads();
    const r = await post(comment({ state: JSON.stringify({ a: 'x'.repeat(3_000_000) }) }));
    assert.ok(r.status === 413 || r.status === 0, `status ${r.status}`);
    assert.equal(countThreads(), before);
  });
});

test('追いコメント（reply）・編集（edit）は、frameMeta を保存しない（comment だけが持つ）：送られても、無視して、poll の出力にも出ない', () => {
  const id = addComment(p, { text: '最初' });
  const sneaky = { topic: 'demo', thread: id, text: '追い', frameMeta: META };
  p.actions.reply(sneaky);
  const th = readThreads(p).threads.find((t) => t.id === id);
  assert.ok(th && th.messages.length === 2);
  assert.ok(!('frameMeta' in th.messages[1]));
  const mid = th.messages[0].id;
  p.actions.edit({ topic: 'demo', thread: id, msg: mid, text: '直した', frameMeta: META } as Parameters<
    typeof p.actions.edit
  >[0]);
  const after = readThreads(p).threads.find((t) => t.id === id);
  assert.ok(!('frameMeta' in (after?.messages[0] ?? {})));
  assert.ok(!threadsRaw().includes('"frameMeta"'));
  submit(p);
  const r = p.agent.peek('demo');
  assert.ok('items' in r);
  for (const m of r.items[0]?.new ?? []) assert.ok(!('frameMeta' in m));
});
