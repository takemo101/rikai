// @vitest-environment jsdom
// 版を並べて比べる画面の島（F44）：ブロックごとの行（追加・変更・削除・同じ・空白）・札の文字・読み取り専用（入口を出さない）・枠（html-app）の登録と解放・左右の独立。
import { act } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { registeredFrames, releaseApps } from '../../../src/web/doc/frameRegistry';
import { initialFrameState } from '../../../src/web/doc/frameState';
import { type CompareInput, renderCompare } from '../../../src/web/doc/render/compare';
import { buildView } from '../../../src/web/lib/view';
import { meta, topicState } from '../helpers';

afterEach(() => {
  releaseApps(document);
  document.body.replaceChildren();
});

const view = (() => {
  const v = buildView(
    { slug: 'demo', page: 'root', version: 3 },
    topicState({ meta: meta({ pages: { root: { title: 'T', parent: null, versions: 3, createdAt: '' } } }) }),
  );
  if (!v) throw new Error('view');
  return v;
})();

const V1 = '# 題\n\n猫は一日に三回、ごはんを食べます。\n\n- 朝\n- 夜\n\n睡眠の段落です。\n';
const V2 = '# 題\n\n猫は一日に四回、ごはんを食べます。\n\n- 朝\n- 夜\n\nまったく別の、ここで足した内容です。\n';

async function draw(left: string | null, right: string | null, over: Partial<CompareInput> = {}) {
  const el = document.createElement('div');
  document.body.append(el);
  let result: Awaited<ReturnType<typeof renderCompare>> = null;
  await act(async () => {
    result = await renderCompare(
      el,
      {
        view,
        left: { version: 1, md: left },
        right: { version: 2, md: right },
        changesOnly: false,
        frames: { width: 'auto', mode: null },
        onEsc: () => undefined,
        ...over,
      },
      () => true,
    );
  });
  return { el, result: result as Awaited<ReturnType<typeof renderCompare>> };
}
const rows = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>('.cmprow')];
const cells = (row: HTMLElement) => [...row.children] as HTMLElement[];
const text = (e: Element | null | undefined) => e?.textContent ?? '';

test('行：同じ・変更（前・後）・追加・削除が、右の順に並ぶ。札の文字（色だけに頼らない）・空きは空白（読み上げから外す）', async () => {
  const { el, result } = await draw(V1, V2);
  const r = rows(el);
  expect(r.map((x) => x.dataset.status)).toEqual(['same', 'changed', 'same', 'same', 'removed', 'added']);
  // 変更：左＝変更前・右＝変更後。右の下に、文字の差分（折りたたみ）
  const changed = cells(r[1] as HTMLElement);
  expect(text(changed[0]?.querySelector('.cmpbadge'))).toBe('変更前');
  expect(text(changed[1]?.querySelector('.cmpbadge'))).toBe('変更後');
  expect(text(changed[0])).toContain('三回');
  expect(text(changed[1])).toContain('四回');
  expect(changed[1]?.querySelector('details.diffbox summary')?.textContent).toContain('文字の差分');
  // 同じ：札なし
  expect(r[0]?.querySelectorAll('.cmpbadge')).toHaveLength(0);
  // 削除：左に札・右は空白。追加：右に札・左は空白
  const removed = cells(r[4] as HTMLElement);
  expect(text(removed[0]?.querySelector('.cmpbadge'))).toBe('削除');
  expect(text(removed[0])).toContain('睡眠の段落');
  expect(removed[1]?.classList.contains('cmpgap')).toBe(true);
  expect(removed[1]?.getAttribute('aria-hidden')).toBe('true');
  const added = cells(r[5] as HTMLElement);
  expect(text(added[1]?.querySelector('.cmpbadge'))).toBe('追加');
  expect(added[0]?.classList.contains('cmpgap')).toBe(true);
  expect(result?.summary).toEqual({ same: 3, changed: 1, added: 1, removed: 1 });
});

test('文字の差分は、開いたときに、はじめて作る（削除・追加の文字）', async () => {
  const { el } = await draw(V1, V2);
  const d = el.querySelector<HTMLDetailsElement>('.cmpr details.diffbox');
  expect(d?.querySelector('.diff')?.childNodes).toHaveLength(0);
  act(() => {
    if (d) d.open = true;
    d?.dispatchEvent(new Event('toggle'));
  });
  expect(d?.querySelector('del')?.textContent).toBe('三');
  expect(d?.querySelector('ins')?.textContent).toBe('四');
});

test('並びの項目（li）は、1 項目ずつ、並びの外枠に入れる。番号つきの並びは、番号を保つ', async () => {
  const a = '1. 一つ目\n2. 二つ目\n3. 三つ目\n';
  const b = '1. 一つ目\n2. 二つ目を直した\n3. 三つ目\n';
  const { el } = await draw(a, b);
  const r = rows(el);
  expect(r).toHaveLength(3);
  const lists = r.map((x) => cells(x)[1]?.querySelector('ol') as HTMLOListElement);
  expect(lists.map((l) => l.start)).toEqual([1, 2, 3]);
  expect(lists.every((l) => l.children.length === 1)).toBe(true);
  expect(r.map((x) => x.dataset.status)).toEqual(['same', 'changed', 'same']);
});

