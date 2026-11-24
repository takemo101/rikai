// 画像を付ける前の検査と、読み込み（base64）。入力欄への貼り付け・ドラッグ・選択（`panel/useImageAttach.ts`）と、範囲の画像（`interact/region.ts`）が、同じ検査を通す。
// 形式・大きさ・枚数の最終の検査は、サーバー（`server/image.ts`）。値は `shared/image.ts`。
import { IMG_MAX_BYTES, IMG_MAX_MB, IMG_MAX_N, IMG_TYPES } from '../../shared/image';

export interface ImageRejection {
  reason: 'type' | 'size' | 'count';
  message: string;
}

/** 付ける前の検査。`count`：すでに付けている枚数。通れば null */
export function checkImage(file: { type: string; size: number }, count: number): ImageRejection | null {
  if (!IMG_TYPES.includes(file.type))
    return { reason: 'type', message: '画像は、png・jpeg・gif・webp だけ付けられます' };
  if (file.size > IMG_MAX_BYTES) return { reason: 'size', message: `画像が大きすぎます（${IMG_MAX_MB}MB まで）` };
  if (count >= IMG_MAX_N) return { reason: 'count', message: `画像は ${IMG_MAX_N} 枚までです` };
  return null;
}

/** ファイルを、base64（data URL の本体の部分）にする */
export function readBase64(file: Blob): Promise<string> {
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
  r.onerror = () => reject(r.error ?? new Error('画像を読めません'));
  r.readAsDataURL(file);
  return promise;
}
