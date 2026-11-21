'use strict';
// コメントの位置を、版が変わった本文から探し直す。DOM に触れない純粋な関数だけ（ブラウザと Node のテストの両方で使う）。
// 選んだ文は、W3C の TextQuoteSelector と同じ考え方（human-review の anchor-text）：quote を探し、前後の文脈で同じ文を区別する。
(function (root) {
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

  // 空白の連続を 1 つにまとめ、まとめたあとの各文字が、元の何文字目かを覚える
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

  // text の中で a.quote の位置 { start, end } を返す。なければ null。整形し直しで空白だけが変わった場合は、空白をまとめて探す
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

  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();

  // 文字の 2 つ組の重なり（Dice 係数）。0〜1。直された表・段落が、元と近いかを見る
  function similarity(a, b) {
    a = norm(a); b = norm(b);
    if (!a || !b) return 0;
    if (a === b) return 1;
    if (a.length < 2 || b.length < 2) return 0;
    const grams = new Map();
    for (let i = 0; i < a.length - 1; i++) { const g = a.slice(i, i + 2); grams.set(g, (grams.get(g) || 0) + 1); }
    let hit = 0;
    for (let i = 0; i < b.length - 1; i++) {
      const g = b.slice(i, i + 2);
      const n = grams.get(g);
      if (n) { hit++; grams.set(g, n - 1); }
    }
    return (2 * hit) / (a.length - 1 + b.length - 1);
  }

  const SIMILAR = 0.5;
  const EXCERPT = 200;

  // ブロックへのコメントの探し直し。blocks は [{ id, hash, tag, text }]（本文の順）。
  // 1) 同じ内容のブロック（確実）→ 2) 同じ種類で、内容が近いブロック（推定）→ 3) 同じ種類の、同じ位置のブロック（推定）。なければ null
  function locateBlock(blocks, a) {
    if (!a || !blocks.length) return null;
    const same = blocks.map((b, index) => ({ b, index })).filter((x) => a.blockHash && x.b.hash === a.blockHash);
    if (same.length) return { index: (same.find((x) => x.b.id === a.blockId) || same[0]).index, approx: null };
    const kind = blocks.map((b, index) => ({ b, index })).filter((x) => !a.blockTag || x.b.tag === a.blockTag);
    const want = norm(a.blockText).slice(0, EXCERPT);
    if (want) {
      let best = null, bs = 0;
      for (const x of kind) {
        const s = similarity(want, norm(x.b.text).slice(0, EXCERPT));
        if (s > bs) { bs = s; best = x; }
      }
      if (best && bs >= SIMILAR) return { index: best.index, approx: 'similar' };
    }
    const here = kind.find((x) => x.b.id === a.blockId);
    if (here) return { index: here.index, approx: 'position' };
    return null;
  }

  const api = { findQuote, locateBlock, similarity, EXCERPT };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RikaiAnchor = api;
})(typeof window !== 'undefined' ? window : globalThis);
