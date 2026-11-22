// 資料の形式と無害化（F9・F26・F28・N3）：diff・json・terminal・trace・Mermaid・html-app（枠の中のスクリプトが動く・親に触れない・「ソースを見る」）・
// 無害化（<script>・onerror・javascript: が出ない）
import { expect, test } from './fixtures';
import { addTextComment, hoverBlock, ui } from './ui';

const BT = '```';
const lines = (...l: string[]) => `${l.join('\n')}\n`;

const DOC_FORMATS = lines(
  '# 形式の資料',
  '',
  '## 差分',
  '',
  `${BT}diff`,
  'diff --git a/cat.txt b/cat.txt',
  '--- a/cat.txt',
  '+++ b/cat.txt',
  '@@ -1,2 +1,2 @@',
  ' 猫は寝る',
  '-猫は鳴く',
  '+猫は歌う',
  BT,
  '',
  '## JSON',
  '',
  `${BT}json`,
  '{"name": "たま", "age": 3, "price": 1.50, "owner": {"city": "東京", "tags": ["a", "b"]}}',
  BT,
  '',
  '## 端末',
  '',
  `${BT}terminal`,
  String.raw`\x1b[31m赤い文字\x1b[0m と \x1b[1m太字\x1b[0m と ESC[32m`,
  BT,
  '',
  '## トレース',
  '',
  `${BT}trace`,
  '準備 | 0 | 100 | 最初',
  '実行 | 100 | 300 | 本番',
  BT,
  '',
  '## 図',
  '',
  `${BT}mermaid`,
  'flowchart LR',
  '  A[起点] --> B[終点]',
  BT,
  '',
  `${BT}mermaid`,
  'これは図ではありません',
  BT,
  '',
  `${BT}json`,
  '{壊れた JSON',
  BT,
);

