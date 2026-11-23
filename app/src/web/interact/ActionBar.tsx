// 入口のバー（`#actbar`。「コメント」。画像・図を含むブロックでは、「拡大」も）。文を選ぶと、選んだ文の上に・ブロックにマウスを置くと、そのブロックの右上に出る（範囲は、右下に浮かぶ「範囲を選ぶ」）。
// ブロックにマウスを置くと、入口のバーを、そのブロックの右上（ブロックの上）に出す。バーへ向かう間に消えない・別のブロックへ飛ばないように、
// ポインターが「そのブロックの、バーの高さ上〜下端 × 箱の右端まで」の帯にいる間は、同じブロックのまま出し続ける（`inBand`）。
// 帯の外でも、本文の箱の右の余白にいる間は、同じ高さにある本文のブロックを探す（左の余白は、探さない）。
import { MessageSquarePlus, ZoomIn } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Anchor } from '../../shared/types';
import { blockAnchor } from '../doc/render/blocks';
import { openZoomOf, zoomTargetOfBlock } from '../doc/zoomOpen';
import { $ } from '../lib/dom';
import { useUi } from '../store/ui';
import { openComposer } from './compose';
import { barPosition, blockBarSpot, inBand, probeX } from './geometry';
import { anchorFromSelection } from './selection';

/** ブロックのバーが、ポインターが帯を出てから、消えるまでの遅れ（ms） */
export const BLOCK_BAR_HIDE_MS = 350;

type BarMode = 'sel' | 'blk';
interface Bar {
  mode: BarMode;
  /** バーの右端・上端（画面の座標） */
  right: number;
  top: number;
  /** 「拡大」を出すか：ブロックのバーで、そのブロックが、画像・Mermaid の図・インラインの svg を含むとき */
  zoom: boolean;
}
/** イベントの処理が読む、いまの状態（再描画を起こさない） */
interface Ctl {
  /** 'sel'（文を選んだとき）・'blk'（ブロックにマウスを置いたとき）・null（出していない） */
  mode: BarMode | null;
  /** 文を選んだときの、対象 */
  anchor: Anchor | null;
  /** ブロックにマウスを置いたときの、ブロック */
  blk: HTMLElement | null;
  hideTimer: number;
}

interface Props {
  /** `#docscroll`（まだなければ null） */
  scroller: HTMLElement | null;
  /** 最新版を見ているか（コメントの入口は、最新版にだけ） */
  latest: boolean;
}

