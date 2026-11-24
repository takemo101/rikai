// 画面の状態。サーバーの状態は、api/queries.ts（TanStack Query）。
// **書き込みは、ここの関数だけ**（部品が、状態を直接書き換えない）。値は、書き換えず、作り直す（selector で、変化を見分けるため）。
// localStorage：`rikai-seen`（seen）・`rikai-ui`（ui）。読み書きは lib/storage.ts。
//
// 5 つのスライス（`slices/`：settings・zoom・composer・select・compare）を、`createUi`（`createUi.ts`）が 1 つのストアに合成する。ここは、その入口：`useUi` と、型・定数の再公開。
// サーバーの状態（topics・topic・md・offline・error）と、導出（page・version）は、ここにない（queries.ts・lib/view.ts）。
// 本文の DOM を指すもの（locs・nums・approx・pendingEl・regions・blkBadges…）は、store/doc.ts の DocModel。
import { createUi } from './createUi';
import type { ViewRef } from './deps';

export { initialUi, type UiState, type UiStore } from './createUi';
export type { CompareState } from './slices/compare';
export type { AskDraft, ComposerState, Drafts, LostDraft } from './slices/composer';
export type { Tab } from './slices/select';
export type { DialogKind, ToastState } from './slices/settings';
export { ATTACHED_ALT, type FocusRef, type FocusTool, type LightboxTarget, type RegMode } from './slices/zoom';

let viewSource: (() => ViewRef | null) | null = null;

/**
 * いま見ている版を返す関数を、結ぶ（アプリの起動時・テストの準備で、1 度。`lib/view.ts` の `getView`）。ストアは、上の層（`api`・`lib/view`）を import しない：
 * 入力欄を開く・版を並べて比べるときに、この関数で、見ている版を知る。結んでいなければ、使った時点で失敗する（黙って「版なし」にしない）
 */
export function bindView(source: () => ViewRef | null): void {
  viewSource = source;
}

export const useUi = createUi({
  getView: () => {
    if (!viewSource) throw new Error('bindView が呼ばれていません（見ている版を、ストアに結んでいません）');
    return viewSource();
  },
});

/** React の外から、トーストを出す */
export const toast = (msg: string, err = false): void => useUi.getState().showToast(msg, err);
