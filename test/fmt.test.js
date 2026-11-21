'use strict';
// 資料の形式（```diff・```json・```terminal・```trace）：色分け・木・タイムラインの作り方と、安全（資料の文字が、タグ・属性にならない）。
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
const TAG = /<\/?(?:div|pre|span|details|summary)(?: (?:class|data-fmt|data-s|data-w|open)(?:="[^"<>]*")?)*>/g;
const CLASS_OK = /^(?:fmt|fmt-diff|fmt-term|fmt-json|fmt-trace|dl|ctx|add|del|hunk|meta|a-[fg](?:1[0-5]|[0-9])|a-[bdiu]|jk|jp|js|jn|jb|jm|jl|jc|tr|tz|tn|tt|tb|td|tm|tl|r)$/;

// 出力は、決まったタグ・属性だけで、残りの文字に、「<」「>」が、そのまま残らない（escape 済み）。class は、決まった名前だけ
function assertSafe(html, what) {
  assert.ok(html, `${what}: 出力がある`);
  for (const m of html.matchAll(/ class="([^"]*)"/g)) for (const c of m[1].split(' ')) assert.match(c, CLASS_OK, `${what}: class が、決まった名前`);
  for (const m of html.matchAll(/ data-[sw]="([^"]*)"/g)) assert.ok(Number.isFinite(Number(m[1])), `${what}: data-s・data-w は数`);
  const rest = html.replace(TAG, '');
  assert.ok(!/[<>]/.test(rest), `${what}: タグでない所に、< > が残っている: ${rest.slice(0, 120)}`);
  assert.ok(!/\sonerror=|\sonclick=/.test(html.replace(/&[a-z#0-9]+;/g, '')) || !/<[^>]*\son(?:error|click)=/.test(html), `${what}: 属性に、イベントがある`);
}

test('どの形式も、敵意のある文字を、escape して、決まったタグ・クラスの中に入れる', () => {
  for (const h of HOSTILE) {
    assertSafe(fmt.diffHtml(`+${h}\n-${h}\n@@ ${h} @@\n ${h}`), 'diff');
    assertSafe(fmt.ansiHtml(`\u001b[31m${h}\u001b[0m ${h}`), 'terminal');
    assertSafe(fmt.jsonHtml(JSON.stringify({ [h]: h, list: [h, 1, null, true], nested: { [h]: [{ [h]: h }] } })), 'json');
    assertSafe(fmt.traceHtml(`${h} | 0 | 10 | ${h}\nx | 5 | 20`), 'trace');
  }
});

test('diff：行の種類で、クラスが決まる。各行は、改行を含む（引用・選択の文字が、行ごとに分かれる）', () => {
  const html = fmt.diffHtml('diff --git a/x b/x\nindex 1..2 100644\n--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n context\n-old line\n+new line\n-- 削除された、ダッシュで始まる行');
  const kinds = [...html.matchAll(/<span class="dl (\w+)">([^<]*)<\/span>/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(kinds.map((k) => k[0]), ['meta', 'meta', 'meta', 'meta', 'hunk', 'ctx', 'del', 'add', 'del']);
  assert.ok(kinds.every((k) => k[1].endsWith('\n')), '各行が、改行で終わる');
  assert.equal(kinds.map((k) => k[1]).join('').split('\n').length - 1, 9);
  assert.match(fmt.diffHtml('\r\n+a\r\n'), /dl add/, 'CRLF も、読める');
});

test('terminal：色・太字・リセットを、クラスにする。制御文字は捨て、ESC の別の書き方も受ける', () => {
  const html = fmt.ansiHtml('\u001b[1;31mエラー\u001b[0m 通常 \x1b[42;30m緑地\x1b[49m 後 \\x1b[94m明るい青\\u001b[0m \u001b[38;5;2m256色\u001b[0m \u001b[38;2;1;2;3m真の色\u001b[0m ␛[4mA␛[0m ^[[3mB^[[0m');
  assert.match(html, /<span class="a-f1 a-b">エラー<\/span>/);
  assert.match(html, / 通常 /);
  assert.match(html, /<span class="a-f0 a-g2">緑地<\/span>/);
  assert.match(html, /<span class="a-f0"> 後 <\/span>/, '背景だけ戻して、文字色は、続く');
  assert.match(html, /<span class="a-f12">明るい青<\/span>/, '\\x1b の書き方');
  assert.match(html, /<span class="a-f2">256色<\/span>/, '256 色のうち、基本の 16 色');
  assert.match(html, /真の色/);
  assert.doesNotMatch(html, /a-f[0-9]+">真の色/, '24 ビット色は、色なし');
  assert.match(html, /<span class="a-u">A<\/span>/, '␛ の書き方');
  assert.match(html, /<span class="a-i">B<\/span>/, '^[ の書き方');
  const wide = fmt.ansiHtml('\u001b[38;5;200mX\u001b[48;5;300mY\u001b[38;5;1234567mZ\u001b[31;99;1000mW');
  assertSafe(wide, '範囲外の色');
  assert.doesNotMatch(wide, /a-[fg](?:1[6-9]|[2-9]\d|\d{3,})/, '16 以上の色番号は、クラスにしない（色なし）');
  assert.match(wide, /XYZ|X.*Y.*Z/);
  const dirty = fmt.ansiHtml('a\u001b[2Jb\u001b[?25lc\u0007d\u0000e');
  assert.match(dirty, /abcde/, '色以外の制御シーケンス・制御文字は、捨てる');
  assert.ok(!dirty.includes('\u001b'));
});

test('json：折りたためる木。JSON でない・大きすぎる・深すぎるものは、null（ふつうのコードブロックになる）', () => {
  const html = fmt.jsonHtml('{"a":{"b":{"c":[1,2,{"d":null}]}},"e":"文字","f":true,"g":[],"h":{}}');
  assert.equal((html.match(/<details/g) || []).length, 5, '空でない、オブジェクト・配列の数（根・a・b・c・{d}）。空の [] と {} は、数えない');
  assert.match(html, /<details open><summary><span class="jp">\{<\/span>/, '根は、開く');
  assert.match(html, /<details><summary><span class="jk">"c"<\/span>/, '深さ 2 以降は、閉じる');
  assert.match(html, /<span class="jm"> 5 keys<\/span>/);
  assert.match(html, /<span class="jm"> 1 key<\/span>/, '1 つのとき、単数');
  assert.match(html, /<span class="jp">\[\]<\/span>/, '空の配列');
  for (const bad of ['', '{', '{"a":}', 'undefined', "{'a':1}"]) assert.equal(fmt.jsonHtml(bad), null, JSON.stringify(bad));
  assert.equal(fmt.jsonHtml(`[${Array.from({ length: 3001 }, (_, i) => i).join(',')}]`), null, '3000 ノードを超える');
  assert.ok(fmt.jsonHtml(`[${Array.from({ length: 2000 }, (_, i) => i).join(',')}]`), '2000 は、描く');
  assert.equal(fmt.jsonHtml('['.repeat(60) + ']'.repeat(60)), null, '深さ 40 を超える');
  assert.ok(fmt.jsonHtml('{"__proto__":{"x":1},"constructor":2}'), '特別な名前のキーも、ふつうに描く');
  assert.ok(fmt.jsonHtml('"文字だけ"') && fmt.jsonHtml('42') && fmt.jsonHtml('null'), '根が、値でも描く');
});

test('trace：「名前 | 開始 | 長さ | メモ」の行から、タイムラインを作る。読めないときは null', () => {
  const html = fmt.traceHtml('# コメント\nリクエスト | 0 | 100 | 受付\nDB 検索 | 20 | 60\n\nレスポンス | 100 | 400 | a | b');
  const bars = [...html.matchAll(/data-s="([\d.]+)" data-w="([\d.]+)"/g)].map((m) => [Number(m[1]), Number(m[2])]);
  assert.deepEqual(bars, [[0, 20], [4, 12], [20, 80]], '全体（500ms）に対する、開始・長さの %');
  assert.match(html, /<span class="td">100ms<\/span>/);
  assert.match(html, /<span class="tl r">500ms<\/span>/, '全体の長さ');
  assert.match(html, /<span class="tm">a \| b<\/span>/, 'メモは、| を含められる');
  assert.match(fmt.traceHtml('x | 0 | 1500'), /1\.5s/);
  for (const bad of ['', '# だけ', 'x | 1', 'x | a | 2', ' | 1 | 2', 'x | -1 | 2', 'x | 1 | -2', 'x | | 2', 'x | 1 | Infinity']) assert.equal(fmt.traceHtml(bad), null, JSON.stringify(bad));
  assert.equal(fmt.traceHtml(Array.from({ length: 201 }, (_, i) => `s${i} | ${i} | 1`).join('\n')), null, '200 行を超える');
  assert.ok(fmt.traceHtml('x | 0 | 0'), '長さ 0 でも、描く（全体が 0 でも、割り算で壊れない）');
});

test('render：決まった言語だけ。自分のプロパティ以外（__proto__・constructor など）は、受けない', () => {
  for (const lang of ['diff', 'patch', 'terminal', 'ansi']) assert.ok(fmt.render(lang, 'x'), lang);
  assert.ok(fmt.render('json', '{}'));
  assert.ok(fmt.render('trace', 'a | 0 | 1'));
  for (const lang of ['', 'js', 'mermaid', 'DIFF', '__proto__', 'constructor', 'toString', 'hasOwnProperty']) assert.equal(fmt.render(lang, 'x'), null, lang);
  assert.equal(fmt.render('json', '{'), null, '壊れた JSON は、null');
});
