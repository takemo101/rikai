// @vitest-environment jsdom
// アラート（`> [!NOTE]`）とタスクリスト（`- [ ]`）：記法の判定・ブロックとしての扱い（コメントの位置づけを変えない）・版の差分・安全（N3）。
import { expect, test } from 'vitest';
import { findQuote } from '../../../src/shared/anchor';
import {
  blockAnchor,
  blockEls,
  blockText,
  markBlocks,
  plainText,
  sigTag,
  tagLabel,
  textIndex,
} from '../../../src/web/doc/render/blocks';
import { addDiff } from '../../../src/web/doc/render/diff';
import { applyHighlights } from '../../../src/web/doc/render/highlights';
import { mdToFragment, PURIFY } from '../../../src/web/doc/render/markdown';
import { thread } from '../helpers';

function dom(md: string, kind: 'doc' | 'reply' = 'doc'): HTMLElement {
  const div = document.createElement('div');
  const frag = mdToFragment(md, { slug: 'demo', kind });
  if (kind === 'doc') markBlocks(frag);
  div.append(frag);
  return div;
}
const alertOf = (md: string): string | null => dom(md).querySelector('blockquote')?.getAttribute('data-alert') ?? null;

// ---------------------------------------------------------------- アラートの判定
test.each([
  ['NOTE', 'note', 'メモ'],
  ['TIP', 'tip', 'ヒント'],
  ['IMPORTANT', 'important', '重要'],
  ['WARNING', 'warning', '警告'],
  ['CAUTION', 'caution', '注意'],
])('アラート：[!%s] は %s（題は %s）。マーカーの行は DOM から外れ、本文だけが残る', (name, type, title) => {
  const out = dom(`> [!${name}]\n> 本文の一行目\n> 二行目`);
  const bq = out.querySelector('blockquote') as HTMLElement;
  expect(bq.dataset.alert).toBe(type);
  expect(bq.getAttribute('role')).toBe('note');
  expect(bq.getAttribute('aria-label')).toBe(title);
  expect(bq.textContent).not.toContain('[!');
  expect(blockText(bq)).toBe('本文の一行目 二行目');
  expect(bq.dataset.bid).toBe('b0'); // 1 つのブロック
  expect(blockEls(out)).toHaveLength(1);
});

test('アラート：大文字・小文字は問わない。マーカーの行末の空白・`<br>`（行末の空白 2 つ）・空行を挟んだ本文も、認識する', () => {
  expect(alertOf('> [!note]\n> 本文')).toBe('note');
  expect(alertOf('> [!Warning]\n> 本文')).toBe('warning');
  expect(alertOf('> [!TIP]   \n> 本文')).toBe('tip');
  const br = dom('> [!NOTE]  \n> 本文');
  expect(br.querySelector('blockquote')?.getAttribute('data-alert')).toBe('note');
  expect(br.querySelector('br')).toBeNull();
  expect(blockText(br.querySelector('blockquote') as HTMLElement)).toBe('本文');
  const blank = dom('> [!CAUTION]\n>\n> 段落 1\n>\n> 段落 2');
  expect(blank.querySelectorAll('blockquote > p')).toHaveLength(2);
  expect(blank.querySelector('blockquote')?.getAttribute('data-alert')).toBe('caution');
  expect(dom('> [!NOTE]').querySelector('blockquote')?.getAttribute('data-alert')).toBe('note'); // 本文なしでも、枠は出る
});

test('アラートの中に、段落・リスト・コード・表・リンク・インラインの記法を書ける', () => {
  const md = [
    '> [!WARNING]',
    '> **太字**と`code`と[リンク](https://example.com/)と[内部](page:next)',
    '>',
    '> - 項目 1',
    '> - 項目 2',
    '>',
    '> ```js',
    '> const a = 1;',
    '> ```',
    '>',
    '> | a | b |',
    '> |---|---|',
    '> | 1 | 2 |',
  ].join('\n');
  const bq = dom(md).querySelector('blockquote') as HTMLElement;
  expect(bq.dataset.alert).toBe('warning');
  expect(bq.querySelector('strong')?.textContent).toBe('太字');
  expect(bq.querySelector('a[target="_blank"]')?.getAttribute('href')).toBe('https://example.com/');
  expect(bq.querySelector('a.pagelink')?.getAttribute('href')).toBe('#/demo/next');
  expect(bq.querySelectorAll('ul > li')).toHaveLength(2);
  expect(bq.querySelector('pre code')?.textContent).toContain('const a = 1;');
  expect(bq.querySelector('table td')?.textContent).toBe('1');
});

