// 関連の線（F35・F55）の更新の骨組み（本文の `Connectors`・拡大表示の `FocusLinks` で共用）：測る（読みだけ）→ state に入れる（書き）を、`requestAnimationFrame` に 1 回へまとめる。
// 何を購読するか（`observe`）と、何を測るか（`measure`）は、呼ぶ側。大きさを見るカードは、`measure` が返す（`watch`）：増減に、観察を合わせる。
import { useCallback, useEffect, useRef, useState } from 'react';
import { type Frame, sameFrame } from './connectorPath';

export interface LinkFrameOptions {
  /** false なら、何も測らない・リスナーも張らない（frame は null） */
  enabled: boolean;
  /**
   * 購読する：スクロール・窓・大きさ・DOM の変化で、`request` を呼ぶ。後始末の関数を返す。購読できなければ（要素がない）null。
   * `ro`：大きさの観察（変化で `request`）。固定の要素は、ここで `observe` する
   */
  observe: (request: () => void, ro: ResizeObserver) => (() => void) | null;
  /** 測る（読みだけ）。`watch` に、大きさを見たい要素（いま出ているカード）を入れる。null は、線が 0 本 */
  measure: (watch: Element[]) => Frame | null;
}

/**
 * 線のフレームと、測り直しの依頼（`request`：state の変化のあと、DOM を React が書いてから、呼ぶ。1 フレームにまとめて測る）を返す。
 * `epoch`：`observe` をつなぎ直す契機（本文の DocModel など）。`observe`・`measure` は、いつも最新のものを使う（effect を作り直さない）。
 */
export function useLinkFrame(opts: LinkFrameOptions, epoch: unknown): { frame: Frame | null; request: () => void } {
  const [frame, setFrame] = useState<Frame | null>(null);
  const latest = useRef(opts);
  latest.current = opts;
  const schedule = useRef(() => {});
  const request = useCallback(() => schedule.current(), []);
  const { enabled } = opts;

  // biome-ignore lint/correctness/useExhaustiveDependencies: epoch が、つなぎ直す契機（値は、effect の中で使わない）。opts は、latest（ref）から読む
  useEffect(() => {
    if (!enabled) {
      setFrame(null);
      return;
    }
    let raf = 0;
    const watched = new Set<Element>(); // 大きさを見ている要素
    const request = (): void => {
      if (!raf) raf = requestAnimationFrame(run);
    };
    const ro = new ResizeObserver(request);
    const run = (): void => {
      raf = 0;
      const watch: Element[] = [];
      const next = latest.current.measure(watch); // 読み：ここまで
      setFrame((prev) => (next === null ? null : sameFrame(prev, next) ? prev : next)); // 書き：ここから
      const now = new Set(watch);
      for (const c of watched) {
        if (now.has(c)) continue;
        ro.unobserve(c);
        watched.delete(c);
      }
      for (const c of now) {
        if (watched.has(c)) continue;
        ro.observe(c);
        watched.add(c);
      }
    };
    const stop = latest.current.observe(request, ro);
    if (!stop) {
      ro.disconnect();
      return;
    }
    schedule.current = request;
    request();
    return () => {
      schedule.current = () => {};
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      stop();
    };
  }, [enabled, epoch]);

  return { frame: enabled ? frame : null, request };
}
