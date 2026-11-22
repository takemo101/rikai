// コメントの位置を、版が変わった本文から探し直す。DOM に触れない純粋な関数だけ（サーバー・画面・テストが共有する）。
// 選んだ文は、W3C の TextQuoteSelector と同じ考え方（human-review の anchor-text）：quote を探し、前後の文脈で同じ文を区別する。

/** 選んだ文のアンカー（前後の文脈つき） */
export interface QuoteAnchor {
  quote?: string | null;
  prefix?: string | null;
  suffix?: string | null;
}

/** ブロックへのアンカー */
export interface BlockAnchor {
  blockId?: string | null;
  blockHash?: string | null;
  blockTag?: string | null;
  blockText?: string | null;
}

/** 本文のブロック（本文の順に渡す） */
export interface BlockInfo {
  id: string;
  hash: string;
  tag: string;
  text: string;
}

export interface QuoteHit {
  start: number;
  end: number;
}

/** 'similar'：同じ種類で内容が近い／'position'：同じ種類の、同じ位置。どちらも推定 */
export type Approx = 'similar' | 'position';

export interface BlockHit {
  index: number;
  approx: Approx | null;
}

function occurrences(text: string, quote: string): number[] {
  const found: number[] = [];
  let at = text.indexOf(quote);
  while (at !== -1) {
    found.push(at);
    at = text.indexOf(quote, at + 1);
  }
  return found;
}

const commonSuffix = (a: string, b: string): number => {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
};
const commonPrefix = (a: string, b: string): number => {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
};

function bestHit(text: string, hits: number[], quote: string, prefix: string, suffix: string): number {
  let best = hits[0] as number;
  let bs = -1;
  for (const at of hits) {
    const sc =
      commonSuffix(prefix, text.slice(Math.max(0, at - prefix.length), at)) +
      commonPrefix(suffix, text.slice(at + quote.length, at + quote.length + suffix.length));
    if (sc > bs) {
      bs = sc;
      best = at;
    }
  }
  return best;
}

// 空白の連続を 1 つにまとめ、まとめたあとの各文字が、元の何文字目かを覚える
function collapseWithMap(text: string): { flat: string; map: number[] } {
  let flat = '';
  let pending = -1;
  const map: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (/\s/.test(text[i] as string)) {
      if (pending === -1) pending = i;
      continue;
    }
    if (pending !== -1 && flat) {
      flat += ' ';
      map.push(pending);
    }
    pending = -1;
    flat += text[i];
    map.push(i);
  }
  return { flat, map };
}

/** text の中で a.quote の位置 { start, end } を返す。なければ null。整形し直しで空白だけが変わった場合は、空白をまとめて探す */
export function findQuote(text: string, a: QuoteAnchor | null | undefined): QuoteHit | null {
  const quote = a?.quote;
  if (!a || !quote) return null;
  const hits = occurrences(text, quote);
  if (hits.length) {
    const at = hits.length === 1 ? (hits[0] as number) : bestHit(text, hits, quote, a.prefix || '', a.suffix || '');
    return { start: at, end: at + quote.length };
  }
  const { flat, map } = collapseWithMap(text);
  const fq = quote.replace(/\s+/g, ' ').trim();
  if (!fq || !map.length) return null;
  const fh = occurrences(flat, fq);
  if (!fh.length) return null;
  const at = bestHit(flat, fh, fq, (a.prefix || '').replace(/\s+/g, ' '), (a.suffix || '').replace(/\s+/g, ' '));
  return { start: map[at] as number, end: (map[at + fq.length - 1] as number) + 1 };
}

const norm = (s: unknown): string =>
  String(s || '')
    .replace(/\s+/g, ' ')
    .trim();

/** 文字の 2 つ組の重なり（Dice 係数）。0〜1。直された表・段落が、元と近いかを見る */
export function similarity(a: unknown, b: unknown): number {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return 0;
  const grams = new Map<string, number>();
  for (let i = 0; i < x.length - 1; i++) {
    const g = x.slice(i, i + 2);
    grams.set(g, (grams.get(g) || 0) + 1);
  }
  let hit = 0;
  for (let i = 0; i < y.length - 1; i++) {
    const g = y.slice(i, i + 2);
    const n = grams.get(g);
    if (n) {
      hit++;
      grams.set(g, n - 1);
    }
  }
  return (2 * hit) / (x.length - 1 + y.length - 1);
}

const SIMILAR = 0.5;
export const EXCERPT = 200;

/**
 * ブロックへのコメントの探し直し。blocks は本文の順。
 * 1) 同じ内容のブロック（確実）→ 2) 同じ種類で、内容が近いブロック（推定）→ 3) 同じ種類の、同じ位置のブロック（推定）。なければ null
 */
export function locateBlock(blocks: BlockInfo[], a: BlockAnchor | null | undefined): BlockHit | null {
  if (!a || !blocks.length) return null;
  const indexed = blocks.map((b, index) => ({ b, index }));
  const same = indexed.filter((x) => a.blockHash && x.b.hash === a.blockHash);
  if (same.length)
    return {
      index: (same.find((x) => x.b.id === a.blockId) || (same[0] as (typeof same)[number])).index,
      approx: null,
    };
  const kind = indexed.filter((x) => !a.blockTag || x.b.tag === a.blockTag);
  const want = norm(a.blockText).slice(0, EXCERPT);
  if (want) {
    let best: (typeof kind)[number] | null = null;
    let bs = 0;
    for (const x of kind) {
      const s = similarity(want, norm(x.b.text).slice(0, EXCERPT));
      if (s > bs) {
        bs = s;
        best = x;
      }
    }
    if (best && bs >= SIMILAR) return { index: best.index, approx: 'similar' };
  }
  const here = kind.find((x) => x.b.id === a.blockId);
  if (here) return { index: here.index, approx: 'position' };
  return null;
}