test('認識しないもの：同じ行に文字がある・ほかの種類・先頭の行でない・リストの中・引用の中の引用は、ふつうの引用のまま', () => {
  expect(alertOf('> [!NOTE] 同じ行の本文')).toBeNull();
  expect(alertOf('> [!NOTE] *強調*')).toBeNull();
  expect(alertOf('> [!INFO]\n> 本文')).toBeNull();
  expect(alertOf('> [! NOTE]\n> 本文')).toBeNull();
  expect(alertOf('> [!NOTES]\n> 本文')).toBeNull();
  expect(alertOf('> 前置き\n> [!NOTE]\n> 本文')).toBeNull();
  expect(alertOf('> 前置き [!NOTE]\n> 本文')).toBeNull();
  expect(alertOf('[!NOTE]\n本文')).toBeNull(); // 引用でない
  expect(alertOf('- 項目\n\n  > [!NOTE]\n  > 本文')).toBeNull(); // 要素の中（GitHub：入れ子にできない）
  const nested = dom('> [!NOTE]\n> 外\n>\n> > [!TIP]\n> > 内');
  expect(nested.querySelector('blockquote')?.getAttribute('data-alert')).toBe('note');
  expect(nested.querySelector('blockquote blockquote')?.hasAttribute('data-alert')).toBe(false); // 内側は、ふつうの引用
  expect(nested.querySelector('blockquote blockquote')?.textContent).toContain('[!TIP]'); // 文字も、そのまま
  // 認識しない引用は、文字も、そのまま（マーカーも本文の文字）
  expect(blockText(dom('> [!NOTE] 同じ行の本文').querySelector('blockquote') as HTMLElement)).toBe(
    '[!NOTE] 同じ行の本文',
  );
});

test('資料の生の HTML の `data-alert` は、偽の印になれない（消す）。引用でも同じ', () => {
  const out = dom('<blockquote data-alert="caution"><p>偽</p></blockquote>\n\n<div data-alert="note">x</div>');
  expect(out.querySelector('[data-alert]')).toBeNull();
});

test('返信（kind: reply）でも、アラート・タスクを描く（ブロックの番号は付けない）', () => {
  const out = dom('> [!TIP]\n> 返信\n\n- [x] 済み', 'reply');
  expect(out.querySelector('blockquote[data-alert="tip"]')).not.toBeNull();
  expect(out.querySelector('li.task-done .task-box[aria-checked="true"]')).not.toBeNull();
  expect(out.querySelector('[data-bid]')).toBeNull();
});

// ---------------------------------------------------------------- 既存のコメントの位置づけ（ハッシュ）
// 値は、この変更の前の実装で測った（ブロックの文字の、ハッシュ）。変わると、以前の版で保存したコメントが、別のブロックを指す
test('ふつうの引用・リスト・番号つきの並び・タスクの項目のハッシュ・ブロックの文字は、変わらない（変更前の実装の値）', () => {
  const hashes = (md: string): string[][] => blockEls(dom(md)).map((e) => [e.dataset.bhash ?? '', blockText(e)]);
  expect(hashes('> 引用の文\n> 続き')).toEqual([['89povy', '引用の文 続き']]);
  expect(hashes('- a\n- b\n  - c')).toEqual([
    ['3t3a', 'a'],
    ['3771vu', 'b c'],
  ]);
  expect(hashes('1. x\n2. y')).toEqual([
    ['3t3x', 'x'],
    ['3t3y', 'y'],
  ]);
  // タスクの項目：これまでも、チェックは落ちて、文字だけだった（`- [ ] a` と `- a` は、同じハッシュ）
  expect(hashes('- [ ] a\n- [x] b\n- [X] c\n  - [ ] nested')).toEqual([
    ['3t3a', 'a'],
    ['3t3b', 'b'],
    ['zms97v', 'c nested'],
  ]);
  expect(hashes('- [ ] a\n\n  para\n\n- [x] b')).toEqual([
    ['1tnsqh6', 'a para'],
    ['3t3b', 'b'],
  ]);
  expect(hashes('1. [ ] one\n2. [x] two')).toEqual([
    ['377esn', 'one'],
    ['377j8f', 'two'],
  ]);
  // マーカーのない引用・同じ行に文字がある引用は、変わらない（`[!NOTE]` も、文字のまま）
  expect(hashes('> [!NOTE] 同じ行')).toEqual([['boesf8', '[!NOTE] 同じ行']]);
});

