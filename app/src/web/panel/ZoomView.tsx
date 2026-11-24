// ズーム・移動ができるステージ（本文・返信の画像・図：F37）。個別表示（F43）では、窓の左のステージの領域（右のドックを除く）に出し、範囲を選んで、コメントできる。
// 座標：姿勢 `pose`（ズーム・移動）・ステージの領域の大きさ `view`（ResizeObserver で測る）・中身の自然な大きさ `nat` から、中身の箱が決まる（`interact/focusGeom.ts`）。
// 範囲は、その箱に対する比率で持つ（ズーム・移動で、変わらない）。既存の範囲コメントの枠は、同じ箱の上に重ねる（ズーム・移動に、追従する）。
import { Maximize2, X, ZoomIn, ZoomOut } from 'lucide-react';
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { boxAt, type DragSelection, ratioToBox, stageBox } from '../interact/focusGeom';
import { finishFocusMedia } from '../interact/focusRegion';
import type { RegionDeps } from '../interact/region';
import {
  clampPan,
  fitPose,
  fitScale,
  isClickGesture,
  type Pose,
  type Size,
  toggleScale,
  wheelFactor,
  ZOOM_MAX,
  ZOOM_STEP,
  zoomAt,
} from '../lib/zoom';
import { svgNaturalSize } from '../lib/zoomSvg';
import { type FocusRef, type LightboxTarget, useUi } from '../store/ui';
import { DragOverlay } from './DragOverlay';
import { RangeTool } from './FocusTools';
import type { FocusCtx } from './useFocusCtx';

type MediaTarget = Exclude<LightboxTarget, { kind: 'img'; zoom: false } | { kind: 'app' }>;

interface DragState {
  x: number;
  y: number;
  pose: Pose;
  moved: boolean;
  /** 押したのが、画像・図（と、その上の範囲の枠）の上か（ドラッグで、ポインターを取り込むと、離したときの target は、取り込んだ要素になるので、押したときに決める） */
  onContent: boolean;
}

/** ステージの領域の大きさ。測れない（jsdom・まだ配置されていない）ときは、窓の大きさ */
function measure(el: HTMLElement | null): Size {
  const r = el?.getBoundingClientRect();
  return r && r.width > 0 && r.height > 0
    ? { w: r.width, h: r.height }
    : { w: window.innerWidth, h: window.innerHeight };
}

