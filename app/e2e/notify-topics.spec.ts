// ほかのトピックの新着の通知（F46）：開いているトピック以外に、AI の返信・新しい版が届いたとき、画面を見ていなければ、通知が 1 回出る（トピック名と件数）。押すと、そのトピックが開く。
// 一覧の API（/api/topics）の `fresh`（ID の要約）の、前回との差で決める。開いているトピックは、これまでどおり（トピックの取得から）：二重に出ない。
// `window.Notification` は、初期化スクリプトで差し替えて、通知の生成を記録する（F41 の notify.spec と同じ流儀）。
import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { DOC_BASIC } from './samples';
import { ui } from './ui';

interface Note {
  title: string;
  options: { body?: string; tag?: string };
}
const OTHER = 'other';
const OTHER_TITLE = '別の観察日記';
const DOC_V2 = DOC_BASIC.replace('一日に三回', '一日に四回');
const ASK = { type: 'yes_no', question: '夜も鳴きますか' } as const;

async function prepare(page: Page, opts: { hidden?: boolean; notify?: boolean } = {}) {
  await page.addInitScript(
    ({ hidden }) => {
      const w = window as unknown as Record<string, unknown>;
      w.__notes = [] as unknown[];
      w.__instances = [] as unknown[];
      w.__hidden = hidden;
      class FakeNotification {
        static permission: NotificationPermission = 'granted';
        static async requestPermission() {
          return 'granted' as const;
        }
        onclick: (() => void) | null = null;
        closed = false;
        constructor(title: string, options: unknown) {
          (w.__notes as unknown[]).push({ title, options });
          (w.__instances as unknown[]).push(this);
        }
        close() {
          this.closed = true;
        }
      }
      w.Notification = FakeNotification;
      document.hasFocus = () => !(w.__hidden as boolean);
      Object.defineProperty(document, 'visibilityState', {
        get: () => ((w.__hidden as boolean) ? 'hidden' : 'visible'),
        configurable: true,
      });
    },
    { hidden: opts.hidden ?? false },
  );
  await page.evaluate((v) => localStorage.setItem('rikai-ui', JSON.stringify({ notify: v })), opts.notify ?? true);
  await page.reload();
  await ui(page).article.locator('.blk').first().waitFor();
}
const notes = (page: Page) => page.evaluate(() => (window as unknown as { __notes: Note[] }).__notes);
const setHidden = (page: Page, hidden: boolean) =>
  page.evaluate((h) => ((window as unknown as { __hidden: boolean }).__hidden = h), hidden);
const click = (page: Page, i: number) =>
  page.evaluate((n) => (window as unknown as { __instances: { onclick: () => void }[] }).__instances[n]?.onclick(), i);
type App = { apply: (b: unknown, o?: { topic?: string }) => Promise<unknown> };
const reply = (app: App, topic: string, body = '返信です。', ask?: unknown) =>
  app.apply(
    { threads: [{ page: 'root', anchor: { quote: '猫は朝によく鳴きます' }, body, ...(ask ? { ask } : {}) }] },
    { topic },
  );