test.describe('資料の形式', () => {
  test('diff：行の種類で色分け（追加・削除・@@・ファイルの見出し）（F26）', async ({ page, app }) => {
    const u = ui(page);
    await app.switchTopic(page, 'fmt', '形式の資料', DOC_FORMATS);
    const d = u.article.locator('.fmt-diff');
    await expect(d.locator('.dl.add')).toHaveText('+猫は歌う');
    await expect(d.locator('.dl.del')).toHaveText('-猫は鳴く');
    await expect(d.locator('.dl.hunk')).toContainText('@@ -1,2 +1,2 @@');
    await expect(d.locator('.dl.meta')).toHaveCount(3); // diff --git・---・+++
    const color = (sel: string) =>
      d.locator(sel).evaluate((e) => getComputedStyle(e).backgroundColor + getComputedStyle(e).color);
    const [add, del, ctx] = [await color('.dl.add'), await color('.dl.del'), await color('.dl.ctx')];
    expect(new Set([add, del, ctx]).size).toBe(3);
  });

  test('json：折りたためる木（根と深さ 1 までは開く）・書かれたとおりに見せる。読めない JSON はコードブロック（F26）', async ({
    page,
    app,
  }) => {
    const u = ui(page);
    await app.switchTopic(page, 'fmt', '形式の資料', DOC_FORMATS);
    const j = u.article.locator('.fmt-json');
    await expect(j.locator('details')).toHaveCount(3); // 根・owner・tags
    await expect(j.locator('details[open]')).toHaveCount(2); // 根と深さ 1
    await expect(j).toContainText('1.50'); // 数は、元の文字のまま
    const tags = j.locator('details').nth(2);
    await expect(tags.locator('.jc')).toBeHidden(); // 深さ 2 は、閉じている
    await tags.locator('summary').click();
    await expect(tags.locator('.jc')).toBeVisible();
    // 壊れた JSON は、ふつうのコードブロック
    await expect(u.article.locator('pre', { hasText: '{壊れた JSON' })).toBeVisible();
    await expect(u.article.locator('.fmt-json')).toHaveCount(1);
  });

  test('terminal：ANSI の色・太字。ESC の書き方は何でもよい。制御文字は見えない（F26）', async ({ page, app }) => {
    const u = ui(page);
    await app.switchTopic(page, 'fmt', '形式の資料', DOC_FORMATS);
    const t = u.article.locator('.fmt-term');
    const red = t.locator('span', { hasText: '赤い文字' }).first();
    await expect(red).toBeVisible();
    const [r, g] = (await red.evaluate((e) => getComputedStyle(e).color)).match(/\d+/g)?.map(Number) ?? [0, 0];
    expect(r).toBeGreaterThan(g + 60);
    const bold = t.locator('span', { hasText: '太字' }).first();
    expect(Number(await bold.evaluate((e) => getComputedStyle(e).fontWeight))).toBeGreaterThanOrEqual(600);
    await expect(t).not.toContainText('x1b');
    await expect(t).not.toContainText('[31m');
    await expect(t).toContainText('と'); // 色の外の文字は、そのまま
  });

  test('trace：ウォーターフォール（棒の位置・長さが、開始・長さに比例する）（F26）', async ({ page, app }) => {
    const u = ui(page);
    await app.switchTopic(page, 'fmt', '形式の資料', DOC_FORMATS);
    const tr = u.article.locator('.fmt-trace');
    await expect(tr).toContainText('準備');
    await expect(tr).toContainText('実行');
    const bars = tr.locator('.tb');
    await expect(bars).toHaveCount(2);
    const track = (await tr.locator('.tt').first().boundingBox()) as { x: number; width: number };
    const b1 = (await bars.nth(0).boundingBox()) as { x: number; width: number };
    const b2 = (await bars.nth(1).boundingBox()) as { x: number; width: number };
    expect(Math.abs(b1.x - track.x)).toBeLessThanOrEqual(2);
    expect(Math.abs(b1.width / track.width - 0.25)).toBeLessThan(0.03); // 100 / 400
    expect(Math.abs((b2.x - track.x) / track.width - 0.25)).toBeLessThan(0.03); // 開始 100
    expect(Math.abs(b2.width / track.width - 0.75)).toBeLessThan(0.03); // 長さ 300
  });

  test('Mermaid：図が描かれる。描けない図は、メッセージとソース（F9・N3）', async ({ page, app }) => {
    const u = ui(page);
    await app.switchTopic(page, 'fmt', '形式の資料', DOC_FORMATS);
    await expect(u.article.locator('.mermaid-block svg').first()).toBeVisible();
    await expect(u.article.locator('.mermaid-block').first()).toContainText('起点');
    const bad = u.article.locator('.mermaid-error');
    await expect(bad).toContainText('図を描画できませんでした');
    await expect(bad.locator('pre')).toContainText('これは図ではありません');
  });

  test('形式のブロックにもコメントできる（種類のラベル）（F4・F26）', async ({ page, app }) => {
    const u = ui(page);
    await app.switchTopic(page, 'fmt', '形式の資料', DOC_FORMATS);
    const cases: Array<[string, string]> = [
      ['.fmt-diff', '差分'],
      ['.fmt-json', 'JSON'],
      ['.fmt-term', '端末出力'],
      ['.fmt-trace', 'トレース'],
      ['.mermaid-block:has(svg)', '図'],
    ];
    for (const [sel, label] of cases) {
      await hoverBlock(page, u.article.locator(sel).first());
      await expect(u.actbar).toBeVisible();
      await u.actComment.click();
      await expect(u.composer.locator('.quote')).toContainText(label);
      await u.composer.getByRole('button', { name: 'やめる' }).click();
    }
  });

  test('AI の返信（Markdown）：見出し・表・箇条書き・コード・Mermaid・diff が、スレッドの中に描かれる（F9・F26）', async ({
    page,
    app,
  }) => {
    const u = ui(page);
    const body = lines(
      '### 返信の見出し',
      '',
      '| 列A | 列B |',
      '| --- | --- |',
      '| 1 | 2 |',
      '',
      '- 項目その一',
      '- 項目その二',
      '',
      `${BT}js`,
      'const a = 1;',
      BT,
      '',
      `${BT}mermaid`,
      'flowchart LR',
      '  X[左] --> Y[右]',
      BT,
      '',
      `${BT}diff`,
      '-古い',
      '+新しい',
      BT,
    );
    await app.apply({ threads: [{ page: 'root', body }] });
    const msg = u.threads.first().locator('.msg.ai');
    await expect(msg.locator('h3')).toHaveText('返信の見出し');
    await expect(msg.locator('table')).toBeVisible();
    await expect(msg.locator('li')).toHaveCount(2);
    await expect(msg.locator('pre', { hasText: 'const a = 1;' })).toBeVisible();
    await expect(msg.locator('.mermaid-block svg')).toBeVisible();
    await expect(msg.locator('.fmt-diff .dl.add')).toHaveText('+新しい');
  });
});

