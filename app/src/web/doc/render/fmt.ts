// 資料の「形式」：Markdown のコードブロックの種類（```diff・```json・```terminal・```trace）を、HTML の文字列にする。
// DOM に触れない純粋な関数だけ。
// 資料は、AI が書いた、非信頼のデータ。文字は、必ず、ここで escape してから、決まったタグ・クラスの中に入れる（資料の文字が、タグ・属性にならない）。
// 画面は、このあと、全体を DOMPurify に通す（`style` 属性は使えない。位置・長さは、data-* に数だけで持ち、画面が、無害化のあとに設定する）。
// 各行・各項目は、改行で終わる（見た目には出ない）。コメントの引用・AI に届くブロックの文字が、読める形になるように。

export const esc = (s: unknown): string =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const lines = (text: unknown): string[] =>
  String(text == null ? '' : text)
    .replace(/\r\n?/g, '\n')
    .replace(/\n$/, '')
    .split('\n');

// ---- diff：行の種類で、色分け（追加・削除・ハンクの見出し・ファイルの見出し）。ハンクの中では、`---`・`+++` で始まる行も、削除・追加
export function diffHtml(text: unknown): string {
  let inHunk = false; // 「@@」のあと、次の「diff 」までは、ハンクの中（`--- 古い SQL のコメント` を、ファイルの見出しにしない）
  const ls = lines(text);
  // 「diff --git」のない、複数ファイルの差分：ハンクの中でも、「--- 」「+++ 」「@@」の 3 行が続けば、前の 2 行は、ファイルの見出し
  const header = new Set<number>();
  ls.forEach((l, i) => {
    if (l.startsWith('--- ') && (ls[i + 1] ?? '').startsWith('+++ ') && (ls[i + 2] ?? '').startsWith('@@')) {
      header.add(i);
      header.add(i + 1);
    }
  });
  const out = ls.map((l, i) => {
    let c = 'ctx';
    if (l.startsWith('diff ')) {
      inHunk = false;
      c = 'meta';
    } else if (l.startsWith('@@')) {
      inHunk = true;
      c = 'hunk';
    } else if (l.startsWith('\\'))
      c = 'meta'; // \ No newline at end of file
    else if (
      header.has(i) ||
      (!inHunk && /^(index |--- |\+\+\+ |new file|deleted file|similarity |rename |old mode|new mode)/.test(l))
    )
      c = 'meta';
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
// biome-ignore lint/suspicious/noControlCharactersInRegex: 端末の制御文字を捨てるための正規表現
const CONTROL_RE = /[\u0000-\u0008\u000b-\u001f\u007f]/g;

interface SgrState {
  fg: number | null;
  bg: number | null;
  b: boolean;
  d: boolean;
  i: boolean;
  u: boolean;
}

function applySgr(st: SgrState, params: string): void {
  const codes = params === '' ? [0] : params.split(';').map((n) => Number(n));
  for (let i = 0; i < codes.length; i++) {
    const n = codes[i] as number;
    if (n === 0) {
      st.fg = null;
      st.bg = null;
      st.b = st.d = st.i = st.u = false;
    } else if (n === 1) st.b = true;
    else if (n === 2) st.d = true;
    else if (n === 3) st.i = true;
    else if (n === 4) st.u = true;
    else if (n === 22) {
      st.b = false;
      st.d = false;
    } else if (n === 23) st.i = false;
    else if (n === 24) st.u = false;
    else if (n >= 30 && n <= 37) st.fg = n - 30;
    else if (n >= 90 && n <= 97) st.fg = n - 90 + 8;
    else if (n === 39) st.fg = null;
    else if (n >= 40 && n <= 47) st.bg = n - 40;
    else if (n >= 100 && n <= 107) st.bg = n - 100 + 8;
    else if (n === 49) st.bg = null;
    else if (n === 38 || n === 48) {
      const key = n === 38 ? 'fg' : 'bg';
      if (codes[i + 1] === 5) {
        const c = codes[i + 2];
        st[key] = c !== undefined && Number.isInteger(c) && c >= 0 && c < 16 ? c : null;
        i += 2;
      } else if (codes[i + 1] === 2) {
        st[key] = null;
        i += 4;
      }
    }
  }
}

const sgrClass = (st: SgrState): string =>
  [
    st.fg != null ? `a-f${st.fg}` : '',
    st.bg != null ? `a-g${st.bg}` : '',
    st.b ? 'a-b' : '',
    st.d ? 'a-d' : '',
    st.i ? 'a-i' : '',
    st.u ? 'a-u' : '',
  ]
    .filter(Boolean)
    .join(' ');

export function ansiHtml(text: unknown): string {
  const src = lines(text).join('\n');
  const st: SgrState = { fg: null, bg: null, b: false, d: false, i: false, u: false };
  let out = '';
  let last = 0;
  const clean = (s: string): string => s.replace(OTHER_SEQ_RE, '').replace(CONTROL_RE, '');
  const emit = (s: string): void => {
    const t = clean(s);
    if (!t) return;
    const cl = sgrClass(st);
    out += cl ? `<span class="${cl}">${esc(t)}</span>` : esc(t);
  };
  ANSI_RE.lastIndex = 0;
  for (let m = ANSI_RE.exec(src); m; m = ANSI_RE.exec(src)) {
    emit(src.slice(last, m.index));
    applySgr(st, m[1] ?? '');
    last = m.index + m[0].length;
  }
  emit(src.slice(last));
  return `<div class="fmt fmt-term" data-fmt="terminal"><pre>${out}\n</pre></div>\n`;
}

// ---- json：折りたためる木。**書かれたとおりに見せる**：数・文字列・キーは、元の文字のまま（桁あふれ・`1.50`・`-0`・`\n` の表記・重複したキー・キーの順を、変えない）。
// JSON として読めない・大きすぎる（3000 ノード超・深さ 40 超）ときは、null（ふつうのコードブロックにする）
const JSON_MAX_NODES = 3000;
const JSON_MAX_DEPTH = 40;
const NUM_OR_LIT = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/y;

type RawNode =
  | { t: 'o'; items: [string | null, RawNode][] }
  | { t: 'a'; items: [string | null, RawNode][] }
  | { t: 's'; raw: string }
  | { t: 'n'; raw: string }
  | { t: 'b'; raw: string };

// JSON.parse で、正しいと分かった文字列を、元の文字のまま、木にする（値は、種類と元の文字）
function parseRaw(src: string): RawNode {
  let i = 0;
  let n = 0;
  const ws = (): void => {
    while (i < src.length && ' \t\n\r'.includes(src[i] as string)) i++;
  };
  const str = (): string => {
    const s = i++;
    while (i < src.length && src[i] !== '"') i += src[i] === '\\' ? 2 : 1;
    i++;
    return src.slice(s, i);
  };
  const value = (depth: number): RawNode => {
    if (++n > JSON_MAX_NODES || depth > JSON_MAX_DEPTH) throw new Error('big');
    ws();
    const c = src[i];
    if (c === '{' || c === '[') {
      const obj = c === '{';
      const close = obj ? '}' : ']';
      const items: [string | null, RawNode][] = [];
      i++;
      ws();
      if (src[i] === close) {
        i++;
        return { t: obj ? 'o' : 'a', items };
      }
      for (;;) {
        ws();
        let k: string | null = null;
        if (obj) {
          k = str();
          ws();
          i++; // 「:」
        }
        items.push([k, value(depth + 1)]);
        ws();
        if (src[i] === ',') {
          i++;
          continue;
        }
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
  return value(0);
}

export function jsonHtml(text: unknown): string | null {
  const src = String(text == null ? '' : text);
  try {
    JSON.parse(src);
  } catch {
    return null;
  }
  let tree: RawNode;
  try {
    tree = parseRaw(src);
  } catch {
    return null;
  }
  const key = (k: string | null): string =>
    k == null ? '' : `<span class="jk">${esc(k)}</span><span class="jp">: </span>`;
  const node = (k: string | null, v: RawNode, depth: number): string => {
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
const fmtMs = (ms: number): string =>
  ms >= 1000 ? `${Math.round(ms / 10) / 100}s` : `${Math.round(ms * 100) / 100}ms`;

interface TraceRow {
  name: string;
  start: number;
  dur: number;
  note: string;
}

export function traceHtml(text: unknown): string | null {
  const rows: TraceRow[] = [];
  for (const raw of lines(text)) {
    const l = raw.trim();
    if (!l || l.startsWith('#')) continue;
    const cols = l.split('|').map((s) => s.trim());
    const start = Number(cols[1]);
    const dur = Number(cols[2]);
    if (
      cols.length < 3 ||
      !cols[0] ||
      cols[1] === '' ||
      cols[2] === '' ||
      !Number.isFinite(start) ||
      !Number.isFinite(dur) ||
      !Number.isFinite(start + dur) ||
      start < 0 ||
      dur < 0
    )
      return null;
    rows.push({ name: cols[0], start, dur, note: cols.slice(3).join(' | ') });
    if (rows.length > 200) return null;
  }
  if (!rows.length) return null;
  const total = Math.max(...rows.map((r) => r.start + r.dur));
  const scale = total || 1;
  const pct = (v: number): number => Math.round((v / scale) * 10000) / 100;
  // 開始・長さ・メモも、文字として持つ（コメントの引用・AI に届く文字から、タイムラインの中身が分かるように）。位置は、data-s・data-w（数）から、画面が設定する。
  // 区切りの空白・改行は、**セルの span の中**に入れる（グリッドの子の間の空白は、コメントの強調 <mark> に包まれると、グリッドの項目になって、表示が崩れる）
  const body = rows
    .map(
      (r) =>
        `<div class="tr"><span class="tn">${esc(r.name)} </span><span class="tt"><span class="tb" data-s="${pct(r.start)}" data-w="${pct(r.dur)}"></span></span><span class="ts">@${esc(fmtMs(r.start))} </span><span class="td">${esc(fmtMs(r.dur))}${r.note ? ' ' : '\n'}</span>${r.note ? `<span class="tm">${esc(r.note)}\n</span>` : ''}</div>`,
    )
    .join('');
  // 軸の目盛り（0 と全体の長さ）は、文字でなく、data-total から、CSS で出す（コメントの引用・AI に届く文字に、入らない）
  return `<div class="fmt fmt-trace" data-fmt="trace">${body}<div class="tr tz"><span class="tn"></span><span class="tt" data-total="${esc(total ? fmtMs(total) : '0')}"></span></div></div>\n`;
}

// コードブロックの言語から、HTML を返す。この形式でない・読めない（JSON が壊れている など）ときは、null
const KINDS: Record<string, (text: unknown) => string | null> = {
  diff: diffHtml,
  patch: diffHtml,
  terminal: ansiHtml,
  ansi: ansiHtml,
  json: jsonHtml,
  trace: traceHtml,
};

export function render(lang: string, text: unknown): string | null {
  const f = Object.hasOwn(KINDS, lang) ? KINDS[lang] : undefined;
  return f ? f(text) : null;
}

const LABEL: Record<string, string> = { diff: '差分', terminal: '端末出力', json: 'JSON', trace: 'トレース' };
export const labelOf = (kind: string): string => (Object.hasOwn(LABEL, kind) ? (LABEL[kind] as string) : '図表');
