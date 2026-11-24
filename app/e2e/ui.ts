// 画面の操作の補助。本物のマウス（page.mouse）・キーで操作する。
// 旧・新どちらの画面にもあるセレクター（ID・クラス・表示される文言）だけを使い、画面の内部（window の変数・関数）には触れない。
import { expect, type Locator, type Page } from '@playwright/test';

export const ui = (page: Page) => ({
  top: page.locator('#top'),
  side: page.locator('#side'),
  doc: page.locator('#doc'),
  docbar: page.locator('#docbar'),
  docscroll: page.locator('#docscroll'),
  article: page.locator('#article'),
  badges: page.locator('#badges'),
  regbtn: page.locator('#regbtn'),
  regsel: page.locator('#regsel'),
  actbar: page.locator('#actbar'),
  actComment: page.locator('#act-comment'),
  panel: page.locator('#threads'),
  submit: page.locator('#btn-submit'),
  end: page.locator('#btn-end'),
  toast: page.locator('#toast'),
  submitdlg: page.locator('#submitdlg'),
  enddlg: page.locator('#enddlg'),
  ended: page.locator('#ended'),
  lightbox: page.locator('#lightbox'),
  threads: page.locator('#threads .thread:not(.composer)'),
  composer: page.locator('#threads .thread.composer'),
  // 本文の番号の丸（#badges の中）
  bno: page.locator('#badges .bno'),
});

// 本文（#article）の中の文字（単一のテキストノードの中にある）の位置を、画面の座標で返す（先に、見える所へ動かす）
async function textBox(page: Page, needle: string) {
  const box = await page.evaluate((n) => {
    const root = document.querySelector('#article');
    if (!root) return null;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = w.nextNode(); node; node = w.nextNode()) {
      const i = (node.nodeValue ?? '').indexOf(n);
      if (i < 0) continue;
      (node.parentElement as HTMLElement).scrollIntoView({ block: 'center' });
      const r = document.createRange();
      r.setStart(node, i);
      r.setEnd(node, i + n.length);
      const rs = r.getClientRects();
      const first = rs[0] as DOMRect;
      const last = rs[rs.length - 1] as DOMRect;
      return { x1: first.left, y1: first.top + first.height / 2, x2: last.right, y2: last.top + last.height / 2 };
    }
    return null;
  }, needle);
  if (!box) throw new Error('本文に、その文字がありません（またはテキストノードをまたいでいます）');
  return box;
}

// 本物のマウスで、文字をドラッグして選ぶ（始まりは最初の文字の左端、終わりは最後の文字の右端）
export async function dragSelect(page: Page, needle: string) {
  const b = await textBox(page, needle);
  await page.mouse.move(b.x1 + 1, b.y1);
  await page.mouse.down();
  await page.mouse.move((b.x1 + b.x2) / 2, b.y2, { steps: 4 });
  await page.mouse.move(b.x2 - 1, b.y2, { steps: 4 });
  await page.mouse.up();
}

// 文を選んで「コメント」を押し、入力欄を開く
export async function openComposerOnText(page: Page, needle: string) {
  const u = ui(page);
  await dragSelect(page, needle);
  await expect(u.actbar).toBeVisible();
  await u.actComment.click();
  await expect(u.composer).toBeVisible();
}

// 入力欄に書いて「コメントを追加」を押す（入力欄は、開いている）
export async function fillAndAdd(page: Page, text: string) {
  const u = ui(page);
  await u.composer.locator('textarea').fill(text);
  await u.composer.getByRole('button', { name: 'コメントを追加' }).click();
  await expect(u.composer).toHaveCount(0);
}

// 文を選んで、コメントを 1 件、下書きとして追加する
export async function addTextComment(page: Page, needle: string, text: string) {
  await openComposerOnText(page, needle);
  await fillAndAdd(page, text);
  await expect(ui(page).panel).toContainText(text);
}

// 本文のブロック（テキストを含む）の中ほどに、マウスを置く
export async function hoverBlock(page: Page, block: Locator) {
  await block.scrollIntoViewIfNeeded();
  const r = await block.boundingBox();
  if (!r) throw new Error('ブロックが見えません');
  await page.mouse.move(r.x + Math.min(r.width / 2, 120), r.y + r.height / 2, { steps: 3 });
}

// AI に送る：ダイアログを開いて（メモを書いて）送る
export async function submitAll(page: Page, note?: string) {
  const u = ui(page);
  await u.submit.click();
  await expect(u.submitdlg).toBeVisible();
  if (note) await u.submitdlg.locator('textarea').fill(note);
  await u.submitdlg.getByRole('button', { name: 'AI に送る' }).click();
  await expect(u.submitdlg).toBeHidden();
}

// 本文の範囲を、本物のマウスでドラッグして選ぶ（「範囲を選ぶ」ボタンを押したあと）。座標は、画面（viewport）
export async function dragBox(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
}

// 要素の中心
export async function center(loc: Locator) {
  const b = await loc.boundingBox();
  if (!b) throw new Error('要素が見えません');
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, box: b };
}

// 要素の位置・大きさ。範囲の枠・丸は、描き直しの一瞬、なくなる（次のフレームで戻る）ので、見えるまで待つ
export async function box(loc: Locator) {
  let b: { x: number; y: number; width: number; height: number } | null = null;
  await expect
    .poll(async () => {
      b = await loc.boundingBox();
      return b !== null;
    })
    .toBe(true);
  return b as unknown as { x: number; y: number; width: number; height: number };
}

// 範囲を選んだあと、画像の作成・アップロードが終わり、枠・丸の描き直しが落ち着くまで待つ（つかむ前に、枠が作り直されて、つかんだ枠が消えないように）
export async function settled(page: Page) {
  await expect(ui(page).composer).not.toContainText('アップロード中');
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
}

// html-app の「要素を選ぶ」：親が選択モードに入ったあと、枠の中が、それを知る（postMessage は非同期）前に、枠の中の要素を押すと、選択として扱われない（負荷が高いと起きる）。
// 入力欄（`done`）が出るまで、押し直す（選択モードでない間の押下は、枠の中のページの click になるだけで、害はない）。
export async function clickUntilPicked(target: Locator, done: Locator): Promise<void> {
  await expect(async () => {
    await target.click({ timeout: 3000 });
    await expect(done).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20_000 });
}

// 枠の中のボタンを押して、枠の中の数（`counter`）が `count` になるまで待つ。負荷が高いと、押しても、枠の中のハンドラーが付く前（または、枠が作り直される前）で、数が増えない：
// 数が `count - 1` のときだけ、押し直す（押し過ぎで、`count` を超えない）。
export async function clickToCount(button: Locator, counter: Locator, count: number): Promise<void> {
  await expect(async () => {
    if ((await counter.textContent({ timeout: 2000 })) === String(count - 1)) await button.click({ timeout: 2000 });
    await expect(counter).toHaveText(String(count), { timeout: 2000 });
  }).toPass({ timeout: 20_000 });
}
