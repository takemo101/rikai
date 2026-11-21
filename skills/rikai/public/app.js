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
    drafts: { reply: {}, ask: {}, edit: {}, composer: '' },
    editing: null, seen: new Set(JSON.parse(localStorage.getItem('rikai-seen') || '[]')), offline: false, error: null,
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
  marked.use({
    gfm: true,
    renderer: {
      code({ text, lang }) {
        if ((lang || '').trim() === 'mermaid') return `<div class="mermaid-block" data-mermaid="${encSrc(text)}"></div>`;
        return false;
      },
    },
  });

  function mdToFragment(md, topic) {
    const clean = DOMPurify.sanitize(marked.parse(md || ''), PURIFY);
    const tpl = document.createElement('template');
    tpl.innerHTML = clean;
    const root = tpl.content;
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
  const blockText = (el) => el.dataset.mermaid || (el.textContent || '').replace(/\s+/g, ' ').trim();
  function markBlocks(root) {
    blockEls(root).forEach((el, i) => { el.dataset.bid = `b${i}`; el.dataset.bhash = hash(blockText(el)); el.classList.add('blk'); });
  }

  function textIndex(root) {
    const nodes = [];
    let text = '';
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        const p = n.parentElement;
        if (!p || p.closest('.mermaid-block, .diffbox, style, script')) return NodeFilter.FILTER_REJECT;
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
    // 本文の順に番号をつける（右のパネルの、同じ番号のカードと対応する）。印は、CSS の ::after（data-no）で出す
    // （要素や文字を足さないので、コメントの位置づけに使う本文の文字を、変えない）
    S.nums = new Map();
    const located = threadsOnPage().filter((t) => S.locs.get(t.id)).sort(docOrder);
    located.forEach((t, i) => {
      const n = i + 1;
      S.nums.set(t.id, n);
      const marks = $$(`mark.hl[data-tid="${t.id}"]`, art);
      const target = marks.length ? marks[marks.length - 1] : S.locs.get(t.id);
      target.dataset.no = String(n);
    });
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
    if (!S.composer && !art.querySelector('mark.hl.pending, .blk-pending')) return; // 何もなければ、本文に触らない
    clearPending();
    if (!S.composer) return;
    const a = S.composer.anchor;
    if (a.quote) {
      const hit = findQuote(textIndex(art).text, a);
      if (hit) S.pendingEl = wrapRange(art, hit.start, hit.end, 'pending', 'pending');
    } else {
      const blocks = blockEls(art);
      const found = locateBlock(blocks.map((b) => ({ id: b.dataset.bid, hash: b.dataset.bhash, tag: b.tagName, text: blockText(b) })), a);
      if (found) { S.pendingEl = blocks[found.index]; S.pendingEl.classList.add('blk-pending'); }
    }
  }

  // 差分に使う、ブロックの文字（表は、セルを「 | 」で、行を改行でつなぐ。図は、ソース）
  const safeDecode = (s) => { try { return decodeURIComponent(s); } catch (_) { return s; } }; // AI が書いた HTML の属性が、不正なことがある
  function plainText(el) {
    if (el.classList.contains('mermaid-block')) return safeDecode(el.dataset.mermaid || '');
    if (el.tagName === 'TABLE') return [...el.rows].map((r) => [...r.cells].map((c) => c.textContent.trim()).join(' | ')).join('\n');
    if (el.tagName === 'PRE') return (el.textContent || '').replace(/\n$/, '');
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
    const prev = mdToFragment(S.prevMd, S.slug);
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
    const frag = mdToFragment(S.md, S.slug);
    markBlocks(frag);
    // 件数に、どの版のものかの印（key）を付ける（ページ・版を切り替えた直後に、前のページの件数を見せないため）
    S.diff = S.showChanges && v > 1 && S.prevMd != null ? { ...addDiff(frag), key: S.loaded } : null;
    art.replaceChildren(frag);
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

  function renderAsk(t, q) {
    const ask = q.ask;
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
        box.append(h('div', { class: 'body pre', text: m.text }));
        if (!m.sent) {
          box.append(h('div', { class: 'row meta' }, h('span', { class: 'chip draft small', text: '未送信' }),
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

  function renderThread(t) {
    const [stText, stCls] = threadStatus(t);
    const loc = S.locs.get(t.id);
    const orphan = !loc && t.anchor && t.version <= curVersion();
    const future = t.version > curVersion();
    const fresh = t.messages.some((m) => m.author === 'ai' && !S.seen.has(m.id));
    const quote = t.anchor ? (t.anchor.quote || t.anchor.label) : 'AIからの質問';
    const card = h('div', { class: `thread ${stCls}${S.active === t.id ? ' active' : ''}${fresh ? ' fresh' : ''}`, 'data-tid': t.id });
    card.append(h('div', { class: 'th-head', onclick: () => focusThread(t.id, true) },
      S.nums.has(t.id) ? h('span', { class: 'no', title: '本文の、同じ番号の印の所へのコメントです', text: String(S.nums.get(t.id)) }) : null,
      h('span', { class: `chip ${stCls} small`, text: stText }),
      h('span', { class: 'chip small', text: `v${t.version}` }),
      orphan ? h('span', { class: 'chip warn small', text: '修正で文が変わりました' }) : null,
      S.approx.has(t.id) ? h('span', { class: 'chip warn small', text: S.approx.get(t.id) === 'similar' ? '近い内容のブロックに表示' : '同じ位置のブロックに表示' }) : null,
      future ? h('span', { class: 'chip small', text: '後の版のコメント' }) : null,
      h('div', { class: 'quote', text: trunc(quote, 90) })));
    // 回答（kind が answer）は、質問の下の入力欄で見せるので、メッセージとしては描かない（null）。null を append すると、文字「null」が出る
    for (const m of t.messages) { const el = renderMessage(t, m); if (el) card.append(el); }
    const foot = h('div', { class: 'th-foot' });
    if (!t.resolved) {
      foot.append(
        h('textarea', {
          rows: 2, 'data-key': `reply-${t.id}`, placeholder: '返信・追加の質問（⌘/Ctrl+Enter で追加）', value: S.drafts.reply[t.id] || '',
          oninput: (e) => { S.drafts.reply[t.id] = e.target.value; },
          onkeydown: (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); sendReply(t); } },
        }),
        h('div', { class: 'row' },
          h('button', { class: 'primary small', text: '返信を追加', onclick: () => sendReply(t) }),
          h('button', { class: 'ghost small', text: '理解できた（解決）', onclick: () => act(async () => { await api('/api/resolve', { topic: S.slug, thread: t.id, resolved: true }); await refreshTopic(true); }) })));
    } else {
      foot.append(h('button', { class: 'ghost small', text: '再開する', onclick: () => act(async () => { await api('/api/resolve', { topic: S.slug, thread: t.id, resolved: false }); await refreshTopic(true); }) }));
    }
    card.append(foot);
    return card;
  }

  async function sendReply(t) {
    const text = (S.drafts.reply[t.id] || '').trim();
    if (!text) return;
    await act(async () => { await api('/api/reply', { topic: S.slug, thread: t.id, text }); S.drafts.reply[t.id] = ''; await refreshTopic(true); });
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

  function renderThreads() {
    const panel = $('#threads');
    // 入力中の欄を覚えておき、描き直したあとに戻す
    const ae = document.activeElement;
    const keep = ae && ae.dataset && ae.dataset.key ? { key: ae.dataset.key, s: ae.selectionStart, e: ae.selectionEnd } : null;
    const scroll = panel.scrollTop;
    panel.replaceChildren();
    if (!S.topic) return;
    const head = h('div', { class: 'side-h', text: 'コメント' });
    panel.append(head);
    markPending(); // 入力中の対象を本文で強調し、その位置を決めてから、入力欄を並べる
    const list = threadsOnPage();
    const live = list.filter((t) => !t.resolved).sort(docOrder);
    const done = list.filter((t) => t.resolved).sort(docOrder);
    if (!list.length && !S.composer) panel.append(h('div', { class: 'empty', text: '本文の文を選択すると「コメント」が出ます。図・表・画像は、ブロックの右に出る ＋ から。' }));
    // 入力欄は、対象の位置の順に、スレッドの間へ入れる（いつも一番上、にしない）
    const slot = composerSlot(live);
    live.forEach((t, i) => { if (i === slot) panel.append(renderComposer()); panel.append(renderThread(t)); });
    if (S.composer && slot >= live.length) panel.append(renderComposer());
    if (done.length) {
      const det = h('details', { class: 'done' }, h('summary', { text: `解決済み (${done.length})` }));
      for (const t of done) det.append(renderThread(t));
      panel.append(det);
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
      if (!text) return;
      const r = await act(() => api('/api/comment', { topic: S.slug, page: S.page, version: curVersion(), anchor: a, text }));
      if (!r) return;
      S.composer = null;
      S.drafts.composer = '';
      S.active = r.thread;
      await refreshTopic(true);
      focusThread(r.thread, false);
    };
    return h('div', { class: 'thread composer' },
      h('div', { class: 'th-head' }, h('span', { class: 'no pending', title: '本文の、オレンジの部分へのコメントです', text: '新' }), h('span', { class: 'chip draft small', text: '新しいコメント' }), h('div', { class: 'quote', text: trunc(a.quote || a.label, 90) }),
        S.pendingEl ? h('div', { class: 'hint', text: '本文の、オレンジの部分へのコメントです' }) : null),
      h('textarea', {
        rows: 3, 'data-key': 'composer', placeholder: 'わからない点・確認したい点・直してほしい点（⌘/Ctrl+Enter で追加）', value: S.drafts.composer,
        oninput: (e) => { S.drafts.composer = e.target.value; },
        onkeydown: (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); submit(); } },
      }),
      h('div', { class: 'row' },
        h('button', { class: 'primary small', text: 'コメントを追加', onclick: submit }),
        h('button', { class: 'ghost small', text: 'やめる', onclick: () => { S.composer = null; S.drafts.composer = ''; renderThreads(); } })));
  }

  function startComposer(anchor) {
    if (!isLatest()) { toast('コメントは最新版にだけ付けられます', true); return; }
    S.composer = { anchor };
    renderThreads();
    const ta = $('[data-key="composer"]');
    if (ta) ta.focus();
    const card = $('.thread.composer');
    if (card) card.scrollIntoView({ block: 'center', behavior: 'smooth' });
    getSelection().removeAllRanges();
    $('#selbtn').hidden = true;
    $('#blkbtn').hidden = true;
  }

  function focusThread(tid, scrollDoc) {
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
    if (r.slug !== S.slug) { S.topic = null; S.composer = null; }
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
  const selbtn = $('#selbtn');
  const blkbtn = $('#blkbtn');
  let pendingAnchor = null;
  let blkTarget = null;
  let blkHide;

  selbtn.addEventListener('mousedown', (e) => e.preventDefault());
  selbtn.addEventListener('click', () => { if (pendingAnchor) startComposer(pendingAnchor); });
  blkbtn.addEventListener('click', () => { if (blkTarget) startComposer(blockAnchor(blkTarget)); });
  blkbtn.addEventListener('mouseenter', () => clearTimeout(blkHide));
  blkbtn.addEventListener('mouseleave', () => scheduleBlkHide());

  document.addEventListener('mouseup', (e) => {
    if (e.target === selbtn) return;
    setTimeout(() => {
      const sel = getSelection();
      const a = sel && !sel.isCollapsed && isLatest() ? anchorFromSelection() : null;
      if (!a) { selbtn.hidden = true; pendingAnchor = null; return; }
      pendingAnchor = a;
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      selbtn.style.left = `${Math.min(window.innerWidth - 90, Math.max(8, rect.right - 20))}px`;
      selbtn.style.top = `${Math.max(8, rect.top - 38)}px`;
      selbtn.hidden = false;
    }, 0);
  });
  document.addEventListener('mousedown', (e) => { if (e.target !== selbtn) selbtn.hidden = true; });

  // 「＋」は、ブロックの右端（本文の箱の内側の余白）に出す。ボタンへ向かう間に消えない・別のブロックへ飛ばないように、
  // ポインタが「そのブロックの高さ × 箱の右端まで」の帯にいる間は、同じブロックのまま出し続ける。
  // 帯の外でも、本文の箱の右の余白にいる間は、同じ高さにある本文のブロックを探す（左の余白は、探さない）。
  function scheduleBlkHide() {
    clearTimeout(blkHide);
    blkHide = setTimeout(() => { blkbtn.hidden = true; }, 350);
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
    return y >= r.top - 4 && y <= r.bottom + 4 && x >= r.left - 8 && x <= art.right + 8;
  }
  function placeBlkBtn(blk) {
    const r = blk.getBoundingClientRect();
    const art = $('#article').getBoundingClientRect();
    const top = $('#docscroll').getBoundingClientRect().top + 4; // 本文の領域の上端（上のバーに、重ねない）
    blkbtn.style.left = `${art.right - 34}px`;
    blkbtn.style.top = `${Math.min(Math.max(r.top, top), Math.max(r.bottom - 26, top))}px`;
  }
  $('#docscroll').addEventListener('mousemove', (e) => {
    if (!isLatest()) return;
    if (blkTarget && !blkbtn.hidden && inBand(blkTarget, e.clientX, e.clientY)) { clearTimeout(blkHide); return; }
    const blk = blockAt(e.clientX, e.clientY);
    if (!blk) { scheduleBlkHide(); return; }
    clearTimeout(blkHide);
    blkTarget = blk;
    placeBlkBtn(blk);
    blkbtn.hidden = false;
  });
  $('#docscroll').addEventListener('scroll', () => { blkbtn.hidden = true; });
  $('#docscroll').addEventListener('mouseleave', () => scheduleBlkHide());

  $('#article').addEventListener('click', (e) => {
    const a = e.target.closest('a[data-page]');
    if (a) return; // ハッシュで遷移する
    const el = e.target.closest('[data-tid]');
    if (el && el.dataset.tid !== 'pending') focusThread(el.dataset.tid, false);
  });

  // 本文の印と、右のカードを、マウスを置いたとき、お互いに光らせる（どのコメントが、どの対象のものかが、すぐ分かるように）
  let linkedTid = null;
  function setLinked(tid) {
    linkedTid = tid;
    $$('.linked').forEach((e) => e.classList.remove('linked'));
    if (tid) $$(`[data-tid="${tid}"]`).forEach((e) => e.classList.add('linked'));
  }
  $('#threads').addEventListener('mouseover', (e) => { const c = e.target.closest('.thread[data-tid]'); setLinked(c ? c.dataset.tid : null); });
  $('#threads').addEventListener('mouseleave', () => setLinked(null));
  $('#article').addEventListener('mouseover', (e) => {
    const el = e.target.closest('[data-tid]');
    const tid = el && el.dataset.tid !== 'pending' ? el.dataset.tid : null;
    if (tid === linkedTid) return;
    setLinked(tid);
    const card = tid && $(`.thread[data-tid="${tid}"]`);
    if (card) card.scrollIntoView({ block: 'nearest' }); // 右のカードが見えない所にあるときだけ、動かす
  });
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
  window.addEventListener('hashchange', () => act(route));

  act(route);
  setInterval(tick, 1500);
})();
