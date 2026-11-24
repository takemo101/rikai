// 画面の状態の、ストアを作る：5 つのスライス（`slices/`）を、1 つの `create<UiStore>()` に合成する。**1 つの操作は、1 回の `set`**（購読者が、中間の状態を見ない）：
// 複数のスライスにまたがる操作は、ほかのスライスの項目を直接書かず、そのスライスが公開した「次の状態を返す関数」を、自分の 1 回の `set` に合成する（`slices/compare.ts`）。
// 上の層（api・lib/view）は import しない：必要なものは、作成時に、`deps` で受け取る（`deps.ts`）。
import { create } from 'zustand';
import type { UiDeps } from './deps';
import { type CompareSlice, type CompareSliceState, createCompareSlice, initialCompare } from './slices/compare';
import { createDraftSlice, type DraftSlice, type DraftState, initialDraft } from './slices/composer';
import { createSelectSlice, initialSelect, type SelectSlice, type SelectState } from './slices/select';
import { createSettingsSlice, initialSettings, type SettingsSlice, type SettingsState } from './slices/settings';
import { createZoomSlice, initialZoom, type ZoomSlice, type ZoomState } from './slices/zoom';

export type UiState = SettingsState & ZoomState & DraftState & SelectState & CompareSliceState;
export type UiStore = SettingsSlice & ZoomSlice & DraftSlice & SelectSlice & CompareSlice;

/** 状態の初期値（localStorage から、seen・ui を読む）。テストが、ストアを戻すのにも使う */
export function initialUi(): UiState {
  return {
    ...initialSettings(),
    ...initialZoom(),
    ...initialDraft(),
    ...initialSelect(),
    ...initialCompare(),
  };
}

/** スライスを、E（設定・一時）→ D（拡大表示・範囲）→ A（入力欄・下書き）→ B（パネルの選択）→ C（比較）の順に合成する */
export const createUi = (deps: UiDeps) =>
  create<UiStore>()((...a) => ({
    ...createSettingsSlice(...a),
    ...createZoomSlice(...a),
    ...createDraftSlice(deps)(...a),
    ...createSelectSlice(...a),
    ...createCompareSlice(deps)(...a),
  }));
