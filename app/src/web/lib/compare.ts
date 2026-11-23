// 版を並べて比べる（F44）の、純粋な部分：版の選び方の制約・既定の組・「ブロックごとの行」の並べ方・行のまとめ方。DOM・ストア・サーバーに触れない。
// 行の並べ方：右（今）の本文の順に、左（前）のブロックを対応づけて並べる。左にだけあるブロック（削除）は、**前の版で、すぐ前にあったブロックの、あとに**差し込む
// （入れ替わった「変更」があっても、削除の行が、遠くへ飛ばない）。左右が揃うので、スクロールの同期は要らない（1 つの縦のスクロールの中の、行）。
import type { BlockMatches } from '../../shared/diff';

/** 比べるには、版が、この数以上要る */
export const COMPARE_MIN_VERSIONS = 2;

/** 版として使える数か（1 以上・最新版以下の整数） */
export const isVersion = (v: unknown, latest: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= latest;

/**
 * 開いたときの、左右の版：右＝いま見ている版・左＝その 1 つ前。いま見ている版が v1 のときは、左＝v1・右＝v2
 * （最新版を見ているふつうの場合は、左＝最新の 1 つ前・右＝最新）。`latest` が 2 未満なら null（比べられない）
 */
export function defaultPair(viewing: number, latest: number): { left: number; right: number } | null {
  if (!Number.isInteger(latest) || latest < COMPARE_MIN_VERSIONS) return null;
  const right = Math.min(latest, Math.max(2, Number.isInteger(viewing) ? viewing : latest));
  return { left: right - 1, right };
}

/** 版のラベル：最新か、過去の版か（文字でも伝える：色だけにしない） */
export const versionTag = (v: number, latest: number): string => (v === latest ? '最新' : '過去の版');

export type RowStatus = 'same' | 'changed' | 'added' | 'removed' | 'solo';

export interface Row {
  status: RowStatus;
  /** 左（前）のブロックの添字。なければ null（空白） */
  left: number | null;
  /** 右（今）のブロックの添字。なければ null（空白） */
  right: number | null;
}

/**
 * 対応づけの結果から、行を作る。`m`：`matchBlocks(左, 右)` の結果。`nLeft`・`nRight`：左右のブロック数。
 * `m` が null のとき（片方の版が、まだ・取れなかった）は、ある側だけの行（`solo`）で、反対側は空白
 */
export function alignRows(m: BlockMatches | null, nLeft: number, nRight: number): Row[] {
  if (!m) {
    const rows: Row[] = [];
    const n = Math.max(nLeft, nRight);
    for (let i = 0; i < n; i++) rows.push({ status: 'solo', left: nLeft ? i : null, right: nRight ? i : null });
    return rows;
  }
  const rows: Row[] = [];
  const removed = [...m.removed].sort((a, b) => a - b);
  let ri = 0;
  // 削除の行を、そのブロックより前の版で「あとにある」対応先の行の、直前に出す（前の版の順を、なるべく保つ）
  const flushBefore = (p: number): void => {
    while (ri < removed.length && (removed[ri] as number) < p)
      rows.push({ status: 'removed', left: removed[ri++] as number, right: null });
  };
  // 追加の行の続きも、直後に対応づいた行（なければ末尾）の前の、削除を先に出す（「削除→追加」の順：差分の読み慣れた順）
  const after: number[] = new Array(m.cur.length);
  let nextPrev = Number.POSITIVE_INFINITY;
  for (let j = m.cur.length - 1; j >= 0; j--) {
    const prev = (m.cur[j] as BlockMatches['cur'][number]).prev;
    if (prev !== null) nextPrev = prev;
    after[j] = nextPrev;
  }
  m.cur.forEach((c, j) => {
    flushBefore(c.prev ?? (after[j] as number));
    if (c.prev === null) rows.push({ status: 'added', left: null, right: j });
    else rows.push({ status: c.status === 'same' ? 'same' : 'changed', left: c.prev, right: j });
  });
  flushBefore(Number.POSITIVE_INFINITY);
  return rows;
}

export interface RowSummary {
  same: number;
  changed: number;
  added: number;
  removed: number;
}

export function summarize(rows: readonly Row[]): RowSummary {
  const s: RowSummary = { same: 0, changed: 0, added: 0, removed: 0 };
  for (const r of rows) if (r.status !== 'solo') s[r.status]++;
  return s;
}

export type RowItem = { kind: 'row'; row: Row } | { kind: 'same'; rows: Row[] };

/** 「変更のある所だけ」：続く `same` の行を、1 つの折りたたみにまとめる（それ以外の行は、そのまま） */
export function groupSame(rows: readonly Row[]): RowItem[] {
  const out: RowItem[] = [];
  for (const row of rows) {
    const last = out[out.length - 1];
    if (row.status !== 'same') out.push({ kind: 'row', row });
    else if (last?.kind === 'same') last.rows.push(row);
    else out.push({ kind: 'same', rows: [row] });
  }
  return out;
}
