'use strict';
// 資料の形式（```diff・```json・```terminal・```trace）：色分け・木・タイムラインの作り方と、安全（資料の文字が、タグ・属性にならない）、
// 書かれたとおりに見せること（JSON の数・キー）。
// 資料は、AI が書いた非信頼のデータ。ここで、escape を取りこぼすと、画面に、タグ・イベントの属性が出る（ビューアの DOMPurify の手前の、1 つ目の防御）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fmt = require('../skills/rikai/public/fmt.js');

const HOSTILE = [
  '<script>alert(1)</script>',
  '"><img src=x onerror=alert(1)>',
  "'; </pre><div onclick=alert(1)>",
  '&lt;b&gt; &amp; \u001b[31m<i>x</i>\u001b[0m',
];
const TAG = /<\/?(?:div|pre|span|details|summary)(?: (?:class|data-fmt|data-s|data-w|data-n|data-total|open)(?:="[^"<>]*")?)*>/g;
const CLASS_OK = /^(?:fmt|fmt-diff|fmt-term|fmt-json|fmt-trace|dl|ctx|add|del|hunk|meta|a-[fg](?:1[0-5]|[0-9])|a-[bdiu]|jk|jp|js|jn|jb|jl|jc|tr|tz|tn|tt|tb|ts|td|tm)$/;

// 出力は、決まったタグ・属性だけで、残りの文字に、「<」「>」が、そのまま残らない（escape 済み）。class は、決まった名前だけ
function assertSafe(html, what) {
  assert.ok(html, `${what}: 出力がある`);
  for (const m of html.matchAll(/ class="([^"]*)"/g)) for (const c of m[1].split(' ')) assert.match(c, CLASS_OK, `${what}: class が、決まった名前`);
  for (const m of html.matchAll(/ data-[sw]="([^"]*)"/g)) assert.ok(Number.isFinite(Number(m[1])), `${what}: data-s・data-w は数: ${m[1]}`);
  for (const m of html.matchAll(/ data-n="([^"]*)"/g)) assert.match(m[1], /^\d+ (?:items?|keys?)$/, `${what}: data-n は、個数だけ`);
  const rest = html.replace(TAG, '');
  assert.ok(!/[<>]/.test(rest), `${what}: タグでない所に、< > が残っている: ${rest.slice(0, 120)}`);
}

test('escape：5 つの文字を、すべて escape する（属性の中に入れる値がなくても、念のため）', () => {
  assert.equal(fmt.esc('"&\'<>'), '&quot;&amp;&#39;&lt;&gt;');
  assert.equal(fmt.esc(null), 'null');
});

test('どの形式も、敵意のある文字を、escape して、決まったタグ・クラスの中に入れる', () => {
  for (const h of HOSTILE) {
    assertSafe(fmt.diffHtml(`+${h}\n-${h}\n@@ ${h} @@\n ${h}`), 'diff');
    assertSafe(fmt.ansiHtml(`\u001b[31m${h}\u001b[0m ${h}`), 'terminal');
    assertSafe(fmt.jsonHtml(JSON.stringify({ [h]: h, list: [h, 1, null, true], nested: { [h]: [{ [h]: h }] } })), 'json');
    assertSafe(fmt.traceHtml(`${h} | 0 | 10 | ${h}\nx | 5 | 20`), 'trace');
  }
  assertSafe(fmt.traceHtml('x | 0 | 0'), '全体が 0 のトレース');
});

test('diff：行の種類で、クラスが決まる。ハンクの中の「---」「+++」は、削除・追加。各行は、改行を含む', () => {
  const html = fmt.diffHtml('diff --git a/x b/x\nindex 1..2 100644\n--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n context\n-old line\n+new line\n-- 削除された、ダッシュで始まる行\n--- 古い SQL のコメント\n+++ 足した行\n\\ No newline at end of file\ndiff --git a/y b/y\n--- a/y\n+++ b/y');
  const kinds = [...html.matchAll(/<span class="dl (\w+)">([^<]*)<\/span>/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(kinds.map((k) => k[0]), ['meta', 'meta', 'meta', 'meta', 'hunk', 'ctx', 'del', 'add', 'del', 'del', 'add', 'meta', 'meta', 'meta', 'meta'],
    'ハンクの中（@@ のあと）の --- は del・+++ は add。次の diff --git で、見出しに戻る');
  assert.ok(kinds.every((k) => k[1].endsWith('\n')), '各行が、改行で終わる');
  assert.match(fmt.diffHtml('\r\n+a\r\n'), /dl add/, 'CRLF も、読める');
  assert.match(fmt.diffHtml('--- a\n+++ b\n+x'), /dl meta">--- a\n[\s\S]*dl meta">\+\+\+ b\n[\s\S]*dl add">\+x/, '@@ がない差分は、見出しの行を、見出しにする');
});

test('diff：「diff --git」のない、複数ファイルの差分でも、2 つ目のファイルの見出しは、見出し（ハンクの中の、削除・追加と、取り違えない）', () => {
  const html = fmt.diffHtml('--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n--- a/y\n+++ b/y\n@@ -1 +1 @@\n-c\n+d\n--- 古い SQL のコメント\n+++ 足した行');
  const kinds = [...html.matchAll(/<span class="dl (\w+)">/g)].map((m) => m[1]);
  assert.deepEqual(kinds, ['meta', 'meta', 'hunk', 'del', 'add', 'meta', 'meta', 'hunk', 'del', 'add', 'del', 'add'], '「---・+++・@@」が続くときだけ、見出し。ハンクの最後の「--- 」「+++ 」は、削除・追加');
});

test('terminal：色・太字・リセットを、クラスにする。制御文字は捨て、ESC の別の書き方も受ける', () => {
  const html = fmt.ansiHtml('\u001b[1;31mエラー\u001b[0m 通常 \x1b[42;30m緑地\x1b[49m 後 \\x1b[94m明るい青\\u001b[0m \u001b[38;5;2m256色\u001b[0m \u001b[38;2;1;2;3m真の色\u001b[0m ␛[4mA␛[0m ^[[3mB^[[0m \\x1B[1mC\\e[0m \\033[2mD\\033[0m');
  assert.match(html, /<span class="a-f1 a-b">エラー<\/span>/);
  assert.match(html, / 通常 /);
  assert.match(html, /<span class="a-f0 a-g2">緑地<\/span>/);
  assert.match(html, /<span class="a-f0"> 後 <\/span>/, '背景だけ戻して、文字色は、続く');
  assert.match(html, /<span class="a-f12">明るい青<\/span>/, '\\x1b の書き方');
  assert.match(html, /<span class="a-f2">256色<\/span>/, '256 色のうち、基本の 16 色');
  assert.doesNotMatch(html, /a-f[0-9]+">真の色/, '24 ビット色は、色なし');
  assert.match(html, /<span class="a-u">A<\/span>/, '␛ の書き方');
  assert.match(html, /<span class="a-i">B<\/span>/, '^[ の書き方');
  assert.match(html, /<span class="a-b">C<\/span>/, '\\x1B（大文字）の書き方');
  assert.match(html, /<span class="a-d">D<\/span>/, '\\033 の書き方');
  // 24 ビット色（38;2;r;g;b）は、5 つの値を読み飛ばす。読み飛ばさないと、1;2;3 が、太字・薄字・斜体になる
  const rgb = fmt.ansiHtml('\u001b[38;2;1;2;3mX\u001b[0m');
  assert.match(rgb, /^<div[^>]*><pre>X\n<\/pre>/, '24 ビット色のあとの文字は、色も装飾もなし');
  const wide = fmt.ansiHtml('\u001b[38;5;200mX\u001b[48;5;300mY\u001b[38;5;1234567mZ\u001b[31;99;1000mW');
  assertSafe(wide, '範囲外の色');
  assert.doesNotMatch(wide, /a-[fg](?:1[6-9]|[2-9]\d|\d{3,})/, '16 以上の色番号は、クラスにしない（色なし）');
  assert.match(wide, /XYZ|X.*Y.*Z/);
  const dirty = fmt.ansiHtml('a\u001b[2Jb\u001b[?25lc\u0007d\u0000e\\x1b[2Kf\\e[1Ag');
  assert.match(dirty, /abcdefg/, '色以外の制御シーケンス（書き方によらず）・制御文字は、捨てる');
  assert.ok(!dirty.includes('\u001b'));
});

test('json：折りたためる木。書かれたとおりに見せる（数・文字列・重複したキー・キーの順）', () => {
  const html = fmt.jsonHtml('{"a":{"b":{"c":[1,2,{"d":null}]}},"e":"文字","f":true,"g":[],"h":{}}');
  assert.equal((html.match(/<details/g) || []).length, 5, '空でない、オブジェクト・配列の数（根・a・b・c・{d}）。空の [] と {} は、数えない');
  assert.equal((html.match(/<details open>/g) || []).length, 2, '根（深さ 0）と、深さ 1 だけ開く');
  assert.match(html, /<details open><summary data-n="5 keys"><span class="jp">\{<\/span>/, '根は、開く');
  assert.match(html, /<summary data-n="1 key"><span class="jk">&quot;a&quot;<\/span>/, '1 つのとき、単数');
  assert.match(html, /<details><summary data-n="3 items"><span class="jk">&quot;c&quot;<\/span>/, '深さ 3 は、閉じる');
  assert.doesNotMatch(html, /keys<|items</, '個数は、文字にしない（引用・AI に届く文字に、入らない）');
  assert.match(html, /<span class="jp">\[\]<\/span>/, '空の配列');
  // 書かれたとおり
  const raw = fmt.jsonHtml('{"big":12345678901234567890,"huge":1e400,"neg0":-0,"keep":1.50,"dup":1,"dup":2,"b":1,"1":2,"s":"a\\nb\\"c\\u00e9"}');
  assert.match(raw, /<span class="jn">12345678901234567890<\/span>/, '桁あふれする整数も、そのまま');
  assert.match(raw, /<span class="jn">1e400<\/span>/);
  assert.match(raw, /<span class="jn">-0<\/span>/);
  assert.match(raw, /<span class="jn">1\.50<\/span>/);
  assert.equal((raw.match(/&quot;dup&quot;/g) || []).length, 2, '重複したキーも、両方');
  assert.ok(raw.indexOf('&quot;b&quot;') < raw.indexOf('<span class="jk">&quot;1&quot;'), '整数のようなキーを、並べ替えない');
  const tabbed = fmt.jsonHtml('{\t"a":\r\n1,\r\n\t"b":\t[\t]\r\n}');
  assert.match(tabbed || '', /<span class="jk">&quot;a&quot;<\/span><span class="jp">: <\/span><span class="jn">1<\/span>[\s\S]*<span class="jk">&quot;b&quot;<\/span><span class="jp">: <\/span><span class="jp">\[\]<\/span>/, 'タブ・CR の空白があっても、キーと値を、正しく読む（タブで字下げした JSON）');
  assert.match(raw, /<span class="js">&quot;a\\nb\\&quot;c\\u00e9&quot;<\/span>/, '文字列は、書かれた表記のまま（\\n・\\"・\\uXXXX）');
  assert.match(html.replace(/<[^>]+>/g, '').replace(/&quot;/g, '"'), /"a": \{\n"b": \{\n/, 'テキストは、行ごとに改行する（引用・AI に届く文字になる）');
  for (const bad of ['', '{', '{"a":}', 'undefined', "{'a':1}", '[1,]']) assert.equal(fmt.jsonHtml(bad), null, JSON.stringify(bad));
  assert.equal(fmt.jsonHtml(`[${Array.from({ length: 3001 }, (_, i) => i).join(',')}]`), null, '3000 ノードを超える');
  assert.ok(fmt.jsonHtml(`[${Array.from({ length: 2999 }, (_, i) => i).join(',')}]`), '3000 以下は、描く');
  assert.equal(fmt.jsonHtml('['.repeat(60) + ']'.repeat(60)), null, '深さ 40 を超える');
  assert.ok(fmt.jsonHtml('{"__proto__":{"x":1},"constructor":2}'), '特別な名前のキーも、ふつうに描く');
  assert.ok(fmt.jsonHtml('"文字だけ"') && fmt.jsonHtml('42') && fmt.jsonHtml('null') && fmt.jsonHtml(' \n[ 1 , 2 ]\n'), '根が、値でも・空白があっても描く');
});

test('trace：「名前 | 開始 | 長さ | メモ」の行から、タイムラインを作る。読めないときは null', () => {
  const html = fmt.traceHtml('# コメント\nリクエスト | 0 | 100 | 受付\nDB 検索 | 20 | 60\n\nレスポンス | 100 | 400 | a | b');
  const bars = [...html.matchAll(/data-s="([\d.]+)" data-w="([\d.]+)"/g)].map((m) => [Number(m[1]), Number(m[2])]);
  assert.deepEqual(bars, [[0, 20], [4, 12], [20, 80]], '全体（500ms）に対する、開始・長さの %');
  assert.match(html, /<span class="td">100ms <\/span>/);
  assert.match(html, /<span class="ts">@20ms <\/span>/, '開始も、文字で持つ');
  assert.match(html, /<span class="tt" data-total="500ms"><\/span>/, '全体の長さ（軸の端は、CSS で出す）');
  assert.doesNotMatch(html.replace(/<[^>]+>/g, ''), /500ms|\b0\b.*500/, '軸の目盛りは、文字に入らない');
  assert.match(html, /<span class="tm">a \| b\n<\/span>/, 'メモは、| を含められる');
  assert.match(html.replace(/<[^>]+>/g, ''), /DB 検索 @20ms 60ms\n/, 'テキストは、1 行にまとまり、改行で終わる');
  // 区切りの空白・改行は、セルの中だけ（グリッドの子の間の空白は、コメントの強調 <mark> に包まれると、グリッドの項目になって、表示が崩れる）
  assert.doesNotMatch(html, /<\/span>\s+<span|<\/span>\s+<\/div>|<div class="tr">\s|<\/div>\s+<div class="tr/, 'セルの外に、空白・改行がない');
  assert.match(fmt.traceHtml('x | 0 | 1500'), /1\.5s/);
  for (const bad of ['', '# だけ', 'x | 1', 'x | a | 2', ' | 1 | 2', 'x | -1 | 2', 'x | 1 | -2', 'x | | 2', 'x | 1 | Infinity', 'x | 1e308 | 1e308']) assert.equal(fmt.traceHtml(bad), null, JSON.stringify(bad));
  assert.equal(fmt.traceHtml(Array.from({ length: 201 }, (_, i) => `s${i} | ${i} | 1`).join('\n')), null, '200 行を超える');
  const zero = fmt.traceHtml('x | 0 | 0');
  assert.ok(zero, '長さ 0 でも、描く（全体が 0 でも、割り算で壊れない）');
  assert.match(zero, /data-total="0"/, '全体が 0 の軸の端は、0');
  assert.doesNotMatch(zero, /NaN|Infinity/);
});

test('render：決まった言語だけ。自分のプロパティ以外（__proto__・constructor など）は、受けない。ラベルも、同じ', () => {
  for (const lang of ['diff', 'patch', 'terminal', 'ansi']) assert.ok(fmt.render(lang, 'x'), lang);
  assert.ok(fmt.render('json', '{}'));
  assert.ok(fmt.render('trace', 'a | 0 | 1'));
  for (const lang of ['', 'js', 'mermaid', 'DIFF', '__proto__', 'constructor', 'toString', 'hasOwnProperty']) assert.equal(fmt.render(lang, 'x'), null, lang);
  assert.equal(fmt.render('json', '{'), null, '壊れた JSON は、null');
  assert.equal(fmt.labelOf('json'), 'JSON');
  for (const k of ['__proto__', 'constructor', 'toString', '', 'nope']) assert.equal(fmt.labelOf(k), '図表', `${k}: 文字のラベルだけ`);
});