// html-app：JavaScript で動く部品は、隔離した枠（iframe）の中で動く
const APP_SCRIPT = [
  '<div id="out">未実行</div>',
  '<button id="inc">増やす</button><span id="count">0</span>',
  '<pre id="res"></pre>',
  '<script>',
  "document.getElementById('out').textContent = '動いています';",
  'var n = 0;',
  "document.getElementById('inc').addEventListener('click', function () { n++; document.getElementById('count').textContent = String(n); });",
  'var res = [];',
  "try { res.push('parent:' + typeof window.parent.document.title); } catch (e) { res.push('parent:blocked'); }",
  "try { window.top.document.body.setAttribute('data-hacked', '1'); res.push('top:touched'); } catch (e) { res.push('top:blocked'); }",
  "try { res.push('ls:' + typeof localStorage.length); } catch (e) { res.push('ls:blocked'); }",
  "try { res.push('cookie:' + document.cookie.length); } catch (e) { res.push('cookie:blocked'); }",
  "try { window.top.location.href = 'about:blank'; res.push('nav:done'); } catch (e) { res.push('nav:blocked'); }",
  "res.push('origin:' + window.origin);",
  "function render() { document.getElementById('res').textContent = res.join(','); }",
  "fetch('/api/topics').then(function (r) { res.push('fetch:' + r.status); render(); }).catch(function () { res.push('fetch:blocked'); render(); });",
  '</script>',
].join('\n');

const DOC_APP = lines(
  '# 動く部品',
  '',
  `${BT}html-app height=300`,
  APP_SCRIPT,
  BT,
  '',
  '枠の下の段落です。',
  '',
  `${BT}html-app`,
  '<p id="second">二つ目の枠</p>',
  BT,
);

test.describe('html-app（実行できる枠）', () => {
  test('枠の中のスクリプトが動く。iframe は sandbox="allow-scripts" だけ（F28）', async ({ page, app }) => {
    const u = ui(page);
    await app.switchTopic(page, 'app', '動く部品', DOC_APP);
    const iframes = page.locator('iframe');
    await expect(iframes).toHaveCount(2);
    const first = iframes.first();
    await expect(first).toHaveAttribute('sandbox', 'allow-scripts');
    expect(await first.getAttribute('allow')).toBeFalsy();
    await expect(first).toHaveAttribute('height', '300'); // info 文字列の height=300
    await expect(first).toHaveAttribute('src', /\/appframe\/app\/root\/1\/0$/);
    await expect(iframes.nth(1)).toHaveAttribute('src', /\/appframe\/app\/root\/1\/1$/);
    await expect(iframes.nth(1)).toHaveAttribute('sandbox', 'allow-scripts');
    await expect(u.article.locator('.htmlapp').first()).toContainText('実行できる枠 1');
    await expect(u.article.locator('.htmlapp').first()).toContainText('隔離されています');

    const f = page.frameLocator('iframe').first();
    await expect(f.locator('#out')).toHaveText('動いています');
    // 本物のマウスで押す：枠の中のスクリプトが、反応する
    await f.locator('#inc').click();
    await f.locator('#inc').click();
    await expect(f.locator('#count')).toHaveText('2');
    await expect(page.frameLocator('iframe').nth(1).locator('#second')).toHaveText('二つ目の枠');
  });

  test('枠は、親（画面）に触れない・外へ通信できない・別の画面へ移れない（F28・N3）', async ({ page, app }) => {
    await app.switchTopic(page, 'app', '動く部品', DOC_APP);
    const f = page.frameLocator('iframe').first();
    const res = f.locator('#res');
    await expect(res).toContainText('fetch:'); // 最後まで終わるまで待つ
    const text = (await res.textContent()) ?? '';
    for (const expected of [
      'parent:blocked',
      'top:blocked',
      'ls:blocked',
      'cookie:blocked',
      'nav:blocked',
      'origin:null',
      'fetch:blocked',
    ]) {
      expect(text, expected).toContain(expected);
    }
    // 画面の側：書き換えられていない・移っていない
    expect(await page.evaluate(() => document.body.getAttribute('data-hacked'))).toBeNull();
    expect(page.url()).toContain('#/app/root');
    // 合言葉・localStorage は、画面にある（枠からは、触れない）
    expect(await page.evaluate(() => typeof localStorage.getItem)).toBe('function');
  });

  test('「ソースを見る」で、枠の中身を、文字として見られる。「この枠にコメント」でコメントできる（F28）', async ({
    page,
    app,
  }) => {
    const u = ui(page);
    await app.switchTopic(page, 'app', '動く部品', DOC_APP);
    const box = u.article.locator('.htmlapp').first();
    const src = box.locator('details', { has: page.locator('summary', { hasText: 'ソースを見る' }) });
    await expect(src.locator('pre')).toBeHidden();
    await src.locator('summary').click();
    await expect(src.locator('pre')).toContainText("document.getElementById('out')");
    // ソースの文字は、コメントの対象の文字にならない（本文として選べない）が、枠にはコメントできる
    await box.getByRole('button', { name: 'この枠にコメント' }).click();
    await expect(u.composer).toBeVisible();
    await expect(u.composer.locator('.quote')).toContainText('実行できる枠');
  });

  test('AI の返信の html-app は、枠にならない（ふつうのコードブロック）（F28）', async ({ page, app }) => {
    const u = ui(page);
    await app.apply({ threads: [{ page: 'root', body: lines(`${BT}html-app`, '<p>返信の中</p>', BT) }] });
    const msg = u.threads.first().locator('.msg.ai');
    await expect(msg.locator('pre')).toContainText('返信の中');
    await expect(msg.locator('iframe')).toHaveCount(0);
  });
});

