// 版どうしの差分。DOM に触れない純粋な関数だけ（サーバー・画面・テストが共有する）。
//  - diffText: 2 つの文字列の、トークン単位の差分（同じ・追加・削除）
//  - matchBlocks: 前の版と今の版のブロックの対応づけ（同じ・変更・追加・削除）。順序を保つ。内容が同じでも、種類（tag）が違えば「変更」
import { similarity } from './anchor';

/** 半角の英数字の連続・空白の連続は 1 つ、それ以外（日本語など）は 1 文字ずつ */
export function tokenize(s: unknown): string[] {
  return String(s).match(/[A-Za-z0-9_]+|\s+|[^\s]/gu) || [];
}

/** 動的計画法の表の上限（トークン数の積）。超えたら、丸ごとの置き換えにして、固まらないようにする */
export const MAX_CELLS = 1_000_000;

/** eq と del をつなぐと a、eq と ins をつなぐと b になる */
export interface DiffOp {
  t: 'eq' | 'del' | 'ins';
  s: string;
}

function pushOp(ops: DiffOp[], t: DiffOp['t'], s: string): void {
  if (!s) return;
  const last = ops[ops.length - 1];
  if (last && last.t === t) last.s += s;
  else ops.push({ t, s });
}

export function diffText(a: unknown, b: unknown): DiffOp[] {
  const sa = String(a);
  const sb = String(b);
  if (sa === sb) return sa ? [{ t: 'eq', s: sa }] : [];
  const x = tokenize(sa);
  const y = tokenize(sb);
  let pre = 0;
  while (pre < x.length && pre < y.length && x[pre] === y[pre]) pre++;
  let suf = 0;
  while (suf < x.length - pre && suf < y.length - pre && x[x.length - 1 - suf] === y[y.length - 1 - suf]) suf++;
  const xm = x.slice(pre, x.length - suf);
  const ym = y.slice(pre, y.length - suf);
  const ops: DiffOp[] = [];
  pushOp(ops, 'eq', x.slice(0, pre).join(''));
  if (xm.length * ym.length > MAX_CELLS) {
    pushOp(ops, 'del', xm.join(''));
    pushOp(ops, 'ins', ym.join(''));
  } else {
    const n = xm.length;
    const m = ym.length;
    const w = m + 1;
    const dp = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i * w + j] =
          xm[i] === ym[j]
            ? (dp[(i + 1) * w + j + 1] as number) + 1
            : Math.max(dp[(i + 1) * w + j] as number, dp[i * w + j + 1] as number);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (xm[i] === ym[j]) {
        pushOp(ops, 'eq', xm[i] as string);
        i++;
        j++;
      } else if ((dp[(i + 1) * w + j] as number) >= (dp[i * w + j + 1] as number)) {
        pushOp(ops, 'del', xm[i] as string);
        i++;
      } else {
        pushOp(ops, 'ins', ym[j] as string);
        j++;
      }
    }
    while (i < n) pushOp(ops, 'del', xm[i++] as string);
    while (j < m) pushOp(ops, 'ins', ym[j++] as string);
  }
  pushOp(ops, 'eq', x.slice(x.length - suf).join(''));
  return ops;
}

const SIMILAR = 0.5;
/** 順序を保つ対応づけの表（ブロック数の積）の上限。超えたら、同じ内容を先頭から対応づける */
export const MAX_BLOCK_CELLS = 4_000_000;
/** 近いブロックを探すとき、比べる組の数の、全体の上限。使い切ったら、残りの区間は、追加と削除にする（時間の保護） */
export const MAX_PAIRS = 20_000;
/** 近さを見る、ブロックの文字の長さ（先頭から） */
const MATCH_EXCERPT = 200;

/** 対応づけに使うブロックの要約（本文の順） */
export interface BlockSig {
  hash: string;
  tag: string;
  text: string;
}

export type MatchStatus = 'same' | 'changed' | 'added';

export interface BlockMatch {
  status: MatchStatus;
  /** 前の版の添字。なければ null */
  prev: number | null;
}

export interface BlockMatches {
  /** 今の版の各ブロックごと */
  cur: BlockMatch[];
  /** 前の版にあって、対応する今のブロックがない添字 */
  removed: number[];
  /** 近さを調べる組の数の予算（`MAX_PAIRS`）を超えて、近さによる対応づけを、一部の区間で、していない（そこは、追加と削除になる） */
  limited: boolean;
}