/** ズーム・移動ができる表示（本文・返信の画像・図）。姿勢 `pose` が null の間は、全体表示。`focus`・`ctx`：個別表示のとき（範囲の枠の重ね・範囲を選ぶ道具） */
export function ZoomView({
  target,
  onClose,
  focus,
  ctx,
  deps,
}: {
  target: MediaTarget;
  onClose: () => void;
  focus?: FocusRef | undefined;
  ctx?: FocusCtx | undefined;
  deps?: RegionDeps | undefined;
}) {
  const viewRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<Size>(() => measure(null));
  const [imgNat, setImgNat] = useState<Size | null>(null);
  const [custom, setCustom] = useState<Pose | null>(null);
  const [panning, setPanning] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const drag = useRef<DragState | null>(null);
  const tool = useUi((s) => s.focusTool);

  const nat: Size | null = target.kind === 'svg' ? svgNaturalSize(target.node, target.size) : imgNat;
  const fit = nat ? fitScale(nat, view, target.kind) : 1;
  const pose: Pose = custom ?? fitPose(fit);
  const atFit = pose.scale <= fit + 1e-6;
  const atMax = pose.scale >= Math.max(ZOOM_MAX, fit) - 1e-6;

  // イベントの処理が、いつも、最新の値を読む
  const live = useRef({ nat, view, fit, pose });
  live.current = { nat, view, fit, pose };

  // ステージの領域の大きさ（右のドックを除く）が変わったら、測り直して、全体表示に戻す（窓の大きさ・ドックの出し入れ）
  useLayoutEffect(() => {
    const el = viewRef.current;
    const sync = (): void => {
      const next = measure(el);
      const cur = live.current.view;
      if (cur.w === next.w && cur.h === next.h) return;
      setView(next);
      setCustom(null);
    };
    sync();
    if (!el) return;
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    window.addEventListener('resize', sync);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', sync);
    };
  }, []);

  // 図：複製した SVG を、舞台に入れる（HTML を、文字列から作らない）。大きさは、自然な大きさ
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (target.kind !== 'svg' || !stage || !nat) return;
    const svg = target.node;
    svg.setAttribute('width', String(nat.w));
    svg.setAttribute('height', String(nat.h));
    svg.style.maxWidth = 'none';
    svg.style.display = 'block';
    if (svg.parentElement !== stage) stage.replaceChildren(svg);
  }, [target, nat]);

  /** 倍率を変える（cursor は、ステージの領域の中心からの位置。既定は、中心）。値は、live（ref）から読む */
  const zoomTo = useCallback((scale: number, cursor = { x: 0, y: 0 }): void => {
    const l = live.current;
    if (!l.nat) return;
    setCustom(zoomAt(l.pose, l.nat, l.view, l.fit, scale, cursor));
  }, []);
  const toFit = useCallback((): void => setCustom(null), []);
  const cursorOf = useCallback((e: { clientX: number; clientY: number }) => {
    const r = viewRef.current?.getBoundingClientRect();
    const l = live.current.view;
    return { x: e.clientX - ((r?.left ?? 0) + l.w / 2), y: e.clientY - ((r?.top ?? 0) + l.h / 2) };
  }, []);

  // ホイールでズーム（カーソルを中心に）。窓のどこでも（右のドックの上は、ふつうにスクロールする）。ページのスクロールを止めるので、passive にしない
  useEffect(() => {
    const el = viewRef.current;
    const root = el?.closest<HTMLElement>('#lightbox') ?? el;
    if (!root) return;
    const onWheel = (e: WheelEvent): void => {
      if (e.target instanceof Element && e.target.closest('.fv-dock')) return;
      e.preventDefault();
      zoomTo(live.current.pose.scale * wheelFactor(e.deltaY, e.deltaMode), cursorOf(e));
    };
    root.addEventListener('wheel', onWheel, { passive: false });
    return () => root.removeEventListener('wheel', onWheel);
  }, [zoomTo, cursorOf]);

  // キー：＋／−／0（全体表示）。Esc は、親が受ける。入力欄（右のドックの textarea）では、効かせない（文字が打てなくなる）
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target instanceof Element && e.target.closest('textarea, input, select, [contenteditable]')) return;
      if (e.key === '+' || e.key === '=') zoomTo(live.current.pose.scale * ZOOM_STEP);
      else if (e.key === '-' || e.key === '_') zoomTo(live.current.pose.scale / ZOOM_STEP);
      else if (e.key === '0') toFit();
      else return;
      e.preventDefault();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [zoomTo, toFit]);

  // ドラッグで移動。押した位置から、ほとんど動かなかったときは「押す」：画像・図の外（背景）なら、閉じる
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0 || (e.target as Element).closest('.lb-tools, .fv-tools')) return;
    drag.current = {
      x: e.clientX,
      y: e.clientY,
      pose: live.current.pose,
      moved: false,
      onContent: !!(e.target as Element).closest('.lb-stage, .fv-regions'),
    };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const d = drag.current;
    if (!d) return;
    if (!d.moved) {
      if (isClickGesture({ x: d.x, y: d.y }, { x: e.clientX, y: e.clientY })) return;
      d.moved = true;
      e.currentTarget.setPointerCapture?.(e.pointerId); // ドラッグが始まってから、取り込む（押しただけなら、click・dblclick の target を、変えない）
      if (live.current.pose.scale > live.current.fit + 1e-6) setPanning(true);
    }
    const l = live.current;
    if (!l.nat || d.pose.scale <= l.fit + 1e-6) return; // 全体表示では、動かさない
    setCustom(
      clampPan({ scale: d.pose.scale, x: d.pose.x + e.clientX - d.x, y: d.pose.y + e.clientY - d.y }, l.nat, l.view),
    );
  };
  const onPointerUp = (): void => {
    const d = drag.current;
    drag.current = null;
    setPanning(false);
    if (!d || d.moved) return; // ドラッグの終わりでは、閉じない
    if (!d.onContent) onClose();
  };

  // ---- 個別表示：範囲の枠の重ね・範囲を選ぶ ----
  const box = nat ? stageBox(pose, nat, view) : null; // 中身の箱（ステージの領域の座標）
  const canSelect = !!focus?.base && !!ctx?.block && ctx.canComment && !!nat;
  /** 中身の、いまの箱（画面の座標）。ドラッグの点を収める・比率にする */
  const viewportBox = useCallback(() => {
    const r = viewRef.current?.getBoundingClientRect();
    const l = live.current;
    const b = l.nat ? stageBox(l.pose, l.nat, l.view) : null;
    return r && b ? boxAt(r.left + b.left, r.top + b.top, b.width, b.height) : null;
  }, []);
  const onSelect = (sel: DragSelection): void => {
    const block = ctx?.block;
    const media = stageRef.current?.querySelector(target.kind === 'img' ? 'img' : 'svg');
    if (!block || !media || !deps) return;
    finishFocusMedia(
      { block, media, rect: sel.rect, size: target.kind === 'svg' ? (live.current.nat ?? null) : null },
      deps,
    );
  };
  const marks = useMemo(() => (focus?.base ? (ctx?.regions ?? []) : []), [focus?.base, ctx?.regions]);
  const selectThread = (tid: string): void => {
    const t = ctx?.threads.find((x) => x.id === tid);
    if (t) useUi.getState().focusThread(t);
  };
  const activeTid = useUi((s) => s.active);
  const linkedTid = useUi((s) => s.linkedTid);

  const pct = Math.round(pose.scale * 100);
  const tx = nat ? `translate(-50%, -50%) translate(${pose.x}px, ${pose.y}px) scale(${pose.scale})` : undefined;
  return (
    <>
      <div
        ref={viewRef}
        className={`lb-view${panning ? ' panning' : ''}${atFit ? '' : ' zoomed'}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          drag.current = null;
          setPanning(false);
        }}
      >
        {/* biome-ignore lint/a11y/noStaticElementInteractions: ダブルクリックで、全体表示 ↔ 等倍（キーボードは、0 と、ボタン） */}
        <div
          ref={stageRef}
          className={`lb-stage ${target.kind}`}
          style={nat ? { width: nat.w, height: nat.h, transform: tx } : { visibility: 'hidden' }}
          onDoubleClick={(e) => zoomTo(toggleScale(live.current.pose.scale, live.current.fit), cursorOf(e))}
        >
          {target.kind === 'img' ? (
            <img
              alt={target.alt}
              src={target.src}
              draggable={false}
              onLoad={(e) => setImgNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
            />
          ) : null}
        </div>
        {box && marks.length ? (
          <div className="fv-regions" aria-hidden="true">
            {marks.map((m) => {
              const b = ratioToBox(m.rect, box);
              if (!b) return null;
              const cls = [
                'fv-box',
                m.tid === 'pending' && 'pending',
                b.top < 24 && 'top',
                m.resolved && 'resolved',
                activeTid === m.tid && 'active',
                linkedTid === m.tid && 'linked',
              ]
                .filter(Boolean)
                .join(' ');
              return (
                // biome-ignore lint/a11y/useKeyWithClickEvents: 枠は、マウスの近道。キーボードは、ドックのカード
                // biome-ignore lint/a11y/noStaticElementInteractions: 同上
                <div
                  key={m.tid}
                  className={cls}
                  data-tid={m.tid}
                  style={{ left: b.left, top: b.top, width: b.width, height: b.height }}
                  onClick={m.tid === 'pending' ? undefined : () => selectThread(m.tid)}
                >
                  <span className="fv-no">{m.n}</span>
                </div>
              );
            })}
          </div>
        ) : null}
        {tool === 'region' && canSelect ? <DragOverlay getBox={viewportBox} onSelect={onSelect} /> : null}
      </div>
      {focus ? (
        <div className="fv-tools" role="toolbar" aria-label="コメントの道具">
          <RangeTool
            enabled={canSelect}
            reason={
              ctx?.canComment === false
                ? '最新版にだけ、コメントを付けられます'
                : focus.base
                  ? '画像・図の読み込みが終わってから、選べます'
                  : 'このブロックの、2 つ目以降の画像・図では、範囲を選べません（ブロック全体には、コメントできます）'
            }
          />
        </div>
      ) : null}
      <div className="lb-tools" role="toolbar" aria-label="拡大表示の操作">
        <button
          type="button"
          aria-label="ズームアウト"
          title="ズームアウト（−）"
          disabled={atFit}
          onClick={() => zoomTo(pose.scale / ZOOM_STEP)}
        >
          <ZoomOut aria-hidden="true" focusable="false" />
        </button>
        <span className="lb-pct" title="ズーム倍率（等倍が 100%）">
          {pct}%
        </span>
        <button
          type="button"
          aria-label="ズームイン"
          title="ズームイン（＋）"
          disabled={atMax}
          onClick={() => zoomTo(pose.scale * ZOOM_STEP)}
        >
          <ZoomIn aria-hidden="true" focusable="false" />
        </button>
        <button type="button" aria-label="全体に合わせる" title="全体に合わせる（0）" disabled={atFit} onClick={toFit}>
          <Maximize2 aria-hidden="true" focusable="false" />
        </button>
        <button type="button" className="close" aria-label="閉じる" title="閉じる（Esc）" onClick={onClose}>
          <X aria-hidden="true" focusable="false" />
        </button>
      </div>
    </>
  );
}
