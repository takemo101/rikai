'use strict';
// 版どうしの差分。DOM に触れない純粋な関数だけ（ブラウザと Node のテストの両方で使う）。
//  - diffText: 2 つの文字列の、トークン単位の差分（同じ・追加・削除）
//  - matchBlocks: 前の版と今の版のブロックの対応づけ（同じ・変更・追加・削除）。順序を保つ
(function (root) {
  const anchor = typeof module !== 'undefined' && module.exports ? require('./anchor.js') : root.RikaiAnchor;

  // 半角の英数字の連続・空白の連続は 1 つ、それ以外（日本語など）は 1 文字ずつ
  function tokenize(s) {
    return String(s).match(/[A-Za-z0-9_]+|\s+|[^\s]/gu) || [];
  }

  // 動的計画法の表の上限（トークン数の積）。超えたら、丸ごとの置き換えにして、固まらないようにする
  const MAX_CELLS = 1_000_000;

  function pushOp(ops, t, s) {
    if (!s) return;
    const last = ops[ops.length - 1];
    if (last && last.t === t) last.s += s;
    else ops.push({ t, s });
  }

  // 戻り値: [{ t: 'eq' | 'del' | 'ins', s }]。eq と del をつなぐと a、eq と ins をつなぐと b になる
  function diffText(a, b) {
    a = String(a); b = String(b);
    if (a === b) return a ? [{ t: 'eq', s: a }] : [];
    const x = tokenize(a), y = tokenize(b);
    let pre = 0;
    while (pre < x.length && pre < y.length && x[pre] === y[pre]) pre++;
    let suf = 0;
    while (suf < x.length - pre && suf < y.length - pre && x[x.length - 1 - suf] === y[y.length - 1 - suf]) suf++;
    const xm = x.slice(pre, x.length - suf), ym = y.slice(pre, y.length - suf);
    const ops = [];
    pushOp(ops, 'eq', x.slice(0, pre).join(''));
    if (xm.length * ym.length > MAX_CELLS) {
      pushOp(ops, 'del', xm.join(''));
      pushOp(ops, 'ins', ym.join(''));
    } else {
      const n = xm.length, m = ym.length, w = m + 1;
      const dp = new Uint32Array((n + 1) * w);
      for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
          dp[i * w + j] = xm[i] === ym[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
        }
      }
      let i = 0, j = 0;
      while (i < n && j < m) {
        if (xm[i] === ym[j]) { pushOp(ops, 'eq', xm[i]); i++; j++; }
        else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) { pushOp(ops, 'del', xm[i]); i++; }
        else { pushOp(ops, 'ins', ym[j]); j++; }
      }
      while (i < n) pushOp(ops, 'del', xm[i++]);
      while (j < m) pushOp(ops, 'ins', ym[j++]);
    }
    pushOp(ops, 'eq', x.slice(x.length - suf).join(''));
    return ops;
  }

  const SIMILAR = 0.5;
  // 順序を保つ対応づけの表（ブロック数の積）の上限。超えたら、同じ内容を先頭から対応づける
  const MAX_BLOCK_CELLS = 4_000_000;
  // 近いブロックを探す、1 つの区間の、比べる組の数の上限。超えたら、その区間は、追加と削除にする
  const MAX_GAP_PAIRS = 40_000;
  // 近さを見る、ブロックの文字の長さ（先頭から）
  const MATCH_EXCERPT = 400;

  // prev・cur は [{ hash, tag, text }]（本文の順）。戻り値:
  //   cur: 今の版の各ブロックごとの { status: 'same' | 'changed' | 'added', prev: 前の版の添字 | null }
  //   removed: 前の版にあって、対応する今のブロックがない添字
  // 1) 同じ内容（hash）を、順序を保って対応づける（最長共通部分列）
  // 2) 残りを、同じ「同じ」の間の区間の中で、同じ種類で内容が近いものどうし（類似度 0.5 以上。高い順）
  // 3) 残りの今のブロックは追加、前のブロックは削除

  function matchBlocks(prev, cur) {
    const n = prev.length, m = cur.length;
    const curPrev = new Array(m).fill(null);
    const status = new Array(m).fill('added');
    const prevUsed = new Array(n).fill(false);
    const anchors = []; // 順序を保った [prev 添字, cur 添字]

    if (n * m <= MAX_BLOCK_CELLS) {
      const w = m + 1;
      const dp = new Uint32Array((n + 1) * w);
      for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
          dp[i * w + j] = prev[i].hash === cur[j].hash ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
        }
      }
      let i = 0, j = 0;
      while (i < n && j < m) {
        if (prev[i].hash === cur[j].hash) { anchors.push([i, j]); i++; j++; }
        else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) i++;
        else j++;
      }
    } else {
      // 大きすぎるときは、順序を見ずに、同じ内容を先頭から対応づける
      const free = new Map();
      prev.forEach((p, i) => { if (!free.has(p.hash)) free.set(p.hash, []); free.get(p.hash).push(i); });
      cur.forEach((c, j) => { const l = free.get(c.hash); if (l && l.length) anchors.push([l.shift(), j]); });
      anchors.sort((p, q) => p[1] - q[1]);
    }
    for (const [i, j] of anchors) { curPrev[j] = i; status[j] = 'same'; prevUsed[i] = true; }

    // 内容が近いかを見るのは、先頭の MATCH_EXCERPT 文字だけ。一度だけ整えて、何度も整えない
    const norm = (t) => String(t).replace(/\s+/g, ' ').trim().slice(0, MATCH_EXCERPT);
    const pex = prev.map((p) => norm(p.text)), cex = cur.map((c) => norm(c.text));
    const bounds = [[-1, -1], ...anchors, [n, m]];
    for (let k = 0; k + 1 < bounds.length; k++) {
      const [pa, ca] = bounds[k], [pb, cb] = bounds[k + 1];
      // 区間が大きすぎるとき（ほとんど全部が書き直された資料）は、近さを調べず、追加と削除にする（比べる組の数が、積で増えるため）
      if ((pb - pa - 1) * (cb - ca - 1) > MAX_GAP_PAIRS) continue;
      const cand = [];
      for (let j = ca + 1; j < cb; j++) {
        for (let i = pa + 1; i < pb; i++) {
          if (prev[i].tag !== cur[j].tag) continue;
          const s = anchor.similarity(pex[i], cex[j]);
          if (s >= SIMILAR) cand.push({ i, j, s });
        }
      }
      cand.sort((p, q) => q.s - p.s || p.j - q.j || p.i - q.i);
      for (const c of cand) {
        if (prevUsed[c.i] || curPrev[c.j] !== null) continue;
        prevUsed[c.i] = true; curPrev[c.j] = c.i; status[c.j] = 'changed';
      }
    }
    const removed = [];
    for (let i = 0; i < n; i++) if (!prevUsed[i]) removed.push(i);
    return { cur: cur.map((_, j) => ({ status: status[j], prev: curPrev[j] })), removed };
  }

  const api = { tokenize, diffText, matchBlocks, MAX_CELLS, MAX_BLOCK_CELLS, MAX_GAP_PAIRS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RikaiDiff = api;
})(typeof window !== 'undefined' ? window : globalThis);
