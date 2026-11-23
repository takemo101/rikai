// 画面の広さ：右のコメントの幅の、上限・既定と、窓の幅の購読。旧 app.js の panelMax・panelWidth・applyUi の数の部分。
import { useSyncExternalStore } from 'react';
import { PANEL_MIN } from '../lib/storage';
import { useUi } from '../store/ui';

/** 左の一覧の幅（CSS の --side-w。広い窓は 230px・〜900px は 168px）と、本文の領域に残す最小の幅 */
export const SIDE_W = 230;
export const SIDE_W_NARROW = 168;
export const DOC_MIN = 360;
/** 狭い窓（CSS の `@media (max-width: 900px)` と同じ）：右の幅の下限を下げ、本文の領域を、広く残す */
export const NARROW_MAX = 900;
export const PANEL_MIN_NARROW = 220;
export const DOC_MIN_NARROW = 400;
/**
 * この幅より狭い窓では、左の一覧を、自動で隠す（保存した sideOpen は、書き換えない）：左の一覧（168）・右の幅の下限（220）・本文の最小（400）が、並べて入らない幅。
 * 左の一覧が戻ると、本文が 400px を割る（788px 未満）ので、そこまでは、隠す。隠している間は、☰ で、本文の上に重ねて出せる（ドロワー）
 */
export const SIDE_AUTO_HIDE_BELOW = SIDE_W_NARROW + PANEL_MIN_NARROW + DOC_MIN_NARROW;
/** 矢印キーの、1 回の変化量 */
export const KEY_STEP = 24;

export const isNarrow = (innerWidth: number): boolean => innerWidth <= NARROW_MAX;
export const sideAutoHidden = (innerWidth: number): boolean => innerWidth < SIDE_AUTO_HIDE_BELOW;

/** 左の一覧を、本文の列の横に並べているか：保存した開閉。ただし、自動で隠す窓（788px 未満）では、並べない */
export function sideShown(sideOpen: boolean, innerWidth: number): boolean {
  return sideOpen && !sideAutoHidden(innerWidth);
}

/** 左の一覧を、本文の上に重ねて（ドロワー）出しているか：自動で隠す窓で、☰ で出したとき */
export function drawerOpen(narrowSideOpen: boolean, innerWidth: number): boolean {
  return narrowSideOpen && sideAutoHidden(innerWidth);
}

/** 右の幅の下限：広い窓は PANEL_MIN（280）・狭い窓（〜900px）は 220 */
export function panelMin(innerWidth: number): number {
  return isNarrow(innerWidth) ? PANEL_MIN_NARROW : PANEL_MIN;
}

/** 右の幅の上限：窓の 70%。ただし、左の一覧（出していれば）と合わせて、本文の領域が、広い窓は 360px・狭い窓は 400px 以上、残る幅まで。下限は panelMin */
export function panelMax(shown: boolean, innerWidth: number): number {
  const narrow = isNarrow(innerWidth);
  const side = shown ? (narrow ? SIDE_W_NARROW : SIDE_W) : 0;
  const docMin = narrow ? DOC_MIN_NARROW : DOC_MIN;
  return Math.max(panelMin(innerWidth), Math.min(Math.floor(innerWidth * 0.7), innerWidth - side - docMin));
}

/** 実際に使う幅：覚えている幅（下限 min。既定は PANEL_MIN）を、上限で抑える。覚えている幅は、書き換えない */
export function panelWidth(saved: number, max: number, min: number = PANEL_MIN): number {
  return Math.min(Math.max(min, Number(saved) || min), max);
}

const subscribe = (onChange: () => void): (() => void) => {
  window.addEventListener('resize', onChange);
  return () => window.removeEventListener('resize', onChange);
};
const innerWidth = (): number => window.innerWidth;

/** いまの右の幅・下限・上限と、左の一覧の出し方（窓の大きさ・左の一覧の開閉で変わる）。狭い窓の取っ手の幅は、保存せず、ここだけで使う */
export function usePanelGeometry(): {
  w: number;
  min: number;
  max: number;
  /** 左の一覧を、本文の列の横に並べている */
  sideShown: boolean;
  /** 左の一覧を、本文の上に重ねて出している（ドロワー） */
  drawer: boolean;
  /** 自動で隠す窓（788px 未満） */
  autoHidden: boolean;
  /** 狭い窓（〜900px） */
  narrow: boolean;
} {
  const width = useSyncExternalStore(subscribe, innerWidth);
  const sideOpen = useUi((s) => s.ui.sideOpen);
  const narrowSideOpen = useUi((s) => s.narrowSideOpen);
  const narrow = isNarrow(width);
  const saved = useUi((s) => (narrow && s.panelWNarrow !== null ? s.panelWNarrow : s.ui.panelW));
  const shown = sideShown(sideOpen, width);
  const min = panelMin(width);
  const max = panelMax(shown, width);
  return {
    w: panelWidth(saved, max, min),
    min,
    max,
    sideShown: shown,
    drawer: drawerOpen(narrowSideOpen, width),
    autoHidden: sideAutoHidden(width),
    narrow,
  };
}
