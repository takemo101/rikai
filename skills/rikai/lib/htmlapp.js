'use strict';
// html-app：資料（Markdown）の ```html-app フェンス（JavaScript を動かす、隔離した枠の中身）を取り出す。
// 数え方は、ブラウザの `app.js` と同じ（同梱の marked の字句解析を、そのまま使う。フェンスは、文書の順に 0 から数える）。
// 取り出した中身は、`server.js` が、隔離する CSP つきで配る（/appframe）。ここは、取り出すだけで、何も実行しない。
//
// 資料は、AI が書いた、非信頼のデータ。marked の字句解析は、入力によっては、とても遅い・深い入れ子で例外になる（40KB の入れ子の箇条書きで、数十秒以上）。
// サーバーのイベントループを止めないよう、**別のスレッド（worker）で解析し、時間を切る**（`appsOfAsync`）。
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const APP_MAX = 200 * 1024; // 1 つの枠の中身の上限（文字数）
const DOC_MAX = 4 * 1024 * 1024; // 解析する資料の上限（バイト）
const TIMEOUT_MS = 3000;

let marked = null;
// 初めて要るときに読む（使わない資料では、読み込まない）。ブラウザと同じ版の marked（public/vendor）
const lib = () => (marked || (marked = require(path.join(__dirname, '..', 'public', 'vendor', 'marked.min.js'))));

// ブラウザの `renderer.code` と同じ判定：情報文字列の最初の語が html-app
const kindOf = (lang) => String(lang || '').trim().split(/\s+/)[0].toLowerCase();

// 資料の中の、html-app フェンスの中身（文書の順）。入れ子（箇条書き・引用の中）も、字句解析の順で数える。
// ブロックの字句解析だけを使う（フェンスは、ブロックのトークン。行の中の解析は、要らない）。改行の正規化は、marked の `lex` と同じ
function appsOf(markdown) {
  const out = [];
  const walk = (tokens) => {
    for (const t of tokens || []) {
      if (t.type === 'code' && kindOf(t.lang) === 'html-app') out.push(String(t.text));
      if (t.tokens) walk(t.tokens);
      if (t.items) walk(t.items);
    }
  };
  walk(new (lib().Lexer)().blockTokens(String(markdown || '').replace(/\r\n|\r/g, '\n'), []));
  return out;
}

// worker で取り出す。時間（timeoutMs）を超えたら、worker を止めて、拒否する（reason：'timeout'）。例外（深すぎる入れ子など）も、拒否する
function appsOfAsync(markdown, timeoutMs = TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const w = new Worker(__filename, { workerData: { markdown: String(markdown || '') }, resourceLimits: { maxOldGenerationSizeMb: 256, stackSizeMb: 4 } });
    let done = false;
    const end = (fn, v) => { if (done) return; done = true; clearTimeout(timer); w.terminate(); fn(v); };
    const timer = setTimeout(() => end(reject, Object.assign(new Error('timeout'), { reason: 'timeout' })), timeoutMs);
    w.once('message', (m) => end(m.ok ? resolve : reject, m.ok ? m.apps : Object.assign(new Error(m.error), { reason: 'error' })));
    w.once('error', (e) => end(reject, Object.assign(e, { reason: 'error' })));
    w.once('exit', () => end(reject, Object.assign(new Error('exit'), { reason: 'error' })));
  });
}

if (!isMainThread && workerData && typeof workerData.markdown === 'string') {
  try { parentPort.postMessage({ ok: true, apps: appsOf(workerData.markdown) }); } catch (e) { parentPort.postMessage({ ok: false, error: String(e && e.name) }); }
}

module.exports = { appsOf, appsOfAsync, kindOf, APP_MAX, DOC_MAX };
