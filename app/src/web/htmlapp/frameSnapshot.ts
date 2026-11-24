// 枠の画像（`snapshot-req` → `snapshot`）の、受け取った画像の検査：範囲選択の画像（F25）に枠が入るとき、枠自身に、自分の見た目を画像にさせる。
// 応答は、**こちらが出した id の、その枠からの、1 回だけ**を受ける（古い・偽・兄弟の枠の応答は、捨てる：橋〔`frameBridge.ts`〕の `receive`）。2 秒で、時間切れ（枠が応答しない：null → 箱に戻る）。
// 画像は、PNG の data URL・長さ・形（`shared/htmlapp-bridge.ts`）を確かめ、**画像として読めて、大きさが上限の中**のものだけ使う（ここ）。
import { SNAPSHOT_MAX_SIDE } from '../../shared/htmlapp-bridge';

/** 枠の画像を待つ時間（ms） */
export const SNAPSHOT_TIMEOUT_MS = 2000;

/** PNG の data URL が、画像として読めて、大きさ（幅・高さ）が上限の中か */
export function decodesWithinLimit(png: string): Promise<boolean> {
  return new Promise((resolve) => {
    const im = new Image();
    im.onload = () =>
      resolve(
        im.naturalWidth > 0 &&
          im.naturalHeight > 0 &&
          im.naturalWidth <= SNAPSHOT_MAX_SIDE &&
          im.naturalHeight <= SNAPSHOT_MAX_SIDE,
      );
    im.onerror = () => resolve(false);
    im.src = png;
  });
}
