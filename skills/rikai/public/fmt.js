'use strict';
// 資料の「形式」：Markdown のコードブロックの種類（```diff・```json・```terminal・```trace）を、HTML の文字列にする。
// DOM に触れない純粋な関数だけ（ブラウザ〔window.RikaiFmt〕と Node のテスト〔require〕の両方から使う）。
// 資料は、AI が書いた、非信頼のデータ。文字は、必ず、ここで escape してから、決まったタグ・クラスの中に入れる（資料の文字が、タグ・属性にならない）。
// ビューアは、このあと、全体を DOMPurify に通す（`style` 属性は使えない。位置・長さは、data-* に数だけで持ち、ビューアが、無害化のあとに設定する）。
// 各行・各項目は、改行で終わる（見た目には出ない）。コメントの引用・AI に届くブロックの文字が、読める形になるように。
(function (root) {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const lines = (text) => String(text == null ? '' : text).replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n');

  // ---- diff：行の種類で、色分け（追加・削除・ハンクの見出し・ファイルの見出し）。ハンクの中では、`---`・`+++` で始まる行も、削除・追加
  function diffHtml(text) {
    let inHunk = false; // 「@@」のあと、次の「diff 」までは、ハンクの中（`--- 古い SQL のコメント` を、ファイルの見出しにしない）
    const ls = lines(text);
    const header = new Set(); // 「diff --git」のない、複数ファイルの差分：ハンクの中でも、「--- 」「+++ 」「@@」の 3 行が続けば、前の 2 行は、ファイルの見出し
    ls.forEach((l, i) => { if (l.startsWith('--- ') && (ls[i + 1] || '').startsWith('+++ ') && (ls[i + 2] || '').startsWith('@@')) { header.add(i); header.add(i + 1); } });
    const out = ls.map((l, i) => {
      let c = 'ctx';
      if (l.startsWith('diff ')) { inHunk = false; c = 'meta'; }
      else if (l.startsWith('@@')) { inHunk = true; c = 'hunk'; }
      else if (l.startsWith('\\')) c = 'meta'; // \ No newline at end of file
      else if (header.has(i) || (!inHunk && /^(index |--- |\+\+\+ |new file|deleted file|similarity |rename |old mode|new mode)/.test(l))) c = 'meta';
      else if (l.startsWith('+')) c = 'add';
      else if (l.startsWith('-')) c = 'del';
      return `<span class="dl ${c}">${esc(l)}\n</span>`;
    });
    return `<div class="fmt fmt-diff" data-fmt="diff"><pre>${out.join('')}</pre></div>\n`;
  }

  // ---- terminal：ANSI の色（SGR）。色・太字・薄字・斜体・下線。ほかの制御文字は、捨てる。256 色・24 ビット色の、基本の 16 色以外は、色なし
  // ESC の書き方は、実際の制御文字のほか、\x1b・\u001b・\033・\e・␛・^[ も受ける（AI が、制御文字を書きにくいため）
  const ESC = '(?:\\u001b|\\\\x1[bB]|\\\\u001[bB]|\\\\033|\\\\e|␛|\\^\\[)';
  const ANSI_RE = new RegExp(`${ESC}\\[([0-9;]*)m`, 'g');
  const OTHER_SEQ_RE = new RegExp(`${ESC}\\[[0-9;?]*[@-~]`, 'g');
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
    const clean = (s) => s.replace(OTHER_SEQ_RE, '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '');
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
    return `<div class="fmt fmt-term" data-fmt="terminal"><pre>${out}\n</pre></div>\n`;
  }

  // ---- json：折りたためる木。**書かれたとおりに見せる**：数・文字列・キーは、元の文字のまま（桁あふれ・`1.50`・`-0`・`\n` の表記・重複したキー・キーの順を、変えない）。
  // JSON として読めない・大きすぎる（3000 ノード超・深さ 40 超）ときは、null（ふつうのコードブロックにする）
  const JSON_MAX_NODES = 3000, JSON_MAX_DEPTH = 40;
  const NUM_OR_LIT = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/y;
  // JSON.parse で、正しいと分かった文字列を、元の文字のまま、木にする（値は、種類と元の文字）
  function parseRaw(src) {
    let i = 0, n = 0;
    const ws = () => { while (i < src.length && ' \t\n\r'.includes(src[i])) i++; };
    const str = () => { const s = i++; while (i < src.length && src[i] !== '"') i += src[i] === '\\' ? 2 : 1; i++; return src.slice(s, i); };
    const value = (depth) => {
      if (++n > JSON_MAX_NODES || depth > JSON_MAX_DEPTH) throw new Error('big');
      ws();
      const c = src[i];
      if (c === '{' || c === '[') {
        const obj = c === '{', close = obj ? '}' : ']', items = [];
        i++; ws();
        if (src[i] === close) { i++; return { t: obj ? 'o' : 'a', items }; }
        for (;;) {
          ws();
          let k = null;
          if (obj) { k = str(); ws(); i++; } // 「:」
          items.push([k, value(depth + 1)]);
          ws();
          if (src[i] === ',') { i++; continue; }
          i++; // 閉じ
          return { t: obj ? 'o' : 'a', items };
        }
      }
      if (c === '"') return { t: 's', raw: str() };
      NUM_OR_LIT.lastIndex = i;
      const m = NUM_OR_LIT.exec(src);
      if (!m) throw new Error('bad');
      i += m[0].length;
      return { t: /^-?\d/.test(m[0]) ? 'n' : 'b', raw: m[0] };
    };
    const v = value(0);
    return v;
  }
  function jsonHtml(text) {
    const src = String(text == null ? '' : text);
    try { JSON.parse(src); } catch (_) { return null; }
    let tree;
    try { tree = parseRaw(src); } catch (_) { return null; }
    const key = (k) => (k == null ? '' : `<span class="jk">${esc(k)}</span><span class="jp">: </span>`);
    const node = (k, v, depth) => {
      if (v.t === 's') return `<div class="jl">${key(k)}<span class="js">${esc(v.raw)}</span>\n</div>`;
      if (v.t === 'n') return `<div class="jl">${key(k)}<span class="jn">${esc(v.raw)}</span>\n</div>`;
      if (v.t === 'b') return `<div class="jl">${key(k)}<span class="jb">${esc(v.raw)}</span>\n</div>`;
      const [o, c] = v.t === 'a' ? ['[', ']'] : ['{', '}'];
      if (!v.items.length) return `<div class="jl">${key(k)}<span class="jp">${o}${c}</span>\n</div>`;
      const kids = v.items.map(([ck, cv]) => node(ck, cv, depth + 1)).join('');
      const len = v.items.length;
      const meta = v.t === 'a' ? `${len} item${len === 1 ? '' : 's'}` : `${len} key${len === 1 ? '' : 's'}`;
      // 個数は、文字でなく、data-n から、CSS で出す（コメントの引用・AI に届く文字に、画面の補助の言葉が入らないように）
      return `<details${depth < 2 ? ' open' : ''}><summary data-n="${meta}">${key(k)}<span class="jp">${o}</span>\n</summary><div class="jc">${kids}</div><div class="jl"><span class="jp">${c}</span>\n</div></details>`;
    };
    return `<div class="fmt fmt-json" data-fmt="json">${node(null, tree, 0)}</div>\n`;
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
      if (cols.length < 3 || !cols[0] || cols[1] === '' || cols[2] === '' || !Number.isFinite(start) || !Number.isFinite(dur) || !Number.isFinite(start + dur) || start < 0 || dur < 0) return null;
      rows.push({ name: cols[0], start, dur, note: cols.slice(3).join(' | ') });
      if (rows.length > 200) return null;
    }
    if (!rows.length) return null;
    const total = Math.max(...rows.map((r) => r.start + r.dur));
    const scale = total || 1;
    const pct = (v) => Math.round((v / scale) * 10000) / 100;
    // 開始・長さ・メモも、文字として持つ（コメントの引用・AI に届く文字から、タイムラインの中身が分かるように）。位置は、data-s・data-w（数）から、ビューアが設定する。
    // 区切りの空白・改行は、**セルの span の中**に入れる（グリッドの子の間の空白は、コメントの強調 <mark> に包まれると、グリッドの項目になって、表示が崩れる）
    const body = rows.map((r) => `<div class="tr"><span class="tn">${esc(r.name)} </span><span class="tt"><span class="tb" data-s="${pct(r.start)}" data-w="${pct(r.dur)}"></span></span><span class="ts">@${esc(fmtMs(r.start))} </span><span class="td">${esc(fmtMs(r.dur))}${r.note ? ' ' : '\n'}</span>${r.note ? `<span class="tm">${esc(r.note)}\n</span>` : ''}</div>`).join('');
    // 軸の目盛り（0 と全体の長さ）は、文字でなく、data-total から、CSS で出す（コメントの引用・AI に届く文字に、入らない）
    return `<div class="fmt fmt-trace" data-fmt="trace">${body}<div class="tr tz"><span class="tn"></span><span class="tt" data-total="${esc(total ? fmtMs(total) : '0')}"></span></div></div>\n`;
  }

  // コードブロックの言語から、HTML を返す。この形式でない・読めない（JSON が壊れている など）ときは、null
  const KINDS = { diff: diffHtml, patch: diffHtml, terminal: ansiHtml, ansi: ansiHtml, json: jsonHtml, trace: traceHtml };
  function render(lang, text) {
    const f = Object.prototype.hasOwnProperty.call(KINDS, lang) ? KINDS[lang] : null;
    return f ? f(text) : null;
  }
  const LABEL = { diff: '差分', terminal: '端末出力', json: 'JSON', trace: 'トレース' };
  const labelOf = (kind) => (Object.prototype.hasOwnProperty.call(LABEL, kind) ? LABEL[kind] : '図表');

  const api = { esc, diffHtml, ansiHtml, jsonHtml, traceHtml, render, labelOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RikaiFmt = api;
})(typeof window !== 'undefined' ? window : globalThis);
