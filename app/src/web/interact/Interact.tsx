// 本文の選択・ブロックのホバー・範囲選択（契約：contracts.ts の InteractProps）。
// 出すもの：`#actbar`（入口のバー）・`#regbtn`（右下に浮かぶ「範囲を選ぶ」）・`#regsel`（範囲選択の枠。`#docscroll` の中）。
// ほかに：Esc の扱い・カードと本文の、お互いの光り（hoverLink）・範囲の枠の調整（F31）の購読。
import { useEffect, useState } from 'react';
import type { InteractProps } from '../contracts';
import { escapeStep } from '../lib/escape';
import type { Box } from '../lib/geom';
import { regionAdjustTarget } from '../overlay/regionAdjust';
import { ActionBar } from './ActionBar';
import { subscribeRegionAdjust } from './adjust';
import { installHoverLink } from './hoverLink';
import { RegionSelect } from './RegionSelect';
import { finishRegion } from './region';
import { useRegionDeps } from './useRegionDeps';

export function Interact({ view, scrollRef }: InteractProps) {
  const deps = useRegionDeps(); // 画像の保存（トピックを変えない操作）。いつも、最新の attach を呼ぶ
  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  useEffect(() => setScroller(scrollRef.current), [scrollRef]);
  const latest = !!view?.isLatest && !view.readOnly; // コメントの入口：最新版で、トピックが開いているとき
  const readOnly = !!view?.readOnly;

  const finish = (vr: Box): void => finishRegion(vr, deps);

  // 範囲の枠を、ドラッグで調整したとき（離したあと）：その範囲で、入力欄の対象と画像を、作り直す
  useEffect(() => subscribeRegionAdjust(regionAdjustTarget, (vr) => finishRegion(vr, deps)), [deps]);

  useEffect(() => installHoverLink(), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') escapeStep(e);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <ActionBar scroller={scroller} latest={latest} readOnly={readOnly} />
      <RegionSelect scroller={scroller} enabled={latest} onFinish={finish} />
    </>
  );
}
