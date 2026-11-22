// AI の質問（ask。F10・F21・F30）：5 つの型 → 回答を保存・取り消し → Submit（pull に answer が届く）→ 固定 →「答えずに、会話が進みました」
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { addTextComment, submitAll, ui } from './ui';

const ASKS = {
  single: {
    type: 'single_choice',
    question: '猫は何を食べますか',
    options: [
      { id: 'a', label: 'カリカリ' },
      { id: 'b', label: '魚', detail: '焼いたもの' },
      { id: 'c', label: '草' },
    ],
  },
  multi: {
    type: 'multi_choice',
    question: '好きな場所はどこですか',
    options: [
      { id: 'x', label: '日向' },
      { id: 'y', label: '箱' },
      { id: 'z', label: '机の上' },
    ],
    allowOther: true,
  },
  yesno: { type: 'yes_no', question: '猫は夜行性ですか' },
  scale: {
    type: 'scale',
    question: 'ここまでの理解度は',
    min: 1,
    max: 5,
    minLabel: 'ぜんぜん',
    maxLabel: 'よく分かった',
  },
  free: { type: 'free_text', question: '自分の言葉で説明してください', placeholder: '自分の言葉で' },
} as const;

const askCard = (page: Page, q: string) => ui(page).threads.filter({ hasText: q });

// AI 起点のスレッドを、5 つの型で 1 つずつ出す
async function seedAll(page: Page, app: { apply: (b: unknown) => Promise<unknown> }) {
  await app.apply({
    threads: Object.values(ASKS).map((ask, i) => ({ page: 'root', body: `確認の質問 ${i + 1} です。`, ask })),
  });
  await expect(ui(page).threads).toHaveCount(5);
}

