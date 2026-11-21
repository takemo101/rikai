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
    try { j = await res.json(); } catch (_) { throw new Error('通信エラー'); }
    if (!res.ok || j.ok === false) throw new Error(j.error || 'エラー');
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

  // ------------------------------------------------------------ 引用の再特定（human-review の anchor-text と同じ考え方）
  function occurrences(text, quote) {
    const found = [];
    let at = text.indexOf(quote);
    while (at !== -1) { found.push(at); at = text.indexOf(quote, at + 1); }
    return found;
  }
  const commonSuffix = (a, b) => { let n = 0; while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++; return n; };
  const commonPrefix = (a, b) => { let n = 0; while (n < a.length && n < b.length && a[n] === b[n]) n++; return n; };
  function bestHit(text, hits, quote, prefix, suffix) {
    let best = hits[0], bs = -1;
    for (const at of hits) {
      const sc = commonSuffix(prefix, text.slice(Math.max(0, at - prefix.length), at)) + commonPrefix(suffix, text.slice(at + quote.length, at + quote.length + suffix.length));
      if (sc > bs) { bs = sc; best = at; }
    }
    return best;
  }
  function collapseWithMap(text) {
    let flat = '', pending = -1;
    const map = [];
    for (let i = 0; i < text.length; i++) {
      if (/\s/.test(text[i])) { if (pending === -1) pending = i; continue; }
      if (pending !== -1 && flat) { flat += ' '; map.push(pending); }
      pending = -1;
      flat += text[i];
      map.push(i);
    }
    return { flat, map };
  }
  function findQuote(text, a) {
    const quote = a && a.quote;
    if (!quote) return null;
    const hits = occurrences(text, quote);
    if (hits.length) {
      const at = hits.length === 1 ? hits[0] : bestHit(text, hits, quote, a.prefix || '', a.suffix || '');
      return { start: at, end: at + quote.length };
    }
    const { flat, map } = collapseWithMap(text);
    const fq = quote.replace(/\s+/g, ' ').trim();
    if (!fq || !map.length) return null;
    const fh = occurrences(flat, fq);
    if (!fh.length) return null;
    const at = bestHit(flat, fh, fq, (a.prefix || '').replace(/\s+/g, ' '), (a.suffix || '').replace(/\s+/g, ' '));
    return { start: map[at], end: map[at + fq.length - 1] + 1 };
  }

  // ------------------------------------------------------------ 状態
  const S = {
    topics: [], slug: null, page: 'root', version: null, topic: null,
    md: null, prevMd: null, loaded: '', docSig: '',
    composer: null, active: null, showChanges: true, locs: new Map(), renderTok: 0,
    drafts: { reply: {}, ask: {}, edit: {}, composer: '' },
    editing: null, seen: new Set(JSON.parse(localStorage.getItem('rikai-seen') || '[]')), offline: false,
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
  function blockEls(root) {
    const out = [];
    for (const el of root.children) {
      if (el.tagName === 'UL' || el.tagName === 'OL') { for (const li of el.children) if (li.tagName === 'LI') out.push(li); } else out.push(el);
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
        if (!p || p.closest('.mermaid-block, style, script')) return NodeFilter.FILTER_REJECT;
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
    return { blockId: el.dataset.bid || '', blockHash: el.dataset.bhash || '', quote: '', prefix: '', suffix: '', label: blockLabel(el) };
  }
  function anchorFromSelection() {
    const sel = getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed) return null;
    const r = sel.getRangeAt(0);
    const art = $('#article');
    if (!art.contains(r.commonAncestorContainer)) return null;
    const a = elOf(r.startContainer), b = elOf(r.endContainer);
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
    const v = curVersion();
    const blocks = blockEls(art);
    for (const t of threadsOnPage()) {
      if (t.version > v) { S.locs.set(t.id, null); continue; }
      const a = t.anchor;
      if (!a) { S.locs.set(t.id, null); continue; }
      let el = null;
      if (a.quote) {
        const idx = textIndex(art);
        const hit = findQuote(idx.text, a);
        if (hit) el = wrapRange(art, hit.start, hit.end, t.id, statusClass(t));
      }
      if (!el && !a.quote) {
        el = blocks.find((b) => b.dataset.bhash === a.blockHash) || (t.version === v ? blocks.find((b) => b.dataset.bid === a.blockId) : null) || null;
        if (el) { el.classList.add('blk-thread', statusClass(t)); el.dataset.tid = t.id; }
      }
      S.locs.set(t.id, el);
    }
  }

  async function renderDoc() {
    const tok = ++S.renderTok;
    const scroller = $('#docscroll');
    const scroll = scroller.scrollTop;
    const art = $('#article');
    const v = curVersion();
    const frag = mdToFragment(S.md, S.slug);
    markBlocks(frag);
    if (S.showChanges && v > 1 && S.prevMd != null) {
      const prev = mdToFragment(S.prevMd, S.slug);
      markBlocks(prev);
      const seen = new Set(blockEls(prev).map((e) => e.dataset.bhash));
      for (const el of blockEls(frag)) if (!seen.has(el.dataset.bhash)) el.classList.add('changed');
    }
    art.replaceChildren(frag);
    await fillMermaid(art);
    if (tok !== S.renderTok) return;
    applyHighlights(art);
    scroller.scrollTop = scroll;
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
    if (S.offline) st.append(h('span', { class: 'chip warn', text: 'サーバーに接続できません' }));
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
        h('a', { href: `#/${t.slug}/root`, text: t.title }),
        t.pending ? h('span', { class: 'chip wait small', text: '待ち' }) : null,
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
        bar.append(h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: S.showChanges, onchange: (e) => { S.showChanges = e.target.checked; S.docSig = ''; loadPage(); } }), '前の版からの変更を表示'));
      }
    }
    if (!isLatest()) {
      bar.append(h('span', { class: 'chip warn', text: `過去の版 v${curVersion()} を表示中（コメントは最新版にだけ付けられます）` }),
        h('a', { class: 'btnlink', href: `#/${S.slug}/${S.page}`, text: '最新版へ' }));
    }
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
      h('span', { class: `chip ${stCls} small`, text: stText }),
      h('span', { class: 'chip small', text: `v${t.version}` }),
      orphan ? h('span', { class: 'chip warn small', text: '修正で文が変わりました' }) : null,
      future ? h('span', { class: 'chip small', text: '後の版のコメント' }) : null,
      h('div', { class: 'quote', text: trunc(quote, 90) })));
    for (const m of t.messages) card.append(renderMessage(t, m));
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
    if (S.composer) panel.append(renderComposer());
    const list = threadsOnPage();
    const live = list.filter((t) => !t.resolved).sort(docOrder);
    const done = list.filter((t) => t.resolved).sort(docOrder);
    if (!list.length && !S.composer) panel.append(h('div', { class: 'empty', text: '本文の文を選択すると「コメント」が出ます。図・表・画像は、ブロックの右に出る ＋ から。' }));
    for (const t of live) panel.append(renderThread(t));
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
      h('div', { class: 'th-head' }, h('span', { class: 'chip draft small', text: '新しいコメント' }), h('div', { class: 'quote', text: trunc(a.quote || a.label, 90) })),
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

  function renderAll() {
    renderTop();
    renderSide();
    renderDocbar();
    renderThreads();
    $('#ended').hidden = !(S.topic && S.topic.meta.closed);
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
    if (!r) {
      if (!S.topics.length) { $('#article').textContent = 'トピックがありません。/rikai で資料を作ってください。'; return; }
      location.hash = `#/${S.topics[0].slug}/root`;
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
      await refreshTopic(false);
      if (S.offline) { S.offline = false; renderTop(); }
      renderSide();
    } catch (_) {
      if (!S.offline) { S.offline = true; renderTop(); }
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
  blkbtn.addEventListener('mouseleave', () => { blkbtn.hidden = true; });

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

  $('#docscroll').addEventListener('mousemove', (e) => {
    if (!isLatest()) return;
    const blk = e.target.closest && e.target.closest('#article [data-bid]');
    if (!blk) { clearTimeout(blkHide); blkHide = setTimeout(() => { blkbtn.hidden = true; }, 200); return; }
    clearTimeout(blkHide);
    if (blk === blkTarget && !blkbtn.hidden) return;
    blkTarget = blk;
    const r = blk.getBoundingClientRect();
    const art = $('#article').getBoundingClientRect();
    blkbtn.style.left = `${art.right + 6}px`;
    blkbtn.style.top = `${Math.max(r.top, 50)}px`;
    blkbtn.hidden = false;
  });
  $('#docscroll').addEventListener('scroll', () => { blkbtn.hidden = true; });
  $('#docscroll').addEventListener('mouseleave', () => { blkHide = setTimeout(() => { blkbtn.hidden = true; }, 200); });

  $('#article').addEventListener('click', (e) => {
    const a = e.target.closest('a[data-page]');
    if (a) return; // ハッシュで遷移する
    const el = e.target.closest('[data-tid]');
    if (el) focusThread(el.dataset.tid, false);
  });

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
