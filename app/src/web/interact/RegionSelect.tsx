// 本文の、好きな範囲を選んで、コメントする：右下に浮かぶ「範囲を選ぶ」ボタン（`#regbtn`）と、本文の上に重ねる選択の枠（`#regsel`。`#docscroll` の中の絶対位置）。
// ボタンを押すと、選ぶ状態（`regMode: 'selecting'`）になり、ボタンは「やめる」に変わる。本文の上のどこでも、ドラッグで範囲を選べる（Esc・枠の外を押す・もう一度ボタンを押す・8px 未満では、やめる）。
// 範囲のあとの処理（基準のブロック・比率・画像）は、`finishRegion`（region.ts）。
import { SquareDashed } from 'lucide-react';
import { type PointerEvent, useCallback, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cancelAllPicks } from '../doc/framePick';
import { $ } from '../lib/dom';
import type { Box } from '../lib/geom';
import { RANGE_TOO_SMALL } from '../lib/messages';
import { toast, useUi } from '../store/ui';
import { type DragRect, dragRect, dragTooSmall, toViewport } from './geometry';

interface Props {
  /** `#docscroll`（まだなければ null） */
  scroller: HTMLElement | null;
  /** 範囲を選べる版か（最新版で、トピックが開いているとき）。ボタンは、そのときだけ出す */
  enabled: boolean;
  /** ドラッグで選び終えた範囲（ビューポートの矩形） */
  onFinish: (vr: Box) => void;
}

interface Frame {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function RegionSelect({ scroller, enabled, onFinish }: Props) {
  const regMode = useUi((s) => s.regMode);
  const selecting = regMode === 'selecting';
  const [frame, setFrame] = useState<Frame | null>(null);
  const [box, setBox] = useState<DragRect | null>(null);
  const from = useRef<{ x: number; y: number } | null>(null);
  const selEl = useRef<HTMLDivElement>(null);
  const btnEl = useRef<HTMLButtonElement>(null);

  const cancel = useCallback((): void => {
    from.current = null;
    setBox(null);
    useUi.getState().setRegMode('idle');
  }, []);

  // 選び始めたとき、選択の枠を、本文（`#article`）の箱に合わせる
  useLayoutEffect(() => {
    const art = $('#article');
    if (!selecting || !scroller || !art) return;
    const dr = scroller.getBoundingClientRect();
    const a = art.getBoundingClientRect();
    setFrame({
      left: Math.round(a.left - dr.left + scroller.scrollLeft),
      top: Math.round(a.top - dr.top + scroller.scrollTop),
      width: a.width,
      height: a.height,
    });
  }, [selecting, scroller]);

  // 枠の外を押す・窓の大きさが変わる：やめる
  useLayoutEffect(() => {
    if (!selecting) return;
    const onDown = (e: Event): void => {
      if (e.target instanceof Node && !selEl.current?.contains(e.target) && !btnEl.current?.contains(e.target))
        cancel();
    };
    window.addEventListener('resize', cancel);
    document.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('resize', cancel);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [selecting, cancel]);

  const start = (): void => {
    if (!enabled) {
      toast('コメントは最新版にだけ付けられます', true);
      return;
    }
    const art = $('#article');
    if (!art?.querySelector('[data-bid]')) {
      toast('範囲を選べる本文がありません', true);
      return;
    }
    getSelection()?.removeAllRanges();
    from.current = null;
    setBox(null);
    cancelAllPicks(); // 「要素を選ぶ」と同時に ON にしない（範囲の重ねが、枠を覆うため）：あとから始めたほうが、前のほうを止める
    useUi.getState().setRegMode('selecting');
  };

  const frameBox = (el: HTMLElement): Box => el.getBoundingClientRect();
  const onPointerDown = (e: PointerEvent<HTMLDivElement>): void => {
    if (!selecting || e.button !== 0) return;
    const r = frameBox(e.currentTarget);
    from.current = { x: e.clientX - r.left, y: e.clientY - r.top };
    setBox({ ...from.current, w: 0, h: 0 });
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>): void => {
    if (selecting && from.current) setBox(dragRect(frameBox(e.currentTarget), from.current, e.clientX, e.clientY));
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>): void => {
    if (!selecting || !from.current) return;
    const r = frameBox(e.currentTarget);
    const q = dragRect(r, from.current, e.clientX, e.clientY);
    cancel();
    if (dragTooSmall(q)) {
      toast(RANGE_TOO_SMALL, true);
      return;
    }
    onFinish(toViewport(r, q));
  };

  return (
    <>
      {/* 押しても、文の選択を外さない。押すと選ぶ状態になり、もう一度押すと、やめる */}
      <button
        id="regbtn"
        ref={btnEl}
        type="button"
        hidden={!enabled}
        className={selecting ? 'on' : undefined}
        title="本文の、好きな範囲を、ドラッグで選んで、コメントします（もう一度押すか、Esc で、やめます）"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => (selecting ? cancel() : start())}
      >
        <SquareDashed aria-hidden="true" focusable="false" />
        <span className="lbl">{selecting ? 'やめる' : '範囲を選ぶ'}</span>
      </button>
      {scroller
        ? createPortal(
            // biome-ignore lint/a11y/useAriaPropsSupportedByRole: 既存の DOM（aria-label を残す）
            <div
              id="regsel"
              ref={selEl}
              hidden={!selecting}
              aria-label="範囲を選ぶ"
              style={selecting && frame ? frame : undefined}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={cancel}
            >
              {selecting ? (
                <>
                  <div className="hint">ドラッグして、範囲を選びます（Esc か、枠の外を押すと、やめます）</div>
                  {box ? (
                    <div className="box" style={{ left: box.x, top: box.y, width: box.w, height: box.h }} />
                  ) : null}
                </>
              ) : null}
            </div>,
            scroller,
          )
        : null}
    </>
  );
}
