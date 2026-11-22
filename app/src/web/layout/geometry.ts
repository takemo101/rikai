// 画面の広さ：右のコメントの幅の、上限・既定と、窓の幅の購読。旧 app.js の panelMax・panelWidth・applyUi の数の部分。
import { useSyncExternalStore } from 'react';
import { PANEL_MIN } from '../lib/storage';
import { useUi } from '../store/ui';

/** 左の一覧の幅（CSS の --side-w の既定）と、本文の領域に残す最小の幅 */
export const SIDE_W = 230;
export const DOC_MIN = 360;
/** 矢印キーの、1 回の変化量 */
export const KEY_STEP = 24;

/** 右の幅の上限：窓の 70%。ただし、左の一覧（開いているとき）と合わせて、本文の領域が DOC_MIN 以上、残る幅まで */
export function panelMax(sideOpen: boolean, innerWidth: number): number {
  return Math.max(PANEL_MIN, Math.min(Math.floor(innerWidth * 0.7), innerWidth - (sideOpen ? SIDE_W : 0) - DOC_MIN));
}

/** 実際に使う幅：覚えている幅（下限 PANEL_MIN）を、上限で抑える */
export function panelWidth(saved: number, max: number): number {
  return Math.min(Math.max(PANEL_MIN, Number(saved) || PANEL_MIN), max);
}

const subscribe = (onChange: () => void): (() => void) => {
  window.addEventListener('resize', onChange);
  return () => window.removeEventListener('resize', onChange);
};
const innerWidth = (): number => window.innerWidth;

/** いまの右の幅と上限（窓の大きさ・左の一覧の開閉で変わる） */
export function usePanelGeometry(): { w: number; max: number } {
  const width = useSyncExternalStore(subscribe, innerWidth);
  const sideOpen = useUi((s) => s.ui.sideOpen);
  const saved = useUi((s) => s.ui.panelW);
  const max = panelMax(sideOpen, width);
  return { w: panelWidth(saved, max), max };
}
