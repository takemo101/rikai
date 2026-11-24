// スライス C：版を並べて比べる（F44）。開閉・左右の版・比較用ツールバーの選び・閉じたあとに戻すスクロール位置。
// **比べる前の画面の復元の規則は、ここだけ**：開くとき、見ていた版の印（`View.key`）とスクロール位置を `from` に控える。閉じるとき、見ている版が同じ（`key` が同じ）ときだけ、スクロール位置を `scrollRestore` に渡す。
// ほかのスライスの項目は、直接書かない：範囲を選ぶのをやめる（D）・カードの光りを消す（B）は、それぞれが公開した「次の状態を返す関数」を、1 回の `set` に合成する（購読者が、中間の状態を見ない）。
// 入力欄（A）・選んでいるスレッド（B）は、控えない（開いている間も、そのまま持つ）。
import type { StateCreator } from 'zustand';
import { defaultPair, isVersion } from '../../lib/compare';
import type { FrameWidth } from '../../lib/frameWidth';
import type { ResolvedTheme } from '../../lib/theme';
import type { UiStore } from '../createUi';
import type { UiDeps } from '../deps';
import { unlinkThread } from './select';
import { cancelRegSelect } from './zoom';

/**
 * 版を並べて比べる（F44）の状態。開いている間だけある（null＝通常の表示）。**開閉・左右の版・比較用ツールバーの選びの、所有者は、ここだけ**（ルート〔ハッシュ〕には、持たない：
 * 版のルート `#/…/vN` は「見ている版」で、比較は、その上の一時の画面。再読み込みで閉じる。ページ・トピックを移ると、閉じる）。
 * `left`・`right`：比べる版（同じ版を左右に選んでもよい）。`width`・`mode`：左右のすべての枠に、まとめて効く幅・枠だけの外観（mode の null は、画面に従う）。
 * `changesOnly`：変更のない続きのブロックを、折りたたむ。
 * `from`：開く前の画面（閉じるとき、戻すために控える）：見ていた版の印（`View.key`）・本文のスクロール位置。
 * **入力欄（対象つき）・選んでいるスレッドは、控えない：開いている間も、そのまま持つ**（右のコメント欄が、隠れるだけ）。比べている間に、見ている版が変わったときの扱いは、比べないときと同じ道（`moveComposer`：App の、版が変わったときの効果）
 */
export interface CompareState {
  left: number;
  right: number;
  width: FrameWidth;
  mode: ResolvedTheme | null;
  changesOnly: boolean;
  from: { key: string; scrollTop: number };
}

export interface CompareSliceState {
  /** 版を並べて比べる画面（F44）。開いていなければ null */
  compare: CompareState | null;
  /** 比べる画面を閉じて、本文を描き直したあとに、戻すスクロール位置（本文〔`Article`〕が、描き終えたら、1 度だけ受け取る）。なければ null */
  scrollRestore: number | null;
}

export interface CompareActions {
  /**
   * 開く：版が 2 つ以上あるページで、いま見ている版と、その 1 つ前（`defaultPair`）。開けたら true。`scrollTop`：本文のスクロール位置（閉じたら戻す）。
   * コメントの入力欄・選んでいるスレッドは、そのまま持つ（右のコメント欄は、隠れるだけ。書きかけの文・添付の画像・対象も残る）
   */
  openCompare: (scrollTop?: number) => boolean;
  /**
   * 閉じる。`restore`（既定 true）：本文のスクロール位置を、戻す。**見ている版が同じとき（`View.key` が同じ）だけ**戻す（ページ・トピックを移った・新しい版が届いて最新版が替わったときは、戻さない）。
   * 入力欄は、開く前のまま残っている：同じ版なら、同じ対象で、続けられる。版が変わったときは、変わった時点で、`moveComposer`（App）が、新しい最新版なら確かめの印（`verify`）を付け、そうでなければ「対象を失った下書き」へ移している
   */
  closeCompare: (restore?: boolean) => void;
  /** 戻すスクロール位置を、1 度だけ受け取る（受け取ると、なくなる） */
  takeScrollRestore: () => number | null;
  /** 左右の版を選ぶ。存在しない版（0・最新版より後・整数でない）は、受けない */
  setCompareVersion: (side: 'left' | 'right', version: number) => void;
  setCompareWidth: (width: FrameWidth) => void;
  /** 枠だけの外観（null は、画面に従う）。画面の外観が変わると、null に戻る（`useFollowAppFrames`） */
  setCompareMode: (mode: ResolvedTheme | null) => void;
  setCompareChangesOnly: (on: boolean) => void;
}

export type CompareSlice = CompareSliceState & CompareActions;

export function initialCompare(): CompareSliceState {
  return { compare: null, scrollRestore: null };
}

export const createCompareSlice =
  ({ getView }: UiDeps): StateCreator<UiStore, [], [], CompareSlice> =>
  (set, get) => ({
    ...initialCompare(),

    openCompare: (scrollTop = 0) => {
      const v = getView();
      const pair = v ? defaultPair(v.version, v.latest) : null;
      if (!v || !pair) return false;
      // 入力欄・選んでいるスレッドは、そのまま持つ（右のコメント欄は隠れるだけ。下書きの文・添付の画像・対象も残る）。戻すのは、本文のスクロール位置だけ
      set({
        compare: { ...pair, width: 'auto', mode: null, changesOnly: false, from: { key: v.key, scrollTop } },
        ...cancelRegSelect(),
        ...unlinkThread(),
      });
      return true;
    },
    closeCompare: (restore = true) => {
      const { compare } = get();
      if (!compare) return;
      const sameKey = restore && getView()?.key === compare.from.key;
      set({ compare: null, scrollRestore: sameKey ? compare.from.scrollTop : null });
    },
    takeScrollRestore: () => {
      const r = get().scrollRestore;
      if (r !== null) set({ scrollRestore: null });
      return r;
    },
    setCompareVersion: (side, version) => {
      const v = getView();
      if (!v || !isVersion(version, v.latest)) return;
      set((s) => (s.compare ? { compare: { ...s.compare, [side]: version } } : s));
    },
    setCompareWidth: (width) => set((s) => (s.compare ? { compare: { ...s.compare, width } } : s)),
    setCompareMode: (mode) =>
      set((s) => (s.compare && s.compare.mode !== mode ? { compare: { ...s.compare, mode } } : s)),
    setCompareChangesOnly: (changesOnly) => set((s) => (s.compare ? { compare: { ...s.compare, changesOnly } } : s)),
  });
