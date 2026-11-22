// 本文の選択・ブロックのホバー・範囲選択（契約：contracts.ts の InteractProps）。
// 出すもの：`#actbar`（入口のバー）・`#regbtn`（右下に浮かぶ「範囲を選ぶ」）・`#regsel`（範囲選択の枠。`#docscroll` の中）。
// ほかに：Esc の扱い・カードと本文の、お互いの光り（hoverLink）・範囲の枠の調整（F31）の購読。
import { useEffect, useRef, useState } from 'react';
import { useMutations } from '../api/mutations';
import type { InteractProps } from '../contracts';
import { regionAdjustTarget } from '../overlay/regionAdjust';
import { useUi } from '../store/ui';
import { ActionBar } from './ActionBar';
import { subscribeRegionAdjust } from './adjust';
import type { ViewportRect } from './geometry';
import { installHoverLink } from './hoverLink';
import { RegionSelect } from './RegionSelect';
import { finishRegion, type RegionDeps } from './region';

/**
 * Esc の順：範囲選択のキャンセル → 範囲の枠をドラッグ中なら（元に戻すのは、枠を持つ W1 の overlay の仕事なので）何もしない → それ以外は、ライトボックスを閉じる。
 * 何かを閉じた（またはドラッグ中で、任せた）ときは true
 */
export function handleEscape(): boolean {
  const s = useUi.getState();
  if (s.regMode === 'selecting') {
    s.setRegMode('idle');
    return true;
  }
  if (s.regDrag) return true;
  if (s.lightbox) {
    s.closeLightbox();
    return true;
  }
  return false;
}

export function Interact({ view, scrollRef }: InteractProps) {
  const { attach } = useMutations();
  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  useEffect(() => setScroller(scrollRef.current), [scrollRef]);
  const latest = !!view?.isLatest;

  // 画像の保存（トピックを変えない操作）。イベントの処理が、いつも、最新のものを呼ぶ
  const attachRef = useRef(attach);
  useEffect(() => {
    attachRef.current = attach;
  }, [attach]);
  const depsRef = useRef<RegionDeps>({ attach: (topic, data) => attachRef.current({ topic, data }) });

  const finish = (vr: ViewportRect): void => finishRegion(vr, depsRef.current);

  // 範囲の枠を、ドラッグで調整したとき（離したあと）：その範囲で、入力欄の対象と画像を、作り直す
  useEffect(() => subscribeRegionAdjust(regionAdjustTarget, (vr) => finishRegion(vr, depsRef.current)), []);

  useEffect(() => installHoverLink(), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') handleEscape();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <ActionBar scroller={scroller} latest={latest} />
      <RegionSelect scroller={scroller} enabled={latest} onFinish={finish} />
    </>
  );
}