test('アラートに変わる引用（これまでは `[!NOTE]` を含む引用）のハッシュは、マーカーを外した文字のものになる（変更前は 133qr4o）', () => {
  const [e] = blockEls(dom('> [!NOTE]\n> メモの本文'));
  expect(e?.dataset.bhash).toBe('167v8sp');
  expect(e?.dataset.bhash).not.toBe('133qr4o');
});

// ---------------------------------------------------------------- ブロックとしての扱い
function article(md: string): HTMLElement {
  const art = document.createElement('article');
  const frag = mdToFragment(md, { slug: 'demo', kind: 'doc' });
  markBlocks(frag);
  art.append(frag);
  document.body.replaceChildren(art);
  return art;
}

test('アラートの中の文を選んで付けたコメント（文）は、本文の文字から探せて、強調される。題・マーカーは、文字に入らない', () => {
  const art = article('# 題\n\n> [!IMPORTANT]\n> ここを選んで、コメントする。\n\n後ろの段落。');
  const idx = textIndex(art).text;
  expect(idx).toContain('ここを選んで、コメントする。');
  expect(idx).not.toContain('IMPORTANT');
  expect(idx).not.toContain('重要');
  expect(findQuote(idx, { quote: 'ここを選んで' })).not.toBeNull();
  const t = thread({
    id: 't1',
    anchor: {
      blockId: 'b1',
      blockHash: 'x',
      blockTag: 'BLOCKQUOTE',
      blockText: '',
      quote: 'ここを選んで',
      prefix: '',
      suffix: '',
      label: '',
    },
  });
  const r = applyHighlights(art, [t], 1);
  expect(art.querySelector('blockquote[data-alert] mark.hl[data-tid="t1"]')?.textContent).toBe('ここを選んで');
  expect(r.locs.get('t1')?.kind).toBe('text');
});

test('アラートへのブロックのコメント：アンカーは、本文の文字（題なし）・ラベルに種類。同じ内容のブロックを、確実に見つける', () => {
  const art = article('# 題\n\n> [!WARNING]\n> 消すと戻せません。\n\n段落。');
  const bq = art.querySelector('blockquote') as HTMLElement;
  const a = blockAnchor(bq);
  expect(a.blockTag).toBe('BLOCKQUOTE');
  expect(a.blockText).toBe('消すと戻せません。');
  expect(a.label).toBe('警告: 消すと戻せません。');
  const r = applyHighlights(art, [thread({ id: 't2', anchor: a })], 1);
  expect(r.locs.get('t2')).toMatchObject({ kind: 'block' });
  expect(r.approx.has('t2')).toBe(false); // 推定ではない（同じハッシュ）
  expect(bq.classList.contains('blk-thread')).toBe(true);
});

test('以前の版で保存した、`[!NOTE]` を含む引用へのブロックのコメント：ハッシュが変わっても、近い内容・同じ位置で見つかる（推定）', () => {
  const art = article('# 題\n\n> [!NOTE]\n> 以前は、ふつうの引用だった、少し長めの本文です。\n\n段落。');
  const old = {
    blockId: 'b1',
    blockHash: '000000',
    blockTag: 'BLOCKQUOTE',
    blockText: '[!NOTE] 以前は、ふつうの引用だった、少し長めの本文です。',
    quote: '',
    prefix: '',
    suffix: '',
    label: '',
  };
  const r = applyHighlights(art, [thread({ id: 't3', anchor: old })], 1);
  expect(r.locs.get('t3')).toMatchObject({ kind: 'block' });
  expect(r.approx.get('t3')).toBe('similar');
});