test('読み取り専用：コメントの入口に使う印・枠のツールバー・「この枠にコメント」・拡大表示・要素選択が、ない', async () => {
  const md = '# 題\n\n段落です。\n\n```html-app height=160\n<button>押す</button>\n```\n\n![図](assets/a.png)\n';
  const { el } = await draw(md, md);
  expect(el.querySelectorAll('.apptools, [data-pick], [data-focus-open], button.link')).toHaveLength(0);
  expect(el.querySelectorAll('[data-focus-entry], #article, .blk-thread, mark.hl')).toHaveLength(0);
  // 枠は、本文と同じ隔離（sandbox は allow-scripts だけ）。左右で、版が違う
  const frames = [...el.querySelectorAll('iframe')];
  expect(frames).toHaveLength(2);
  expect(frames.map((f) => f.getAttribute('sandbox'))).toEqual(['allow-scripts', 'allow-scripts']);
  expect(frames.map((f) => f.getAttribute('src'))).toEqual([
    '/appframe/demo/root/1/0?mode=light',
    '/appframe/demo/root/2/0?mode=light',
  ]);
  expect(frames.map((f) => f.title)).toEqual(['左の実行できる枠 1', '右の実行できる枠 1']);
  expect(registeredFrames()).toBe(2);
});

test('枠：描き直す・解くと、橋から外れる（登録が増えない）。幅・外観は、最初の状態に反映される', async () => {
  const md = '```html-app height=160\n<p>a</p>\n```\n';
  const el = document.createElement('div');
  document.body.append(el);
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await renderCompare(
        el,
        {
          view,
          left: { version: 1, md },
          right: { version: 2, md },
          changesOnly: false,
          frames: { width: 375, mode: 'dark' },
          onEsc: () => undefined,
        },
        () => true,
      );
    });
    expect(registeredFrames()).toBe(2);
    expect(el.querySelectorAll('iframe')).toHaveLength(2);
  }
  const f = el.querySelector('iframe') as HTMLIFrameElement;
  expect(f.style.width).toBe('375px');
  expect(f.dataset.mode).toBe('dark');
  releaseApps(el);
  expect(registeredFrames()).toBe(0);
});

test('「変更のある所だけ」：続く「同じ」を、折りたたみにまとめる（件数つき）。変更・追加・削除は、そのまま', async () => {
  const { el } = await draw(V1, V2, { changesOnly: true });
  const groups = [...el.querySelectorAll('details.cmpgroup')];
  expect(groups.map((g) => g.querySelector(':scope > summary')?.textContent)).toEqual([
    '変更のないブロック 1 件（押すと開きます）',
    '変更のないブロック 2 件（押すと開きます）',
  ]);
  expect(groups.every((g) => !(g as HTMLDetailsElement).open)).toBe(true);
  const direct = [...el.children]
    .filter((c) => c.classList.contains('cmprow'))
    .map((c) => (c as HTMLElement).dataset.status);
  expect(direct).toEqual(['changed', 'removed', 'added']);
});

test('片方の版が取れない：ある側だけの行（反対側は空白）。サマリーは、比べた結果ではないので、すべて 0', async () => {
  const { el, result } = await draw(null, V2);
  expect(rows(el).every((r) => r.dataset.status === 'solo')).toBe(true);
  expect(rows(el).every((r) => cells(r)[0]?.classList.contains('cmpgap'))).toBe(true);
  expect(result?.summary).toEqual({ same: 0, changed: 0, added: 0, removed: 0 });
  const none = await draw(null, null);
  expect(rows(none.el)).toHaveLength(0);
});

test('同じ版どうしでも、描ける（差分なし）。AI の資料の HTML は、無害化されている（script・on*）', async () => {
  const md = '段落<script>window.__x=1</script><img src=x onerror="window.__x=1">\n';
  const { el, result } = await draw(md, md);
  expect(result?.summary).toEqual({ same: 1, changed: 0, added: 0, removed: 0 });
  expect(el.querySelector('script')).toBeNull();
  expect(el.querySelector('[onerror]')).toBeNull();
});

test('古い描画は捨てる：isCurrent が false なら null（枠は、次の描画が外す）', async () => {
  const el = document.createElement('div');
  document.body.append(el);
  let out: unknown = 'x';
  await act(async () => {
    out = await renderCompare(
      el,
      {
        view,
        left: { version: 1, md: V1 },
        right: { version: 2, md: V2 },
        changesOnly: false,
        frames: { width: 'auto', mode: null },
        onEsc: () => undefined,
      },
      () => false,
    );
  });
  expect(out).toBeNull();
});

