// 画像・図を、画面の中に、大きく出す。
// - 添付の画像（サムネイル・送った画像：F31）：大きく出して、押す・Esc で閉じる。
// - 本文・返信の画像・図（F37）：窓に収まる大きさで出して、ズーム（＋／−／全体表示・ホイール・キー）・移動（ドラッグ）・ダブルクリック（全体表示 ↔ 等倍）ができる。
//   閉じる：Esc・背景（画像・図の外）を押す・X。ドラッグの終わりでは、閉じない。画像・図の上を押しても、閉じない。
// 範囲の枠をドラッグしている間の Esc は、枠を元に戻すほう（interact）が受ける：そのときは、閉じない。
// 開いたとき、フォーカスを、ここへ（`role="dialog"`・`aria-modal`）。閉じたとき、開く前の要素へ戻す（フォーカスできる要素だったとき）。
import { Maximize2, X, ZoomIn, ZoomOut } from 'lucide-react';
import {
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
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
import { ATTACHED_ALT, type LightboxTarget, useUi } from '../store/ui';

type ZoomTarget = Exclude<LightboxTarget, { kind: 'img'; zoom: false }>;
const isZoomTarget = (t: LightboxTarget | null): t is ZoomTarget => !!t && (t.kind === 'svg' || t.zoom);

export function Lightbox() {
  const target = useUi((s) => s.lightbox);
  const closeLightbox = useUi((s) => s.closeLightbox);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (target === null) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !useUi.getState().regDrag) closeLightbox();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [target, closeLightbox]);

  // 開いたとき、フォーカスを、ここへ。閉じたとき、開く前の要素へ戻す（フォーカスできる要素だったとき）
  useEffect(() => {
    if (target === null) return;
    const before =
      document.activeElement instanceof HTMLElement && document.activeElement !== document.body
        ? document.activeElement
        : null;
    rootRef.current?.focus({ preventScroll: true });
    return () => {
      if (before && document.contains(before)) before.focus({ preventScroll: true });
    };
  }, [target]);

  const zt = isZoomTarget(target) ? target : null;
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: 閉じるキーは Esc（上の keydown）。添付の画像は、旧と同じ DOM（押すと閉じる）
    <div
      id="lightbox"
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={target?.alt ?? ATTACHED_ALT}
      tabIndex={-1}
      hidden={target === null}
      className={zt ? 'zoomable' : undefined}
      onClick={zt ? undefined : closeLightbox}
    >
      {zt ? (
        <ZoomView target={zt} rootRef={rootRef} onClose={closeLightbox} />
      ) : (
        <>
          <img alt={target?.alt ?? ATTACHED_ALT} src={target?.kind === 'img' ? target.src : undefined} />
          <span className="close">
            <X aria-hidden="true" focusable="false" />
          </span>
        </>
      )}
    </div>
  );
}

interface DragState {
  x: number;
  y: number;
  pose: Pose;
  moved: boolean;
  /** 押したのが、画像・図の上か（ドラッグで、ポインターを取り込むと、離したときの target は、取り込んだ要素になるので、押したときに決める） */
  onContent: boolean;
}

