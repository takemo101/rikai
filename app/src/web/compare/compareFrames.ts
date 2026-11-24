// 版を並べて比べる画面（F44）の、動く枠（html-app）の集まり：比較用ツールバーが、左右のすべての枠に、同じ幅・外観を適用し、いまの状態（そろっているか）を読む。
// 島（`compare.ts`）が描き終えたら公開する（`publishCompareFrames`）。枠の登録そのものは橋（`frameBridge.ts`）・解放と問い合わせは登録簿（`frameRegistry.ts`）。ここは、**登録簿の写し**だけ：画面を閉じる・描き直すと、空にする。
import { useSyncExternalStore } from 'react';
import type { AppFrame } from '../htmlapp/frameRegistry';
import type { FrameWidth } from '../lib/frameWidth';
import type { ResolvedTheme } from '../lib/theme';

/** 左右の枠の、まとめた状態。`width`・`mode`：すべての枠が同じならその値・そろっていなければ null。`avail`：本文の幅（枠の置き場の幅の、小さいほう。測れていなければ 0） */
export interface CompareFramesState {
  count: number;
  width: FrameWidth | null;
  mode: ResolvedTheme | null;
  avail: number;
}

const EMPTY: CompareFramesState = { count: 0, width: null, mode: null, avail: 0 };
let current: readonly AppFrame[] = [];
let unsubs: Array<() => void> = [];
let snap: CompareFramesState = EMPTY;
const subs = new Set<() => void>();

function compute(): CompareFramesState {
  const states = current.map((f) => f.get());
  const first = states[0];
  if (!first) return EMPTY;
  const widths = new Set(states.map((s) => s.width));
  const modes = new Set(states.map((s) => s.mode));
  const avails = states.map((s) => s.avail).filter((a) => a > 0);
  return {
    count: states.length,
    width: widths.size === 1 ? first.width : null,
    mode: modes.size === 1 ? first.mode : null,
    avail: avails.length ? Math.min(...avails) : 0,
  };
}

function emit(): void {
  const next = compute();
  if (next.count === snap.count && next.width === snap.width && next.mode === snap.mode && next.avail === snap.avail)
    return;
  snap = next;
  for (const cb of subs) cb();
}

/** 描いた枠を公開する（空の配列で、解く）。枠の状態の変化も、購読する */
export function publishCompareFrames(frames: readonly AppFrame[]): void {
  for (const u of unsubs.splice(0)) u();
  current = frames;
  unsubs = frames.map((f) => f.subscribe(emit));
  emit();
}

/** 公開している枠すべてに、同じ幅を適用する */
export function applyCompareWidth(width: FrameWidth): void {
  for (const f of current) f.setWidth(width);
}

/** 公開している枠すべてに、同じ枠だけの外観を適用する */
export function applyCompareMode(mode: ResolvedTheme): void {
  for (const f of current) f.setMode(mode);
}

const subscribe = (cb: () => void): (() => void) => {
  subs.add(cb);
  return () => subs.delete(cb);
};

export const useCompareFrames = (): CompareFramesState => useSyncExternalStore(subscribe, () => snap);
