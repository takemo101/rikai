// アンカー（コメントの範囲）の整形：外から来た値を、境界で一度だけ、型のある形にする（文字数を切る・範囲を丸める）。
import type { Anchor, Rect } from '../shared/types';
import { str } from './util';

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
