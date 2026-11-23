// ブラウザの通知（F41）：ベル（オン・オフ・許可）・画面を見ていないときだけ、AI の返信・新しい版・質問で、通知が 1 回出る。最初の読み込みでは出ない。押すと、そのトピックへ戻る。
// `window.Notification` は、初期化スクリプトで差し替えて、通知の生成を記録する（実際の OS の通知は、見えないので）。画面を見ていない状態は、`document.hasFocus`・`visibilityState` を上書きして作る。
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { DOC_BASIC } from './samples';
import { ui } from './ui';

interface Note {
  title: string;
  options: { body?: string; tag?: string; icon?: string; silent?: boolean };
}
// 新しい版（食事の段落を直す）
const DOC_V2 = DOC_BASIC.replace('一日に三回', '一日に四回');
const ASK = { type: 'yes_no', question: '夜も鳴きますか' } as const;

/** 偽の Notification と、画面を見ていない状態の切り替え（window.__hidden）を、ページの初期化に入れて、開き直す */
async function prepare(
  page: Page,
  opts: { permission?: 'granted' | 'denied' | 'default'; hidden?: boolean; notify?: boolean } = {},
) {
  await page.addInitScript(
    ({ permission, hidden }) => {
      const w = window as unknown as Record<string, unknown>;
      w.__notes = [] as unknown[];
      w.__instances = [] as unknown[];
      w.__hidden = hidden;
      w.__asked = 0;
      class FakeNotification {
        // 許可は、ブラウザが覚える（再読み込みしても、そのまま）：localStorage で、まねる
        static permission = (localStorage.getItem('__perm') as NotificationPermission | null) ?? permission;
        static async requestPermission() {
          w.__asked = (w.__asked as number) + 1;
          FakeNotification.permission = (w.__grant as string | undefined) === 'denied' ? 'denied' : 'granted';
          localStorage.setItem('__perm', FakeNotification.permission);
          return FakeNotification.permission;
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
    { permission: opts.permission ?? 'granted', hidden: opts.hidden ?? false },
  );
  if (opts.notify !== undefined)
    await page.evaluate((v) => localStorage.setItem('rikai-ui', JSON.stringify({ notify: v })), opts.notify);
  await page.reload();
  await ui(page).article.locator('.blk').first().waitFor();
}
const notes = (page: Page) => page.evaluate(() => (window as unknown as { __notes: Note[] }).__notes);
const setHidden = (page: Page, hidden: boolean) =>
  page.evaluate((h) => ((window as unknown as { __hidden: boolean }).__hidden = h), hidden);
const bell = (page: Page) => page.locator('#btn-notify');
/** AI が、返信を足す（新しいスレッド：AI 起点） */
const aiReply = (app: { apply: (b: unknown) => Promise<unknown> }, body = '返信です。') =>
  app.apply({ threads: [{ page: 'root', anchor: { quote: '猫は朝によく鳴きます' }, body }] });

test.describe('ブラウザの通知（F41）', () => {
  test('ベル：既定はオフ。押すと、許可を求めて、オン（保存される：再読み込みしても、オン）。もう一度で、オフ', async ({
    page,
  }) => {
    await prepare(page, { permission: 'default' });
    await expect(bell(page)).toHaveAttribute('data-notify', 'off');
    await expect(bell(page)).toBeEnabled();
    await expect(bell(page)).toHaveAttribute('aria-label', /通知：オフ/);
    await bell(page).click();
    await expect(bell(page)).toHaveAttribute('data-notify', 'on');
    expect(await page.evaluate(() => (window as unknown as { __asked: number }).__asked)).toBe(1); // 許可を求めた
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('rikai-ui') ?? '{}').notify)).toBe(true);
    await page.reload(); // 許可は、ブラウザが覚えている（偽物も、まねる）：保存の復元
    await expect(bell(page)).toHaveAttribute('data-notify', 'on');
    await bell(page).click();
    await expect(bell(page)).toHaveAttribute('data-notify', 'off');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('rikai-ui') ?? '{}').notify)).toBe(false);
  });

  test('許可を拒否したら、オフのまま。ブロックされている（denied）とき・保存がオンでも許可がないときは、押せない／オフ', async ({
    page,
  }) => {
    await prepare(page, { permission: 'default' });
    await page.evaluate(() => ((window as unknown as { __grant: string }).__grant = 'denied'));
    await bell(page).click();
    await expect(bell(page)).toHaveAttribute('data-notify', 'disabled'); // 拒否された：以後、押せない
    await expect(bell(page)).toBeDisabled();
    await expect(bell(page)).toHaveAttribute(
      'aria-label',
      '通知がブロックされています。ブラウザの設定で許可してください',
    );
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('rikai-ui') ?? '{}').notify)).not.toBe(true);
  });

  test('保存がオンでも、許可が granted でなければ、オフとして扱う（通知は出ない）', async ({ page, app }) => {
    await prepare(page, { permission: 'default', hidden: true, notify: true });
    await expect(bell(page)).toHaveAttribute('data-notify', 'off');
    await aiReply(app);
    await expect(ui(page).threads).toHaveCount(1);
    await page.waitForTimeout(600);
    expect(await notes(page)).toHaveLength(0);
  });

  test('画面を見ていないとき、AI の返信が届くと、通知が 1 回出る（題 rikai・トピック名と件数・tag・icon なし）。返信の本文は、載せない', async ({
    page,
    app,
  }) => {
    await prepare(page, { notify: true });
    await setHidden(page, true);
    await aiReply(app, '朝はお腹がすくからです（秘密の本文）');
    await expect.poll(() => notes(page).then((n) => n.length), { timeout: 500 }).toBe(1); // SSE：500ms 以内
    const [n] = await notes(page);
    expect(n?.title).toBe('rikai');
    expect(n?.options.body).toBe('猫の観察日記：AI から返信が届きました（返信 1）');
    expect(n?.options.tag).toBe('rikai-demo');
    expect(n?.options.icon).toBeUndefined();
    expect(n?.options.silent).toBe(false);
    expect(JSON.stringify(n)).not.toContain('秘密の本文');
    // 同じ状態の取り直し・自分の操作では、増えない
    await page.waitForTimeout(800);
    expect(await notes(page)).toHaveLength(1);
    // もう 1 つ届く：また出る（同じ tag）
    await aiReply(app, '二つ目です。');
    await expect.poll(() => notes(page).then((n2) => n2.length)).toBe(2);
    expect((await notes(page))[1]?.options.tag).toBe('rikai-demo');
  });

  test('返信・新しい版・質問の件数（0 の項目は省く）。版だけなら「資料が更新されました」', async ({ page, app }) => {
    await prepare(page, { notify: true });
    await setHidden(page, true);
    await app.apply({
      // 質問付きの 1 通は「質問 1」だけ（返信にも数えない）。質問のない 1 通が「返信 1」
      threads: [
        { page: 'root', anchor: { quote: '猫は朝によく鳴きます' }, body: '返信です。' },
        { page: 'root', anchor: { quote: '日向でよく丸くなります' }, body: '質問です。', ask: ASK },
      ],
      revisions: [{ page: 'root', markdown: DOC_V2 }],
    });
    await expect.poll(() => notes(page).then((n) => n.length)).toBe(1);
    expect((await notes(page))[0]?.options.body).toBe(
      '猫の観察日記：AI から返信が届きました（返信 1・新しい版 1・質問 1）',
    );
    // 画面に戻って、また離れる（累計は 0 から）：版だけが増える
    await setHidden(page, false);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await setHidden(page, true);
    await app.apply({ revisions: [{ page: 'root', markdown: `${DOC_V2}\n最後に足した段落です。\n` }] });
    await expect.poll(() => notes(page).then((n) => n.length)).toBe(2);
    expect((await notes(page))[1]?.options.body).toBe('猫の観察日記：資料が更新されました（新しい版 1）');
  });

  test('最初の読み込みでは出ない（すでにある返信は、ベースライン）。画面を見ているときは出ない。見ている間に増えた分は、あとで出ない', async ({
    page,
    app,
  }) => {
    await aiReply(app, '読み込み前から、ある返信です。');
    await prepare(page, { notify: true, hidden: true }); // 画面を見ていない状態で、読み込む
    await expect(ui(page).threads).toHaveCount(1);
    await page.waitForTimeout(1200);
    expect(await notes(page)).toHaveLength(0); // 最初の読み込み
    await setHidden(page, false); // 画面を見ている
    await aiReply(app, '見ている間に届いた返信です。');
    await expect(ui(page).threads).toHaveCount(2);
    await page.waitForTimeout(800);
    expect(await notes(page)).toHaveLength(0);
    await setHidden(page, true); // 離れた：同じ状態（さっきの分）では、出さない
    await page.waitForTimeout(800);
    expect(await notes(page)).toHaveLength(0);
    await aiReply(app, '離れてから届いた返信です。');
    await expect.poll(() => notes(page).then((n) => n.length)).toBe(1);
  });

  test('ベルがオフなら、出ない', async ({ page, app }) => {
    await prepare(page, { notify: false, hidden: true });
    await aiReply(app);
    await expect(ui(page).threads).toHaveCount(1);
    await page.waitForTimeout(800);
    expect(await notes(page)).toHaveLength(0);
  });

  test('通知を押す：画面へ戻って、新着のカードを選ぶ。別のトピックを見ていたら、そのトピックを開く。通知は、閉じる', async ({
    page,
    app,
  }) => {
    await prepare(page, { notify: true });
    await setHidden(page, true);
    await aiReply(app, 'カードへ戻る返信です。');
    await expect.poll(() => notes(page).then((n) => n.length)).toBe(1);
    await page.evaluate(() => (location.hash = '#/other/root')); // 別のトピックの画面にいる
    await page.evaluate(() =>
      (window as unknown as { __instances: { onclick: () => void }[] }).__instances[0]?.onclick(),
    );
    await expect(page).toHaveURL(/#\/demo\/root/);
    expect(
      await page.evaluate(() => (window as unknown as { __instances: { closed: boolean }[] }).__instances[0]?.closed),
    ).toBe(true);
    await expect(ui(page).threads).toHaveCount(1);
    // そのトピックを見ている：新着のカードを選ぶ
    await page.evaluate(() =>
      (window as unknown as { __instances: { onclick: () => void }[] }).__instances[0]?.onclick(),
    );
    await expect(ui(page).threads.first()).toHaveClass(/active/);
  });

  test('実際のブラウザの許可（context.grantPermissions）：偽物なしで、ベルが、許可を得て、オンになる', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['notifications']);
    await page.reload();
    await ui(page).article.locator('.blk').first().waitFor();
    expect(await page.evaluate(() => Notification.permission)).toBe('granted');
    await expect(bell(page)).toBeEnabled();
    await bell(page).click();
    await expect(bell(page)).toHaveAttribute('data-notify', 'on');
  });

  // 意図した変更（RIK-045 の再レビュー）：新着は、件数の差でなく、前回に知っていた ID との差
  test('読んだあとに来た返信：画面を見ている間に返信 → 読む（カードを開く）→ 画面を離れる → 返信 → 通知が出る', async ({
    page,
    app,
  }) => {
    const u = ui(page);
    await prepare(page, { notify: true });
    await aiReply(app, '見ている間に届く返信です。');
    await expect(u.threads).toHaveCount(1);
    await page.waitForTimeout(600);
    expect(await notes(page)).toHaveLength(0); // 見ている：出さない
    await u.threads.first().locator('.th-head').click(); // 読む（取得は、起きない）
    await expect(u.threads.first()).toHaveClass(/active/);
    await setHidden(page, true); // 別のアプリへ
    await aiReply(app, '離れてから届く返信です。');
    await expect.poll(() => notes(page).then((n) => n.length), { timeout: 1500 }).toBe(1);
    expect((await notes(page))[0]?.options.body).toBe('猫の観察日記：AI から返信が届きました（返信 1）');
  });

  test('自分の操作では出ない：解決 → 解決の取り消し（画面を見ていない状態でも）', async ({ page, app }) => {
    const u = ui(page);
    await prepare(page, { notify: true });
    await aiReply(app, '解決と取り消しをする返信です。');
    await expect(u.threads).toHaveCount(1);
    await setHidden(page, true);
    await u.threads.first().getByRole('button', { name: '解決', exact: true }).click();
    await page.locator('.tab', { hasText: '解決済み' }).click();
    await page.locator('.donerow').click();
    await u.threads.first().getByRole('button', { name: '再開する' }).click(); // 解決の取り消し：未解決に戻る
    await page.locator('.tab', { hasText: '進行中' }).click();
    await expect(u.threads).toHaveCount(1);
    await page.waitForTimeout(1000);
    expect(await notes(page)).toHaveLength(0);
  });

  test('累計：画面を見ていない間に 2 回届くと、2 回目は「返信 2」。画面に戻ったら、0 に戻る', async ({ page, app }) => {
    await prepare(page, { notify: true });
    await setHidden(page, true);
    await aiReply(app, '一つ目です。');
    await expect.poll(() => notes(page).then((n) => n.length)).toBe(1);
    await aiReply(app, '二つ目です。');
    await expect.poll(() => notes(page).then((n) => n.length)).toBe(2);
    const bodies = (await notes(page)).map((n) => n.options.body);
    expect(bodies).toEqual([
      '猫の観察日記：AI から返信が届きました（返信 1）',
      '猫の観察日記：AI から返信が届きました（返信 2）',
    ]);
    // 画面に戻る（focus）→ また離れる：0 から
    await setHidden(page, false);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await setHidden(page, true);
    await aiReply(app, '三つ目です。');
    await expect.poll(() => notes(page).then((n) => n.length)).toBe(3);
    expect((await notes(page))[2]?.options.body).toBe('猫の観察日記：AI から返信が届きました（返信 1）');
  });

  test('複数のタブ：同じトピックの通知は、同じ tag：実際のブラウザで、あとの通知が、前の通知を置き換える（見た目は 1 つ）', async ({
    page,
    context,
    app,
  }) => {
    await context.grantPermissions(['notifications']);
    // 実際の Notification を、包んで、作った通知と close を数える（通知の生成は、本物）
    await context.addInitScript(() => {
      const w = window as unknown as { __made: string[]; __closed: string[]; __hidden: boolean };
      w.__made = [];
      w.__closed = [];
      w.__hidden = true;
      const Real = window.Notification;
      window.Notification = class extends Real {
        constructor(title: string, options?: NotificationOptions) {
          super(title, options);
          w.__made.push(options?.tag ?? '');
          this.addEventListener('close', () => w.__closed.push(options?.tag ?? ''));
        }
      };
      document.hasFocus = () => !w.__hidden;
      Object.defineProperty(document, 'visibilityState', {
        get: () => (w.__hidden ? 'hidden' : 'visible'),
        configurable: true,
      });
    });
    await page.evaluate(() => localStorage.setItem('rikai-ui', JSON.stringify({ notify: true })));
    await page.reload();
    await ui(page).article.locator('.blk').first().waitFor();
    const page2 = await context.newPage();
    await app.open(page2);
    await expect(bell(page)).toHaveAttribute('data-notify', 'on');
    await expect(bell(page2)).toHaveAttribute('data-notify', 'on');
    await aiReply(app, '二つのタブで受ける返信です。');
    const total = async (key: '__made' | '__closed') =>
      (
        await Promise.all(
          [page, page2].map((p) =>
            p.evaluate((k) => (window as unknown as Record<string, string[]>)[k]?.length ?? 0, key),
          ),
        )
      ).reduce((a, b) => a + b, 0);
    await expect.poll(() => total('__made')).toBe(2); // 各タブが、出す
    await expect.poll(() => total('__closed')).toBe(1); // 同じ tag：あとの通知が、前の通知を置き換えた（見えるのは 1 つ）
  });
});
