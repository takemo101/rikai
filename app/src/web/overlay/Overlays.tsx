// 本文の外の層（`<div id="badges" aria-hidden="true">`）：番号の丸と、範囲の枠、その周りのイベント。
// 層の中身は、測定してから置く（命令的）：React の子は、持たない。DocModel（`useDoc`）から作る。
//
// 置き直す契機：DocModel の変化・入力欄の対象の変化・`ResizeObserver`（本文・`#docscroll`）・画像の読み込み・窓の大きさ・左の一覧の開閉・右の幅。
// **`regDrag` の間は、置き直さない**（つかんでいる枠が消えるため）。
import { useEffect, useLayoutEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import type { OverlaysProps } from '../contracts';
import { $ } from '../lib/dom';
import { type Box, fromEdges } from '../lib/geom';
import { isImeKey } from '../lib/keys';
import { useDoc } from '../store/doc';
import { useUi } from '../store/ui';
import { forgetShown, markLinked, placeBadges } from './place';
import { adjustEdges, dispatchAdjust, type HandleMode, parseHandle } from './regionAdjust';

interface Drag {
  box: HTMLElement;
  mode: HandleMode;
  x0: number;
  y0: number;
  r0: DOMRect;
  vr: Box | null;
}

export function Overlays({ view, scrollRef }: OverlaysProps) {
  const layerRef = useRef<HTMLDivElement>(null);
  const model = useDoc((s) => s.model);
  const composerId = useUi((s) => s.composer?.id ?? null);
  const ui = useUi((s) => s.ui);
  const linkedTid = useUi((s) => s.linkedTid);
  const viewRef = useRef(view);
  viewRef.current = view;
  const drag = useRef<Drag | null>(null);
  const frame = useRef(0);

  // 置く（最新の DocModel・ビュー・入力欄から）。出すものがなければ、層を空にする
  const place = useRef(() => {});
  place.current = () => {
    const layer = layerRef.current;
    const scroller = scrollRef.current;
    if (!layer || !scroller) return;
    if (useUi.getState().regDrag) return; // 範囲の枠を、ドラッグしている間は、描き直さない（つかんでいる枠が、消えないように）
    const v = viewRef.current;
    const m = useDoc.getState().model;
    const article = $('#article', scroller);
    if (!v || !m || m.key !== v.key || !article) {
      layer.textContent = '';
      return;
    }
    // 本文を描き直している途中（古い DocModel の要素が、本文から外れている）：新しい DocModel が届くまで、いまの層を、そのままにする（空にしない）
    const first = m.blocks[0];
    if (first && !first.el.isConnected) return;
    const ui = useUi.getState();
    placeBadges({
      layer,
      scroller,
      article,
      model: m,
      resolved: new Set(v.topic.threads.filter((t) => t.resolved).map((t) => t.id)),
      composer: ui.composer ? { rect: ui.composer.anchor.rect ?? null } : null,
      linkedTid: ui.linkedTid,
      regionBoxes: ui.ui.regionBoxes,
    });
  };
  const schedule = useRef(() => {});
  schedule.current = () => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      place.current();
    });
  };

  // DocModel・入力欄・ページが変わった：すぐ置く
  // biome-ignore lint/correctness/useExhaustiveDependencies: model・composerId・view の key が、置き直す契機
  useLayoutEffect(() => {
    place.current();
  }, [model, composerId, view?.key]);

  // 左の一覧の開閉・右の幅：記事の大きさが変わらず、位置だけ動くこともあるので、置き直す
  // biome-ignore lint/correctness/useExhaustiveDependencies: ui が、契機
  useEffect(() => {
    schedule.current();
  }, [ui]);

  // 解決の変更（番号の色）は、スレッドが変わるので、本文が描き直され、DocModel が変わる。光り：描き直さず、層の中の印だけ付け替える
  useEffect(() => {
    if (layerRef.current) markLinked(layerRef.current, linkedTid);
  }, [linkedTid]);

  // 大きさが変わるとき（図の描画・画像の読み込み・折りたたみ・幅の変更・窓）。本文の要素は、描き直しで作り直されるので、DocModel ごとに、つなぎ直す
  // biome-ignore lint/correctness/useExhaustiveDependencies: model が変わると、本文（#article）の要素が、作り直されることがある
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const article = $('#article', scroller);
    const go = (): void => schedule.current();
    const ro = new ResizeObserver(go);
    ro.observe(scroller);
    if (article) {
      ro.observe(article);
      // load・error は、バブルしないので、捕まえる（画像の読み込みが終わったとき、範囲の基準が、ブロックから画像に変わる）
      article.addEventListener('load', go, true);
      article.addEventListener('error', go, true);
    }
    window.addEventListener('resize', go);
    return () => {
      ro.disconnect();
      article?.removeEventListener('load', go, true);
      article?.removeEventListener('error', go, true);
      window.removeEventListener('resize', go);
    };
  }, [scrollRef, model]);

  useEffect(
    () => () => {
      if (frame.current) cancelAnimationFrame(frame.current);
      frame.current = 0;
    },
    [],
  );

  // 番号を押す・マウスを置く・枠のドラッグ
  useEffect(() => {
    const layer = layerRef.current;
    const scroller = scrollRef.current;
    if (!layer || !scroller) return;
    const tidOf = (e: Event): string | null =>
      e.target instanceof Element ? (e.target.closest<HTMLElement>('[data-tid]')?.dataset.tid ?? null) : null;

    // 本文の番号を押すと、そのカードだけを見せる。入力中の「新」は、押しても、選ぶカードがない
    const onClick = (e: MouseEvent): void => {
      const tid = tidOf(e);
      const thread = tid && tid !== 'pending' ? viewRef.current?.topic.threads.find((t) => t.id === tid) : undefined;
      if (!thread) return;
      // 順序：solo を決め、パネルを描き直してから、選ぶ（続けて呼ぶと、開いた直後の AI の発言の「●」〔未読〕が、消える）
      flushSync(() => useUi.getState().openSolo(thread.id));
      useUi.getState().focusThread(thread);
    };
    const onOver = (e: MouseEvent): void => {
      const tid = tidOf(e);
      const ui = useUi.getState();
      if (tid === ui.linkedTid) return;
      ui.setLinked(tid);
      const card = tid ? $(`.thread[data-tid="${CSS.escape(tid)}"]`) : null;
      if (card && !useUi.getState().composer) card.scrollIntoView({ block: 'nearest' });
    };
    const onLeave = (): void => useUi.getState().setLinked(null);

    // 入力中の範囲の枠を、ドラッグで動かし・角と辺で大きさを変える。離したら、その範囲を、`interact/` へ渡す（`regionAdjustTarget`。書きかけの文字は、残る）
    const onDown = (e: PointerEvent): void => {
      const box = e.target instanceof Element ? e.target.closest<HTMLElement>('.regionbox.pending') : null;
      if (!box || e.button !== 0 || !useUi.getState().composer) return;
      const handle = e.target instanceof HTMLElement ? e.target.dataset.h : undefined;
      drag.current = {
        box,
        mode: parseHandle(handle),
        x0: e.clientX,
        y0: e.clientY,
        r0: box.getBoundingClientRect(),
        vr: null,
      };
      useUi.getState().setRegDrag(true);
      box.setPointerCapture(e.pointerId);
      e.preventDefault();
    };
    const onMove = (e: PointerEvent): void => {
      const d = drag.current;
      if (!d) return;
      const article = $('#article', scroller);
      if (!article) return;
      const a = article.getBoundingClientRect(); // 本文の外へは、出さない
      const edges = adjustEdges(d.mode, d.r0, e.clientX - d.x0, e.clientY - d.y0, a);
      d.vr = fromEdges(edges);
      const dr = scroller.getBoundingClientRect();
      Object.assign(d.box.style, {
        left: `${edges.left - dr.left + scroller.scrollLeft}px`,
        top: `${edges.top - dr.top + scroller.scrollTop}px`,
        width: `${d.vr.width}px`,
        height: `${d.vr.height}px`,
      });
    };
    const endDrag = (apply: boolean): void => {
      const d = drag.current;
      if (!d) return;
      drag.current = null;
      forgetShown(layer); // ドラッグで、枠の位置を、書き換えた：次の配置で、入力欄の対象の位置へ、戻す（同じ内容でも、作り直す）
      useUi.getState().setRegDrag(false);
      if (apply && d.vr) dispatchAdjust(d.vr);
      schedule.current(); // 断られた（小さすぎ・本文なし）ときも、枠を、入力欄の対象の位置へ戻す
    };
    const onUp = (): void => endDrag(true);
    const onCancel = (): void => endDrag(false);
    // 範囲の枠をつかんでいる間の Esc：動かすのをやめる（元に戻す）。ほかの Esc の処理（ライトボックスを閉じる）には、渡さない
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || isImeKey(e) || !drag.current) return; // 変換中の Esc は、変換の取り消し
      endDrag(false);
      e.stopImmediatePropagation();
    };

    layer.addEventListener('click', onClick);
    layer.addEventListener('mouseover', onOver);
    layer.addEventListener('mouseleave', onLeave);
    layer.addEventListener('pointerdown', onDown);
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey, true);
    return () => {
      layer.removeEventListener('click', onClick);
      layer.removeEventListener('mouseover', onOver);
      layer.removeEventListener('mouseleave', onLeave);
      layer.removeEventListener('pointerdown', onDown);
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey, true);
      if (drag.current) {
        drag.current = null;
        useUi.getState().setRegDrag(false);
      }
    };
  }, [scrollRef]);

  return <div id="badges" aria-hidden="true" ref={layerRef} />;
}