export function ActionBar({ scroller, latest }: Props) {
  const [bar, setBar] = useState<Bar | null>(null);
  const barEl = useRef<HTMLDivElement>(null);
  const ctl = useRef<Ctl>({ mode: null, anchor: null, blk: null, hideTimer: 0 });
  const latestRef = useRef(latest);
  const layout = useUi((s) => s.ui);

  const hide = useCallback((): void => {
    ctl.current.mode = null;
    setBar(null);
  }, []);
  const show = useCallback((mode: BarMode, right: number, top: number, zoom = false): void => {
    ctl.current.mode = mode;
    setBar({ mode, right, top, zoom });
  }, []);
  /** ブロックのバーを、遅れて隠す（バーへ向かう間に、消えないように） */
  const scheduleHide = useCallback((): void => {
    window.clearTimeout(ctl.current.hideTimer);
    ctl.current.hideTimer = window.setTimeout(() => {
      if (ctl.current.mode === 'blk') hide();
    }, BLOCK_BAR_HIDE_MS);
  }, [hide]);

  // バーの位置：右端・上端を、窓の中に収める（幅は、出してから測る）
  useLayoutEffect(() => {
    const el = barEl.current;
    if (!bar || !el) return;
    const p = barPosition(bar.right, bar.top, el.offsetWidth, window.innerWidth);
    el.style.left = `${p.left}px`;
    el.style.top = `${p.top}px`;
  }, [bar]);

  // 最新版でなくなった・左の一覧の開閉・右の幅の変更（配置が変わる）：入口のバーは、隠す
  // biome-ignore lint/correctness/useExhaustiveDependencies: latest・layout は、「変わったこと」だけが必要
  useEffect(() => {
    latestRef.current = latest;
    hide();
  }, [latest, layout, hide]);
  // 入力欄を開いた・範囲を選び始めた：隠す
  useEffect(
    () =>
      useUi.subscribe((s, prev) => {
        if ((s.composer && s.composer !== prev.composer) || (s.regMode === 'selecting' && prev.regMode !== 'selecting'))
          hide();
      }),
    [hide],
  );

  useEffect(() => {
    if (!scroller) return;
    const c = ctl.current;
    let selTimer = 0;
    const onBar = (e: { target: EventTarget | null }): boolean =>
      e.target instanceof Node && !!barEl.current?.contains(e.target);

    // 文の選択：mouseup のあとの、選択の確定を待ってから、アンカーを作る
    const onMouseUp = (e: MouseEvent): void => {
      if (onBar(e)) return;
      window.clearTimeout(selTimer);
      selTimer = window.setTimeout(() => {
        const sel = getSelection();
        const article = $('#article');
        const a =
          sel && article && !sel.isCollapsed && latestRef.current && useUi.getState().regMode === 'idle'
            ? anchorFromSelection(article, sel)
            : null;
        if (!sel || !a) {
          c.anchor = null;
          if (c.mode === 'sel') hide();
          return;
        }
        c.anchor = a;
        const rect = sel.getRangeAt(0).getBoundingClientRect();
        show('sel', rect.right + 24, rect.top - 38);
      }, 0);
    };
    const onMouseDown = (e: MouseEvent): void => {
      if (!onBar(e) && c.mode === 'sel') hide();
    };

    const blockAt = (x: number, y: number, art: HTMLElement): HTMLElement | null => {
      const el = document.elementFromPoint(probeX(x, art.getBoundingClientRect()), y);
      return el?.closest<HTMLElement>('#article [data-bid]') ?? null;
    };
    const onMove = (e: MouseEvent): void => {
      const art = $('#article');
      const ui = useUi.getState();
      // 入力欄を開いている間は、ブロックのバーを出さない（入力欄・選んだ範囲の上に、重ならないように）
      if (!art || !latestRef.current || ui.regMode !== 'idle' || c.mode === 'sel' || ui.composer) return;
      const artBox = art.getBoundingClientRect();
      if (
        c.blk &&
        c.mode === 'blk' &&
        inBand(
          c.blk.getBoundingClientRect(),
          artBox,
          barEl.current?.getBoundingClientRect() ?? null,
          e.clientX,
          e.clientY,
        )
      ) {
        window.clearTimeout(c.hideTimer);
        return;
      }
      const blk = blockAt(e.clientX, e.clientY, art);
      if (!blk) {
        scheduleHide();
        return;
      }
      window.clearTimeout(c.hideTimer);
      c.blk = blk;
      const spot = blockBarSpot(blk.getBoundingClientRect(), artBox, scroller.getBoundingClientRect().top);
      show('blk', spot.right, spot.top, !!zoomTargetOfBlock(blk));
    };
    // バーへ向かって、本文の領域を出るときは、消さない（React の onMouseEnter は、この mouseleave より先に呼ばれるので、タイマーを止められない）
    const onLeave = (e: MouseEvent): void => {
      if (!onBar({ target: e.relatedTarget })) scheduleHide();
    };
    const onScroll = (): void => {
      if (c.mode === 'blk') hide();
    };

    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('mousedown', onMouseDown);
    scroller.addEventListener('mousemove', onMove);
    scroller.addEventListener('scroll', onScroll);
    scroller.addEventListener('mouseleave', onLeave);
    return () => {
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('mousedown', onMouseDown);
      scroller.removeEventListener('mousemove', onMove);
      scroller.removeEventListener('scroll', onScroll);
      scroller.removeEventListener('mouseleave', onLeave);
      window.clearTimeout(selTimer);
      window.clearTimeout(c.hideTimer);
    };
  }, [scroller, hide, show, scheduleHide]);

  const onComment = (): void => {
    const c = ctl.current;
    const blk = c.mode === 'blk' && c.blk?.isConnected ? c.blk : null;
    const a = c.mode === 'sel' ? c.anchor : blk && blockAnchor(blk);
    hide();
    if (a) openComposer(a);
  };

  /** 「拡大」：そのブロックの（最初の）画像・図を、大きく出す（コメントの有無に関係なく）。コメントの入力欄は、開かない */
  const onZoom = (): void => {
    const c = ctl.current;
    const el = c.mode === 'blk' && c.blk?.isConnected ? zoomTargetOfBlock(c.blk) : null;
    hide();
    if (el) openZoomOf(el);
  };

  return (
    // 押しても、文の選択を外さない。バーへ向かう間・バーの上にいる間は、ブロックのバーを消さない（マウスだけの、見た目のための処理）
    // biome-ignore lint/a11y/noStaticElementInteractions: 旧と同じ DOM（役割を足さない）。操作は、中の button
    <div
      id="actbar"
      ref={barEl}
      hidden={!bar}
      onMouseDown={(e) => e.preventDefault()}
      onMouseEnter={() => window.clearTimeout(ctl.current.hideTimer)}
      onMouseLeave={() => {
        if (ctl.current.mode === 'blk') scheduleHide();
      }}
    >
      {bar?.mode === 'blk' && bar.zoom ? (
        <button id="act-zoom" type="button" aria-label="拡大" title="この画像・図を、大きく見ます" onClick={onZoom}>
          <ZoomIn aria-hidden="true" focusable="false" />
          拡大
        </button>
      ) : null}
      <button id="act-comment" type="button" title="この文・ブロックに、コメントします" onClick={onComment}>
        <MessageSquarePlus aria-hidden="true" focusable="false" />
        コメント
      </button>
    </div>
  );
}