test.describe('AI の質問と回答', () => {
  test('5 つの型：答えて「回答を保存」→ 未送信 → Submit で answer が pull に届く → 送信済みで固定（F10・F21）', async ({
    page,
    app,
  }) => {
    const u = ui(page);
    await seedAll(page, app);
    await expect(u.top).toContainText('回答 0/5');
    const save = (c: ReturnType<typeof askCard>) => c.getByRole('button', { name: '回答を保存' });

    // 単一選択
    const single = askCard(page, ASKS.single.question);
    await expect(single.locator('.ask')).toContainText('焼いたもの');
    await expect(save(single)).toBeDisabled(); // 選ぶまで保存できない
    await single.getByLabel('魚').check();
    await save(single).click();
    await expect(single.getByRole('button', { name: '保存済み（未送信）' })).toBeDisabled();
    await expect(single.getByRole('button', { name: '取り消す' })).toBeVisible();
    await expect(u.submit).toHaveText('Submit (1)');
    await expect(u.top).toContainText('回答 0/5'); // 保存しただけでは、数えない

    // 複数選択＋その他
    const multi = askCard(page, ASKS.multi.question);
    await multi.getByLabel('日向').check();
    await multi.getByLabel('机の上').check();
    await multi.locator('.opt.other input[type=text]').fill('窓辺');
    await multi.locator('.opt.other input[type=text]').press('Tab');
    await save(multi).click();
    await expect(multi.getByRole('button', { name: '保存済み（未送信）' })).toBeVisible();

    // はい／いいえ
    const yn = askCard(page, ASKS.yesno.question);
    await yn.getByRole('button', { name: 'いいえ', exact: true }).click();
    await save(yn).click();
    await expect(yn.getByRole('button', { name: '保存済み（未送信）' })).toBeVisible();

    // 尺度（両端のラベル）
    const scale = askCard(page, ASKS.scale.question);
    await expect(scale).toContainText('ぜんぜん');
    await expect(scale).toContainText('よく分かった');
    for (const n of ['1', '2', '3', '4', '5'])
      await expect(scale.getByRole('button', { name: n, exact: true })).toBeVisible();
    await scale.getByRole('button', { name: '4', exact: true }).click();
    await save(scale).click();
    await expect(scale.getByRole('button', { name: '保存済み（未送信）' })).toBeVisible();

    // 自由記述
    const free = askCard(page, ASKS.free.question);
    await free.getByPlaceholder('自分の言葉で').fill('猫は夜に活発です');
    await free.getByPlaceholder('自分の言葉で').press('Tab');
    await save(free).click();
    await expect(free.getByRole('button', { name: '保存済み（未送信）' })).toBeVisible();

    await expect(u.submit).toHaveText('Submit (5)');
    await submitAll(page);

    // pull：型ごとの回答の形
    const r = await app.nextRound();
    expect(r.items).toHaveLength(5);
    const answers: Record<string, unknown> = {};
    for (const it of r.items) {
      const m = it.new.find((x: { kind: string }) => x.kind === 'answer');
      expect(m, '回答の発言').toBeTruthy();
      answers[JSON.stringify(m.answer)] = m;
    }
    const all = Object.keys(answers).join('\n');
    expect(all).toContain('{"choice":"b"}');
    expect(all).toContain('{"choices":["x","z"],"other":"窓辺"}');
    expect(all).toContain('{"value":false}');
    expect(all).toContain('{"value":4}');
    expect(all).toContain('{"text":"猫は夜に活発です"}');

    // 送信済み：「回答を送信済み」・入力は固定・数に入る
    await expect(single).toContainText('回答を送信済み');
    await expect(single.getByLabel('魚')).toBeDisabled();
    await expect(single.getByLabel('魚')).toBeChecked();
    await expect(save(single)).toHaveCount(0);
    await expect(yn.getByRole('button', { name: 'はい', exact: true })).toBeDisabled();
    await expect(free.getByPlaceholder('自分の言葉で')).toBeDisabled();
    await expect(u.top).toContainText('回答 5/5');
  });

  test('保存した回答は、選び直せる・取り消せる。取り消すと、送る変更でなくなる（F5・F10）', async ({ page, app }) => {
    const u = ui(page);
    await seedAll(page, app);
    const single = askCard(page, ASKS.single.question);
    await single.getByLabel('草').check();
    await single.getByRole('button', { name: '回答を保存' }).click();
    await expect(u.submit).toHaveText('Submit (1)');
    // 選び直して保存
    await single.getByLabel('カリカリ').check();
    await single.getByRole('button', { name: '回答を保存' }).click();
    await expect(single.getByRole('button', { name: '保存済み（未送信）' })).toBeVisible();
    // 取り消す
    await single.getByRole('button', { name: '取り消す' }).click();
    await expect(single.getByRole('button', { name: '取り消す' })).toHaveCount(0);
    await expect(u.submit).toBeDisabled();
    await expect(single.getByLabel('カリカリ')).not.toBeChecked();
    // もう一度答えて、送る：最後に保存した選択だけが届く
    await single.getByLabel('魚').check();
    await single.getByRole('button', { name: '回答を保存' }).click();
    await submitAll(page);
    const r = await app.nextRound();
    expect(r.items).toHaveLength(1);
    expect(r.items[0].new[0].answer).toEqual({ choice: 'b' });
    expect(JSON.stringify(r)).not.toContain('"choice":"c"');
  });

  test('送信済みの回答は、サーバーも、変更・取り消しを断る（F10）', async ({ page, app }) => {
    await seedAll(page, app);
    const single = askCard(page, ASKS.single.question);
    await single.getByLabel('魚').check();
    await single.getByRole('button', { name: '回答を保存' }).click();
    await submitAll(page);
    await app.nextRound();
    await expect(single).toContainText('回答を送信済み');
    const t = JSON.parse((await app.http(`/api/topic/${app.slug}`, { auth: true })).body);
    const th = t.threads.find((x: { messages: Array<{ ask?: { question: string } }> }) =>
      x.messages.some((m) => m.ask?.question === ASKS.single.question),
    );
    const q = th.messages.find((m: { ask?: unknown }) => m.ask);
    for (const answer of [{ choice: 'a' }, null]) {
      const res = await app.http('/api/answer', {
        method: 'POST',
        auth: true,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ topic: app.slug, thread: th.id, msg: q.id, answer }),
      });
      expect(res.status, '送信済みの回答への操作').toBeGreaterThanOrEqual(400);
      expect(JSON.parse(res.body).ok).toBe(false);
    }
  });

  test('サーバーは、ask に照らして答えを検査する（存在しない選択肢・範囲外・空は受けない）（F10）', async ({
    page,
    app,
  }) => {
    await seedAll(page, app);
    const t = JSON.parse((await app.http(`/api/topic/${app.slug}`, { auth: true })).body);
    const ask = (q: string) => {
      const th = t.threads.find((x: { messages: Array<{ ask?: { question: string } }> }) =>
        x.messages.some((m) => m.ask?.question === q),
      );
      return { th, q: th.messages.find((m: { ask?: unknown }) => m.ask) };
    };
    const post = async (q: string, answer: unknown) => {
      const { th, q: m } = ask(q);
      const res = await app.http('/api/answer', {
        method: 'POST',
        auth: true,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ topic: app.slug, thread: th.id, msg: m.id, answer }),
      });
      return JSON.parse(res.body).ok;
    };
    expect(await post(ASKS.single.question, { choice: 'zzz' })).toBe(false);
    expect(await post(ASKS.scale.question, { value: 9 })).toBe(false);
    expect(await post(ASKS.free.question, { text: '   ' })).toBe(false);
    expect(await post(ASKS.single.question, { choice: 'a' })).toBe(true);
  });

  test('AI が新しい質問を出したら、また答えられる（F10）', async ({ page, app }) => {
    const u = ui(page);
    await app.apply({ threads: [{ page: 'root', body: '最初の質問です。', ask: ASKS.single }] });
    const card = u.threads.first();
    await card.getByLabel('草').check();
    await card.getByRole('button', { name: '回答を保存' }).click();
    await submitAll(page);
    const r = await app.nextRound();
    await app.apply({
      round: r.round,
      replies: [
        { thread: r.items[0].thread, body: '惜しいです。', ask: { type: 'yes_no', question: '魚は好きですか' } },
      ],
    });
    await expect(card).toContainText('魚は好きですか');
    await expect(card.getByRole('button', { name: 'はい', exact: true })).toBeEnabled();
    // 前の質問は、送信済みのまま固定
    await expect(card.getByLabel('草')).toBeDisabled();
    await card.getByRole('button', { name: 'はい', exact: true }).click();
    await card.getByRole('button', { name: '回答を保存' }).last().click();
    await expect(u.submit).toHaveText('Submit (1)');
  });

  test('答えないまま会話が進んだ質問は、小さく見える。「答える」で、また答えられる（F30）', async ({ page, app }) => {
    const u = ui(page);
    await app.apply({ threads: [{ page: 'root', body: '確認です。', ask: ASKS.single }] });
    const card = u.threads.first();
    await expect(card.getByLabel('魚')).toBeVisible();
    // 未送信の発言は、会話が進んだことにならない
    await card.locator('textarea').fill('質問に答える前に、ひとつ聞きたいです');
    await card.getByRole('button', { name: '返信を追加' }).click();
    await expect(card).toContainText('質問に答える前に');
    await expect(card.getByLabel('魚')).toBeVisible();
    await expect(card).not.toContainText('答えずに、会話が進みました');
    // 送ると、小さくなる
    await submitAll(page);
    await expect(card).toContainText('答えずに、会話が進みました');
    await expect(card.locator('.ask')).toContainText(ASKS.single.question);
    await expect(card.locator('input[type=radio]')).toHaveCount(0);
    await expect(card.getByRole('button', { name: '回答を保存' })).toHaveCount(0);
    // 「答える」で、ふつうの入力になる
    await card.getByRole('button', { name: '答える' }).click();
    await expect(card.getByLabel('魚')).toBeVisible();
    await card.getByLabel('魚').check();
    await card.getByRole('button', { name: '回答を保存' }).click();
    await expect(u.submit).toHaveText('Submit (1)');
  });

  test('ユーザーのコメントから始まるスレッドへの、質問つきの返信は、答えられる形で出る（F10・F30）', async ({
    page,
    app,
  }) => {
    const u = ui(page);
    await addTextComment(page, '猫は朝によく鳴きます', 'なぜ朝ですか');
    await submitAll(page);
    const tid = (await app.nextRound()).items[0].thread;
    await app.apply({
      round: 1,
      replies: [
        { thread: tid, body: '朝は活発です。', ask: { type: 'yes_no', question: '朝に鳴くのは分かりましたか' } },
      ],
    });
    const card = u.threads.first();
    await expect(card).toContainText('朝に鳴くのは分かりましたか');
    await expect(card).not.toContainText('答えずに、会話が進みました');
    await card.getByRole('button', { name: 'はい', exact: true }).click();
    await card.getByRole('button', { name: '回答を保存' }).click();
    await expect(u.submit).toHaveText('Submit (1)');
  });

  test('答えた質問・まだ会話が進んでいない質問は、小さくならない（F30）', async ({ page, app }) => {
    await app.apply({
      threads: [
        { page: 'root', body: '一つ目', ask: { type: 'yes_no', question: '質問その一' } },
        { page: 'root', body: '二つ目', ask: { type: 'yes_no', question: '質問その二' } },
      ],
    });
    const one = askCard(page, '質問その一');
    await one.getByRole('button', { name: 'はい', exact: true }).click();
    await one.getByRole('button', { name: '回答を保存' }).click();
    await one.locator('textarea').fill('追加の発言');
    await one.getByRole('button', { name: '返信を追加' }).click();
    await submitAll(page);
    await expect(one).toContainText('回答を送信済み');
    await expect(one).not.toContainText('答えずに、会話が進みました'); // 答えたので
    await expect(askCard(page, '質問その二')).not.toContainText('答えずに、会話が進みました'); // 別のスレッドの発言では、進まない
    await expect(askCard(page, '質問その二').getByRole('button', { name: 'はい', exact: true })).toBeVisible();
  });
});
