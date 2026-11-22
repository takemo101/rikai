'use strict';
// html-app：資料（Markdown）の ```html-app フェンス（JavaScript を動かす、隔離した枠の中身）を取り出す。
// 数え方は、ブラウザの `app.js` と同じ（同梱の marked の字句解析を、そのまま使う。フェンスは、文書の順に 0 から数える）。
// 取り出した中身は、`server.js` が、隔離する CSP つきで配る（/appframe）。ここは、取り出すだけで、何も実行しない。
const path = require('path');

const APP_MAX = 200 * 1024; // 1 つの枠の中身の上限（文字数）

let marked = null;
// 初めて要るときに読む（使わない資料では、読み込まない）。ブラウザと同じ版の marked（public/vendor）
function lexer(markdown) {
  if (!marked) marked = require(path.join(__dirname, '..', 'public', 'vendor', 'marked.min.js'));
  return marked.lexer(markdown);
}

// ブラウザの `renderer.code` と同じ判定：情報文字列の最初の語が html-app
const kindOf = (lang) => String(lang || '').trim().split(/\s+/)[0].toLowerCase();

// 資料の中の、html-app フェンスの中身（文書の順）。入れ子（箇条書き・引用の中）も、字句解析の順で数える
function appsOf(markdown) {
  const out = [];
  const walk = (tokens) => {
    for (const t of tokens || []) {
      if (t.type === 'code' && kindOf(t.lang) === 'html-app') out.push(String(t.text));
      if (t.tokens) walk(t.tokens);
      if (t.items) walk(t.items);
    }
  };
  walk(lexer(String(markdown || '')));
  return out;
}

module.exports = { appsOf, kindOf, APP_MAX };
