// 画像の上限（画面とサーバーで同じ値）。添付の画像（F24）：形式・1 枚の大きさ・1 つの入力に付ける枚数。
// 最終の検査は、サーバー（`server/image.ts`：中身の先頭のバイトで形式を決める）。画面は、付ける前に、同じ値で、早く断る（`web/lib/image.ts`）。

/** 付けられる画像の形式（申告の MIME。サーバーは、中身の先頭のバイトで、改めて決める） */
export const IMG_TYPES: readonly string[] = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
/** 1 枚の上限（MB） */
export const IMG_MAX_MB = 5;
/** 1 枚の上限（バイト） */
export const IMG_MAX_BYTES = IMG_MAX_MB * 1024 * 1024;
/** 1 つのコメント・返信に付けられる枚数 */
export const IMG_MAX_N = 4;
/** 画面が作る画像（範囲の画像・html-app の枠の画像）の、長い辺の上限（px） */
export const IMG_OUT_MAX_SIDE = 2400;