// 無害化：AI が書いた資料・返信は、非信頼のデータ。スクリプトは動かない
const DOC_EVIL = lines(
  '# 無害化の確認',
  '',
  '通常の段落です。',
  '',
  '<script>window.__pwn = 1;</script>',
  '',
  '<img src="x" onerror="window.__pwn = 2">',
  '',
  '<p onclick="window.__pwn = 3" style="color:red" id="victim">属性つきの段落</p>',
  '',
  '[危ないリンク](javascript:window.__pwn=4)',
  '',
  '<a href="javascript:window.__pwn=5" id="evil-a">HTML のリンク</a>',
  '',
  '<iframe src="/api/topics" id="evil-frame"></iframe>',
  '',
  '<style>body { display: none }</style>',
  '',
  '<form action="/api/end"><input name="x"><button>送る</button></form>',
  '',
  '![外部の画像](https://example.com/x.png)',
  '',
  '<svg onload="window.__pwn=6"><circle r="5"></circle></svg>',
  '',
  '[外部のリンク](https://example.com/page)',
  '',
  `${BT}mermaid`,
  'flowchart LR',
  '  A["<b>太</b><img src=x onerror=window.__pwn=8>"] --> B[終点]',
  BT,
);

test.describe('無害化', () => {
  test('資料の <script>・onerror・javascript: などが出ない・動かない（N3）', async ({ page, app }) => {
    const u = ui(page);
    await app.switchTopic(page, 'evil', '無害化の確認', DOC_EVIL);
    await expect(u.article.locator('.mermaid-block svg')).toBeVisible();
    await expect(u.article.locator('#victim')).toHaveText('属性つきの段落');

    for (const bad of [
      'script',
      'iframe',
      'form',
      'input',
      'button',
      'img[src*="example.com"]',
      '[onerror]',
      '[onclick]',
      '[onload]',
      'a[href^="javascript" i]',
    ]) {
      await expect(u.article.locator(bad), bad).toHaveCount(0);
    }
    // 資料の <style>（図の中の、描画用の <style> は、除く）
    expect(
      await u.article.evaluate(
        (a) => [...a.querySelectorAll('style')].filter((e) => !e.closest('.mermaid-block')).length,
      ),
    ).toBe(0);
    expect(await u.article.locator('#victim').getAttribute('style')).toBeNull();
    expect(await page.evaluate(() => getComputedStyle(document.body).display)).not.toBe('none');
    // 外部の画像は、表示しない（説明が出る）。通信もしない（フィクスチャが、終わりに数える）
    await expect(u.article).toContainText('外部画像は表示しません');
    // 危ないリンクを押しても、何も起きない
    await u.article.getByText('危ないリンク').click();
    await u.article.getByText('HTML のリンク').click();
    expect(page.url()).toContain('#/evil/root');
    expect(await page.evaluate(() => (window as unknown as { __pwn?: number }).__pwn)).toBeUndefined();
    // 外部のリンクは、新しいタブ・noopener
    const ext = u.article.locator('a', { hasText: '外部のリンク' });
    await expect(ext).toHaveAttribute('target', '_blank');
    expect(await ext.getAttribute('rel')).toContain('noopener');
  });

  test('AI の返信の <script>・onerror も、動かない（N3）', async ({ page, app }) => {
    const u = ui(page);
    await app.apply({
      threads: [
        {
          page: 'root',
          body: '返信です。<script>window.__pwn = 11;</script><img src="x" onerror="window.__pwn = 12">[リンク](javascript:window.__pwn=13)',
        },
      ],
    });
    const msg = u.threads.first().locator('.msg.ai');
    await expect(msg).toContainText('返信です。');
    for (const bad of ['script', '[onerror]', 'a[href^="javascript" i]'])
      await expect(msg.locator(bad), bad).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __pwn?: number }).__pwn)).toBeUndefined();
  });

  test('人間のコメントは、文字として表示する（HTML として解釈しない）（N3）', async ({ page }) => {
    const u = ui(page);
    const text = '<b>強調</b><img src=x onerror="window.__pwn=21">';
    await addTextComment(page, '猫は朝によく鳴きます', text);
    const body = u.threads.first().locator('.msg.user .body');
    await expect(body).toHaveText(text);
    await expect(body.locator('b, img')).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __pwn?: number }).__pwn)).toBeUndefined();
  });
});