test('タスクの項目：ブロックは、ふつうのリストと同じ（li ごと）。チェック欄は、文字に入らない。入れ子の項目は、親の項目の中', () => {
  const art = article('- [ ] 一つ目\n- [x] 二つ目\n  - [ ] 入れ子');
  const lis = blockEls(art);
  expect(lis.map((e) => e.tagName)).toEqual(['LI', 'LI']);
  expect(lis.map((e) => blockText(e))).toEqual(['一つ目', '二つ目 入れ子']);
  expect(lis.map((e) => plainText(e))).toEqual(['一つ目', '二つ目 入れ子']);
  expect(textIndex(art).text.replace(/\s+/g, ' ').trim()).toBe('一つ目 二つ目 入れ子');
  const a = blockAnchor(lis[0] as HTMLElement);
  expect(a.blockText).toBe('一つ目');
  expect(a.label).toBe('一つ目');
});

// ---------------------------------------------------------------- タスクリストの形
test('タスクリスト：`[ ]`・`[x]`・`[X]`。番号つき・入れ子・段落が続く項目。チェック欄は、押せない印（input でない）', () => {
  const out = dom(
    '- [ ] 未\n- [x] 済\n- [X] 大文字\n\n1. [ ] 番号\n2. [x] 番号済\n\n- [ ] 親\n  - [x] 子\n\n区切り\n\n- [ ] 段落\n\n  続き',
  );
  const boxes = [...out.querySelectorAll<HTMLElement>('.task-box')];
  expect(boxes.map((b) => b.getAttribute('aria-checked'))).toEqual([
    'false',
    'true',
    'true',
    'false',
    'true',
    'false',
    'true',
    'false',
  ]);
  for (const b of boxes) {
    expect(b.getAttribute('role')).toBe('checkbox');
    expect(b.getAttribute('aria-disabled')).toBe('true');
    expect(b.getAttribute('aria-label')).toMatch(/^(完了|未完了)$/);
    expect(b.tagName).toBe('SPAN');
  }
  expect(out.querySelector('input')).toBeNull();
  expect(out.querySelectorAll('ol > li.task-item')).toHaveLength(2);
  expect(out.querySelectorAll('li.task-item li.task-item')).toHaveLength(1); // 入れ子
  expect(out.querySelectorAll('li.task-item > p > .task-box')).toHaveLength(1); // 段落が続く項目
  expect(out.querySelectorAll('li.task-done')).toHaveLength(4);
});

test('タスクではないもの：`[ ]` の後ろに空白がない・文の途中・コード・番号のない括弧は、ふつうの文字', () => {
  const out = dom('- [ ]なし\n- 文の `[x]` 途中\n- [] 空\n- 普通 [x] の途中');
  expect(out.querySelector('.task-box, .task-item')).toBeNull();
  expect(out.textContent).toContain('[ ]なし');
});

test('タスクの印は、項目の先頭のものだけ。資料の生の HTML の偽の印（項目の外・途中）は、消える', () => {
  const out = dom(
    '<span class="task-box" role="checkbox" aria-checked="true"></span>\n\n- 途中に <span class="task-box"></span> 偽',
  );
  expect(out.querySelector('.task-box')).toBeNull();
});

// ---------------------------------------------------------------- 版の差分
function diffOf(prev: string, cur: string, key: string) {
  const frag = mdToFragment(cur, { slug: 'demo', kind: 'doc' });
  markBlocks(frag);
  const sum = addDiff(frag, { key, slug: 'demo', md: cur, prevMd: prev });
  const box = document.createElement('div');
  box.append(frag);
  return { sum, box };
}

test('差分：チェックが変わった項目は、文字が同じでも「変更」（入れ子のチェックも）。同じなら、変更なし', () => {
  const a = diffOf('- [ ] 手順 1\n- [ ] 手順 2\n', '- [x] 手順 1\n- [ ] 手順 2\n', 'demo/ck/2');
  expect(a.sum).toEqual({ changed: 1, added: 0, removed: 0 });
  expect(a.box.querySelector('.diffnote')?.textContent).toBe(
    'ブロックの種類が変わりました：箇条書き・チェック ☐ → 箇条書き・チェック ☑',
  );
  const nested = diffOf('- [ ] 親\n  - [ ] 子\n', '- [ ] 親\n  - [x] 子\n', 'demo/ck/3');
  expect(nested.sum.changed).toBe(1);
  expect(nested.box.querySelector('.diffnote')?.textContent).toContain('☐☐ → 箇条書き・チェック ☐☑');
  const same = diffOf('- [x] a\n- [ ] b\n', '- [x] a\n- [ ] b\n', 'demo/ck/4');
  expect(same.sum).toEqual({ changed: 0, added: 0, removed: 0 });
  // チェックなし → チェックあり（記法を足した）も、変更
  expect(diffOf('- 項目\n', '- [ ] 項目\n', 'demo/ck/5').sum.changed).toBe(1);
});