test.describe('ほかのトピックの新着の通知（F46）', () => {
  test('開いていないトピックに AI の返信が届くと、通知が 1 回出る（トピック名と件数・tag はそのトピック）。返信の本文は載せない。同じ取り直しでは、増えない。押すと、そのトピックが開く', async ({
    page,
    app,
  }) => {
    await app.addTopic(OTHER, OTHER_TITLE, DOC_BASIC);
    await prepare(page, { hidden: true });
    await expect(page.locator('#top-title')).toHaveText('猫の観察日記'); // 開いているのは、demo
    await reply(app, OTHER, '朝はお腹がすくからです（秘密の本文）');
    await expect.poll(() => notes(page).then((n) => n.length), { timeout: 1500 }).toBe(1); // SSE：すぐ
    const [n] = await notes(page);
    expect(n?.title).toBe('rikai');
    expect(n?.options.body).toBe('別の観察日記：AI から返信が届きました（返信 1）');
    expect(n?.options.tag).toBe('rikai-other');
    expect(JSON.stringify(n)).not.toContain('秘密の本文');
    await page.waitForTimeout(1200);
    expect(await notes(page)).toHaveLength(1); // 取り直しでは、増えない
    // 押すと、そのトピックが開く
    await click(page, 0);
    await expect(page).toHaveURL(/#\/other\/root/);
    await expect(page.locator('#top-title')).toHaveText(OTHER_TITLE);
    expect(
      await page.evaluate(() => (window as unknown as { __instances: { closed: boolean }[] }).__instances[0]?.closed),
    ).toBe(true);
  });

  test('件数：返信・質問・新しい版（0 の項目は省く）。画面を見ていない間は、累計（返信 1 → 返信 2）。版だけなら「資料が更新されました」', async ({
    page,
    app,
  }) => {
    await app.addTopic(OTHER, OTHER_TITLE, DOC_BASIC);
    await prepare(page, { hidden: true });
    await reply(app, OTHER, '一つ目です。');
    await expect.poll(() => notes(page).then((n) => n.length)).toBe(1);
    await reply(app, OTHER, '二つ目です。');
    await expect.poll(() => notes(page).then((n) => n.length)).toBe(2);
    expect((await notes(page)).map((n) => n.options.body)).toEqual([
      '別の観察日記：AI から返信が届きました（返信 1）',
      '別の観察日記：AI から返信が届きました（返信 2）',
    ]);
    await setHidden(page, false);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await setHidden(page, true);
    await app.apply(
      { threads: [{ page: 'root', anchor: { quote: '日向でよく丸くなります' }, body: '質問です。', ask: ASK }] },
      { topic: OTHER },
    );
    await expect.poll(() => notes(page).then((n) => n.length)).toBe(3);
    expect((await notes(page))[2]?.options.body).toBe('別の観察日記：AI から返信が届きました（質問 1）');
    await app.apply({ revisions: [{ page: 'root', markdown: DOC_V2 }] }, { topic: OTHER });
    await expect.poll(() => notes(page).then((n) => n.length)).toBe(4);
    expect((await notes(page))[3]?.options.body).toBe('別の観察日記：AI から返信が届きました（新しい版 1・質問 1）');
  });

  test('開いているトピックの返信は、これまでどおり 1 回だけ（二重にならない）。ほかのトピックと同時に届いても、それぞれ 1 回', async ({
    page,
    app,
  }) => {
    await app.addTopic(OTHER, OTHER_TITLE, DOC_BASIC);
    await prepare(page, { hidden: true });
    await reply(app, 'demo', '開いているトピックへの返信です。');
    await reply(app, OTHER, 'ほかのトピックへの返信です。');
    await expect.poll(() => notes(page).then((n) => n.length), { timeout: 2000 }).toBe(2);
    await page.waitForTimeout(1500);
    const all = await notes(page);
    expect(all).toHaveLength(2);
    expect(all.map((n) => n.options.tag).sort()).toEqual(['rikai-demo', 'rikai-other']);
    expect(all.find((n) => n.options.tag === 'rikai-demo')?.options.body).toBe(
      '猫の観察日記：AI から返信が届きました（返信 1）',
    );
  });

  test('トピックの切り替え：開き直したトピックは、ベースラインを取り直す（すでにある返信を、新着にしない）。切り替えのあとは、旧いトピックを一覧から、新しいトピックを取得から、それぞれ 1 回', async ({
    page,
    app,
  }) => {
    await app.addTopic(OTHER, OTHER_TITLE, DOC_BASIC);
    await reply(app, OTHER, '切り替える前から、ある返信です。');
    await prepare(page, { hidden: true });
    await page.waitForTimeout(800);
    expect(await notes(page)).toHaveLength(0); // 最初の読み込み：ベースライン
    await page.evaluate(() => (location.hash = '#/other/root'));
    await expect(page.locator('#top-title')).toHaveText(OTHER_TITLE);
    await page.waitForTimeout(800);
    expect(await notes(page)).toHaveLength(0); // 開いた：すでにある返信は、新着でない
    // other を開いている：demo は一覧から・other は取得から
    await reply(app, 'demo', 'demo への返信です。');
    await reply(app, OTHER, 'other への返信です。');
    await expect.poll(() => notes(page).then((n) => n.length), { timeout: 2000 }).toBe(2);
    await page.waitForTimeout(1500);
    const all = await notes(page);
    expect(all).toHaveLength(2);
    expect(all.map((n) => n.options.tag).sort()).toEqual(['rikai-demo', 'rikai-other']);
    // もう一度 demo へ戻る：すでに通知した返信は、もう一度、出ない
    await page.evaluate(() => (location.hash = '#/demo/root'));
    await expect(page.locator('#top-title')).toHaveText('猫の観察日記');
    await page.waitForTimeout(1000);
    expect(await notes(page)).toHaveLength(2);
  });

  test('出さない：画面を見ているとき・最初の読み込みですでにある返信・ベルがオフ・閉じたトピック', async ({
    page,
    app,
  }) => {
    await app.addTopic(OTHER, OTHER_TITLE, DOC_BASIC);
    await app.addTopic('old', '終わった資料', DOC_BASIC);
    await reply(app, OTHER, '読み込み前から、ある返信です。');
    await prepare(page, { hidden: false });
    await reply(app, OTHER, '見ている間に届く返信です。'); // 画面を見ている
    await page.waitForTimeout(1200);
    expect(await notes(page)).toHaveLength(0);
    await setHidden(page, true); // 離れた：さっきの分は、出さない
    await page.waitForTimeout(1000);
    expect(await notes(page)).toHaveLength(0);
    // 閉じたトピック（終了）：新着がない扱い
    expect(
      (
        await app.http('/api/end', {
          method: 'POST',
          auth: true,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ topic: 'old' }),
        })
      ).status,
    ).toBe(200);
    await page.waitForTimeout(600);
    await reply(app, 'old', '終わったあとに届く返信です。');
    await page.waitForTimeout(1200);
    expect(await notes(page)).toHaveLength(0);
    // ベルがオフ
    await page.evaluate(() => localStorage.setItem('rikai-ui', JSON.stringify({ notify: false })));
    await page.reload();
    await ui(page).article.locator('.blk').first().waitFor();
    await setHidden(page, true);
    await reply(app, OTHER, 'ベルがオフのときの返信です。');
    await page.waitForTimeout(1200);
    expect(await notes(page)).toHaveLength(0);
    // オンに戻して、離れたまま、次の返信：出る（ベースラインは、進んでいる）
    await page.evaluate(() => localStorage.setItem('rikai-ui', JSON.stringify({ notify: true })));
    await page.reload();
    await ui(page).article.locator('.blk').first().waitFor();
    await setHidden(page, true);
    await reply(app, OTHER, 'オンに戻してからの返信です。');
    await expect.poll(() => notes(page).then((n) => n.length), { timeout: 2000 }).toBe(1);
  });

  // 一覧の fresh の窓は、通知の対象のトピックの数で決まる（すべてのトピックに付く）。トピックの増減で窓が変わっても、誤通知は出ない
  test('多数のトピック：すべてのトピックに fresh が付く（後ろのトピックも）。トピックが増えて窓が縮んでも・減って広がっても、誤通知は出ない。そのあとの本当の新着は、1 回出る', async ({
    page,
    app,
  }) => {
    test.setTimeout(180_000);
    const slugOf = (i: number) => `z${String(i).padStart(2, '0')}`;
    const fill = (slug: string) => {
      const messages = Array.from({ length: 230 }, (_, i) => ({
        id: `m${i + 1}`,
        author: 'ai',
        kind: 'reply',
        at: '',
        text: '返信',
        sent: true,
      }));
      const file = path.join(app.root, '.rikai', slug, 'threads.json');
      fs.writeFileSync(
        file,
        JSON.stringify({
          seq: 231,
          threads: [
            {
              id: 't1',
              page: 'root',
              version: 1,
              anchor: null,
              resolved: false,
              resolveSent: true,
              createdAt: '',
              origin: 'ai',
              messages,
            },
          ],
        }),
      );
    };
    const topics = async () =>
      JSON.parse((await app.http('/api/topics', { auth: true })).body) as {
        slug: string;
        fresh?: { window: number; replies: string[] };
      }[];
    for (let i = 1; i <= 20; i++) {
      await app.addTopic(slugOf(i), `資料 ${slugOf(i)}`, DOC_BASIC);
      fill(slugOf(i));
    }
    await prepare(page, { hidden: true }); // demo ＋ 20 トピック（21）：窓は 190
    let all = await topics();
    expect(all).toHaveLength(21);
    expect(all.every((t) => t.fresh?.window === 190)).toBe(true);
    expect(all.find((t) => t.slug === 'z20')?.fresh?.replies).toHaveLength(190); // 後ろのトピックにも、付く
    // 増える（窓が縮む）：誤通知なし
    for (let i = 21; i <= 40; i++) await app.addTopic(slugOf(i), `資料 ${slugOf(i)}`, DOC_BASIC); // 空のトピック（z01〜z20 の窓が縮む）
    await page.waitForTimeout(1500);
    all = await topics();
    expect(all).toHaveLength(41);
    expect(all.every((t) => t.fresh?.window === 97)).toBe(true);
    expect(await notes(page)).toHaveLength(0);
    // 減る（窓が広がる）：古い ID が、新しく窓に入っても、誤通知なし
    for (let i = 21; i <= 40; i++)
      fs.rmSync(path.join(app.root, '.rikai', slugOf(i)), { recursive: true, force: true });
    await page.waitForTimeout(1500);
    all = await topics();
    expect(all).toHaveLength(21);
    expect(all.every((t) => t.fresh?.window === 190)).toBe(true);
    expect(await notes(page)).toHaveLength(0);
    // 本当の新着は、1 回出る
    await reply(app, 'z02', '本当の新着です。');
    await expect.poll(() => notes(page).then((n) => n.length), { timeout: 3000 }).toBe(1);
    await page.waitForTimeout(1000);
    const all2 = await notes(page);
    expect(all2).toHaveLength(1);
    expect(all2[0]?.options.body).toBe('資料 z02：AI から返信が届きました（返信 1）');
  });
});