test('枠から届く知らせ：Esc は、画面を閉じる知らせとして届く（形が正しいときだけ）。偽の pick・state は、何も起こさない。別の窓からの知らせは、受けない', async () => {
  const md = '```html-app height=160\n<p>a</p>\n```\n';
  const onEsc = vi.fn();
  const el = document.createElement('div');
  document.body.append(el);
  await act(async () => {
    await renderCompare(
      el,
      {
        view,
        left: { version: 1, md },
        right: { version: 2, md },
        changesOnly: false,
        frames: { width: 'auto', mode: null },
        onEsc,
      },
      () => true,
    );
  });
  const [l, r] = [...el.querySelectorAll('iframe')] as HTMLIFrameElement[];
  const post = (from: Window | null | undefined, data: unknown) =>
    window.dispatchEvent(new MessageEvent('message', { data, source: from ?? null }));
  post(l?.contentWindow, { __rikai: 1, type: 'esc', extra: 1 }); // 余分なキー：捨てる
  post(l?.contentWindow, { __rikai: 1, type: 'esc' });
  post(r?.contentWindow, { __rikai: 1, type: 'esc' });
  post(window, { __rikai: 1, type: 'esc' }); // 枠でない窓
  expect(onEsc).toHaveBeenCalledTimes(2);
  // 選択モードでない枠の pick・state・snapshot は、受けても、何も起こらない（例外も、出ない）
  const pick = {
    __rikai: 1,
    type: 'pick',
    selector: 'p',
    tag: 'p',
    text: 'a',
    rect: { x: 1, y: 2, w: 3, h: 4 },
    styles: {},
    frame: { w: 10, h: 10 },
  };
  post(l?.contentWindow, pick);
  post(l?.contentWindow, { __rikai: 1, type: 'state', json: '{"a":1}' });
  post(r?.contentWindow, { __rikai: 1, type: 'snapshot', id: 'a'.repeat(12), png: null });
  expect(onEsc).toHaveBeenCalledTimes(2);
});

test('比べる画面の枠の幅・外観は、本文の枠の「同じ版の中で覚える状態」に、混ざらない（同じ番号の枠でも）', async () => {
  initialFrameState('demo/root/2', 0, 'light', true); // 本文の枠の覚え（版の印）
  const { result } = await draw('```html-app height=160\n<p>a</p>\n```\n', '```html-app height=160\n<p>b</p>\n```\n');
  const [l, r] = result?.frames ?? [];
  l?.setWidth(375);
  r?.setMode('dark');
  expect(initialFrameState('demo/root/2', 0, 'light', true)).toMatchObject({
    width: 'auto',
    mode: 'light',
    forced: false,
  });
});

test('種類だけが変わったブロック（段落 → 見出し・箇条書き → 番号つき）は、「変更前」「変更後」の行になり、種類の変化を書く', async () => {
  const { el, result } = await draw('概要です。\n\n- 項目 A\n- 項目 B\n', '## 概要です。\n\n1. 項目 A\n2. 項目 B\n');
  expect(rows(el).map((r) => r.dataset.status)).toEqual(['changed', 'changed', 'changed']);
  expect(result?.summary).toEqual({ same: 0, changed: 3, added: 0, removed: 0 });
  const note = (i: number) => {
    const d = el.querySelectorAll<HTMLDetailsElement>('.cmpr details.diffbox')[i];
    if (d) d.open = true;
    d?.dispatchEvent(new Event('toggle'));
    return d?.querySelector('.diffnote')?.textContent;
  };
  expect(note(0)).toBe('ブロックの種類が変わりました：p → h2');
  expect(note(1)).toBe('ブロックの種類が変わりました：箇条書き → 番号つきの並び');
});

test('変更が多すぎる（近さを調べる組の予算を超える）：limited の印を返す。少なければ false', async () => {
  const many = (tag: string) => Array.from({ length: 150 }, (_, i) => `${tag} の ${i} 番目の段落です。`).join('\n\n');
  const big = await draw(many('前'), many('後'));
  expect(big.result?.limited).toBe(true);
  expect(big.result?.summary.changed).toBe(0); // 追加と削除として並ぶ
  expect(big.result?.summary.added).toBe(150);
  expect((await draw(V1, V2)).result?.limited).toBe(false);
});

test('文字の差分は、文字として描く：HTML を含む文（img・script・&lt;）でも、タグにならない（textContent にそのまま入る）', async () => {
  const evil = '`<img src=x onerror=window.__xss=1>` と `<script>window.__xss=1</script>` と &lt;b&gt;';
  const { el } = await draw(`前の文：${evil}\n`, `後の文：${evil}\n`);
  const d = el.querySelector<HTMLDetailsElement>('.cmpr details.diffbox');
  act(() => {
    if (d) d.open = true;
    d?.dispatchEvent(new Event('toggle'));
  });
  const diff = d?.querySelector('.diff') as HTMLElement;
  expect(diff.textContent).toContain('<img src=x onerror=window.__xss=1>');
  expect(diff.textContent).toContain('<script>window.__xss=1</script>');
  expect(diff.textContent).toContain('<b>'); // 資料の `&lt;b&gt;` は、文字の <b>。タグにしない
  expect(diff.querySelectorAll('img, script, b, [onerror]')).toHaveLength(0);
  expect(diff.querySelector('del')?.textContent).toBe('前');
  expect(diff.querySelector('ins')?.textContent).toBe('後');
  expect((window as unknown as { __xss?: number }).__xss).toBeUndefined();
});
