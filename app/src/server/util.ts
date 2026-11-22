// 共通の小さな道具（エラー・時刻・JSON の読み書き・待つ・出力）。ほかのモジュールに依存しない。
import fs from 'node:fs';
import type { Anchor, Rect } from '../shared/types';

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function out(obj: unknown): void {
  console.log(JSON.stringify(obj, null, 2));
}
export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
export function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
export const now = (): string => new Date().toISOString();

export function readJSON<T>(p: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as T;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw e;
  }
}
export function writeJSON(p: string, v: unknown, mode?: number): void {
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(v, null, 2), mode ? { mode } : undefined);
  fs.renameSync(tmp, p);
}

export const str = (v: unknown, max = 20000): string => String(v == null ? '' : v).slice(0, max);

type Loose = Record<string, unknown>;

// 本文の、範囲（左上にあるブロック〔画像・図があれば、その最初の画像・図〕の大きさに対する比率。左上が原点）。
// 範囲は、その基準の外へ出てよい（複数のブロックにまたがる・小さな画像を含む段落の、広い範囲）ので、左上は −100〜100・幅と高さは 1000 まで。
// 4 桁に丸める。数でない・小さすぎる（0.05% 未満。縦に長いブロックの中の、1 行の範囲を残すため、低くしてある）なら、範囲なし
export function normRect(r: unknown): Rect | null {
  if (!r || typeof r !== 'object') return null;
  const o = r as Loose;
  const raw = [o.x, o.y, o.w, o.h].map(Number);
  if (!raw.every(Number.isFinite)) return null;
  const c = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v * 10000) / 10000));
  const w = c(raw[2], 0, 1000);
  const h = c(raw[3], 0, 1000);
  return w < 0.0005 || h < 0.0005 ? null : { x: c(raw[0], -100, 100), y: c(raw[1], -100, 100), w, h };
}

export function normAnchor(a: unknown): Anchor | null {
  if (!a || typeof a !== 'object') return null;
  const o = a as Loose;
  const rect = normRect(o.rect);
  return {
    blockId: str(o.blockId, 40),
    blockHash: str(o.blockHash, 40),
    blockTag: str(o.blockTag, 16),
    blockText: str(o.blockText, 200),
    quote: str(o.quote, 2000),
    prefix: str(o.prefix, 64),
    suffix: str(o.suffix, 64),
    label: str(o.label, 120),
    ...(rect ? { rect } : {}),
  };
}
