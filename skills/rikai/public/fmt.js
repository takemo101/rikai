'use strict';
// 資料の「形式」：Markdown のコードブロックの種類（```diff・```json・```terminal・```trace）を、HTML の文字列にする。
// DOM に触れない純粋な関数だけ（ブラウザ〔window.RikaiFmt〕と Node のテスト〔require〕の両方から使う）。
// 資料は、AI が書いた、非信頼のデータ。文字は、必ず、ここで escape してから、決まったタグ・クラスの中に入れる（資料の文字が、タグ・属性にならない）。
// ビューアは、このあと、全体を DOMPurify に通す（`style` 属性は使えない。位置・長さは、data-* に数だけで持ち、ビューアが、無害化のあとに設定する）。
(function (root) {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const lines = (text) => String(text == null ? '' : text).replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n');

  // ---- diff：行の種類で、色分け（追加・削除・ハンクの見出し・ファイルの見出し）。各行は、1 つのブロックの要素（行末の改行を含む）
  function diffHtml(text) {
    const out = lines(text).map((l) => {
      let c = 'ctx';
      if (/^(diff |index |--- |\+\+\+ |new file|deleted file|similarity |rename |old mode|new mode)/.test(l)) c = 'meta';
      else if (l.startsWith('@@')) c = 'hunk';
      else if (l.startsWith('+')) c = 'add';
      else if (l.startsWith('-')) c = 'del';
      return `<span class="dl ${c}">${esc(l)}\n</span>`;
    });
    return `<div class="fmt fmt-diff" data-fmt="diff"><pre>${out.join('')}</pre></div>\n`;
  }

  // ---- terminal：ANSI の色（SGR）。色・太字・薄字・斜体・下線。ほかの制御文字は、捨てる。256 色・24 ビット色の、基本の 16 色以外は、色なし
  // ESC の書き方は、実際の制御文字のほか、\x1b・\u001b・\033・␛・^[ も受ける（AI が、制御文字を書きにくいため）
  const ANSI_RE = /(?:\u001b|\\x1b|\\u001b|\\033|␛|\^\[)\[([0-9;]*)m/g;
  function applySgr(st, params) {
    const codes = params === '' ? [0] : params.split(';').map((n) => Number(n));
    for (let i = 0; i < codes.length; i++) {
      const n = codes[i];
      if (n === 0) { st.fg = st.bg = null; st.b = st.d = st.i = st.u = false; }
      else if (n === 1) st.b = true;
      else if (n === 2) st.d = true;
      else if (n === 3) st.i = true;
      else if (n === 4) st.u = true;
      else if (n === 22) { st.b = false; st.d = false; }
      else if (n === 23) st.i = false;
      else if (n === 24) st.u = false;
      else if (n >= 30 && n <= 37) st.fg = n - 30;
      else if (n >= 90 && n <= 97) st.fg = n - 90 + 8;
      else if (n === 39) st.fg = null;
      else if (n >= 40 && n <= 47) st.bg = n - 40;
      else if (n >= 100 && n <= 107) st.bg = n - 100 + 8;
      else if (n === 49) st.bg = null;
      else if (n === 38 || n === 48) {
        const key = n === 38 ? 'fg' : 'bg';
        if (codes[i + 1] === 5) { const c = codes[i + 2]; st[key] = Number.isInteger(c) && c >= 0 && c < 16 ? c : null; i += 2; }
        else if (codes[i + 1] === 2) { st[key] = null; i += 4; }
      }
    }
  }
  const sgrClass = (st) => [st.fg != null ? `a-f${st.fg}` : '', st.bg != null ? `a-g${st.bg}` : '', st.b ? 'a-b' : '', st.d ? 'a-d' : '', st.i ? 'a-i' : '', st.u ? 'a-u' : ''].filter(Boolean).join(' ');
  function ansiHtml(text) {
    const src = lines(text).join('\n');
    const st = { fg: null, bg: null, b: false, d: false, i: false, u: false };
    let out = '', last = 0, m;
    const clean = (s) => s.replace(/\u001b\[[0-9;?]*[@-~]/g, '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '');
    const emit = (s) => {
      const t = clean(s);
      if (!t) return;
      const cl = sgrClass(st);
      out += cl ? `<span class="${cl}">${esc(t)}</span>` : esc(t);
    };
    ANSI_RE.lastIndex = 0;
    while ((m = ANSI_RE.exec(src))) {
      emit(src.slice(last, m.index));
      applySgr(st, m[1]);
      last = m.index + m[0].length;
    }
    emit(src.slice(last));
    return `<div class="fmt fmt-term" data-fmt="terminal"><pre>${out}</pre></div>\n`;
  }

  // ---- json：折りたためる木。JSON として読めない・大きすぎる（3000 ノード超・深さ 40 超）ときは、null（ふつうのコードブロックにする）
  const JSON_MAX_NODES = 3000, JSON_MAX_DEPTH = 40;
  function jsonHtml(text) {
    let v;
    try { v = JSON.parse(String(text)); } catch (_) { return null; }
    let n = 0;
    let tooBig = false;
    const key = (k) => (k == null ? '' : `<span class="jk">"${esc(k)}"</span><span class="jp">: </span>`);
    const node = (k, val, depth) => {
      if (++n > JSON_MAX_NODES || depth > JSON_MAX_DEPTH) { tooBig = true; return ''; }
      if (val === null) return `<div class="jl">${key(k)}<span class="jb">null</span></div>`;
      if (typeof val === 'string') return `<div class="jl">${key(k)}<span class="js">"${esc(val)}"</span></div>`;
      if (typeof val === 'number') return `<div class="jl">${key(k)}<span class="jn">${esc(val)}</span></div>`;
      if (typeof val === 'boolean') return `<div class="jl">${key(k)}<span class="jb">${val}</span></div>`;
      const isArr = Array.isArray(val);
      const entries = isArr ? val.map((x, i) => [i, x]) : Object.entries(val);
      const [o, c] = isArr ? ['[', ']'] : ['{', '}'];
      if (!entries.length) return `<div class="jl">${key(k)}<span class="jp">${o}${c}</span></div>`;
      const kids = entries.map(([ck, cv]) => node(isArr ? null : ck, cv, depth + 1)).join('');
      const meta = isArr ? `${entries.length} item${entries.length === 1 ? '' : 's'}` : `${entries.length} key${entries.length === 1 ? '' : 's'}`;
      return `<details${depth < 2 ? ' open' : ''}><summary>${key(k)}<span class="jp">${o}</span><span class="jm"> ${meta}</span></summary><div class="jc">${kids}</div><div class="jl"><span class="jp">${c}</span></div></details>`;
    };
    const html = node(null, v, 0);
    if (tooBig) return null;
    return `<div class="fmt fmt-json" data-fmt="json">${html}</div>\n`;
  }

  // ---- trace：手順のタイムライン（ウォーターフォール）。1 行 = 「名前 | 開始 | 長さ | メモ（任意）」。開始・長さは、ミリ秒（数）。
  // 空行と、# で始まる行は、読み飛ばす。読めない行があれば、null（ふつうのコードブロックにする）。最大 200 行
  const fmtMs = (ms) => (ms >= 1000 ? `${Math.round(ms / 10) / 100}s` : `${Math.round(ms * 100) / 100}ms`);
  function traceHtml(text) {
    const rows = [];
    for (const raw of lines(text)) {
      const l = raw.trim();
      if (!l || l.startsWith('#')) continue;
      const cols = l.split('|').map((s) => s.trim());
      const start = Number(cols[1]), dur = Number(cols[2]);
      if (cols.length < 3 || !cols[0] || cols[1] === '' || cols[2] === '' || !Number.isFinite(start) || !Number.isFinite(dur) || start < 0 || dur < 0) return null;
      rows.push({ name: cols[0], start, dur, note: cols.slice(3).join(' | ') });
      if (rows.length > 200) return null;
    }
    if (!rows.length) return null;
    const total = Math.max(...rows.map((r) => r.start + r.dur)) || 1;
    const pct = (v) => Math.round((v / total) * 10000) / 100;
    const body = rows.map((r) => `<div class="tr"><span class="tn">${esc(r.name)}</span><span class="tt"><span class="tb" data-s="${pct(r.start)}" data-w="${pct(r.dur)}"></span></span><span class="td">${esc(fmtMs(r.dur))}</span>${r.note ? `<span class="tm">${esc(r.note)}</span>` : ''}</div>`).join('');
    return `<div class="fmt fmt-trace" data-fmt="trace">${body}<div class="tr tz"><span class="tn"></span><span class="tt"><span class="tl">0</span><span class="tl r">${esc(fmtMs(total))}</span></span></div></div>\n`;
  }

  // コードブロックの言語から、HTML を返す。この形式でない・読めない（JSON が壊れている など）ときは、null
  const KINDS = { diff: diffHtml, patch: diffHtml, terminal: ansiHtml, ansi: ansiHtml, json: jsonHtml, trace: traceHtml };
  function render(lang, text) {
    const f = Object.prototype.hasOwnProperty.call(KINDS, lang) ? KINDS[lang] : null;
    return f ? f(text) : null;
  }
  const LABEL = { diff: '差分', terminal: '端末出力', json: 'JSON', trace: 'トレース' };

  const api = { esc, diffHtml, ansiHtml, jsonHtml, traceHtml, render, LABEL };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RikaiFmt = api;
})(typeof window !== 'undefined' ? window : globalThis);
