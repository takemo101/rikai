// 枠（html-app）の幅の切り替え。比較の状態（`store/slices/compare.ts`）と、枠の橋・ツールバー（`doc/`）が共有する型（ストアが、`doc/` を import しないように、ここに置く）。

/** 枠の幅の切り替え：`auto` は、本文の幅いっぱい（縮小なし）。数は px（枠の中のレイアウトの幅。本文より広いときは、縮小して、本文の幅に収める） */
export type FrameWidth = 'auto' | 375 | 768 | 1280 | 1920;
export const FRAME_WIDTHS: readonly FrameWidth[] = [375, 768, 1280, 1920, 'auto'];