/** ズーム・移動ができる表示（本文・返信の画像・図）。姿勢 `pose` が null の間は、全体表示 */
function ZoomView({
  target,
  rootRef,
  onClose,
}: {
  target: ZoomTarget;
  rootRef: RefObject<HTMLDivElement | null>;
  onClose: () => void;
}) {
  const [view, setView] = useState<Size>(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const [imgNat, setImgNat] = useState<Size | null>(null);
  const [custom, setCustom] = useState<Pose | null>(null);
  const [panning, setPanning] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const drag = useRef<DragState | null>(null);

  const nat: Size | null = target.kind === 'svg' ? svgNaturalSize(target.node, target.size) : imgNat;
  const fit = nat ? fitScale(nat, view, target.kind) : 1;
  const pose: Pose = custom ?? fitPose(fit);
  const atFit = pose.scale <= fit + 1e-6;
  const atMax = pose.scale >= Math.max(ZOOM_MAX, fit) - 1e-6;

  // イベントの処理が、いつも、最新の値を読む
  const live = useRef({ nat, view, fit, pose });
  live.current = { nat, view, fit, pose };

  // 窓の大きさが変わったら、全体表示に戻す
  useEffect(() => {
    const onResize = (): void => {
      setView({ w: window.innerWidth, h: window.innerHeight });
      setCustom(null);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
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

  /** 倍率を変える（cursor は、窓の中心からの位置。既定は、窓の中心）。値は、live（ref）から読む */
  const zoomTo = useCallback((scale: number, cursor = { x: 0, y: 0 }): void => {
    const l = live.current;
    if (!l.nat) return;
    setCustom(zoomAt(l.pose, l.nat, l.view, l.fit, scale, cursor));
  }, []);
  const toFit = useCallback((): void => setCustom(null), []);
  const cursorOf = useCallback(
    (e: { clientX: number; clientY: number }) => ({
      x: e.clientX - live.current.view.w / 2,
      y: e.clientY - live.current.view.h / 2,
    }),
    [],
  );

  // ホイールでズーム（カーソルを中心に）。ページのスクロールを止めるので、passive にしない
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      zoomTo(live.current.pose.scale * wheelFactor(e.deltaY, e.deltaMode), cursorOf(e));
    };
    root.addEventListener('wheel', onWheel, { passive: false });
    return () => root.removeEventListener('wheel', onWheel);
  }, [rootRef, zoomTo, cursorOf]);

  // キー：＋／−／0（全体表示）。Esc は、親が受ける
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === '+' || e.key === '=') zoomTo(live.current.pose.scale * ZOOM_STEP);
      else if (e.key === '-' || e.key === '_') zoomTo(live.current.pose.scale / ZOOM_STEP);
      else if (e.key === '0') toFit();
      else return;
      e.preventDefault();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [zoomTo, toFit]);

  // Tab は、ライトボックスの中のボタンだけを回る（背景の本文へ、出ない）
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onTab = (e: KeyboardEvent): void => {
      if (e.key !== 'Tab') return;
      e.preventDefault();
      const btns = [...root.querySelectorAll<HTMLButtonElement>('.lb-tools button:not(:disabled)')];
      if (!btns.length) return;
      const i = btns.indexOf(document.activeElement as HTMLButtonElement);
      btns[(i + (e.shiftKey ? -1 : 1) + btns.length) % btns.length]?.focus();
    };
    root.addEventListener('keydown', onTab);
    return () => root.removeEventListener('keydown', onTab);
  }, [rootRef]);

  // ドラッグで移動。押した位置から、ほとんど動かなかったときは「押す」：画像・図の外（背景）なら、閉じる
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0 || (e.target as Element).closest('.lb-tools')) return;
    drag.current = {
      x: e.clientX,
      y: e.clientY,
      pose: live.current.pose,
      moved: false,
      onContent: !!(e.target as Element).closest('.lb-stage'),
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

  const pct = Math.round(pose.scale * 100);
  const tx = nat ? `translate(-50%, -50%) translate(${pose.x}px, ${pose.y}px) scale(${pose.scale})` : undefined;
  return (
    <div
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
      <div className="lb-tools" role="toolbar" aria-label="拡大表示の操作">
        <button
          type="button"
          aria-label="縮小"
          title="縮小（−）"
          disabled={atFit}
          onClick={() => zoomTo(pose.scale / ZOOM_STEP)}
        >
          <ZoomOut aria-hidden="true" focusable="false" />
        </button>
        <span className="lb-pct" title="拡大率（等倍が 100%）">
          {pct}%
        </span>
        <button
          type="button"
          aria-label="拡大"
          title="拡大（＋）"
          disabled={atMax}
          onClick={() => zoomTo(pose.scale * ZOOM_STEP)}
        >
          <ZoomIn aria-hidden="true" focusable="false" />
        </button>
        <button type="button" aria-label="全体表示" title="全体表示（0）" disabled={atFit} onClick={toFit}>
          <Maximize2 aria-hidden="true" focusable="false" />
        </button>
        <button type="button" className="close" aria-label="閉じる" title="閉じる（Esc）" onClick={onClose}>
          <X aria-hidden="true" focusable="false" />
        </button>
      </div>
    </div>
  );
}
