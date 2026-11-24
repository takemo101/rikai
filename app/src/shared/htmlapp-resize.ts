// 枠（html-app）が知らせた高さの検査（画面の側の、橋が使う。DOM に触れない純粋な関数）。

/** 枠の高さの上下限（px）。枠が知らせた値は、この範囲に収める */
export const MIN_HEIGHT = 120;
export const MAX_HEIGHT = 2400;

/** 枠が知らせた高さの検査：`{ __rikai: 1, type: 'resize', height }`（余分なキーは、無視）。数（有限・正）だけ。整数に丸めて、上下限に収める。それ以外は null */
export function parseResize(data: unknown): number | null {
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;
  if (d.__rikai !== 1 || d.type !== 'resize') return null;
  const h = d.height;
  if (typeof h !== 'number' || !Number.isFinite(h) || h <= 0) return null;
  return Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.round(h)));
}