/**
 * 1) 同じ内容（hash）を、順序を保って対応づける（最長共通部分列）。種類（tag）まで同じなら「同じ」・違えば「変更」
 * 2) 残りを、同じ「同じ」の間の区間の中で、同じ種類で内容が近いものどうし（類似度 0.5 以上。高い順）
 * 3) 残りの今のブロックは追加、前のブロックは削除
 */
export function matchBlocks(prev: BlockSig[], cur: BlockSig[]): BlockMatches {
  const n = prev.length;
  const m = cur.length;
  const curPrev: (number | null)[] = new Array(m).fill(null);
  const status: MatchStatus[] = new Array(m).fill('added');
  const prevUsed: boolean[] = new Array(n).fill(false);
  const anchors: [number, number][] = []; // 順序を保った [prev 添字, cur 添字]

  if (n * m <= MAX_BLOCK_CELLS) {
    const w = m + 1;
    const dp = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i * w + j] =
          (prev[i] as BlockSig).hash === (cur[j] as BlockSig).hash
            ? (dp[(i + 1) * w + j + 1] as number) + 1
            : Math.max(dp[(i + 1) * w + j] as number, dp[i * w + j + 1] as number);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if ((prev[i] as BlockSig).hash === (cur[j] as BlockSig).hash) {
        anchors.push([i, j]);
        i++;
        j++;
      } else if ((dp[(i + 1) * w + j] as number) >= (dp[i * w + j + 1] as number)) i++;
      else j++;
    }
  } else {
    // 大きすぎるときは、順序を見ずに、同じ内容を先頭から対応づける
    const free = new Map<string, number[]>();
    prev.forEach((p, i) => {
      const list = free.get(p.hash);
      if (list) list.push(i);
      else free.set(p.hash, [i]);
    });
    cur.forEach((c, j) => {
      const l = free.get(c.hash);
      if (l?.length) anchors.push([l.shift() as number, j]);
    });
    anchors.sort((p, q) => p[1] - q[1]);
  }
  for (const [i, j] of anchors) {
    curPrev[j] = i;
    // 内容が同じでも、ブロックの種類（段落 → 見出し・引用など）が違えば、変更（対応はつける：追加と削除には、しない）
    status[j] = (prev[i] as BlockSig).tag === (cur[j] as BlockSig).tag ? 'same' : 'changed';
    prevUsed[i] = true;
  }

  // 内容が近いかを見るのは、先頭の MATCH_EXCERPT 文字だけ。一度だけ整えて、何度も整えない
  const norm = (t: string): string => String(t).replace(/\s+/g, ' ').trim().slice(0, MATCH_EXCERPT);
  const pex = prev.map((p) => norm(p.text));
  const cex = cur.map((c) => norm(c.text));
  const bounds: [number, number][] = [[-1, -1], ...anchors, [n, m]];
  let budget = MAX_PAIRS;
  let limited = false;
  for (let k = 0; k + 1 < bounds.length; k++) {
    const [pa, ca] = bounds[k] as [number, number];
    const [pb, cb] = bounds[k + 1] as [number, number];
    // 比べる組の数は、区間のブロック数の積で増える。残りの予算を超える区間は、近さを調べず、追加と削除にする
    const pairs = (pb - pa - 1) * (cb - ca - 1);
    if (pairs > budget) {
      limited = true;
      continue;
    }
    budget -= Math.max(0, pairs);
    const cand: { i: number; j: number; s: number }[] = [];
    for (let j = ca + 1; j < cb; j++) {
      for (let i = pa + 1; i < pb; i++) {
        if ((prev[i] as BlockSig).tag !== (cur[j] as BlockSig).tag) continue;
        const s = similarity(pex[i], cex[j]);
        if (s >= SIMILAR) cand.push({ i, j, s });
      }
    }
    cand.sort((p, q) => q.s - p.s || p.j - q.j || p.i - q.i);
    for (const c of cand) {
      if (prevUsed[c.i] || curPrev[c.j] !== null) continue;
      prevUsed[c.i] = true;
      curPrev[c.j] = c.i;
      status[c.j] = 'changed';
    }
  }
  const removed: number[] = [];
  for (let i = 0; i < n; i++) if (!prevUsed[i]) removed.push(i);
  return {
    cur: cur.map((_, j) => ({ status: status[j] as MatchStatus, prev: curPrev[j] as number | null })),
    removed,
    limited,
  };
}
