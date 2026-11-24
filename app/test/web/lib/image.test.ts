// @vitest-environment jsdom
// 画像を付ける前の検査（F24）と、読み込み。入力欄（貼り付け・ドラッグ・選択）と、範囲の画像が、同じ検査・同じ上限を通ること。
import { expect, test } from 'vitest';
import { IMG_MAX_BYTES, IMG_MAX_MB, IMG_MAX_N, IMG_OUT_MAX_SIDE, IMG_TYPES } from '../../../src/shared/image';
import { checkImage, readBase64 } from '../../../src/web/lib/image';

test('上限：形式（png・jpeg・gif・webp）・1 枚 5MB・4 枚・出力の長い辺 2400px（サーバーと同じ値）', () => {
  expect(IMG_TYPES).toEqual(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
  expect([IMG_MAX_MB, IMG_MAX_BYTES, IMG_MAX_N, IMG_OUT_MAX_SIDE]).toEqual([5, 5 * 1024 * 1024, 4, 2400]);
});

test('checkImage：形式（png・jpeg・gif・webp）・大きさ（5MB）・枚数（4 枚）', () => {
  const png = { type: 'image/png', size: 1000 };
  expect(checkImage(png, 0)).toBeNull();
  for (const type of ['image/jpeg', 'image/gif', 'image/webp']) expect(checkImage({ type, size: 1 }, 0)).toBeNull();
  expect(checkImage({ type: 'image/svg+xml', size: 1 }, 0)).toMatchObject({ reason: 'type' });
  expect(checkImage({ type: 'text/plain', size: 1 }, 0)).toMatchObject({ reason: 'type' });
  expect(checkImage({ type: '', size: 1 }, 0)).toMatchObject({ reason: 'type' });
  expect(checkImage({ type: 'image/png', size: 5 * 1024 * 1024 }, 0)).toBeNull();
  expect(checkImage({ type: 'image/png', size: 5 * 1024 * 1024 + 1 }, 0)).toMatchObject({
    reason: 'size',
    message: '画像が大きすぎます（5MB まで）',
  });
  expect(checkImage(png, IMG_MAX_N - 1)).toBeNull();
  expect(checkImage(png, IMG_MAX_N)).toMatchObject({ reason: 'count', message: '画像は 4 枚までです' });
  // 形式が先（形式が違うものは、枚数が上限でも、形式のエラー）
  expect(checkImage({ type: 'text/plain', size: 1 }, IMG_MAX_N)).toMatchObject({ reason: 'type' });
});

test('readBase64：data URL の本体の部分（base64）だけを返す', async () => {
  expect(await readBase64(new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' }))).toBe('AQIDBA==');
  expect(await readBase64(new Blob([]))).toBe('');
});
