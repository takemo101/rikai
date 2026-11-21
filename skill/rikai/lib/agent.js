'use strict';
// AI 向け：Submit された round を読む（peek）と、返信・新版・子ページを反映する（cmdApply）。
const fs = require('fs');
const path = require('path');
const { HttpError, now, readJSON, writeJSON, normAnchor } = require('./util.js');
const { SLUG_RE, tdir, pageFile, mutate, nextId, loadMeta, loadThreads, countUnsent } = require('./store.js');
const { normAsk } = require('./ask.js');

function listRounds(slug) {
  const dir = path.join(tdir(slug), 'rounds');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => /^\d+\.json$/.test(f)).sort().map((f) => readJSON(path.join(dir, f), null)).filter(Boolean);
}

// Submit されたものがあるか。poll（待つ）と pull（待たない）が共有する。
// 出力の status（feedback / closed / none）は、round のレコードの status（pending / handled）とは別の語なので、必ずレコードの後に置く
function peek(slug) {
  const meta = loadMeta(slug);
  const pend = listRounds(slug).find((r) => r.status === 'pending');
  if (pend) return { ...pend, status: 'feedback', nextStep: 'コメントごとに返信し、rikai apply で反映する。Claude Code は、そのあと、もう一度 rikai poll をバックグラウンドで起動する' };
  if (meta.closed) return { status: 'closed', unsent: countUnsent(loadThreads(slug)) };
  return { status: 'none', message: 'まだ Submit されたコメントはありません', unsent: countUnsent(loadThreads(slug)) };
}

function cmdApply(slug, payload) {
  const P = payload || {};
  const asArr = (v) => (Array.isArray(v) ? v : []);
  return mutate(slug, (meta, th) => {
    const errs = [];
    const newPages = asArr(P.pages);
    const revisions = asArr(P.revisions);
    const replies = asArr(P.replies);
    const newThreads = asArr(P.threads);
    const known = new Set(Object.keys(meta.pages));
    const created = new Set();
    const hasPage = (id) => known.has(id) || created.has(id);

    newPages.forEach((p, i) => {
      const w = `pages[${i}]`;
      if (!SLUG_RE.test(String(p.id || ''))) errs.push(`${w}.id は英小文字・数字・ハイフン`);
      else if (hasPage(p.id)) errs.push(`${w}.id が既存: ${p.id}`);
      if (!String(p.title || '').trim()) errs.push(`${w}.title が空`);
      if (!String(p.markdown || '').trim()) errs.push(`${w}.markdown が空`);
      const parent = p.parent || 'root';
      if (!hasPage(parent)) errs.push(`${w}.parent が存在しない: ${parent}`);
      if (SLUG_RE.test(String(p.id || ''))) created.add(p.id);
    });

    const revised = {};
    revisions.forEach((r, i) => {
      const w = `revisions[${i}]`;
      if (!known.has(r.page)) errs.push(`${w}.page が既存ページではない: ${r.page}`);
      else if (revised[r.page]) errs.push(`${w}.page を1回の apply で2回直せない: ${r.page}`);
      else revised[r.page] = meta.pages[r.page].versions + 1;
      if (!String(r.markdown || '').trim()) errs.push(`${w}.markdown が空`);
    });

    const normReplies = replies.map((r, i) => {
      const w = `replies[${i}]`;
      if (!th.threads.some((t) => t.id === r.thread)) errs.push(`${w}.thread が存在しない: ${r.thread}`);
      if (!String(r.body || '').trim()) errs.push(`${w}.body が空`);
      if (r.page != null && !hasPage(r.page)) errs.push(`${w}.page が存在しない: ${r.page}`);
      return { ...r, ask: normAsk(r.ask, w, errs) };
    });
    const normNew = newThreads.map((r, i) => {
      const w = `threads[${i}]`;
      if (!hasPage(r.page)) errs.push(`${w}.page が存在しない: ${r.page}`);
      if (!String(r.body || '').trim()) errs.push(`${w}.body が空`);
      if (r.link != null && !hasPage(r.link)) errs.push(`${w}.link が存在しない: ${r.link}`);
      return { ...r, ask: normAsk(r.ask, w, errs) };
    });

    const pendingRounds = listRounds(slug).filter((r) => r.status === 'pending');
    let handle = pendingRounds;
    if (P.round != null) {
      handle = pendingRounds.filter((r) => r.round === Number(P.round));
      if (!handle.length) errs.push(`round ${P.round} は未処理ではありません`);
    }
    if (errs.length) throw new HttpError(400, errs.join('\n'));

    // ここから書き込み
    for (const p of newPages) {
      fs.mkdirSync(path.join(tdir(slug), 'pages', p.id), { recursive: true });
      fs.writeFileSync(pageFile(slug, p.id, 1), p.markdown);
      meta.pages[p.id] = { title: String(p.title).trim(), parent: p.parent || 'root', versions: 1, createdAt: now() };
    }
    for (const r of revisions) {
      const pg = meta.pages[r.page];
      pg.versions += 1;
      if (r.title) pg.title = String(r.title).trim();
      fs.writeFileSync(pageFile(slug, r.page, pg.versions), r.markdown);
    }
    const replied = [];
    for (const r of normReplies) {
      const t = th.threads.find((x) => x.id === r.thread);
      t.messages.push({
        id: nextId(th, 'm'), author: 'ai', kind: 'reply', at: now(), text: String(r.body), sent: true,
        ...(r.ask ? { ask: r.ask } : {}), ...(r.page ? { page: r.page } : {}),
        ...(revised[t.page] ? { revision: revised[t.page] } : {}),
      });
      replied.push(t.id);
    }
    const started = [];
    for (const r of normNew) {
      const pg = meta.pages[r.page] || { versions: 1 };
      const t = {
        id: nextId(th, 't'), page: r.page, version: pg.versions, anchor: normAnchor(r.anchor), resolved: false, resolveSent: true,
        createdAt: now(), origin: 'ai',
        messages: [{
          id: nextId(th, 'm'), author: 'ai', kind: 'reply', at: now(), text: String(r.body), sent: true,
          ...(r.ask ? { ask: r.ask } : {}), ...(r.link ? { page: r.link } : {}),
        }],
      };
      th.threads.push(t);
      started.push(t.id);
    }
    const handledNos = handle.map((r) => r.round);
    const unanswered = [];
    for (const r of handle) {
      r.status = 'handled';
      r.handledAt = now();
      writeJSON(path.join(tdir(slug), 'rounds', `${String(r.round).padStart(3, '0')}.json`), r);
      // 返信が要るのは、新しい発言があるとき、または再開されたとき（「解決」だけの通知には、返信しなくてよい）
      for (const it of r.items) if (!replied.includes(it.thread) && (it.new.length || it.userMarked === 'reopened')) unanswered.push(it.thread);
    }
    meta.pending = (meta.pending || []).filter((n) => !handledNos.includes(n));
    return {
      ok: true, handledRounds: handledNos, newPages: [...created], revised, repliedThreads: replied, newThreads: started,
      ...(unanswered.length ? { unansweredThreads: unanswered, warning: '返信していないスレッドがあります' } : {}),
    };
  });
}

module.exports = { listRounds, peek, cmdApply };
