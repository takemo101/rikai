'use strict';
(() => {
  // ------------------------------------------------------------ 小道具
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'value') el.value = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }
  // DOMPurify は属性値に `-->` や `</style` を含むと属性ごと消すので、図のソースは URI エンコードして持つ
  const encSrc = (s) => encodeURIComponent(String(s));
  const trunc = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  function hash(s) {
    let x = 5381;
    for (let i = 0; i < s.length; i++) x = ((x << 5) + x + s.charCodeAt(i)) | 0;
    return (x >>> 0).toString(36);
  }

  async function api(path, body) {
    const res = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
    let j;
    try { j = await res.json(); } catch (_) { throw Object.assign(new Error('通信エラー'), { status: res.status }); }
    if (!res.ok || j.ok === false) throw Object.assign(new Error(j.error || 'エラー'), { status: res.status });
    return j;
  }

  let toastTimer;
  function toast(msg, isErr) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = isErr ? 'err' : '';
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, isErr ? 6000 : 2800);
  }
  async function act(fn) {
    try { return await fn(); } catch (e) { toast(e.message, true); return null; }
  }

  // 引用・ブロックの探し直しは anchor.js（DOM に触れない関数。Node のテストと共有）
  const { findQuote, locateBlock } = window.RikaiAnchor;
  const { diffText, matchBlocks } = window.RikaiDiff;
  const { progressOf } = window.RikaiProgress;

  // ------------------------------------------------------------ 状態
  const S = {
    topics: [], slug: null, page: 'root', version: null, topic: null,
    md: null, prevMd: null, loaded: '', docSig: '',
    composer: null, active: null, showChanges: true, locs: new Map(), approx: new Map(), nums: new Map(), pendingEl: null, renderTok: 0,
    drafts: { reply: {}, ask: {}, edit: {}, composer: '', imgs: {} }, // imgs：入力欄ごとの、添付した画像の名前（'composer'・`reply-<スレッド>`）。送るまで、画面だけが持つ
    imgGen: {}, uploading: 0, // 入力欄ごとの世代（やめる・送る・移るで進める。終わりが遅れたアップロードを、捨てるため）と、アップロード中の数
    editing: null, seen: new Set(JSON.parse(localStorage.getItem('rikai-seen') || '[]')), offline: false, error: null,
    olderOpen: new Set(), // 「これまでのやり取り」を開いているスレッド（描き直しても、開いたまま）
    askOpen: new Set(), // 答えないまま会話が進んだ質問を、「答える」で開いたもの
    tab: 'live', // 右のパネルの切り替え：'live'（進行中）・'done'（解決済み）・'all'（すべて）
    rowOpen: new Set(), // 解決済みの 1 行を、押して開いたスレッド
    solo: null, // 本文の番号を押して、そのカードだけを見ているスレッド
  };
  const svgCache = new Map();
  let mermaidSeq = 0;

  const pages = () => (S.topic ? S.topic.meta.pages : {});
  const latestOf = (id) => (pages()[id] ? pages()[id].versions : 1);
  const curVersion = () => S.version || latestOf(S.page);
  const isLatest = () => curVersion() === latestOf(S.page);

  // ------------------------------------------------------------ Markdown → 安全な DOM
  const PURIFY = {
    USE_PROFILES: { html: true, svg: true },
    FORBID_TAGS: ['style', 'script', 'iframe', 'form', 'input', 'button', 'textarea', 'select', 'object', 'embed', 'link', 'meta', 'base', 'dialog'],
    FORBID_ATTR: ['style', 'srcset', 'formaction', 'ping'],
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|page):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
  };
  // 実行できる枠（html-app）：資料の ```html-app フェンスを、枠の置き場（div.htmlapp）にする。中身（JavaScript）は、ここでは、扱わない。
  // サーバーが、同じ版の資料から、n 番目のフェンスを取り出して、隔離する CSP つきで配る（/appframe）。n は、資料の本文の描画だけが数える（appCtx）。
  // 返信・前の版の差分では、枠にしない（ふつうのコードブロック）
  let appCtx = null;
  marked.use({
    gfm: true,
    renderer: {
      code({ text, lang }) {
        const kind = (lang || '').trim().split(/\s+/)[0].toLowerCase();
        if (kind === 'mermaid') return `<div class="mermaid-block" data-mermaid="${encSrc(text)}"></div>`;
        if (kind === 'html-app') {
          if (!appCtx) return false;
          const n = appCtx.n++;
          appCtx.srcs[n] = text; // ソースは、ここで持つ（属性に入れない：資料の生の HTML で、偽の data-src を書かれても、ソースの表示・位置づけ・差分に、使わない）
          const m = /\bheight=(\d{2,4})(?:px)?\b/.exec(lang || '');
          const ht = m ? Math.min(1200, Math.max(120, Number(m[1]))) : 360;
          return `<div class="htmlapp" data-n="${n}" data-h="${ht}"><div class="cap">実行できる枠 ${n + 1}（隔離されています。パスワードなどの秘密は、入力しないでください）</div></div>`;
        }
        // diff・json・terminal（ANSI）・trace：決まった形の HTML にする（文字は escape 済み。読めないものは、ふつうのコードブロック）
        const fmt = window.RikaiFmt ? window.RikaiFmt.render(kind, text) : null; // fmt.js が読めないとき（古いサーバー）は、ふつうのコードブロック
        return fmt || false;
      },
    },
  });

  function mdToFragment(md, topic, withApps) {
    appCtx = withApps ? { n: 0, srcs: [] } : null;
    const srcs = appCtx ? appCtx.srcs : [];
    let html;
    try { html = marked.parse(md || ''); } finally { appCtx = null; }
    const clean = DOMPurify.sanitize(html, PURIFY);
    const tpl = document.createElement('template');
    tpl.innerHTML = clean;
    const root = tpl.content;
    // 実行できる枠のソース：無害化のあとに、表（srcs）から、ここで付ける。資料の生の HTML が持つ `data-src` は、上書き・削除する（偽のソースを、見せない）
    for (const el of $$('.htmlapp', root)) {
      const n = Number(el.dataset.n);
      if (Number.isInteger(n) && srcs[n] !== undefined) el.dataset.src = encSrc(srcs[n]); else el.removeAttribute('data-src');
    }
    // trace の棒の位置・長さ：`style` 属性は無害化で消えるので、無害化のあとに、数だけから、ここで設定する
    for (const b of $$('.fmt-trace .tb', root)) {
      const s = Number(b.dataset.s), w = Number(b.dataset.w);
      if (Number.isFinite(s) && Number.isFinite(w)) { b.style.left = `${Math.min(Math.max(s, 0), 100)}%`; b.style.width = `${Math.min(Math.max(w, 0.4), 100)}%`; }
    }
    for (const a of $$('a[href]', root)) {
      const href = a.getAttribute('href');
      if (href.startsWith('page:')) {
        const id = href.slice(5);
        a.setAttribute('href', `#/${topic}/${id}`);
        a.dataset.page = id;
        a.classList.add('pagelink');
      } else if (/^(https?:|mailto:)/i.test(href)) {
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
      } else a.removeAttribute('href');
    }
    for (const img of $$('img', root)) {
      const src = img.getAttribute('src') || '';
      if (/^data:image\//i.test(src)) continue;
      if (/^([a-z][a-z0-9+.\-]*:|\/\/)/i.test(src)) {
        img.replaceWith(h('span', { class: 'img-blocked', text: `[外部画像は表示しません: ${img.alt || src}]` }));
        continue;
      }
      const p = src.replace(/^\.\//, '').replace(/^assets\//, '');
      img.setAttribute('src', `/asset/${encodeURIComponent(topic)}/${p.split('/').map(encodeURIComponent).join('/')}`);
      img.loading = 'lazy';
    }
    return root;
  }

  // 枠の置き場に、隔離した iframe を入れる。**sandbox は allow-scripts だけ**（allow-same-origin を付けない：オリジンのない文書になり、この画面に触れない。
  // ポップアップ・上の画面の移動・フォーム・ダウンロードも、できない）。allow は空（カメラ・位置情報・クリップボードなどを、渡さない）。src は、数だけから組み立てる
  function fillApps(container) {
    // 古いサーバー（0.8 以前）は、/appframe を持たず、画面の CSP も古い。枠は、灰色の四角になるので、説明を出す
    const live = !!(S.topic && S.topic.appframe);
    for (const box of $$('.htmlapp', container)) {
      const n = Number(box.dataset.n);
      if (!Number.isInteger(n) || n < 0) continue;
      const ht = Math.min(1200, Math.max(120, Number(box.dataset.h) || 360));
      // 枠の中は、別の文書なので、枠の上では、入口のバーが出ない（マウスの動きが、画面に届かない）。見出しの行に、コメントのボタンを置く
      const cap = box.querySelector('.cap');
      if (cap && isLatest()) cap.append(' ', h('button', { class: 'link', text: 'この枠にコメント', onclick: () => startComposer(blockAnchor(box)) }));
      if (live) {
        box.append(h('iframe', {
          class: 'appframe', title: `実行できる枠 ${n + 1}`, loading: 'lazy', referrerpolicy: 'no-referrer', sandbox: 'allow-scripts', allow: '',
          src: `/appframe/${encodeURIComponent(S.slug)}/${encodeURIComponent(S.page)}/${curVersion()}/${n}`, height: String(ht),
        }));
      } else {
        box.append(h('div', { class: 'mm-err', text: 'この画面のサーバーが古いため、枠を動かせません。`rikai stop` のあと、`rikai open` で開き直してください。' }));
      }
      // 何が動くかを、見られるように（ソースは、文字として出す）。版が変わったときに、何が変わったか、確かめられる
      let source = '';
      try { source = decodeURIComponent(box.dataset.src || ''); } catch (_) { /* 読めないものは、出さない */ }
      if (source) box.append(h('details', { class: 'appsrc' }, h('summary', { text: 'ソースを見る' }), h('pre', { text: source })));
    }
  }

  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'neutral', fontFamily: 'inherit' });
  async function fillMermaid(container) {
    const jobs = [];
    for (const el of $$('.mermaid-block', container)) {
      const code = decodeURIComponent(el.dataset.mermaid || '');
      if (svgCache.has(code)) { el.innerHTML = svgCache.get(code); continue; }
      jobs.push((async () => {
        const id = `mmd${++mermaidSeq}`;
        try {
          const { svg } = await mermaid.render(id, code);
          svgCache.set(code, svg);
          el.innerHTML = svg;
        } catch (e) {
          const stray = document.getElementById(`d${id}`);
          if (stray) stray.remove();
          el.classList.add('mermaid-error');
          el.replaceChildren(h('div', { class: 'mm-err', text: '図を描画できませんでした' }), h('pre', { text: code }));
        }
      })());
    }
    await Promise.all(jobs);
  }

  // ------------------------------------------------------------ ブロックと本文テキスト
  // 差分の箱（.diffbox）は、ブロックではない（コメントの位置づけ・ブロックの番号に入れない）
  function blockEls(root) {
    const out = [];
    for (const el of root.children) {
      if (el.classList.contains('diffbox')) continue;
      if (el.tagName === 'UL' || el.tagName === 'OL') { for (const li of el.children) if (li.tagName === 'LI' && !li.classList.contains('diffbox')) out.push(li); } else out.push(el);
    }
    return out;
  }
  // ブロックの文字（位置づけ・版の差分に使う）。図は、ソース。**実行できる枠は、ソース**（置き場の見出しの文字は、番号で決まるので、使わない：枠を足す・消すと、コメントが別の枠に付く）
  const blockText = (el) => el.dataset.mermaid || (el.classList.contains('htmlapp') ? `html-app ${safeDecode(el.dataset.src || '')}` : (el.textContent || '').replace(/\s+/g, ' ').trim());
  // 範囲を選べる要素：ブロックの中の、画像（img）と図（svg。Mermaid・AI が書いたインラインの SVG）。最初の 1 つ
  const mediaOf = (el) => (el.matches('img, svg') ? el : el.querySelector('img, svg'));
  // 範囲の基準：ブロックの最初の画像・図。なければ、ブロックそのもの。**壊れた画像**（読み込みが終わって、大きさがない）だけは、ブロックを基準にする。
  // 読み込み前の画像（遅延読み込み）は、画像のまま（大きさがないあいだは、枠を出さない。読み込まれたら、合わせ直す）。範囲の枠を出すときも、同じ基準を使う（保存した比率は、この基準に対するもの）
  const frameOf = (el) => { const m = mediaOf(el); if (!m) return el; return m.tagName.toLowerCase() === 'img' && m.complete && !m.naturalWidth ? el : m; };
  function markBlocks(root) {
    blockEls(root).forEach((el, i) => { el.dataset.bid = `b${i}`; el.dataset.bhash = hash(blockText(el)); el.classList.add('blk'); });
  }

  function textIndex(root) {
    const nodes = [];
    let text = '';
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        const p = n.parentElement;
        if (!p || p.closest('.mermaid-block, .htmlapp, .diffbox, style, script')) return NodeFilter.FILTER_REJECT; // 実行できる枠の、見出し・ソースの文字は、コメントの対象の文字にしない
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let n;
    while ((n = w.nextNode())) { nodes.push({ node: n, start: text.length }); text += n.nodeValue; }
    return { text, nodes };
  }
  function boundaryOffset(idx, node, off) {
    if (node.nodeType === 3) { const e = idx.nodes.find((x) => x.node === node); if (e) return e.start + off; }
    const probe = document.createRange();
    probe.setStart(node, off);
    probe.collapse(true);
    for (const e of idx.nodes) {
      const r = document.createRange();
      r.setStart(e.node, 0);
      r.collapse(true);
      if (probe.compareBoundaryPoints(Range.START_TO_START, r) <= 0) return e.start;
    }
    return idx.text.length;
  }
  const elOf = (n) => (n.nodeType === 1 ? n : n.parentElement);

  function blockLabel(el) {
    if (el.classList.contains('mermaid-block')) return '図';
    if (el.classList.contains('htmlapp')) return '実行できる枠';
    if (el.dataset && el.dataset.fmt) return window.RikaiFmt ? window.RikaiFmt.labelOf(el.dataset.fmt) : '図表';
    const img = el.querySelector && el.querySelector('img');
    if (img) return `画像: ${img.alt || ''}`.trim();
    if (el.tagName === 'TABLE') return '表';
    if (el.tagName === 'PRE') return 'コード';
    return trunc(el.textContent, 40);
  }
  function blockAnchor(el) {
    return {
      blockId: el.dataset.bid || '', blockHash: el.dataset.bhash || '', blockTag: el.tagName, blockText: blockText(el).slice(0, window.RikaiAnchor.EXCERPT),
      quote: '', prefix: '', suffix: '', label: blockLabel(el),
    };
  }
  function anchorFromSelection() {
    const sel = getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed) return null;
    const r = sel.getRangeAt(0);
    const art = $('#article');
    if (!art.contains(r.commonAncestorContainer)) return null;
    const a = elOf(r.startContainer), b = elOf(r.endContainer);
    // 差分の文字から選び始めたときは、コメントを付けない。終わりが、変更したブロックの直後の箱に入っても（三回クリックなど）、始まりが本文なら、受け付ける
    if (a.closest('.diffbox')) return null;
    const mb = a.closest('.mermaid-block') || b.closest('.mermaid-block');
    if (mb) return blockAnchor(mb);
    const idx = textIndex(art);
    let s = boundaryOffset(idx, r.startContainer, r.startOffset);
    let e = boundaryOffset(idx, r.endContainer, r.endOffset);
    while (s < e && /\s/.test(idx.text[s])) s++;
    while (e > s && /\s/.test(idx.text[e - 1])) e--;
    if (e - s > 2000) e = s + 2000;
    if (e <= s) return null;
    const blk = a.closest('[data-bid]');
    return {
      blockId: blk ? blk.dataset.bid : '', blockHash: blk ? blk.dataset.bhash : '',
      quote: idx.text.slice(s, e), prefix: idx.text.slice(Math.max(0, s - 32), s), suffix: idx.text.slice(e, e + 32), label: '',
    };
  }

  // ------------------------------------------------------------ 本文の描画とハイライト
  function wrapRange(art, start, end, tid, cls) {
    const idx = textIndex(art);
    let first = null;
    for (const e of idx.nodes) {
      const len = e.node.nodeValue.length;
      const s = Math.max(start, e.start) - e.start;
      const en = Math.min(end, e.start + len) - e.start;
      if (en <= s) continue;
      const r = document.createRange();
      r.setStart(e.node, s);
      r.setEnd(e.node, en);
      const mark = h('mark', { class: `hl ${cls}`, 'data-tid': tid });
      r.surroundContents(mark);
      if (!first) first = mark;
    }
    return first;
  }

  function threadsOnPage() {
    return S.topic ? S.topic.threads.filter((t) => t.page === S.page) : [];
  }
  const statusClass = (t) => (t.resolved ? 'resolved' : 'live');

  function applyHighlights(art) {
    S.locs = new Map();
    S.approx = new Map();
    const v = curVersion();
    const blocks = blockEls(art);
    const infos = blocks.map((b) => ({ id: b.dataset.bid, hash: b.dataset.bhash, tag: b.tagName, text: blockText(b) }));
    for (const t of threadsOnPage()) {
      if (t.version > v) { S.locs.set(t.id, null); continue; }
      const a = t.anchor;
      if (!a) { S.locs.set(t.id, null); continue; }
      let el = null;
      if (a.quote) {
        const idx = textIndex(art);
        const hit = findQuote(idx.text, a);
        if (hit) el = wrapRange(art, hit.start, hit.end, t.id, statusClass(t));
      } else {
        // 内容が変わったブロックも、近い内容・同じ位置のブロックを、推定として探す（推定は、パネルに印を出す）
        const found = locateBlock(infos, a);
        if (found) {
          el = blocks[found.index];
          el.classList.add('blk-thread', statusClass(t));
          el.dataset.tid = t.id;
          if (found.approx) S.approx.set(t.id, found.approx);
        }
      }
      S.locs.set(t.id, el);
    }
    // 本文の順に番号をつける（右のパネルの、同じ番号のカードと対応する）。
    // 番号の印は、文・ブロック・範囲の、**すべて、同じ見た目・同じ位置**（要素の外の層 #badges の、記事の左の余白に、対象の上端にそろえて、丸く出す。placeBadges）。
    // 要素や文字を足さない（コメントの位置づけに使う本文の文字を、変えない）
    S.nums = new Map();
    S.blkBadges = new Map();
    S.txtBadges = []; // 文の選択のコメント：最初の強調（mark）の、最初の行の高さに出す
    S.regions = []; // 画像・図の中の範囲を、対象にしたコメントの枠（placeBadges が、層に出す。番号は、ほかと同じ、左の余白の丸）
    const located = threadsOnPage().filter((t) => S.locs.get(t.id)).sort(docOrder);
    located.forEach((t, i) => {
      const n = i + 1;
      S.nums.set(t.id, n);
      const marks = $$(`mark.hl[data-tid="${t.id}"]`, art);
      if (marks.length) {
        S.txtBadges.push({ tid: t.id, el: marks[0], n, resolved: !!t.resolved });
      } else {
        // 1 つのブロックに、複数のコメントがあるときは、番号を並べる。カードの番号は、どれも、本文の印と対応する
        const el = S.locs.get(t.id);
        if (!S.blkBadges.has(el)) S.blkBadges.set(el, []);
        S.blkBadges.get(el).push({ tid: t.id, n, resolved: !!t.resolved });
        if (t.anchor && t.anchor.rect) S.regions.push({ tid: t.id, el, rect: t.anchor.rect, resolved: !!t.resolved });
      }
    });
    placeBadges();
    markPending();
  }

  // 入力中のコメントの対象を、本文で強調する（まだ送っていない。オレンジ）。入力欄を開いている間だけ
  function clearPending() {
    const art = $('#article');
    for (const m of $$('mark.hl.pending', art)) m.replaceWith(...m.childNodes);
    for (const e of $$('.blk-pending', art)) e.classList.remove('blk-pending');
    art.normalize();
    S.pendingEl = null;
  }
  function markPending() {
    const art = $('#article');
    if (!S.composer && !S.pendingEl && !art.querySelector('mark.hl.pending, .blk-pending')) return; // 何もなければ、本文に触らない（範囲の入力中は、.blk-pending を付けないので、pendingEl も見る）
    clearPending();
    if (!S.composer) { scheduleBadges(); return; } // 入力中の範囲の枠を、消す
    const a = S.composer.anchor;
    if (a.quote) {
      const hit = findQuote(textIndex(art).text, a);
      if (hit) S.pendingEl = wrapRange(art, hit.start, hit.end, 'pending', 'pending');
    } else {
      const blocks = blockEls(art);
      const found = locateBlock(blocks.map((b) => ({ id: b.dataset.bid, hash: b.dataset.bhash, tag: b.tagName, text: blockText(b) })), a);
      if (found) { S.pendingEl = blocks[found.index]; if (!a.rect) S.pendingEl.classList.add('blk-pending'); } // 範囲は、範囲の枠だけ（ブロックの枠を重ねない）
    }
    scheduleBadges(); // 入力中の範囲の枠（オレンジ）を、出す
  }

  // 差分に使う、ブロックの文字（表は、セルを「 | 」で、行を改行でつなぐ。図は、ソース）
  const safeDecode = (s) => { try { return decodeURIComponent(s); } catch (_) { return s; } }; // AI が書いた HTML の属性が、不正なことがある
  function plainText(el) {
    if (el.classList.contains('mermaid-block')) return safeDecode(el.dataset.mermaid || '');
    if (el.classList.contains('htmlapp')) return safeDecode(el.dataset.src || '');
    if (el.tagName === 'TABLE') return [...el.rows].map((r) => [...r.cells].map((c) => c.textContent.trim()).join(' | ')).join('\n');
    if (el.tagName === 'PRE') return (el.textContent || '').replace(/\n$/, '');
    if (el.dataset && el.dataset.fmt) return (el.textContent || '').replace(/\n+$/, ''); // 形式の各行・各項目は、改行で終わる（fmt.js）。行を、つなげない
    return (el.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function diffBox(ops, tag) {
    const body = h('div', { class: 'diff' }, ops.map((o) => (o.t === 'eq' ? o.s : h(o.t === 'del' ? 'del' : 'ins', { text: o.s }))));
    const details = h('details', { class: tag === 'LI' ? '' : 'diffbox' }, h('summary', { text: '前の版との差分' }), body);
    return tag === 'LI' ? h('li', { class: 'diffbox' }, details) : details;
  }

  // 差分の計画（ブロックの対応づけと、変更ブロックの文字の差分）。同じ版どうしなら同じ結果なので、覚えておく
  // （コメントの操作・スレッドの変更のたびに、前の版の描画と、対応づけを、やり直さない）
  function diffPlan(frag) {
    // 同じ版でも、中身（Markdown）が同じときだけ使う（ページを切り替えながら読み込む途中で、違う中身が、同じ印で入る競合に備える）
    if (S.diffCache && S.diffCache.key === S.loaded && S.diffCache.md === S.md && S.diffCache.prev === S.prevMd) return S.diffCache.plan;
    const prev = mdToFragment(S.prevMd, S.slug, true); // 前の版も、枠の置き場にする（今の版と、同じ形で比べるため。枠は、入れない）
    markBlocks(prev);
    const pe = blockEls(prev), ce = blockEls(frag);
    const info = (els) => els.map((e) => ({ hash: e.dataset.bhash, tag: e.tagName, text: plainText(e) }));
    const pi = info(pe), ci = info(ce);
    const m = matchBlocks(pi, ci);
    const ops = new Map();
    m.cur.forEach((c, j) => { if (c.status === 'changed') ops.set(j, diffText(pi[c.prev].text, ci[j].text)); });
    // 文字のないブロック（画像だけの段落・区切り線）は、ラベルで見せる
    const removed = m.removed.map((i) => pi[i].text || blockLabel(pe[i]) || `（${pe[i].tagName.toLowerCase()}）`);
    const plan = { statuses: m.cur.map((c) => c.status), ops, removed };
    S.diffCache = { key: S.loaded, md: S.md, prev: S.prevMd, plan };
    return plan;
  }

  // 前の版との差分を、frag（今の版のブロック）に足す。戻り値は、件数
  function addDiff(frag) {
    const plan = diffPlan(frag);
    const ce = blockEls(frag);
    const sum = { changed: 0, added: 0, removed: plan.removed.length };
    // ブロックの後ろに箱を足すので、後ろのブロックから処理する（前から足すと、続くブロックの位置が動く）
    for (let j = ce.length - 1; j >= 0; j--) {
      const st = plan.statuses[j];
      if (st === 'same') continue;
      ce[j].classList.add('changed');
      if (st === 'added') { sum.added++; ce[j].classList.add('added'); continue; }
      sum.changed++;
      ce[j].after(diffBox(plan.ops.get(j), ce[j].tagName));
    }
    if (plan.removed.length) {
      frag.append(h('details', { class: 'diffbox removed' },
        h('summary', { text: `前の版からなくなったブロック (${plan.removed.length})` }),
        plan.removed.map((text) => h('div', { class: 'diff' }, h('del', { text })))));
    }
    return sum;
  }

  async function renderDoc() {
    const tok = ++S.renderTok;
    const scroller = $('#docscroll');
    const scroll = scroller.scrollTop;
    const art = $('#article');
    const v = curVersion();
    const frag = mdToFragment(S.md, S.slug, true);
    markBlocks(frag);
    // 件数に、どの版のものかの印（key）を付ける（ページ・版を切り替えた直後に、前のページの件数を見せないため）
    S.diff = S.showChanges && v > 1 && S.prevMd != null ? { ...addDiff(frag), key: S.loaded } : null;
    cancelRegion(); // 範囲を選んでいる途中の枠が、消える要素を指さないように
    art.replaceChildren(frag);
    fillApps(art);
    await fillMermaid(art);
    if (tok !== S.renderTok) return;
    applyHighlights(art);
    scroller.scrollTop = scroll;
    renderDocbar();
    renderThreads();
  }

  const docSigOf = () => JSON.stringify([
    S.slug, S.page, curVersion(), S.showChanges,
    threadsOnPage().map((t) => [t.id, t.resolved, t.version, t.anchor && (t.anchor.quote || t.anchor.blockHash)]),
  ]);

  async function loadPage() {
    const v = curVersion();
    const key = `${S.slug}/${S.page}/${v}`;
    if (S.loaded !== key) {
      const cur = await api(`/api/page/${S.slug}/${S.page}/${v}`);
      S.md = cur.markdown;
      S.prevMd = v > 1 ? (await api(`/api/page/${S.slug}/${S.page}/${v - 1}`)).markdown : null;
      S.loaded = key;
      S.docSig = '';
    }
    const sig = docSigOf();
    if (sig !== S.docSig) { S.docSig = sig; await renderDoc(); }
  }

  // ------------------------------------------------------------ 画面の各部
  function renderTop() {
    const t = S.topic;
    $('#top-title').textContent = t ? t.meta.title : '';
    const btn = $('#btn-submit');
    btn.textContent = t && t.unsent ? `Submit (${t.unsent})` : 'Submit';
    btn.disabled = !t || !t.unsent;
    const st = $('#top-status');
    st.replaceChildren();
    if (t && t.threads.length) {
      const p = progressOf(t.threads);
      st.append(h('span', { class: 'chip', title: '数だけです（人が「理解できた（解決）」にしたスレッドの数と、回答を送信した質問の数。保存しただけの回答は数えません）。理解できたかの判定ではありません', text: `解決 ${p.threads.resolved}/${p.threads.total}${p.asks.total ? `・回答 ${p.asks.answered}/${p.asks.total}` : ''}` }));
    }
    if (S.offline) st.append(h('span', { class: 'chip warn', text: 'サーバーに接続できません' }));
    else if (S.error) st.append(h('span', { class: 'chip warn', title: S.error, text: `サーバーのエラー: ${trunc(S.error, 40)}` }));
    else if (t && t.meta.pending && t.meta.pending.length) {
      st.append(
        h('span', { class: 'chip wait', text: 'AIの返信待ち' }),
        h('span', { class: 'hint', text: 'Claude Code 以外は「rikai に送りました」と伝えてください' }),
        h('button', { class: 'ghost small', text: 'コピー', onclick: () => navigator.clipboard.writeText(`rikai(${S.slug})に送りました。rikai pull ${S.slug} で読んで返信してください`).then(() => toast('コピーしました')) }),
      );
    }
  }

  function renderSide() {
    const side = $('#side');
    side.replaceChildren();
    side.append(h('div', { class: 'side-h', text: '理解の対象' }));
    const ul = h('ul', { class: 'topics' });
    for (const t of S.topics) {
      ul.append(h('li', { class: t.slug === S.slug ? 'cur' : '' },
        t.unsupported
          ? h('span', { class: 'topic-off', text: t.title })
          : h('a', { href: `#/${t.slug}/root`, text: t.title }),
        (() => {
          // 開いているトピックは、画面が持っている最新のスレッドから数える（一覧の更新を待たず、上のバーと食い違わない）
          const p = t.slug === S.slug && S.topic ? progressOf(S.topic.threads) : t.progress;
          return p && p.threads.total ? h('span', { class: 'chip small', title: '解決したスレッド / 全スレッド', text: `${p.threads.resolved}/${p.threads.total}` }) : null;
        })(),
        t.pending ? h('span', { class: 'chip wait small', text: '待ち' }) : null,
        t.unsupported ? h('span', { class: 'chip warn small', title: 'この rikai が読めない、新しい形式です。rikai を更新してください', text: '新しい形式' }) : null,
        t.closed ? h('span', { class: 'chip small', text: '終了' }) : null));
    }
    side.append(ul);
    if (!S.topic) return;
    side.append(h('div', { class: 'side-h', text: 'ページ' }));
    const all = pages();
    const openCount = (id) => S.topic.threads.filter((t) => t.page === id && !t.resolved).length;
    const build = (parent) => {
      const kids = Object.keys(all).filter((id) => (all[id].parent || null) === parent);
      if (!kids.length) return null;
      const u = h('ul', { class: 'tree' });
      for (const id of kids) {
        const n = openCount(id);
        u.append(h('li', {},
          h('a', { href: `#/${S.slug}/${id}`, class: id === S.page ? 'cur' : '' }, all[id].title, h('span', { class: 'ver', text: ` v${all[id].versions}` }), n ? h('span', { class: 'badge', text: n }) : null),
          build(id)));
      }
      return u;
    };
    const tree = build(null);
    if (tree) side.append(tree);
  }

  function renderDocbar() {
    const bar = $('#docbar');
    const hadFocus = document.activeElement && document.activeElement.dataset && document.activeElement.dataset.key === 'chk-changes';
    bar.replaceChildren();
    if (!S.topic) return;
    const all = pages();
    const crumbs = [];
    for (let id = S.page; id; id = all[id] && all[id].parent) crumbs.unshift(id);
    const nav = h('nav', { class: 'crumbs' });
    crumbs.forEach((id, i) => {
      if (i) nav.append(h('span', { class: 'sep', text: '›' }));
      nav.append(id === S.page ? h('span', { class: 'here', text: all[id].title }) : h('a', { href: `#/${S.slug}/${id}`, text: all[id].title }));
    });
    bar.append(nav, h('div', { class: 'spacer' }));
    const n = latestOf(S.page);
    if (n > 1) {
      const sel = h('select', { title: '版', onchange: (e) => { location.hash = `#/${S.slug}/${S.page}${+e.target.value === n ? '' : '/v' + e.target.value}`; } });
      for (let i = n; i >= 1; i--) sel.append(h('option', { value: i, selected: i === curVersion() }, `v${i}${i === n ? '（最新）' : ''}`));
      bar.append(sel);
      if (curVersion() > 1) {
        bar.append(h('label', { class: 'chk' }, h('input', { type: 'checkbox', 'data-key': 'chk-changes', checked: S.showChanges, onchange: (e) => { S.showChanges = e.target.checked; S.docSig = ''; loadPage(); } }), '前の版からの変更を表示'));
        if (S.diff && S.diff.key === `${S.slug}/${S.page}/${curVersion()}`) bar.append(h('span', { class: 'chip', title: '前の版との比較', text: `変更 ${S.diff.changed}・追加 ${S.diff.added}・削除 ${S.diff.removed}` }));
        if (S.showChanges && S.diff && S.diff.key === `${S.slug}/${S.page}/${curVersion()}` && S.diff.changed + S.diff.added > 0) bar.append(h('span', { class: 'legend' }, h('i', { class: 'swatch' }), '緑の線：前の版から変えたところ'));
      }
    }
    if (!isLatest()) {
      bar.append(h('span', { class: 'chip warn', text: `過去の版 v${curVersion()} を表示中（コメントは最新版にだけ付けられます）` }),
        h('a', { class: 'btnlink', href: `#/${S.slug}/${S.page}`, text: '最新版へ' }));
    }
    if (hadFocus) { const c = bar.querySelector('[data-key="chk-changes"]'); if (c) c.focus(); } // 作り直しで、キーボードの位置が外れないように
  }

  // ------------------------------------------------------------ スレッドパネル
  const answerOf = (t, q) => {
    for (let i = t.messages.length - 1; i >= 0; i--) { const m = t.messages[i]; if (m.kind === 'answer' && m.to === q.id) return m; }
    return null;
  };
  const hasUnsent = (t) => t.messages.some((m) => m.author === 'user' && !m.sent);
  const lastMsg = (t) => t.messages[t.messages.length - 1];

  function threadStatus(t) {
    if (t.resolved) return ['解決済み', 'ok'];
    if (hasUnsent(t)) return ['未送信', 'draft'];
    const m = lastMsg(t);
    if (m && m.author === 'ai') return ['AIの返信', 'new'];
    return ['AIの確認待ち', 'wait'];
  }

  function askDraftValid(ask, d) {
    if (!d) return false;
    switch (ask.type) {
      case 'single_choice': return !!(d.choice || (ask.allowOther && (d.other || '').trim()));
      case 'multi_choice': return !!((d.choices && d.choices.length) || (ask.allowOther && (d.other || '').trim()));
      case 'yes_no': return typeof d.value === 'boolean';
      case 'scale': return Number.isInteger(d.value);
      default: return !!(d.text || '').trim();
    }
  }
  const cloneAns = (a) => (a ? JSON.parse(JSON.stringify(a)) : null);

  // 答えないまま、会話が進んだ質問（あとに、**送信した**利用者の発言がある。別の質問への回答は、数えない）：もう、答えを求めない。小さく見せて、「答える」で開く（答えたければ、答えられる）
  const askStale = (t, q) => !answerOf(t, q) && !t.resolved && t.messages.slice(t.messages.indexOf(q) + 1).some((m) => m.author === 'user' && m.sent && m.kind !== 'answer');
  function renderAsk(t, q) {
    const ask = q.ask;
    if (askStale(t, q) && !S.askOpen.has(q.id)) {
      return h('div', { class: 'ask stale' }, h('div', { class: 'ask-q', text: ask.question }),
        h('div', { class: 'ask-foot' }, h('span', { class: 'chip small', text: '答えずに、会話が進みました' }),
          h('button', { class: 'link', text: '答える', onclick: () => { S.askOpen.add(q.id); renderThreads(); } })));
    }
    const saved = answerOf(t, q);
    const locked = !!(saved && saved.sent) || t.resolved;
    if (!(q.id in S.drafts.ask)) S.drafts.ask[q.id] = cloneAns(saved && saved.answer);
    const draftRef = () => S.drafts.ask[q.id] || (S.drafts.ask[q.id] = {});
    const wrap = h('div', { class: 'ask' }, h('div', { class: 'ask-q', text: ask.question }));
    const d = S.drafts.ask[q.id] || {};
    const refresh = () => renderThreads();
    const name = `ask-${q.id}`;

    if (ask.type === 'single_choice' || ask.type === 'multi_choice') {
      const multi = ask.type === 'multi_choice';
      for (const o of ask.options) {
        const checked = multi ? (d.choices || []).includes(o.id) : d.choice === o.id;
        wrap.append(h('label', { class: 'opt' + (checked ? ' on' : '') },
          h('input', {
            type: multi ? 'checkbox' : 'radio', name, checked, disabled: locked,
            onchange: (e) => {
              const dr = draftRef();
              if (multi) {
                const set = new Set(dr.choices || []);
                if (e.target.checked) set.add(o.id); else set.delete(o.id);
                dr.choices = [...set];
              } else { dr.choice = o.id; delete dr.other; }
              refresh();
            },
          }),
          h('span', {}, h('span', { class: 'opt-l', text: o.label }), o.detail ? h('span', { class: 'opt-d', text: o.detail }) : null)));
      }
      if (ask.allowOther) {
        wrap.append(h('label', { class: 'opt other' }, 'その他',
          h('input', {
            type: 'text', 'data-key': `ask-other-${q.id}`, value: d.other || '', disabled: locked, placeholder: '自由入力',
            oninput: (e) => { const dr = draftRef(); dr.other = e.target.value; if (!multi && e.target.value) delete dr.choice; },
            onchange: refresh,
          })));
      }
    } else if (ask.type === 'yes_no') {
      const row = h('div', { class: 'yn' });
      for (const [val, label] of [[true, 'はい'], [false, 'いいえ']]) {
        row.append(h('button', {
          class: 'pill' + (d.value === val ? ' on' : ''), disabled: locked,
          onclick: () => { draftRef().value = val; refresh(); },
        }, label));
      }
      wrap.append(row);
    } else if (ask.type === 'scale') {
      const row = h('div', { class: 'scale' });
      if (ask.minLabel) row.append(h('span', { class: 'sl', text: ask.minLabel }));
      for (let i = ask.min; i <= ask.max; i++) {
        row.append(h('button', { class: 'pill' + (d.value === i ? ' on' : ''), disabled: locked, onclick: () => { draftRef().value = i; refresh(); } }, String(i)));
      }
      if (ask.maxLabel) row.append(h('span', { class: 'sl', text: ask.maxLabel }));
      wrap.append(row);
    } else {
      wrap.append(h('textarea', {
        rows: 3, 'data-key': `ask-text-${q.id}`, value: d.text || '', disabled: locked, placeholder: ask.placeholder || '自分の言葉で',
        oninput: (e) => { draftRef().text = e.target.value; },
        onchange: refresh,
      }));
    }

    const foot = h('div', { class: 'ask-foot' });
    if (locked) {
      if (saved) foot.append(h('span', { class: 'chip ok', text: saved.sent ? '回答を送信済み' : '回答済み' }));
    } else {
      const valid = askDraftValid(ask, S.drafts.ask[q.id]);
      const same = saved && JSON.stringify(saved.answer) === JSON.stringify(S.drafts.ask[q.id]);
      foot.append(h('button', {
        class: 'primary small', disabled: !valid || same, text: same ? '保存済み（未送信）' : '回答を保存',
        onclick: () => act(async () => { await api('/api/answer', { topic: S.slug, thread: t.id, msg: q.id, answer: S.drafts.ask[q.id] }); await refreshTopic(true); }),
      }));
      if (saved) {
        foot.append(h('button', {
          class: 'ghost small', text: '取り消す',
          onclick: () => act(async () => { delete S.drafts.ask[q.id]; await api('/api/answer', { topic: S.slug, thread: t.id, msg: q.id, answer: null }); await refreshTopic(true); }),
        }));
      }
    }
    wrap.append(foot);
    return wrap;
  }

  function renderMessage(t, m) {
    if (m.kind === 'answer') return null;
    const isNew = m.author === 'ai' && !S.seen.has(m.id);
    if (m.author === 'user') {
      const box = h('div', { class: 'msg user' });
      if (S.editing === m.id) {
        box.append(
          h('textarea', { rows: 3, 'data-key': `edit-${m.id}`, value: S.drafts.edit[m.id] != null ? S.drafts.edit[m.id] : m.text, oninput: (e) => { S.drafts.edit[m.id] = e.target.value; } }),
          h('div', { class: 'row' },
            h('button', { class: 'primary small', text: '保存', onclick: () => act(async () => { await api('/api/edit', { topic: S.slug, thread: t.id, msg: m.id, text: S.drafts.edit[m.id] != null ? S.drafts.edit[m.id] : m.text }); S.editing = null; delete S.drafts.edit[m.id]; await refreshTopic(true); }) }),
            h('button', { class: 'ghost small', text: 'キャンセル', onclick: () => { S.editing = null; delete S.drafts.edit[m.id]; renderThreads(); } })));
      } else {
        if (m.text) box.append(h('div', { class: 'body pre', text: m.text }));
        if (m.images && m.images.length) box.append(h('div', { class: 'imgs' }, m.images.map((n) => h('a', { href: imgUrl(n), target: '_blank', rel: 'noopener' }, h('img', { src: imgUrl(n), alt: '添付の画像', loading: 'lazy' })))));
        if (!m.sent) {
          box.append(h('div', { class: 'row meta' },
            h('button', { class: 'link', text: '編集', onclick: () => { S.editing = m.id; renderThreads(); } }),
            h('button', { class: 'link', text: '削除', onclick: () => act(async () => { await api('/api/delete', { topic: S.slug, thread: t.id, msg: m.id }); await refreshTopic(true); }) })));
        }
      }
      return box;
    }
    const box = h('div', { class: 'msg ai' + (isNew ? ' fresh' : '') });
    const body = h('div', { class: 'body md' });
    body.append(mdToFragment(m.text, S.slug));
    fillMermaid(body);
    box.append(h('div', { class: 'who', text: 'AI' }), body);
    if (m.revision) {
      box.append(h('div', { class: 'row meta' }, h('span', { class: 'chip ok small', text: `資料を v${m.revision} に更新` }),
        h('a', { class: 'btnlink', href: `#/${S.slug}/${t.page}/v${m.revision}`, text: `v${m.revision} を見る` })));
    }
    if (m.page && pages()[m.page]) {
      box.append(h('a', { class: 'pagecard', href: `#/${S.slug}/${m.page}` }, h('span', { class: 'pc-l', text: '詳しく見る' }), h('span', { class: 'pc-t', text: pages()[m.page].title }), h('span', { class: 'pc-a', text: '→' })));
    }
    if (m.ask) box.append(renderAsk(t, m));
    return box;
  }

  function renderThread(t, full) { // full：古いやり取りも、たたまない（番号を押して、そのカードだけを見るとき）
    const [stText, stCls] = threadStatus(t);
    const loc = S.locs.get(t.id);
    const orphan = !loc && t.anchor && t.version <= curVersion();
    const future = t.version > curVersion();
    const fresh = t.messages.some((m) => m.author === 'ai' && !S.seen.has(m.id));
    const quote = t.anchor ? (t.anchor.quote || t.anchor.label) : 'AIからの質問';
    const card = h('div', { class: `thread ${stCls}${S.active === t.id ? ' active' : ''}${fresh ? ' fresh' : ''}${linkedTid === t.id ? ' linked' : ''}`, 'data-tid': t.id });
    card.append(h('div', { class: 'th-head', onclick: () => focusThread(t.id, true) },
      S.nums.has(t.id) ? h('span', { class: 'no', title: '本文の、同じ番号の印の所へのコメントです', text: String(S.nums.get(t.id)) }) : null,
      stCls === 'wait' ? null : h('span', { class: `chip ${stCls} small`, text: stText }), // 既定の状態（AI の確認待ち）は、札を出さない
      t.version === curVersion() ? null : h('span', { class: 'chip small', text: `v${t.version}` }), // 版は、いまの版と違うときだけ
      orphan ? h('span', { class: 'chip warn small', text: '修正で文が変わりました' }) : null,
      S.approx.has(t.id) ? h('span', { class: 'chip warn small', text: S.approx.get(t.id) === 'similar' ? '近い内容のブロックに表示' : '同じ位置のブロックに表示' }) : null,
      future ? h('span', { class: 'chip small', text: '後の版のコメント' }) : null,
      h('div', { class: 'quote', text: trunc(quote, 90) })));
    // 回答（kind が answer）は、質問の下の入力欄で見せるので、メッセージとしては描かない（null）。null を append すると、文字「null」が出る
    // 会話が長くなっても、最新のやり取りが、すぐ見えるように：古いやり取りは、折りたたむ。**たたまないもの**：最新の 2 件・最新の AI の発言・最新のユーザーの発言・未送信・編集中・
    // 答えていない質問・まだ見ていない AI の返信（最新の 4 件の中のもの）。**そのあいだの、続く 2 件以上**を、それぞれ「これまでのやり取り（N 件）」にたたむ（たたみが、複数、出ることがある）
    const shown = t.messages.filter((m) => m.kind !== 'answer');
    const lastAi = shown.map((m) => m.author).lastIndexOf('ai'), lastUser = shown.map((m) => m.author).lastIndexOf('user');
    const keep = (m, i) => full || i >= shown.length - 2 || i === lastAi || i === lastUser || (m.author === 'user' && !m.sent) || (m.author === 'ai' && !S.seen.has(m.id) && i >= shown.length - 4) || S.editing === m.id || (m.ask && !answerOf(t, m) && !askStale(t, m));
    let run = [];
    const flush = () => {
      if (run.length >= 2) {
        const key = `${t.id}:${run[0].id}`; // 開いた状態の鍵：スレッドと、その続きの、最初のメッセージ
        card.append(h('details', { class: 'older', open: S.olderOpen.has(key), ontoggle: (e) => { if (e.target.open) S.olderOpen.add(key); else S.olderOpen.delete(key); } },
          h('summary', { text: `これまでのやり取り（${run.length} 件）` }),
          run.map((m) => renderMessage(t, m))));
      } else for (const m of run) { const el = renderMessage(t, m); if (el) card.append(el); }
      run = [];
    };
    shown.forEach((m, i) => { if (keep(m, i)) { flush(); const el = renderMessage(t, m); if (el) card.append(el); } else run.push(m); });
    flush();
    const foot = h('div', { class: 'th-foot' });
    if (!t.resolved) {
      foot.append(
        h('textarea', {
          rows: 2, 'data-key': `reply-${t.id}`, placeholder: '返信・追加の質問（⌘/Ctrl+Enter で追加。画像は、貼り付け・ドラッグでも）', value: S.drafts.reply[t.id] || '',
          oninput: (e) => { S.drafts.reply[t.id] = e.target.value; },
          onkeydown: (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); sendReply(t); } },
          ...imageHandlers(`reply-${t.id}`),
        }),
        imageBar(`reply-${t.id}`),
        h('div', { class: 'row' },
          h('button', { class: 'primary small', text: '返信を追加', onclick: () => sendReply(t) }),
          h('button', { class: 'ghost small', text: '理解できた（解決）', onclick: () => act(async () => { await api('/api/resolve', { topic: S.slug, thread: t.id, resolved: true }); await refreshTopic(true); }) })));
    } else {
      foot.append(h('button', { class: 'ghost small', text: '再開する', onclick: () => act(async () => { await api('/api/resolve', { topic: S.slug, thread: t.id, resolved: false }); await refreshTopic(true); }) }));
    }
    card.append(foot);
    return card;
  }

  // ------------------------------------------------------------ 画像の添付（コメント・返信）
  // 貼り付け（⌘/Ctrl+V。OS のスクリーンショットも）・ドラッグ・ファイル選択で付ける。付けた時点で、サーバーが assets/ に保存し、名前を返す。
  // 送るまでは、×で外せる（外しても、保存したファイルは残る。同じ画像は、同じ名前なので、増えない）。形式・大きさ・枚数の最終の検査は、サーバー
  const IMG_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
  const IMG_MAX_MB = 5, IMG_MAX_N = 4;
  const imgUrl = (name) => `/asset/${encodeURIComponent(S.slug)}/${encodeURIComponent(name)}`;
  const draftImgs = (key) => S.drafts.imgs[key] || (S.drafts.imgs[key] = []);
  // 入力欄の画像を空にする（やめる・送る・別の対象へ移る）。世代を進めて、まだ終わっていないアップロードの結果は、捨てる
  const resetImgs = (key) => { S.drafts.imgs[key] = []; S.imgGen[key] = (S.imgGen[key] || 0) + 1; };
  const readBase64 = (file) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
  // 付けられた画像の名前の一覧を返す（付けなかったものは、入らない）
  async function attachFiles(key, files, stillValid) { // stillValid：付ける直前に、まだ付けてよいか（範囲の切り出しが、別の対象に付かないように）
    const added = [];
    for (const f of files) {
      if (!IMG_TYPES.includes(f.type)) { toast('画像は、png・jpeg・gif・webp だけ付けられます', true); continue; }
      if (f.size > IMG_MAX_MB * 1024 * 1024) { toast(`画像が大きすぎます（${IMG_MAX_MB}MB まで）`, true); continue; }
      if (draftImgs(key).length >= IMG_MAX_N) { toast(`画像は ${IMG_MAX_N} 枚までです`, true); break; }
      const slug = S.slug, gen = S.imgGen[key] || 0;
      S.uploading++;
      renderThreads();
      let r;
      try { r = await act(async () => api('/api/attach', { topic: slug, data: await readBase64(f) })); } finally { S.uploading--; }
      // 終わるまでに、入力欄をやめた・送った・別のトピックへ移った、なら、この画像は、付けない（別の入力欄に、出ないように）。
      // 続けて何枚も貼ると、上の枚数の検査は、完了を待たずに通るので、付ける直前に、もう一度、上限を見る
      if (r && slug === S.slug && gen === (S.imgGen[key] || 0) && (!stillValid || stillValid()) && !draftImgs(key).includes(r.name) && draftImgs(key).length < IMG_MAX_N) { draftImgs(key).push(r.name); added.push(r.name); }
    }
    renderThreads();
    return added;
  }
  // 入力欄の外にファイルを落としても、ブラウザが、そのファイルを開いて、画面（書きかけの文）を失わないようにする
  for (const t of ['dragover', 'drop']) document.addEventListener(t, (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
  // 入力欄（textarea）に付ける、貼り付け・ドラッグの受け口。文字の貼り付けは、そのまま通す（画像だけのときだけ、受ける）
  const imageHandlers = (key) => ({
    onpaste: (e) => {
      const cd = e.clipboardData;
      const files = cd ? [...cd.files].filter((f) => f.type.startsWith('image/')) : [];
      if (!files.length || [...cd.types].includes('text/plain')) return;
      e.preventDefault();
      attachFiles(key, files);
    },
    ondragover: (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault(); },
    ondrop: (e) => {
      const files = e.dataTransfer ? [...e.dataTransfer.files] : [];
      if (!files.length) return;
      e.preventDefault();
      attachFiles(key, files);
    },
  });
  function imageBar(key) {
    const names = draftImgs(key);
    const input = h('input', { type: 'file', accept: IMG_TYPES.join(','), multiple: true, hidden: true, onchange: (e) => { const files = [...e.target.files]; e.target.value = ''; attachFiles(key, files); } });
    return h('div', { class: 'imgbar' },
      names.map((n) => h('span', { class: 'thumb' },
        h('img', { src: imgUrl(n), alt: '添付の画像' }),
        h('button', { class: 'x', title: '外す', 'aria-label': '画像を外す', text: '×', onclick: () => { S.drafts.imgs[key] = names.filter((x) => x !== n); renderThreads(); } }))),
      h('button', { class: 'ghost small attach', text: '画像を付ける', title: 'ファイルを選ぶ。貼り付け（⌘/Ctrl+V）・ドラッグでも付けられます', onclick: () => input.click() }),
      S.uploading ? h('span', { class: 'sl', text: 'アップロード中…' }) : null,
      input);
  }

  async function sendReply(t) {
    const key = `reply-${t.id}`;
    const text = (S.drafts.reply[t.id] || '').trim();
    const images = draftImgs(key);
    if (S.uploading) { toast('画像のアップロード中です。終わってから、送ってください', true); return; }
    if (!text && !images.length) return;
    await act(async () => { await api('/api/reply', { topic: S.slug, thread: t.id, text, images }); S.drafts.reply[t.id] = ''; resetImgs(key); await refreshTopic(true); });
  }

  function docOrder(a, b) {
    const ea = S.locs.get(a.id), eb = S.locs.get(b.id);
    if (ea && eb) return ea.compareDocumentPosition(eb) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    if (ea) return -1;
    if (eb) return 1;
    return 0;
  }

  // 入力欄を入れる位置（live の何番目の前か）。対象が本文の中で見つからないときは、先頭
  function composerSlot(live) {
    if (!S.composer) return -1;
    const p = S.pendingEl;
    if (!p) return 0;
    const i = live.findIndex((t) => { const e = S.locs.get(t.id); return e && (p.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING); });
    return i >= 0 ? i : live.filter((t) => S.locs.get(t.id)).length;
  }

  // 解決済みのスレッドは、1 行（番号・対象・最後の発言のはじめ）で見せる。押すと、カードが開く
  function renderDoneRow(t) {
    const quote = t.anchor ? (t.anchor.quote || t.anchor.label) : 'AIからの質問';
    const last = t.messages.filter((m) => m.kind !== 'answer' && m.text).pop();
    return h('button', { type: 'button', class: 'donerow', 'data-tid': t.id, title: '押すと、このコメントが開きます', onclick: () => { S.rowOpen.add(t.id); renderThreads(); focusThread(t.id, false); } },
      S.nums.has(t.id) ? h('span', { class: 'no resolved', text: String(S.nums.get(t.id)) }) : null,
      h('span', { class: 'dr-q', text: trunc(quote, 30) }),
      h('span', { class: 'dr-last', text: last ? `${last.author === 'ai' ? 'AI' : 'あなた'}：${trunc(last.text, 48)}` : '' }));
  }

  function renderThreads() {
    const panel = $('#threads');
    // 入力中の欄を覚えておき、描き直したあとに戻す
    const ae = document.activeElement;
    const keep = ae && ae.dataset && ae.dataset.key ? { key: ae.dataset.key, s: ae.selectionStart, e: ae.selectionEnd } : null;
    const scroll = panel.scrollTop;
    panel.replaceChildren();
    regbtn.hidden = !S.topic || !isLatest(); // 範囲を選ぶボタンは、最新版を開いているときだけ
    if (!S.topic) return;
    const head = h('div', { class: 'side-h panel-h' }, 'コメント');
    panel.append(head);
    markPending(); // 入力中の対象を本文で強調し、その位置を決めてから、入力欄を並べる
    const list = threadsOnPage();
    const live = list.filter((t) => !t.resolved).sort(docOrder);
    const done = list.filter((t) => t.resolved).sort(docOrder);
    if (S.solo && !list.some((t) => t.id === S.solo)) S.solo = null; // 別のページ・版へ移った
    if (S.solo) { // 本文の番号を押した：そのカードだけを、古いやり取りもたたまずに見せる
      const t = list.find((x) => x.id === S.solo);
      panel.append(h('div', { class: 'solobar' },
        h('button', { class: 'link', type: 'button', text: '← すべてのコメントに戻る', onclick: () => { S.solo = null; renderThreads(); } }),
        h('span', { class: 'hint', text: S.nums.has(t.id) ? `${S.nums.get(t.id)} 番のコメントだけを表示中` : 'このコメントだけを表示中' })));
      if (S.composer) panel.append(renderComposer());
      panel.append(renderThread(t, true));
    } else {
      if (!list.length && !S.composer) panel.append(h('div', { class: 'empty', text: '本文の文を選ぶと「コメント」が出ます。ブロックにマウスを置くと出るバーの「コメント」でも、付けられます。本文の好きな範囲は、右下の「範囲を選ぶ」から、ドラッグで選べます。' }));
      if (list.length) { // 進行中・解決済み・すべて
        panel.append(h('div', { class: 'tabs', role: 'tablist' }, [['live', '進行中', live.length], ['done', '解決済み', done.length], ['all', 'すべて', list.length]].map(([k, label, n]) =>
          h('button', { type: 'button', role: 'tab', class: `tab${S.tab === k ? ' on' : ''}`, 'aria-selected': String(S.tab === k), onclick: () => { S.tab = k; renderThreads(); } }, label, h('span', { class: 'n', text: String(n) })))));
      }
      const showLive = S.tab !== 'done', showDone = S.tab !== 'live';
      // 入力欄は、対象の位置の順に、スレッドの間へ入れる（いつも一番上、にしない）。進行中を出さない切り替えのときは、一番上
      const slot = composerSlot(live);
      if (showLive) {
        live.forEach((t, i) => { if (i === slot) panel.append(renderComposer()); panel.append(renderThread(t)); });
        if (S.composer && slot >= live.length) panel.append(renderComposer());
        if (!live.length && list.length && S.tab === 'live') panel.append(h('div', { class: 'empty', text: '進行中のコメントは、ありません。' }));
      } else if (S.composer) panel.append(renderComposer());
      if (showDone) {
        for (const t of done) panel.append(S.rowOpen.has(t.id)
          ? h('div', { class: 'rowopen' }, renderThread(t), h('button', { class: 'link', type: 'button', text: '一覧の 1 行に戻す', onclick: () => { S.rowOpen.delete(t.id); renderThreads(); } }))
          : renderDoneRow(t));
        if (!done.length && S.tab === 'done') panel.append(h('div', { class: 'empty', text: '解決済みのコメントは、ありません。' }));
      }
    }
    panel.scrollTop = scroll;
    if (keep) {
      const el = panel.querySelector(`[data-key="${CSS.escape(keep.key)}"]`);
      if (el) { el.focus(); try { el.setSelectionRange(keep.s, keep.e); } catch (_) {} }
    }
  }

  function renderComposer() {
    const a = S.composer.anchor;
    const submit = async () => {
      const text = (S.drafts.composer || '').trim();
      const images = draftImgs('composer');
      if (S.uploading) { toast('画像のアップロード中です。終わってから、送ってください', true); return; }
      if (!text && !images.length) return;
      const r = await act(() => api('/api/comment', { topic: S.slug, page: S.page, version: curVersion(), anchor: a, text, images }));
      if (!r) return;
      S.composer = null;
      S.drafts.composer = '';
      resetImgs('composer');
      S.active = r.thread;
      await refreshTopic(true);
      focusThread(r.thread, false);
    };
    return h('div', { class: 'thread composer' },
      h('div', { class: 'th-head' }, h('span', { class: 'no pending', title: '本文の、オレンジの部分へのコメントです', text: '新' }), h('div', { class: 'quote', text: trunc(a.quote || a.label, 90) }),
        S.pendingEl ? h('div', { class: 'hint', text: a.rect ? '本文の、オレンジの枠へのコメントです（枠は、ドラッグで動かし、角・辺で大きさを変えられます）' : '本文の、オレンジの部分へのコメントです' }) : null),
      h('textarea', {
        rows: 3, 'data-key': 'composer', placeholder: 'わからない点・確認したい点・直してほしい点（⌘/Ctrl+Enter で追加。画像は、貼り付け・ドラッグでも）', value: S.drafts.composer,
        oninput: (e) => { S.drafts.composer = e.target.value; },
        onkeydown: (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); submit(); } },
        ...imageHandlers('composer'),
      }),
      imageBar('composer'),
      h('div', { class: 'row' },
        h('button', { class: 'primary small', text: 'コメントを追加', onclick: submit }),
        h('button', { class: 'ghost small', text: 'やめる', onclick: () => { S.composer = null; S.drafts.composer = ''; resetImgs('composer'); renderThreads(); } })));
  }

  function startComposer(anchor) {
    if (!isLatest()) { toast('コメントは最新版にだけ付けられます', true); return; }
    // 前の入力欄が、範囲の切り出し画像を、自動で付けていたら、外す（対象が変わるので、別の範囲の画像を、送らない）。
    // 切り出しのアップロードが、まだ終わっていないときは、finishRegion が、入力欄が同じものかを確かめて、捨てる（ユーザー自身の画像は、捨てない）
    const prevCrop = S.composer && S.composer.regionImg;
    if (prevCrop) S.drafts.imgs.composer = draftImgs('composer').filter((n) => n !== prevCrop);
    S.composer = { anchor };
    renderThreads();
    const ta = $('[data-key="composer"]');
    if (ta) ta.focus();
    const card = $('.thread.composer');
    if (card) card.scrollIntoView({ block: 'center', behavior: 'smooth' });
    getSelection().removeAllRanges();
    hideActbar();
  }

  function focusThread(tid, scrollDoc) {
    const t0 = S.topic.threads.find((t) => t.id === tid);
    if (t0 && t0.resolved && !S.solo && (S.tab === 'live' || !S.rowOpen.has(tid))) { // 解決済みを、本文から選んだ：一覧の中で、開いて見せる
      if (S.tab === 'live') S.tab = 'all';
      S.rowOpen.add(tid);
      renderThreads();
    }
    S.active = tid;
    for (const m of (S.topic.threads.find((t) => t.id === tid) || { messages: [] }).messages) if (m.author === 'ai') S.seen.add(m.id);
    localStorage.setItem('rikai-seen', JSON.stringify([...S.seen].slice(-2000)));
    $$('.hl.active, .blk-thread.active').forEach((e) => e.classList.remove('active'));
    $$(`[data-tid="${tid}"]`, $('#article')).forEach((e) => e.classList.add('active'));
    const el = S.locs.get(tid);
    if (scrollDoc && el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    $$('.thread.active').forEach((e) => e.classList.remove('active'));
    const card = $(`.thread[data-tid="${tid}"]`);
    if (card) { card.classList.add('active'); card.classList.remove('fresh'); if (!scrollDoc) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
  }

  // ------------------------------------------------------------ データ取得とルーティング
  function parseHash() {
    const m = /^#\/([a-z0-9-]+)(?:\/([a-z0-9-]+))?(?:\/v(\d+))?$/.exec(location.hash);
    return m ? { slug: m[1], page: m[2] || 'root', version: m[3] ? Number(m[3]) : null } : null;
  }

  // 終えたトピックは、全面の表示で覆う。ほかに開いているトピックがあれば、そこへ移れるようにする
  function renderEnded() {
    const closed = !!(S.topic && S.topic.meta.closed);
    $('#ended').hidden = !closed;
    const others = closed ? S.topics.filter((t) => t.slug !== S.slug && !t.closed && !t.unsupported) : [];
    // 変わっていなければ、作り直さない（作り直すと、Tab で選んだリンクの選択が外れ、押している最中のクリックが外れうる）
    const key = JSON.stringify([closed, others.map((t) => [t.slug, t.title])]);
    if (key === S.endedKey) return;
    S.endedKey = key;
    if (!closed) return;
    const body = others.length
      ? [h('p', { text: 'ほかに、開いているトピックがあります。' }), h('ul', { class: 'ended-list' }, others.map((t) => h('li', {}, h('a', { href: `#/${t.slug}/root`, text: t.title }))))]
      : [h('p', {}, 'このタブは閉じて構いません。続きはもう一度 ', h('code', { text: '/rikai' }), ' で開けます。')];
    $('#ended-box').replaceChildren(h('h2', { text: 'このトピックのレビューを終了しました' }), ...body);
  }

  function renderAll() {
    renderTop();
    renderSide();
    renderDocbar();
    renderThreads();
    renderEnded();
  }

  async function refreshTopic(force) {
    if (!S.slug) return;
    const d = await api(`/api/topic/${S.slug}${!force && S.topic ? `?since=${S.topic.rev}` : ''}`);
    if (d.unchanged) return;
    const prevLatest = S.topic && pages()[S.page] ? latestOf(S.page) : null;
    S.topic = d;
    if (!pages()[S.page]) { S.page = 'root'; S.version = null; }
    renderAll();
    await loadPage();
    renderDocbar();
    if (prevLatest && !S.version && latestOf(S.page) > prevLatest) toast(`資料が v${latestOf(S.page)} に更新されました`);
  }

  async function route() {
    const r = parseHash();
    S.topics = await api('/api/topics');
    renderSide(); // 先に描く（読めないトピックが先頭でも、ほかのトピックへ移れるように）
    if (!r) {
      const first = S.topics.find((t) => !t.unsupported);
      if (!first) {
        $('#article').textContent = S.topics.length
          ? '読めるトピックがありません（新しい形式のトピックだけです）。rikai を更新してください。'
          : 'トピックがありません。/rikai で資料を作ってください。';
        return;
      }
      location.hash = `#/${first.slug}/root`;
      return;
    }
    const target = S.topics.find((t) => t.slug === r.slug);
    if (target && target.unsupported) {
      // 読めない形式のトピックは、開かず、見ない（サーバーが 409 を返し続けるので、確認もしない）
      S.slug = null; S.topic = null; S.composer = null;
      renderAll();
      $('#article').textContent = `「${target.title}」は、この rikai が読めない新しい形式です。rikai を更新してください。`;
      return;
    }
    const changed = r.slug !== S.slug || r.page !== S.page || r.version !== S.version;
    // 見ているページ・版が、実質、変わらないなら（最新版を「/v2」と明示して移った、など）、入力欄は閉じない
    const sameView = r.slug === S.slug && r.page === S.page && (r.version || latestOf(r.page)) === curVersion();
    if (r.slug !== S.slug) { S.topic = null; S.drafts.imgs = {}; } // 添付した画像は、そのトピックの assets/ にある。別のトピックの入力欄へ持ち越さない
    if (!sameView && S.composer) { S.composer = null; S.drafts.composer = ''; resetImgs('composer'); } // 別のページ・版へ移ったら、入力中の対象（本文の位置）は、意味を失う。書きかけの文・画像も、別の対象に出ないよう消す
    S.slug = r.slug; S.page = r.page; S.version = r.version;
    if (changed) { S.loaded = ''; S.active = null; }
    await act(async () => { await refreshTopic(true); });
    $('#docscroll').scrollTop = 0;
  }

  async function tick() {
    try {
      S.topics = await api('/api/topics');
      renderSide();
      renderEnded();
      await refreshTopic(false);
      if (S.offline || S.error) { S.offline = false; S.error = null; renderTop(); }
    } catch (e) {
      // 接続できない（fetch の失敗。status がない）と、サーバーが答えたエラー（status がある）は、別の状態として見せる
      const next = e.status ? { offline: false, error: e.message } : { offline: true, error: null };
      if (S.offline !== next.offline || S.error !== next.error) { Object.assign(S, next); renderTop(); }
    }
  }

  // ------------------------------------------------------------ 選択・ブロックのコメント入口
  const actbar = $('#actbar');
  let actMode = null; // 'sel'（文を選んだとき）・'blk'（ブロックにマウスを置いたとき）・null（出していない）
  let pendingAnchor = null;
  let blkTarget = null;
  let blkHide;

  // 入口は、バーの「コメント」。文を選ぶと、選んだ文の上に・ブロックにマウスを置くと、そのブロックの右上に出る（範囲は、右下に浮かぶ「範囲を選ぶ」）
  function showActbar(mode, right, top) { // right：バーの右端・top：上端（画面の座標）
    actMode = mode;
    actbar.hidden = false;
    const w = actbar.offsetWidth;
    actbar.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, right - w))}px`;
    actbar.style.top = `${Math.max(8, top)}px`;
  }
  function hideActbar() { actbar.hidden = true; actMode = null; }
  actbar.addEventListener('mousedown', (e) => e.preventDefault()); // 押しても、文の選択を外さない
  $('#act-comment').addEventListener('click', () => {
    const a = actMode === 'sel' ? pendingAnchor : (blkTarget && blockAnchor(blkTarget));
    hideActbar();
    if (a) startComposer(a);
  });
  // 範囲を選ぶ入口は、本文の右下に浮かぶボタン（いつも同じ場所。押すと選ぶ状態になり、もう一度押すと、やめる）
  const regbtn = $('#regbtn');
  regbtn.addEventListener('mousedown', (e) => e.preventDefault()); // 押しても、文の選択を外さない
  regbtn.addEventListener('click', () => { hideActbar(); if (regState) cancelRegion(); else startRegionSelect(); });
  actbar.addEventListener('mouseenter', () => clearTimeout(blkHide));
  actbar.addEventListener('mouseleave', () => { if (actMode === 'blk') scheduleBlkHide(); });

  document.addEventListener('mouseup', (e) => {
    if (actbar.contains(e.target)) return;
    setTimeout(() => {
      const sel = getSelection();
      const a = sel && !sel.isCollapsed && isLatest() && !regState ? anchorFromSelection() : null;
      if (!a) { pendingAnchor = null; if (actMode === 'sel') hideActbar(); return; }
      pendingAnchor = a;
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      showActbar('sel', rect.right + 24, rect.top - 38);
    }, 0);
  });
  document.addEventListener('mousedown', (e) => { if (!actbar.contains(e.target) && actMode === 'sel') hideActbar(); });

  // ブロックにマウスを置くと、入口のバーを、そのブロックの右上（ブロックの上）に出す。バーへ向かう間に消えない・別のブロックへ飛ばないように、
  // ポインタが「そのブロックの、バーの高さ上〜下端 × 箱の右端まで」の帯にいる間は、同じブロックのまま出し続ける。
  // 帯の外でも、本文の箱の右の余白にいる間は、同じ高さにある本文のブロックを探す（左の余白は、探さない）。
  function scheduleBlkHide() {
    clearTimeout(blkHide);
    blkHide = setTimeout(hideBlkBtns, 350);
  }
  function blockAt(x, y) {
    const art = $('#article').getBoundingClientRect();
    const m = Math.min(48, art.width / 2);
    const px = Math.min(Math.max(x, art.left + m), art.right - m);
    const el = document.elementFromPoint(px, y);
    return el && el.closest ? el.closest('#article [data-bid]') : null;
  }
  function inBand(blk, x, y) {
    const r = blk.getBoundingClientRect();
    const art = $('#article').getBoundingClientRect();
    if (y >= r.top - 4 && y <= r.bottom + 4 && x >= r.left - 8 && x <= art.right + 8) return true;
    // バーの上（と、そのまわり 6px）も、同じブロック。バーは、前のブロックの右端に少し重なるので、バーの外側の、前のブロックには、移れる
    const b = actbar.getBoundingClientRect();
    return actMode === 'blk' && x >= b.left - 6 && x <= b.right + 6 && y >= b.top - 6 && y <= b.bottom + 6;
  }
  function placeBlkBtn(blk) {
    const r = blk.getBoundingClientRect();
    const art = $('#article').getBoundingClientRect();
    const top = $('#docscroll').getBoundingClientRect().top + 4; // 本文の領域の上端（上のバーに、重ねない）
    showActbar('blk', art.right - 8, Math.max(r.top - 30, top));
  }
  $('#docscroll').addEventListener('mousemove', (e) => {
    if (!isLatest() || regState || actMode === 'sel' || S.composer) return; // 入力欄を開いている間は、ブロックのバーを出さない（入力欄・選んだ範囲の上に、重ならないように）
    if (blkTarget && actMode === 'blk' && inBand(blkTarget, e.clientX, e.clientY)) { clearTimeout(blkHide); return; }
    const blk = blockAt(e.clientX, e.clientY);
    if (!blk) { scheduleBlkHide(); return; }
    clearTimeout(blkHide);
    blkTarget = blk;
    placeBlkBtn(blk);
  });
  $('#docscroll').addEventListener('scroll', hideBlkBtns);
  $('#docscroll').addEventListener('mouseleave', () => scheduleBlkHide());

  // ------------------------------------------------------------ 本文の、好きな範囲を選んで、コメントする
  // 右下の「範囲を選ぶ」を押すと、本文の上のどこでも、ドラッグで範囲を選べる（文・表・コード・図・画像・複数のブロックにまたがってもよい）。
  // 範囲は、**左上にあるブロック**（画像・図があれば、その最初の画像・図）の大きさに対する比率（{x,y,w,h}。左上が原点）で持つ。範囲が、そのブロックの外へ出れば、0〜1 を超える。
  // 切り出した画像は、コメントの画像として添付する（AI には、画像のファイルの場所と、範囲の比率〔region〕が届く）。コメントの探し直しは、ブロックの位置づけと同じ（範囲は、ブロックの中の位置）
  function hideBlkBtns() { if (actMode === 'blk') hideActbar(); }
  const regsel = $('#regsel');
  let regState = null;
  function cancelRegion() { regState = null; regsel.hidden = true; regsel.replaceChildren(); regbtn.classList.remove('on'); regbtn.querySelector('.lbl').textContent = '範囲を選ぶ'; }
  function startRegionSelect() {
    if (regState) return;
    if (!isLatest()) { toast('コメントは最新版にだけ付けられます', true); return; }
    const art = $('#article');
    if (!art.querySelector('[data-bid]')) { toast('範囲を選べる本文がありません', true); return; }
    getSelection().removeAllRanges();
    const ds = $('#docscroll'), dr = ds.getBoundingClientRect(), a = art.getBoundingClientRect();
    regsel.replaceChildren(h('div', { class: 'hint', text: 'ドラッグして、範囲を選びます（Esc か、枠の外を押すと、やめます）' }));
    Object.assign(regsel.style, { left: `${Math.round(a.left - dr.left + ds.scrollLeft)}px`, top: `${Math.round(a.top - dr.top + ds.scrollTop)}px`, width: `${a.width}px`, height: `${a.height}px` });
    regsel.hidden = false;
    regbtn.classList.add('on');
    regbtn.querySelector('.lbl').textContent = 'やめる';
    regState = { from: null, box: null };
  }
  // ドラッグ中の矩形（選択の枠の内側の座標。はみ出さない）
  function regRect(e) {
    const r = regsel.getBoundingClientRect();
    const x = Math.min(Math.max(e.clientX - r.left, 0), r.width), y = Math.min(Math.max(e.clientY - r.top, 0), r.height);
    const f = regState.from;
    return { x: Math.min(f.x, x), y: Math.min(f.y, y), w: Math.abs(x - f.x), h: Math.abs(y - f.y) };
  }
  regsel.addEventListener('pointerdown', (e) => {
    if (!regState || e.button !== 0) return;
    const r = regsel.getBoundingClientRect();
    regState.from = { x: e.clientX - r.left, y: e.clientY - r.top };
    regState.box = h('div', { class: 'box' });
    regsel.append(regState.box);
    regsel.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  regsel.addEventListener('pointermove', (e) => {
    if (!regState || !regState.from) return;
    const q = regRect(e);
    Object.assign(regState.box.style, { left: `${q.x}px`, top: `${q.y}px`, width: `${q.w}px`, height: `${q.h}px` });
  });
  regsel.addEventListener('pointerup', (e) => {
    if (!regState || !regState.from) return;
    const q = regRect(e), r = regsel.getBoundingClientRect();
    cancelRegion();
    if (q.w < 8 || q.h < 8) { toast('範囲が小さすぎます。ドラッグで、範囲を選んでください', true); return; }
    finishRegion({ left: r.left + q.x, top: r.top + q.y, width: q.w, height: q.h });
  });
  regsel.addEventListener('pointercancel', cancelRegion);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && regState) cancelRegion(); });
  document.addEventListener('pointerdown', (e) => { if (regState && !regsel.contains(e.target) && !regbtn.contains(e.target)) cancelRegion(); });
  window.addEventListener('resize', cancelRegion);
  // 範囲の名前（カードの見出し・AI に届く label）。画像の alt・図（Mermaid）・インラインの svg の文字
  function regionLabel(blk, media) {
    if (media.tagName.toLowerCase() === 'img') return `画像${media.alt ? `: ${media.alt}` : ''}`;
    return blk.classList.contains('mermaid-block') ? '図' : (trunc(blk.textContent, 40) || '図');
  }
  function finishRegion(vr) {
    const vx2 = vr.left + vr.width, vy2 = vr.top + vr.height;
    const box = (b) => b.getBoundingClientRect();
    const hits = $$('#article [data-bid]').filter((b) => { const r = box(b); return (r.width || r.height) && r.right > vr.left && r.left < vx2 && r.bottom > vr.top && r.top < vy2; });
    if (!hits.length) { toast('そこには本文がありません。本文の上で、範囲を選んでください', true); return; }
    // 基準にするブロック：左上の点を含むもの（小さいほう）。左上が、ブロックの間の余白なら、最初に重なるもの
    const holding = hits.filter((b) => { const r = box(b); return r.left <= vr.left && vr.left <= r.right && r.top <= vr.top && vr.top <= r.bottom; });
    const blk = holding.length ? holding.reduce((a, b) => (box(b).width * box(b).height < box(a).width * box(a).height ? b : a)) : hits[0];
    const frame = frameOf(blk);
    const media = frame === blk ? null : frame;
    const fr = box(frame);
    const r4 = (v) => Math.round(v * 10000) / 10000;
    const rect4 = { x: r4((vr.left - fr.left) / fr.width), y: r4((vr.top - fr.top) / fr.height), w: r4(vr.width / fr.width), h: r4(vr.height / fr.height) };
    if (!(fr.width && fr.height) || rect4.w < 0.0005 || rect4.h < 0.0005) { toast('範囲が小さすぎます。ドラッグで、範囲を選んでください', true); return; }
    // 範囲が、1 つの画像・図の中に収まるなら、元の解像度から切り出す。そうでなければ、表示されている本文を、画像にする
    const inside = media && (media.tagName.toLowerCase() !== 'img' || media.naturalWidth > 0) && vr.left >= fr.left - 1 && vr.top >= fr.top - 1 && vx2 <= fr.right + 1 && vy2 <= fr.bottom + 1;
    const plain = blk.cloneNode(true); // <style>・<script> の中身（図の CSS など）は、名前に入れない
    for (const x of plain.querySelectorAll('style, script')) x.remove();
    const text = blk.classList.contains('mermaid-block') ? '図' : plain.textContent.replace(/\s+/g, ' ').trim();
    const label = inside ? `${regionLabel(blk, media)}の一部` : `範囲：${trunc(text, 30) || blk.tagName.toLowerCase()}`; // 画像・図の外へ出る範囲は、画像の一部ではない
    // 画像にする作業は、入力欄を開く前に始める（入力中のオレンジの強調が、画像に写らないように。スタイルを写す所までは、同期で終わる）
    const job = inside ? cropMedia(media, rect4) : rasterRegion(vr);
    startComposer({ ...blockAnchor(blk), label, rect: rect4 });
    const comp = S.composer;
    if (!comp) { job.catch(() => {}); return; } // 最新版でないとき、startComposer が断った
    // 画像にする（写真は 2 秒ほど、長い範囲はそれ以上かかる）間も、「アップロード中」にして、その間の送信を断る（画像が、送られずに消えないように）
    S.uploading++;
    renderThreads();
    job
      .then(async (file) => {
        if (!file || S.composer !== comp) return; // 画像にしている間に、入力欄をやめた・別の対象へ移ったなら、付けない
        const names = await attachFiles('composer', [file], () => S.composer === comp);
        if (names[0] && S.composer === comp) comp.regionImg = names[0]; // 対象を選び直したとき、この画像だけを外すため
      })
      .catch((e) => toast(e && e.user ? e.message : 'この範囲の画像を作れませんでした（このブラウザでは、できないことがあります）。位置だけで、コメントできます', true))
      .finally(() => { S.uploading--; renderThreads(); });
  }
  // 範囲を、画像にする。画像は、元の解像度から。図（svg）と、ベクターの画像（SVG の img）は、表示の大きさの最大 2 倍で描く。
  // 出力は、長い辺が 2400px まで（写真の元の解像度は、5MB を超えるため）。PNG が大きすぎるときは、JPEG にする。
  // 画像は同じオリジン（/asset/・data:）なので、canvas が汚れない。svg は、外部のものを読まない（data: の画像にする）
  async function cropMedia(media, rect) {
    const isImg = media.tagName.toLowerCase() === 'img';
    const b = media.getBoundingClientRect();
    const vectorScale = Math.min(2, 2400 / Math.max(b.width, b.height));
    const vector = isImg && /^data:image\/svg|\.svg(?:[?#]|$)/i.test(media.currentSrc || media.src);
    let src, sw, sh; // 描く元と、それを画像にしたときの大きさ（切り出しの座標は、この大きさで測る）
    let fit = null; // ベクターの img は、箱の中に、縦横比を保って収まる（表示と同じに、中央にそろえる）
    if (isImg && !vector) {
      src = media; sw = media.naturalWidth; sh = media.naturalHeight;
    } else if (isImg) {
      src = media; sw = Math.round(b.width * vectorScale); sh = Math.round(b.height * vectorScale);
      const nw = media.naturalWidth, nh = media.naturalHeight;
      if (nw && nh) { const s = Math.min(sw / nw, sh / nh); fit = { w: nw * s, h: nh * s, x: (sw - nw * s) / 2, y: (sh - nh * s) / 2 }; }
    } else {
      sw = Math.round(b.width * vectorScale); sh = Math.round(b.height * vectorScale);
      const clone = media.cloneNode(true);
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      if (!clone.getAttribute('viewBox')) clone.setAttribute('viewBox', `0 0 ${b.width} ${b.height}`);
      clone.setAttribute('width', sw);
      clone.setAttribute('height', sh);
      const im = new Image();
      await new Promise((resolve, reject) => {
        im.onload = resolve;
        im.onerror = () => reject(new Error('svg を読めません'));
        im.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(clone))}`;
      });
      src = im;
    }
    const sx = Math.round(rect.x * sw), sy = Math.round(rect.y * sh);
    const cw = Math.max(1, Math.min(sw - sx, Math.round(rect.w * sw))), ch = Math.max(1, Math.min(sh - sy, Math.round(rect.h * sh)));
    const k = Math.min(1, 2400 / Math.max(cw, ch)); // 出力の縮小
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(cw * k)); cv.height = Math.max(1, Math.round(ch * k));
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff'; // 透明な図は、PNG にしたとき、見えなくならないよう、白地に
    ctx.fillRect(0, 0, cv.width, cv.height);
    const f = fit || { x: 0, y: 0, w: sw, h: sh };
    ctx.drawImage(src, (f.x - sx) * k, (f.y - sy) * k, f.w * k, f.h * k); // 全体を、ずらして描く（はみ出す所は、切れる）。k が 1 なら、切り出しと同じ
    return canvasFile(cv);
  }
  async function canvasFile(cv) {
    const toBlob = (type, q) => new Promise((resolve) => cv.toBlob(resolve, type, q));
    let blob = await toBlob('image/png');
    let name = 'region.png';
    if (blob && blob.size > IMG_MAX_MB * 1024 * 1024 * 0.98) { blob = await toBlob('image/jpeg', 0.88); name = 'region.jpg'; }
    return blob ? new File([blob], name, { type: blob.type }) : null;
  }
  // 本文の、任意の範囲（vr。画面の座標）を、画像にする。表示されている本文のブロックを、見た目（computed style）を写して複製し、SVG の foreignObject に入れて画像にし、canvas に描く。
  // 複製は、画像として読むだけで、スクリプトは動かない（無害化した本文を、そのまま写す）。img は、先に data: にする（同じオリジンのものだけ。canvas は汚れない）。
  // 番号・枠・強調の層は、入らない（本文だけ）。::before などの疑似要素は、写らない
  async function rasterRegion(vr) {
    const W = Math.max(1, Math.round(vr.width)), H = Math.max(1, Math.round(vr.height));
    const k = Math.min(2, 2400 / Math.max(W, H));
    const art = $('#article');
    const paper = getComputedStyle(art).backgroundColor;
    const root = document.createElement('div');
    root.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
    root.style.cssText = `position:relative;width:${W}px;height:${H}px;overflow:hidden;background:${paper === 'rgba(0, 0, 0, 0)' ? '#fff' : paper}`;
    const imgs = [];
    const hit = (r) => (r.width || r.height) && r.right > vr.left && r.left < vr.left + vr.width && r.bottom > vr.top && r.top < vr.top + vr.height;
    const targets = [...art.children].filter((el) => hit(el.getBoundingClientRect()));
    let count = 0;
    for (const el of targets) count += 1 + el.querySelectorAll('*').length;
    if (count > 3000) throw userError('範囲に重なるブロック（表・リストなど）が大きすぎて、画像にできません（要素の合計が 3000 を超えています）。位置だけで、コメントできます');
    // 入力中の強調（オレンジ）は、画像に写さない：スタイルを写す間だけ、外す（同期のうちに戻す）
    const pend = [...art.querySelectorAll('.pending, .blk-pending')].map((e) => [e, ['pending', 'blk-pending'].filter((c) => e.classList.contains(c))]);
    for (const [e, cl] of pend) e.classList.remove(...cl);
    const pendingMarks = new Set(pend.map(([e]) => e).filter((e) => e.tagName === 'MARK')); // 入力中の文の強調は、背景も、写さない
    try {
      for (const el of targets) {
        const r = el.getBoundingClientRect();
        const c = el.cloneNode(true);
        const src = [el, ...el.querySelectorAll('*')], dst = [c, ...c.querySelectorAll('*')];
        for (let i = 0; i < src.length; i++) {
          const cs = getComputedStyle(src[i]);
          let css = '';
          for (const p of cs) css += `${p}:${cs.getPropertyValue(p)};`;
          dst[i].setAttribute('style', `${css}outline:none;${pendingMarks.has(src[i]) ? 'background:none;' : ''}`); // 選んでいるコメントの枠線（outline）・入力中の文の強調は、画像に入れない
          if (src[i] instanceof HTMLImageElement) imgs.push([src[i], dst[i]]);
        }
        // 位置は、!important で決める（写した computed style の、論理プロパティ〔inset-inline-start など〕に、負けないように）
        const place = { position: 'absolute', margin: '0', 'box-sizing': 'border-box', left: `${r.left - vr.left}px`, top: `${r.top - vr.top}px`, width: `${r.width}px`, height: `${r.height}px` };
        for (const [name, value] of Object.entries(place)) c.style.setProperty(name, value, 'important');
        root.append(c);
      }
    } finally {
      for (const [e, cl] of pend) e.classList.add(...cl);
    }
    await Promise.all(imgs.map(([a, b]) => inlineImage(a, b))); // 画像は、あとで（スタイルを写し終えてから）data: にする
    // XML として不正な文字（制御文字・対になっていないサロゲート）は、除く（画像として読めなくなるため）
    const xml = new XMLSerializer().serializeToString(root).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');
    if (xml.length > 40e6) throw userError('範囲が大きすぎて、画像にできません。小さい範囲を選んでください。位置だけで、コメントできます');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(W * k)}" height="${Math.round(H * k)}" viewBox="0 0 ${W} ${H}"><foreignObject x="0" y="0" width="${W}" height="${H}">${xml}</foreignObject></svg>`;
    const im = new Image();
    await new Promise((resolve, reject) => {
      im.onload = resolve;
      im.onerror = () => reject(new Error('範囲を画像にできません'));
      im.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    });
    const cv = document.createElement('canvas');
    cv.width = Math.round(W * k); cv.height = Math.round(H * k);
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.drawImage(im, 0, 0, cv.width, cv.height);
    return canvasFile(cv);
  }
  // 複製の img に、元の画像を、data: として入れる（SVG の中の画像は、外のファイルを読めないため）。表示の大きさの 2 倍まで
  async function inlineImage(img, copy) {
    copy.removeAttribute('srcset');
    try {
      const rc = img.getBoundingClientRect();
      const nw = img.naturalWidth, nh = img.naturalHeight;
      const cw = Math.max(1, Math.round(nw ? Math.min(nw, rc.width * 2) : rc.width * 2));
      const ch = Math.max(1, Math.round(nw ? (cw * nh) / nw : rc.height * 2));
      const cv = document.createElement('canvas');
      cv.width = cw; cv.height = ch;
      cv.getContext('2d').drawImage(img, 0, 0, cw, ch);
      copy.setAttribute('src', cv.toDataURL('image/png'));
    } catch (e) {
      copy.removeAttribute('src'); // 壊れた画像（読み込めない）は、画像なしで写す（範囲全体の画像を、失敗させない）
    }
  }
  // 利用者に見せる失敗（原因が分かるもの）
  const userError = (message) => Object.assign(new Error(message), { user: true });

  // 範囲の枠（押せない）の下を、マウスが通っているとき、その範囲のコメントを返す（重なるときは、小さい枠）。
  // 枠は押せないので、1 つの画像に複数の範囲があっても、それぞれのコメントに、ホバー・クリックが届くように、位置で探す
  function regionTidAt(x, y) {
    let best = null, area = Infinity;
    for (const rb of $$('.regionbox:not(.pending)', $('#badges'))) {
      const r = rb.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom && r.width * r.height < area) { best = rb.dataset.tid; area = r.width * r.height; }
    }
    return best;
  }
  function articleTid(e) {
    const t = regionTidAt(e.clientX, e.clientY);
    if (t) return t;
    const el = e.target.closest('[data-tid]:not([data-tid="pending"])'); // 入力中の強調（pending）の下にある、コメントの印を選ぶ
    if (!el) return null;
    // 範囲のコメントだけのブロックは、範囲の外では、どのコメントにも当てない（最後の範囲に、飛ばない）
    const badges = S.blkBadges && S.blkBadges.get(el);
    if (badges && badges.every((bd) => S.regions.some((g) => g.tid === bd.tid))) return null;
    return el.dataset.tid;
  }
  $('#article').addEventListener('click', (e) => {
    const a = e.target.closest('a[data-page]');
    if (a) return; // ハッシュで遷移する
    const tid = articleTid(e);
    if (tid) focusThread(tid, false);
  });

  // 番号の印は、文・ブロック・範囲の、すべて、同じ見た目（丸）・同じ位置（記事の左の余白。対象の上端）に、要素の外の層（#badges。#docscroll の中の絶対位置）に出す。
  // 要素の中に出すと、箱の overflow で切れる・横スクロールで流れる・行末の文字に重なる。大きさが変わる（図の描画・窓・幅の変更）と、合わせ直す。
  // 近い高さ（4px 以内。同じ行）の印は、1 つの組にして、横に並べる。組が、上の組に重ならないよう、前の組の下端（実測）の 2px 下より上には、出さない。
  // 範囲のコメントの印は、範囲の上端の高さ（画像・図の中の位置）に出す
  function placeBadges() {
    if (S.regDrag) return; // 範囲の枠を、ドラッグしている間は、描き直さない（つかんでいる枠が、消えないように）
    const layer = $('#badges');
    layer.textContent = '';
    if (!S.blkBadges) return;
    const ds = $('#docscroll'), dr = ds.getBoundingClientRect(), ar = $('#article').getBoundingClientRect();
    const left = Math.round(ar.left - dr.left + ds.scrollLeft) - 12;
    // 画像・図の中の範囲（その要素の大きさに対する比率で、位置を決める）。入力中のものは、オレンジ
    const regions = [];
    for (const g of S.regions || []) regions.push(g);
    if (S.composer && S.composer.anchor.rect && S.pendingEl) regions.push({ tid: 'pending', el: S.pendingEl, rect: S.composer.anchor.rect, pending: true });
    const regionTop = new Map();
    for (const g of regions) {
      const media = g.el.isConnected ? frameOf(g.el) : null; // 保存した比率の基準（finishRegion と同じ）
      const m = media ? media.getBoundingClientRect() : null;
      if (!m || !m.width || !m.height) continue;
      g.m = m;
      regionTop.set(g.tid, m.top + g.rect.y * m.height);
    }
    const items = [];
    for (const [el, list] of S.blkBadges) {
      if (!el.isConnected) continue;
      const r = el.getBoundingClientRect();
      if (!r.width && !r.height) continue; // 閉じた <details> の中など、見えない所には、出さない
      for (const b of list) items.push({ top: regionTop.has(b.tid) ? regionTop.get(b.tid) : r.top, ...b });
    }
    for (const b of S.txtBadges || []) {
      const rc = b.el.isConnected ? b.el.getClientRects()[0] : null;
      if (rc) items.push({ top: rc.top, tid: b.tid, n: b.n, resolved: b.resolved });
    }
    if (S.composer && S.pendingEl && S.pendingEl.isConnected) { // 入力中の対象も、同じ印（オレンジ。「新」）
      const rc = regionTop.has('pending') ? { top: regionTop.get('pending') } : S.pendingEl.getClientRects()[0];
      if (rc) items.push({ top: rc.top, tid: 'pending', n: '新', pending: true });
    }
    items.sort((a, b) => a.top - b.top || (typeof a.n === 'number' ? a.n : 1e9) - (typeof b.n === 'number' ? b.n : 1e9));
    const groups = [];
    for (const it of items) {
      const g = groups[groups.length - 1];
      if (g && it.top - g.top < 4) g.items.push(it); else groups.push({ top: it.top, items: [it] });
    }
    let floor = -Infinity;
    for (const g of groups) {
      const top = Math.max(g.top, floor);
      const box = h('div', { class: 'bbadge' }, g.items.map((b) => h('span', { class: `bno${b.resolved ? ' resolved' : ''}${b.pending ? ' pending' : ''}`, 'data-tid': b.tid, text: String(b.n) })));
      box.style.top = `${Math.round(top - dr.top + ds.scrollTop) + 2}px`;
      box.style.left = `${left}px`;
      layer.append(box);
      floor = top + box.offsetHeight + 2; // 折り返して背が高くなった組の、下に、次の組を出す
    }
    for (const g of regions) {
      if (!g.m) continue;
      const m = g.m;
      const rb = h('div', { class: `regionbox${g.resolved ? ' resolved' : ''}${g.pending ? ' pending' : ''}`, 'data-tid': g.tid });
      // 範囲が、本文の領域の外（左右）へ出ても、領域の中に収める（枠のせいで、横にスクロールできるようにならない）
      const x0 = Math.round(m.left - dr.left + ds.scrollLeft + g.rect.x * m.width), x1 = x0 + Math.round(g.rect.w * m.width);
      const left = Math.max(0, x0), right = Math.min(ds.clientWidth, x1);
      if (right <= left) continue;
      Object.assign(rb.style, {
        left: `${left}px`, top: `${Math.round(m.top - dr.top + ds.scrollTop + g.rect.y * m.height)}px`,
        width: `${right - left}px`, height: `${Math.round(g.rect.h * m.height)}px`,
      });
      if (g.pending) for (const k of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) rb.append(h('span', { class: `rh rh-${k}`, 'data-h': k })); // 入力中の枠だけ、つかめる
      layer.append(rb);
    }
    if (linkedTid) for (const e of $$(`[data-tid="${linkedTid}"]`, layer)) e.classList.add('linked'); // 描き直しても、いま光らせているものは、光ったまま
  }
  let badgeFrame = 0;
  const scheduleBadges = () => { if (!badgeFrame) badgeFrame = requestAnimationFrame(() => { badgeFrame = 0; placeBadges(); }); };
  // 図の描画・画像の読み込み・折りたたみ・幅の変更で、記事の大きさが変わるとき。スクロールバーの出入りなど、本文の領域の大きさが変わるときも
  const badgeObserver = new ResizeObserver(scheduleBadges);
  badgeObserver.observe($('#article'));
  badgeObserver.observe($('#docscroll'));
  // 画像の読み込みが終わったとき（範囲の基準が、ブロックから画像に変わる。大きさが変わらない小さな画像でも、枠を合わせ直す）。load は、バブルしないので、捕まえる
  $('#article').addEventListener('load', scheduleBadges, true);
  $('#article').addEventListener('error', scheduleBadges, true);
  $('#badges').addEventListener('click', (e) => {
    const el = e.target.closest('[data-tid]:not([data-tid="pending"])'); // 入力中の「新」は、押しても、選ぶカードがない
    if (el) { S.solo = el.dataset.tid; renderThreads(); focusThread(el.dataset.tid, false); } // 本文の番号を押すと、そのカードだけを見せる
  });
  // 入力中の範囲の枠を、ドラッグで動かし・角と辺で大きさを変える。離したら、その範囲で、入力欄の対象と画像を、作り直す（finishRegion。書きかけの文字は、残る）
  $('#badges').addEventListener('pointerdown', (e) => {
    const box = e.target.closest('.regionbox.pending');
    if (!box || e.button !== 0 || !S.composer) return;
    S.regDrag = { box, mode: e.target.dataset.h || 'move', x0: e.clientX, y0: e.clientY, r0: box.getBoundingClientRect(), vr: null };
    box.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  document.addEventListener('pointermove', (e) => {
    const d = S.regDrag;
    if (!d) return;
    const dx = e.clientX - d.x0, dy = e.clientY - d.y0, m = d.mode, MIN = 12;
    let { left, top, right, bottom } = d.r0;
    if (m === 'move') { left += dx; right += dx; top += dy; bottom += dy; } else {
      if (m.includes('w')) left += dx;
      if (m.includes('e')) right += dx;
      if (m.includes('n')) top += dy;
      if (m.includes('s')) bottom += dy;
      if (right - left < MIN) { if (m.includes('w')) left = right - MIN; else right = left + MIN; }
      if (bottom - top < MIN) { if (m.includes('n')) top = bottom - MIN; else bottom = top + MIN; }
    }
    const a = $('#article').getBoundingClientRect(); // 本文の外へは、出さない
    const w = right - left, hgt = bottom - top;
    if (m === 'move') { left = Math.min(Math.max(left, a.left), a.right - w); top = Math.min(Math.max(top, a.top), a.bottom - hgt); right = left + w; bottom = top + hgt; } else { left = Math.max(left, a.left); right = Math.min(right, a.right); top = Math.max(top, a.top); bottom = Math.min(bottom, a.bottom); }
    d.vr = { left, top, width: right - left, height: bottom - top };
    const ds = $('#docscroll'), dr = ds.getBoundingClientRect();
    Object.assign(d.box.style, { left: `${left - dr.left + ds.scrollLeft}px`, top: `${top - dr.top + ds.scrollTop}px`, width: `${d.vr.width}px`, height: `${d.vr.height}px` });
  });
  const endRegDrag = (apply) => {
    const d = S.regDrag;
    if (!d) return;
    S.regDrag = null;
    if (apply && d.vr) finishRegion(d.vr);
    scheduleBadges(); // finishRegion が断った（小さすぎ・本文なし）ときも、枠を、入力欄の対象の位置へ戻す
  };
  document.addEventListener('pointerup', () => endRegDrag(true));
  document.addEventListener('pointercancel', () => endRegDrag(false));
  // 添付の画像（サムネイル・送った画像）は、押すと、画面の中に、大きく出す（Esc・押すと閉じる）
  const lightbox = $('#lightbox');
  $('#threads').addEventListener('click', (e) => {
    const img = e.target.closest('.thumb img, .msg .imgs img');
    if (!img) return;
    e.preventDefault();
    lightbox.querySelector('img').src = img.src;
    lightbox.hidden = false;
  });
  lightbox.addEventListener('click', () => { lightbox.hidden = true; });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (S.regDrag) endRegDrag(false); // 範囲の枠をつかんでいる間の Esc：動かすのをやめる（元に戻す）
    else if (!lightbox.hidden) lightbox.hidden = true;
  });
  $('#badges').addEventListener('mouseover', (e) => {
    const el = e.target.closest('[data-tid]');
    const tid = el ? el.dataset.tid : null;
    if (tid === linkedTid) return;
    setLinked(tid);
    const card = tid && $(`.thread[data-tid="${tid}"]`);
    if (card && !S.composer) card.scrollIntoView({ block: 'nearest' });
  });
  $('#badges').addEventListener('mouseleave', () => setLinked(null));

  // 本文の印と、右のカードを、マウスを置いたとき、お互いに光らせる（どのコメントが、どの対象のものかが、すぐ分かるように）
  let linkedTid = null;
  function setLinked(tid) {
    linkedTid = tid;
    $$('.linked').forEach((e) => e.classList.remove('linked'));
    if (!tid) return;
    $$(`[data-tid="${tid}"]`).forEach((e) => e.classList.add('linked'));
    const loc = S.locs.get(tid); // 1 つのブロックに複数のコメントがあるとき、data-tid は、最後の 1 つだけ。位置は、ここから取る
    if (loc) loc.classList.add('linked');
  }
  $('#threads').addEventListener('mouseover', (e) => {
    const c = e.target.closest('.thread[data-tid]');
    const tid = c ? c.dataset.tid : null;
    if (tid === linkedTid && (!c || c.classList.contains('linked'))) return;
    setLinked(tid);
  });
  $('#threads').addEventListener('mouseleave', () => setLinked(null));
  function hoverArticle(e) {
    const tid = articleTid(e);
    if (tid === linkedTid) return;
    setLinked(tid);
    const card = tid && $(`.thread[data-tid="${tid}"]`);
    // 右のカードが見えない所にあるときだけ、動かす。入力欄を開いている間は、動かさない（入力欄が、見えなくなるため）
    if (card && !S.composer) card.scrollIntoView({ block: 'nearest' });
  }
  $('#article').addEventListener('mouseover', hoverArticle);
  $('#article').addEventListener('mousemove', (e) => { if (S.regions && S.regions.length) hoverArticle(e); }); // 同じ画像の中で、範囲から範囲へ動くとき
  $('#article').addEventListener('mouseleave', () => setLinked(null));

  // ------------------------------------------------------------ Submit / 終了
  const dlg = $('#submitdlg');
  $('#btn-submit').addEventListener('click', () => {
    const t = S.topic;
    if (!t || !t.unsent) return;
    $('#submitdlg-summary').textContent = `未送信のコメント・回答など ${t.unsent} 件を AI に送ります。`;
    dlg.showModal();
  });
  dlg.addEventListener('close', async () => {
    if (dlg.returnValue !== 'ok') return;
    const note = $('#submitdlg-note').value;
    const r = await act(() => api('/api/submit', { topic: S.slug, note }));
    if (r) { $('#submitdlg-note').value = ''; toast(`第${r.round}回として送信しました`); await refreshTopic(true); }
    dlg.returnValue = '';
  });
  $('#btn-end').addEventListener('click', async () => {
    if (!confirm('レビューを終了します。未送信のコメントは残りますが、AI には届きません。')) return;
    await act(async () => { await api('/api/end', { topic: S.slug }); await refreshTopic(true); });
  });

  document.addEventListener('click', (e) => {
    const a = e.target.closest('a.pagecard, a.pagelink');
    if (a) S.composer = null;
  });

  // ------------------------------------------------------------ 画面の広さ（左の一覧をしまう・右のコメントの幅）
  // 設定は、このブラウザの localStorage に覚える（サーバーには送らない。資料・コメントとは別）
  const UI = { sideOpen: true, panelW: 380 };
  try { Object.assign(UI, JSON.parse(localStorage.getItem('rikai-ui') || '{}')); } catch (_) { /* 壊れていたら、既定のまま */ }
  const PANEL_MIN = 280, PANEL_DEFAULT = 380;
  const SIDE_W = 230, DOC_MIN = 360; // 左の一覧の幅（CSS の --side-w の既定）と、本文の領域に残す最小の幅
  // 右の幅の上限：画面の 70%。ただし、左の一覧（開いているとき）と合わせて、本文の領域が DOC_MIN 以上、残る幅まで
  const panelMax = () => Math.max(PANEL_MIN, Math.min(Math.floor(window.innerWidth * 0.7), window.innerWidth - (UI.sideOpen ? SIDE_W : 0) - DOC_MIN));
  const saveUi = () => { try { localStorage.setItem('rikai-ui', JSON.stringify(UI)); } catch (_) { /* 保存できなくても、使える */ } };
  const savedW = () => Math.max(PANEL_MIN, Number(UI.panelW) || PANEL_DEFAULT);
  const panelWidth = () => Math.min(savedW(), panelMax());
  function applyUi() {
    const app = $('#app');
    app.classList.toggle('side-collapsed', !UI.sideOpen);
    const w = panelWidth();
    app.style.setProperty('--panel-w', `${w}px`);
    const rz = $('#panel-resizer');
    rz.setAttribute('aria-valuenow', String(w));
    rz.setAttribute('aria-valuemax', String(panelMax()));
    $('#btn-side').setAttribute('aria-expanded', String(!!UI.sideOpen));
    hideActbar(); // 配置が変わるので、入口のバーは、次にマウスを動かしたとき、出し直す
    scheduleBadges(); // 記事の大きさが変わらず、位置だけ動くとき（上限の幅で中央にそろえているときの、左の一覧のしまい・右の幅の変更）も、ブロックの印を合わせ直す
  }
  $('#btn-side').addEventListener('click', () => { UI.sideOpen = !UI.sideOpen; saveUi(); applyUi(); });
  const resizer = $('#panel-resizer');
  resizer.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return; // 左ボタン（またはタッチ・ペン）だけ。右ボタンの、メニューの途中で、離しを失わないように
    hideActbar(); // 配置が変わるので、入口のバーは、古い位置に残さない
    resizer.setPointerCapture(e.pointerId);
    resizer.classList.add('drag');
    document.body.classList.add('resizing');
    resizer.focus({ preventScroll: true }); // 矢印キーで、続けて調整できるように
    e.preventDefault();
  });
  resizer.addEventListener('pointermove', (e) => {
    if (!resizer.hasPointerCapture(e.pointerId)) return;
    UI.panelW = Math.round(Math.min(Math.max(window.innerWidth - e.clientX, PANEL_MIN), panelMax()));
    applyUi();
  });
  // ドラッグの終わり（離す・取り消し・取り込みを失う、のどれでも）。ここで、必ず、元に戻す
  resizer.addEventListener('lostpointercapture', () => {
    resizer.classList.remove('drag');
    document.body.classList.remove('resizing');
    saveUi();
  });
  resizer.addEventListener('dblclick', () => { UI.panelW = PANEL_DEFAULT; saveUi(); applyUi(); });
  resizer.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    UI.panelW = Math.min(Math.max(panelWidth() + (e.key === 'ArrowLeft' ? 24 : -24), PANEL_MIN), panelMax());
    saveUi();
    applyUi();
  });
  window.addEventListener('resize', applyUi);
  applyUi();
  window.addEventListener('hashchange', () => act(route));

  act(route);
  setInterval(tick, 1500);
})();