test('差分：アラートの種類の変更・引用 → アラートも「変更」。本文だけの変更は、文字の差分', () => {
  const kind = diffOf('> [!NOTE]\n> 同じ本文\n', '> [!WARNING]\n> 同じ本文\n', 'demo/al/2');
  expect(kind.sum).toEqual({ changed: 1, added: 0, removed: 0 });
  expect(kind.box.querySelector('.diffnote')?.textContent).toBe(
    'ブロックの種類が変わりました：注意書き（メモ） → 注意書き（警告）',
  );
  const q = diffOf('> 同じ本文\n', '> [!TIP]\n> 同じ本文\n', 'demo/al/3');
  expect(q.sum.changed).toBe(1);
  expect(q.box.querySelector('.diffnote')?.textContent).toBe(
    'ブロックの種類が変わりました：blockquote → 注意書き（ヒント）',
  );
  const text = diffOf(
    '> [!NOTE]\n> 本文を、直す前。内容は十分に長い。\n',
    '> [!NOTE]\n> 本文を、直した後。内容は十分に長い。\n',
    'demo/al/4',
  );
  expect(text.sum.changed).toBe(1);
  expect(text.box.querySelector('.diffnote')).toBeNull();
  expect(text.box.querySelector('ins')?.textContent).toBe('した後');
});

test('sigTag・tagLabel：ふつうの引用・リストの印は、これまでと同じ', () => {
  const [q] = blockEls(dom('> 引用'));
  const [li] = blockEls(dom('- a'));
  const [ol] = blockEls(dom('1. a'));
  expect([q, li, ol].map((e) => sigTag(e as HTMLElement))).toEqual(['BLOCKQUOTE', 'LI>UL', 'LI>OL']);
  expect(['BLOCKQUOTE', 'LI>UL', 'LI>OL'].map(tagLabel)).toEqual(['blockquote', '箇条書き', '番号つきの並び']);
});

// ---------------------------------------------------------------- 安全（N3）
test('PURIFY は、`input` を落としたまま（チェックの印は、input を使わない）', () => {
  expect(PURIFY.FORBID_TAGS).toContain('input');
  expect(PURIFY.FORBID_TAGS).toContain('form');
});

test('資料の生の `<input>`（チェックボックス・name・form つき）は、これまでどおり落ちる。タスクの印にもならない', () => {
  const out = dom(
    [
      '<input type="checkbox" checked disabled name="a" form="f"> 生',
      '',
      '<form id="f" action="https://evil.example/"><input type="checkbox" name="x"><input type="hidden" name="y" value="z"></form>',
      '',
      '- <input type="checkbox" checked disabled> 項目に入れた',
    ].join('\n'),
  );
  expect(out.querySelector('input, form, button')).toBeNull();
  expect(out.querySelector('.task-box, .task-item')).toBeNull();
  expect(out.textContent).toContain('生');
});

test('悪意のある入力：アラート・タスクの中の script・onerror・javascript: は、動かない・残らない', () => {
  (window as unknown as { pwned?: number }).pwned = undefined;
  const out = dom(
    [
      '> [!NOTE]',
      '> <script>window.pwned=1</script>',
      '> <img src="assets/a.png" onerror="window.pwned=2">',
      '> [悪意](javascript:window.pwned=3)',
      '> <a href="javascript:window.pwned=4" onclick="window.pwned=5">x</a>',
      '',
      '- [ ] <script>window.pwned=6</script><img src=x onerror="window.pwned=7">[悪意](javascript:window.pwned=8)',
      '',
      '> [!TIP]<img src=x onerror="window.pwned=9">',
      '> 本文',
    ].join('\n'),
  );
  expect(out.querySelector('script')).toBeNull();
  for (const el of out.querySelectorAll('*')) {
    for (const a of el.getAttributeNames()) expect(a, `${el.tagName}[${a}]`).not.toMatch(/^on/);
    expect(el.getAttribute('href') ?? '').not.toMatch(/javascript:/i);
  }
  expect(out.querySelector('blockquote')?.getAttribute('data-alert')).toBe('note');
  expect((window as unknown as { pwned?: number }).pwned).toBeUndefined();
});
