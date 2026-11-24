// 枠（html-app）の表示の状態：幅・外観・本文の幅・選択モードと、その最初の状態（F28・F42・F44）。DOM にも、枠の登録簿にも触れない（橋〔`frameBridge.ts`〕と、登録簿〔`frameRegistry.ts`〕の下）。
// 枠の外観：資料が、画面の配色への対応を示した枠（`shared/htmlapp-theme.ts`：オプトイン）だけ、画面の外観に従う（`by: 'auto'`）。
// 示さない従来の枠は、常にライト（画面の外観が変わっても、触らない）。ツールバーでの切り替え（`by: 'user'`）は、どの枠でも効く（利用者の明示の操作）。
// 枠の幅：選んだ幅で、枠の中のレイアウトを計算する（iframe の実際の幅＝選んだ幅。`@media`・`vw`・`100%` が、その幅で効く）。本文の幅より広いときは、
// `transform: scale()` で、本文の幅に収めて見せる（DevTools のデバイスモードと同じ。ラッパーの高さ＝枠の高さ × 縮小率）。選んだ幅が、本文の幅以下なら、縮小しない。
// 縮小率の下限は 50%（それ以下は読めない）：下限で止まって、まだ本文の幅に収まらないときは、枠の置き場を、横にスクロールさせる。
// 枠の幅・外観の切り替えは、保存しない（再読み込みで、自動・画面の外観に戻る）。本文を描き直しても（コメントの追加など）、同じ版の中では、覚えている。
import type { FrameWidth } from '../lib/frameWidth';
import type { ResolvedTheme } from '../lib/theme';

/** 枠の表示の状態。`forced`：枠だけ、画面の外観とは別にしている。`avail`：本文の幅（枠の置き場の幅。px。測れる前は 0） */
export interface FrameState {
  width: FrameWidth;
  mode: ResolvedTheme;
  forced: boolean;
  avail: number;
  /** 要素を選んでいる（選択モード）：利用者が、ボタンを押してから、1 つ選ぶ・中止する・Esc・枠が消える、まで */
  picking: boolean;
}

/** 縮小率の下限（これより小さくすると、読めない）。本文の幅に、これでも収まらないときは、横にスクロールさせる */
export const MIN_SCALE = 0.5;

/** 縮小率：選んだ幅が、本文の幅より広いときだけ、本文の幅に収める（MIN_SCALE 〜 1）。測れていない（avail 0）・自動は、1 */
export const frameScale = (width: FrameWidth, avail: number): number =>
  width !== 'auto' && avail > 0 && width > avail ? Math.max(MIN_SCALE, avail / width) : 1;

/** 縮小しても、選んだ幅が、本文の幅に収まらない（下限で止まった）：枠の置き場を、横にスクロールさせる */
export const frameScrolls = (width: FrameWidth, avail: number): boolean =>
  width !== 'auto' && avail > 0 && width * frameScale(width, avail) > avail + 0.5;

// 同じ版の中で、本文を描き直しても（コメントの追加など）、枠の幅・枠だけの外観を覚える。版・ページが変わったら、捨てる
let memoryKey = '';
export const memory = new Map<number, { width: FrameWidth; mode: ResolvedTheme | null }>();

/**
 * 枠の、最初の状態。`viewKey`：`<トピック>/<ページ>/<版>`・`n`：枠の番号・`page`：いまの画面の外観・`follows`：資料が、画面の配色への対応を示しているか
 * （示さない従来の枠は、常にライト）。同じ版の中で覚えている幅・枠だけの外観があれば、それ（`src` の `?mode=` も、これで決める）
 */
export function initialFrameState(viewKey: string, n: number, page: ResolvedTheme, follows: boolean): FrameState {
  if (memoryKey !== viewKey) {
    memoryKey = viewKey;
    memory.clear();
  }
  const m = memory.get(n);
  return {
    width: m?.width ?? 'auto',
    mode: m?.mode ?? (follows ? page : 'light'),
    forced: m?.mode != null,
    avail: 0,
    picking: false,
  };
}

/** 版を並べて比べる画面（F44）の枠の、最初の状態：比較用ツールバーの選び（幅・枠だけの外観。null は、画面に従う）。覚えは使わない */
export function compareFrameState(
  width: FrameWidth,
  mode: ResolvedTheme | null,
  page: ResolvedTheme,
  follows: boolean,
): FrameState {
  return { width, mode: mode ?? (follows ? page : 'light'), forced: mode !== null, avail: 0, picking: false };
}
