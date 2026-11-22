// 資料の形式（```diff・```json・```terminal・```trace）：色分け・木・タイムラインの作り方と、安全（資料の文字が、タグ・属性にならない）、
// 書かれたとおりに見せること（JSON の数・キー）。旧 test/fmt.test.js の 8 件を、名前・期待値を変えずに移した。
// 資料は、AI が書いた非信頼のデータ。ここで、escape を取りこぼすと、画面に、タグ・イベントの属性が出る（画面の DOMPurify の手前の、1 つ目の防御）。
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import * as fmt from '../../../src/web/doc/render/fmt';

const HOSTILE = [
  '<script>alert(1)</script>',
  '"><img src=x onerror=alert(1)>',
  "'; </pre><div onclick=alert(1)>",
  '&lt;b&gt; &amp; \u001b[31m<i>x</i>\u001b[0m',
];
const TAG =
  /<\/?(?:div|pre|span|details|summary)(?: (?:class|data-fmt|data-s|data-w|data-n|data-total|open)(?:="[^"<>]*")?)*>/g;
const CLASS_OK =
  /^(?:fmt|fmt-diff|fmt-term|fmt-json|fmt-trace|dl|ctx|add|del|hunk|meta|a-[fg](?:1[0-5]|[0-9])|a-[bdiu]|jk|jp|js|jn|jb|jl|jc|tr|tz|tn|tt|tb|ts|td|tm)$/;

/** 出力は、決まったタグ・属性だけで、残りの文字に、「<」「>」が、そのまま残らない（escape 済み）。class は、決まった名前だけ */
function assertSafe(html: string | null, what: string): void {
  expect(html, `${what}: 出力がある`).toBeTruthy();
  const s = html as string;
  for (const m of s.matchAll(/ class="([^"]*)"/g))
    for (const c of (m[1] as string).split(' ')) expect(c, `${what}: class が、決まった名前`).toMatch(CLASS_OK);
  for (const m of s.matchAll(/ data-[sw]="([^"]*)"/g))
    expect(Number.isFinite(Number(m[1])), `${what}: data-s・data-w は数: ${m[1]}`).toBe(true);
  for (const m of s.matchAll(/ data-n="([^"]*)"/g))
    expect(m[1], `${what}: data-n は、個数だけ`).toMatch(/^\d+ (?:items?|keys?)$/);
  const rest = s.replace(TAG, '');
  expect(/[<>]/.test(rest), `${what}: タグでない所に、< > が残っている: ${rest.slice(0, 120)}`).toBe(false);
}

test('escape：5 つの文字を、すべて escape する（属性の中に入れる値がなくても、念のため）', () => {
  expect(fmt.esc('"&\'<>')).toBe('&quot;&amp;&#39;&lt;&gt;');
  expect(fmt.esc(null)).toBe('null');
});

test('どの形式も、敵意のある文字を、escape して、決まったタグ・クラスの中に入れる', () => {
  for (const h of HOSTILE) {
    assertSafe(fmt.diffHtml(`+${h}\n-${h}\n@@ ${h} @@\n ${h}`), 'diff');
    assertSafe(fmt.ansiHtml(`\u001b[31m${h}\u001b[0m ${h}`), 'terminal');
    assertSafe(
      fmt.jsonHtml(JSON.stringify({ [h]: h, list: [h, 1, null, true], nested: { [h]: [{ [h]: h }] } })),
      'json',
    );
    assertSafe(fmt.traceHtml(`${h} | 0 | 10 | ${h}\nx | 5 | 20`), 'trace');
  }
  assertSafe(fmt.traceHtml('x | 0 | 0'), '全体が 0 のトレース');
});

test('diff：行の種類で、クラスが決まる。ハンクの中の「---」「+++」は、削除・追加。各行は、改行を含む', () => {
  const html = fmt.diffHtml(
    'diff --git a/x b/x\nindex 1..2 100644\n--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n context\n-old line\n+new line\n-- 削除された、ダッシュで始まる行\n--- 古い SQL のコメント\n+++ 足した行\n\\ No newline at end of file\ndiff --git a/y b/y\n--- a/y\n+++ b/y',
  );
  const kinds = [...html.matchAll(/<span class="dl (\w+)">([^<]*)<\/span>/g)].map((m) => [m[1], m[2]] as const);
  expect(
    kinds.map((k) => k[0]),
    'ハンクの中（@@ のあと）の --- は del・+++ は add。次の diff --git で、見出しに戻る',
  ).toEqual([
    'meta',
    'meta',
    'meta',
    'meta',
    'hunk',
    'ctx',
    'del',
    'add',
    'del',
    'del',
    'add',
    'meta',
    'meta',
    'meta',
    'meta',
  ]);
  expect(
    kinds.every((k) => (k[1] as string).endsWith('\n')),
    '各行が、改行で終わる',
  ).toBe(true);
  expect(fmt.diffHtml('\r\n+a\r\n'), 'CRLF も、読める').toMatch(/dl add/);
  expect(fmt.diffHtml('--- a\n+++ b\n+x'), '@@ がない差分は、見出しの行を、見出しにする').toMatch(
    /dl meta">--- a\n[\s\S]*dl meta">\+\+\+ b\n[\s\S]*dl add">\+x/,
  );
});

test('diff：「diff --git」のない、複数ファイルの差分でも、2 つ目のファイルの見出しは、見出し（ハンクの中の、削除・追加と、取り違えない）', () => {
  const html = fmt.diffHtml(
    '--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n--- a/y\n+++ b/y\n@@ -1 +1 @@\n-c\n+d\n--- 古い SQL のコメント\n+++ 足した行',
  );
  const kinds = [...html.matchAll(/<span class="dl (\w+)">/g)].map((m) => m[1]);
  expect(kinds, '「---・+++・@@」が続くときだけ、見出し。ハンクの最後の「--- 」「+++ 」は、削除・追加').toEqual([
    'meta',
    'meta',
    'hunk',
    'del',
    'add',
    'meta',
    'meta',
    'hunk',
    'del',
    'add',
    'del',
    'add',
  ]);
});

test('terminal：色・太字・リセットを、クラスにする。制御文字は捨て、ESC の別の書き方も受ける', () => {
  const html = fmt.ansiHtml(
    '\u001b[1;31mエラー\u001b[0m 通常 \x1b[42;30m緑地\x1b[49m 後 \\x1b[94m明るい青\\u001b[0m \u001b[38;5;2m256色\u001b[0m \u001b[38;2;1;2;3m真の色\u001b[0m ␛[4mA␛[0m ^[[3mB^[[0m \\x1B[1mC\\e[0m \\033[2mD\\033[0m',
  );
  expect(html).toMatch(/<span class="a-f1 a-b">エラー<\/span>/);
  expect(html).toMatch(/ 通常 /);
  expect(html).toMatch(/<span class="a-f0 a-g2">緑地<\/span>/);
  expect(html, '背景だけ戻して、文字色は、続く').toMatch(/<span class="a-f0"> 後 <\/span>/);
  expect(html, '\\x1b の書き方').toMatch(/<span class="a-f12">明るい青<\/span>/);
  expect(html, '256 色のうち、基本の 16 色').toMatch(/<span class="a-f2">256色<\/span>/);
  expect(html, '24 ビット色は、色なし').not.toMatch(/a-f[0-9]+">真の色/);
  expect(html, '␛ の書き方').toMatch(/<span class="a-u">A<\/span>/);
  expect(html, '^[ の書き方').toMatch(/<span class="a-i">B<\/span>/);
  expect(html, '\\x1B（大文字）の書き方').toMatch(/<span class="a-b">C<\/span>/);
  expect(html, '\\033 の書き方').toMatch(/<span class="a-d">D<\/span>/);
  // 24 ビット色（38;2;r;g;b）は、5 つの値を読み飛ばす。読み飛ばさないと、1;2;3 が、太字・薄字・斜体になる
  const rgb = fmt.ansiHtml('\u001b[38;2;1;2;3mX\u001b[0m');
  expect(rgb, '24 ビット色のあとの文字は、色も装飾もなし').toMatch(/^<div[^>]*><pre>X\n<\/pre>/);
  const wide = fmt.ansiHtml('\u001b[38;5;200mX\u001b[48;5;300mY\u001b[38;5;1234567mZ\u001b[31;99;1000mW');
  assertSafe(wide, '範囲外の色');
  expect(wide, '16 以上の色番号は、クラスにしない（色なし）').not.toMatch(/a-[fg](?:1[6-9]|[2-9]\d|\d{3,})/);
  expect(wide).toMatch(/XYZ|X.*Y.*Z/);
  const dirty = fmt.ansiHtml('a\u001b[2Jb\u001b[?25lc\u0007d\u0000e\\x1b[2Kf\\e[1Ag');
  expect(dirty, '色以外の制御シーケンス（書き方によらず）・制御文字は、捨てる').toMatch(/abcdefg/);
  expect(dirty.includes('\u001b')).toBe(false);
});

test('json：折りたためる木。書かれたとおりに見せる（数・文字列・重複したキー・キーの順）', () => {
  const html = fmt.jsonHtml('{"a":{"b":{"c":[1,2,{"d":null}]}},"e":"文字","f":true,"g":[],"h":{}}') as string;
  expect(
    (html.match(/<details/g) || []).length,
    '空でない、オブジェクト・配列の数（根・a・b・c・{d}）。空の [] と {} は、数えない',
  ).toBe(5);
  expect((html.match(/<details open>/g) || []).length, '根（深さ 0）と、深さ 1 だけ開く').toBe(2);
  expect(html, '根は、開く').toMatch(/<details open><summary data-n="5 keys"><span class="jp">\{<\/span>/);
  expect(html, '1 つのとき、単数').toMatch(/<summary data-n="1 key"><span class="jk">&quot;a&quot;<\/span>/);
  expect(html, '深さ 3 は、閉じる').toMatch(
    /<details><summary data-n="3 items"><span class="jk">&quot;c&quot;<\/span>/,
  );
  expect(html, '個数は、文字にしない（引用・AI に届く文字に、入らない）').not.toMatch(/keys<|items</);
  expect(html, '空の配列').toMatch(/<span class="jp">\[\]<\/span>/);
  // 書かれたとおり
  const raw = fmt.jsonHtml(
    '{"big":12345678901234567890,"huge":1e400,"neg0":-0,"keep":1.50,"dup":1,"dup":2,"b":1,"1":2,"s":"a\\nb\\"c\\u00e9"}',
  ) as string;
  expect(raw, '桁あふれする整数も、そのまま').toMatch(/<span class="jn">12345678901234567890<\/span>/);
  expect(raw).toMatch(/<span class="jn">1e400<\/span>/);
  expect(raw).toMatch(/<span class="jn">-0<\/span>/);
  expect(raw).toMatch(/<span class="jn">1\.50<\/span>/);
  expect((raw.match(/&quot;dup&quot;/g) || []).length, '重複したキーも、両方').toBe(2);
  expect(
    raw.indexOf('&quot;b&quot;') < raw.indexOf('<span class="jk">&quot;1&quot;'),
    '整数のようなキーを、並べ替えない',
  ).toBe(true);
  const tabbed = fmt.jsonHtml('{\t"a":\r\n1,\r\n\t"b":\t[\t]\r\n}');
  expect(tabbed || '', 'タブ・CR の空白があっても、キーと値を、正しく読む（タブで字下げした JSON）').toMatch(
    /<span class="jk">&quot;a&quot;<\/span><span class="jp">: <\/span><span class="jn">1<\/span>[\s\S]*<span class="jk">&quot;b&quot;<\/span><span class="jp">: <\/span><span class="jp">\[\]<\/span>/,
  );
  expect(raw, '文字列は、書かれた表記のまま（\\n・\\"・\\uXXXX）').toMatch(
    /<span class="js">&quot;a\\nb\\&quot;c\\u00e9&quot;<\/span>/,
  );
  expect(
    html.replace(/<[^>]+>/g, '').replace(/&quot;/g, '"'),
    'テキストは、行ごとに改行する（引用・AI に届く文字になる）',
  ).toMatch(/"a": \{\n"b": \{\n/);
  for (const bad of ['', '{', '{"a":}', 'undefined', "{'a':1}", '[1,]'])
    expect(fmt.jsonHtml(bad), JSON.stringify(bad)).toBeNull();
  expect(fmt.jsonHtml(`[${Array.from({ length: 3001 }, (_, i) => i).join(',')}]`), '3000 ノードを超える').toBeNull();
  expect(fmt.jsonHtml(`[${Array.from({ length: 2999 }, (_, i) => i).join(',')}]`), '3000 以下は、描く').toBeTruthy();
  expect(fmt.jsonHtml('['.repeat(60) + ']'.repeat(60)), '深さ 40 を超える').toBeNull();
  expect(fmt.jsonHtml('{"__proto__":{"x":1},"constructor":2}'), '特別な名前のキーも、ふつうに描く').toBeTruthy();
  expect(
    fmt.jsonHtml('"文字だけ"') && fmt.jsonHtml('42') && fmt.jsonHtml('null') && fmt.jsonHtml(' \n[ 1 , 2 ]\n'),
    '根が、値でも・空白があっても描く',
  ).toBeTruthy();
});

test('trace：「名前 | 開始 | 長さ | メモ」の行から、タイムラインを作る。読めないときは null', () => {
  const html = fmt.traceHtml(
    '# コメント\nリクエスト | 0 | 100 | 受付\nDB 検索 | 20 | 60\n\nレスポンス | 100 | 400 | a | b',
  ) as string;
  const bars = [...html.matchAll(/data-s="([\d.]+)" data-w="([\d.]+)"/g)].map((m) => [Number(m[1]), Number(m[2])]);
  expect(bars, '全体（500ms）に対する、開始・長さの %').toEqual([
    [0, 20],
    [4, 12],
    [20, 80],
  ]);
  expect(html).toMatch(/<span class="td">100ms <\/span>/);
  expect(html, '開始も、文字で持つ').toMatch(/<span class="ts">@20ms <\/span>/);
  expect(html, '全体の長さ（軸の端は、CSS で出す）').toMatch(/<span class="tt" data-total="500ms"><\/span>/);
  expect(html.replace(/<[^>]+>/g, ''), '軸の目盛りは、文字に入らない').not.toMatch(/500ms|\b0\b.*500/);
  expect(html, 'メモは、| を含められる').toMatch(/<span class="tm">a \| b\n<\/span>/);
  expect(html.replace(/<[^>]+>/g, ''), 'テキストは、1 行にまとまり、改行で終わる').toMatch(/DB 検索 @20ms 60ms\n/);
  // 区切りの空白・改行は、セルの中だけ（グリッドの子の間の空白は、コメントの強調 <mark> に包まれると、グリッドの項目になって、表示が崩れる）
  expect(html, 'セルの外に、空白・改行がない').not.toMatch(
    /<\/span>\s+<span|<\/span>\s+<\/div>|<div class="tr">\s|<\/div>\s+<div class="tr/,
  );
  expect(fmt.traceHtml('x | 0 | 1500')).toMatch(/1\.5s/);
  for (const bad of [
    '',
    '# だけ',
    'x | 1',
    'x | a | 2',
    ' | 1 | 2',
    'x | -1 | 2',
    'x | 1 | -2',
    'x | | 2',
    'x | 1 | Infinity',
    'x | 1e308 | 1e308',
  ])
    expect(fmt.traceHtml(bad), JSON.stringify(bad)).toBeNull();
  expect(
    fmt.traceHtml(Array.from({ length: 201 }, (_, i) => `s${i} | ${i} | 1`).join('\n')),
    '200 行を超える',
  ).toBeNull();
  const zero = fmt.traceHtml('x | 0 | 0') as string;
  expect(zero, '長さ 0 でも、描く（全体が 0 でも、割り算で壊れない）').toBeTruthy();
  expect(zero, '全体が 0 の軸の端は、0').toMatch(/data-total="0"/);
  expect(zero).not.toMatch(/NaN|Infinity/);
});

test('render：決まった言語だけ。自分のプロパティ以外（__proto__・constructor など）は、受けない。ラベルも、同じ', () => {
  for (const lang of ['diff', 'patch', 'terminal', 'ansi']) expect(fmt.render(lang, 'x'), lang).toBeTruthy();
  expect(fmt.render('json', '{}')).toBeTruthy();
  expect(fmt.render('trace', 'a | 0 | 1')).toBeTruthy();
  for (const lang of ['', 'js', 'mermaid', 'DIFF', '__proto__', 'constructor', 'toString', 'hasOwnProperty'])
    expect(fmt.render(lang, 'x'), lang).toBeNull();
  expect(fmt.render('json', '{'), '壊れた JSON は、null').toBeNull();
  expect(fmt.labelOf('json')).toBe('JSON');
  for (const k of ['__proto__', 'constructor', 'toString', '', 'nope'])
    expect(fmt.labelOf(k), `${k}: 文字のラベルだけ`).toBe('図表');
});

// 旧 fmt.js（切り替えまでは、skills/rikai/public/ にある）と、同じ入力で、同じ戻り値になること。切り替え後は、旧がないので、飛ばす
const OLD = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../../skills/rikai/public/fmt.js');
type OldFmt = Record<'diffHtml' | 'ansiHtml' | 'jsonHtml' | 'traceHtml', (t: unknown) => string | null> &
  Record<'render', (l: string, t: unknown) => string | null> & { esc: (s: unknown) => string };

test.skipIf(!existsSync(OLD))('旧 fmt.js と、同じ乱数の入力で、戻り値が一致する', () => {
  const old = createRequire(import.meta.url)(OLD) as OldFmt;
  let seed = 20261122;
  const rnd = (n: number): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % n;
  };
  const pick = <T>(xs: readonly T[]): T => xs[rnd(xs.length)] as T;
  const pieces = [
    '+',
    '-',
    '@@ -1 +1 @@',
    '--- a',
    '+++ b',
    'diff --git a b',
    'index 1..2',
    ' ',
    '\\ No newline',
    'x',
    '<b>',
    '"',
    "'",
    '&',
    '\n',
    '\r\n',
    '\u001b[',
    '31m',
    '0m',
    '1;',
    '38;5;',
    '38;2;',
    '48;5;',
    '48;2;',
    '37m',
    '\u001b[37m',
    '\u001b[1;31m',
    '\u001b[0m',
    '\u001b[48;5;4m',
    '47m',
    '97m',
    '22;',
    '23;',
    '24;',
    '39;',
    '49;',
    '3;4;2;',
    'm',
    '\\e[',
    '␛[',
    '^[[',
    '|',
    ' | ',
    '12',
    '3.5',
    '-1',
    '#',
    'a',
    '日本語',
    '{',
    '}',
    '[',
    ']',
    ',',
    ':',
    '"k"',
    'true',
    'null',
    '1e5',
    '\t',
  ];
  const gen = (): string => Array.from({ length: rnd(40) }, () => pick(pieces)).join('');
  const jsons = [
    () => JSON.stringify({ [gen()]: gen(), a: [rnd(100), null, true, [gen()], {}], n: { m: [] } }),
    () => `[${Array.from({ length: rnd(20) }, () => rnd(1000) / 10).join(',')}]`,
    () => `{"x":${rnd(10)},"x":"${gen().replace(/["\\\n\r]/g, '')}"}`,
    gen,
  ];
  const traces = [
    () =>
      Array.from(
        { length: rnd(8) },
        () => `${gen().replace(/\|/g, '')} | ${rnd(500)} | ${rnd(500)}${rnd(2) ? ` | ${gen()}` : ''}`,
      ).join('\n'),
    gen,
  ];
  for (let i = 0; i < 1500; i++) {
    const s = gen();
    expect(fmt.esc(s)).toBe(old.esc(s));
    expect(fmt.diffHtml(s)).toBe(old.diffHtml(s));
    expect(fmt.ansiHtml(s)).toBe(old.ansiHtml(s));
    const j = pick(jsons)();
    expect(fmt.jsonHtml(j)).toBe(old.jsonHtml(j));
    const t = pick(traces)();
    expect(fmt.traceHtml(t)).toBe(old.traceHtml(t));
    for (const lang of ['diff', 'patch', 'terminal', 'ansi', 'json', 'trace', 'x'])
      expect(fmt.render(lang, s)).toBe(old.render(lang, s));
  }
});
