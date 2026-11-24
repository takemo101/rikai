// html-app の枠の個別表示（F43）：窓の左のステージに、枠を、利用できる幅いっぱいに大きく出す。
// **新しい iframe を作る**（同じ内容・同じ `sandbox="allow-scripts"`・同じ `APP_CSP`・同じ橋）。本文の枠は、動かさない（動かすと、再読み込みで状態が消え、本文の枠が壊れる）。
// 本文の枠の状態（スライダーなど）は、引き継がない（既知の制約）。個別表示の枠は、`registerFrame` で橋の登録簿に入る：枠からの `pick`・`state`・`snapshot` は、**本文の枠と同じ検査**
// （`e.source`＝この枠の `contentWindow`・形・大きさ・頻度・`reveal`）で受ける。**錨は、本文の、元の枠（ブロック）**。閉じる・本文から消える・開き直すときは、必ず `releaseApps` で外す（リスナー・iframe を残さない）。
// 幅の切り替え・縮小表示・枠だけのライト／ダークは、本文の枠と同じ部品（`AppToolbar`・`frameBridge`）。範囲の枠の重ねは、枠の置き場（`.appscale`）の中に置く（縮小・横スクロールに、追従する）。
import { X } from 'lucide-react';
import { useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { pickLabel } from '../../shared/htmlapp-bridge';
import { blockAnchor, frameOf } from '../doc/render/blocks';
import { AppToolbar } from '../htmlapp/AppToolbar';
import { appFrameDom } from '../htmlapp/apps';
import { registerFrame } from '../htmlapp/frameBridge';
import { frameMetaOf } from '../htmlapp/frameMeta';
import { type AppFrame, releaseApps } from '../htmlapp/frameRegistry';
import { initialFrameState } from '../htmlapp/frameState';
import { openComposer } from '../interact/compose';
import type { RegionDeps } from '../interact/region';
import { escapeStep } from '../lib/escape';
import { type Box, fromRatio, ratioOf } from '../lib/geom';
import { resolvedTheme } from '../lib/theme';
import { clampRegionRect } from '../overlay/layout';
import { type LightboxTarget, useUi } from '../store/ui';
import { DragOverlay } from './DragOverlay';
import { RangeTool } from './FocusTools';
import type { DragSelection } from './focusGeom';
import { finishFocusApp } from './focusRegion';
import type { FocusCtx, RegionMark } from './useFocusCtx';

type AppTarget = Extract<LightboxTarget, { kind: 'app' }>;

/** 個別表示の枠の、幅・外観の記憶の鍵（本文の枠の鍵 `n` と、混ざらない：負の数）。本文の枠の幅・外観を、個別表示が書き換えない */
const memoryKey = (n: number): number => -1 - n;

interface Built {
  frame: AppFrame;
  iframe: HTMLIFrameElement;
  scale: HTMLElement;
}

export function FocusApp({
  target,
  ctx,
  deps,
  onClose,
  onFrame,
}: {
  target: AppTarget;
  ctx: FocusCtx;
  deps: RegionDeps;
  onClose: () => void;
  /** 枠を作った・外した：ドックが、この枠の最新の状態（`rikai.state`）を読む（本文の枠の状態では、ない） */
  onFrame: (frame: AppFrame | null) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [built, setBuilt] = useState<Built | null>(null);
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const hasView = !!ctx.view; // ビューが届くまで、枠は作らない（届いたら、作る）

  // 枠を作って、橋に登録する。後始末：橋から外し（リスナー・待っている画像・選択モード）、DOM を空にする
  useLayoutEffect(() => {
    const host = hostRef.current;
    const view = ctxRef.current.view;
    if (!host || !view || !hasView) return;
    const { n, fixed, follows } = target.app;
    const key = memoryKey(n);
    const state = initialFrameState(view.key, key, resolvedTheme(), follows);
    const { wrap, iframe } = appFrameDom(view, n, fixed, state.mode, {
      title: `実行できる枠 ${n + 1}（拡大表示）`,
      eager: true,
    });
    host.replaceChildren(wrap);
    const scale = iframe.parentElement;
    if (!scale) return;
    const frame = registerFrame(iframe, key, fixed === null, follows, state, {
      // 利用者が、枠の中の要素を選んだ（検査済み）：本文の、元の枠（ブロック）への下書き（右のドックの入力欄）。自動では、送らない
      // 枠の中の Esc（枠の中にフォーカスがあると、親に届かない）：閉じる・道具の中止の順序に流す（`lib/escape.ts`）。選択モードの Esc は、橋が `pick-cancel` で処理する
      onEsc: () => {
        if (useUi.getState().lightbox?.kind === 'app') escapeStep();
      },
      onPick: (pick, stateJson) => {
        const blk = ctxRef.current.block;
        if (!blk) return;
        const r = frameMetaOf({ pick, stateJson });
        if (!r.ok) {
          useUi.getState().showToast(r.reason, true);
          return;
        }
        openComposer({ ...blockAnchor(blk), label: pickLabel(pick) }, r.meta);
      },
    });
    // 幅の既定は、本文の枠が、いま選んでいる幅（プリセット）：範囲を、同じレイアウトで選べる。本文が「自動」なら、個別表示も「自動」（ステージの幅いっぱい）
    frame.setWidth(initialFrameState(view.key, n, resolvedTheme(), follows).width);
    setBuilt({ frame, iframe, scale });
    onFrame(frame);
    return () => {
      onFrame(null);
      setBuilt(null);
      releaseApps(host);
      host.replaceChildren();
    };
  }, [target, hasView, onFrame]);

  return (
    <>
      {/* 上の帯：道具（幅・外観・要素・範囲）と、閉じる。狭い窓では、折り返して、枠に重ならない */}
      <div className="fv-appbar">
        <div className="fv-tools" role="toolbar" aria-label="コメントの道具">
          {built ? <AppTools built={built} ctx={ctx} /> : null}
        </div>
        <div className="lb-tools" role="toolbar" aria-label="拡大表示の操作">
          <button type="button" className="close" aria-label="閉じる" title="閉じる（Esc）" onClick={onClose}>
            <X aria-hidden="true" focusable="false" />
          </button>
        </div>
      </div>
      <div className="fv-appstage">
        <div className="fv-app" ref={hostRef} />
      </div>
      {built ? createPortal(<AppOverlay built={built} ctx={ctx} deps={deps} />, built.scale) : null}
    </>
  );
}

/** 枠の道具：幅・外観・要素を選ぶ（本文の枠と同じ `AppToolbar`）と、範囲を選ぶ。要素を選ぶと、範囲を選ぶのは、やめる（同時に 1 つの道具） */
function AppTools({ built, ctx }: { built: Built; ctx: FocusCtx }) {
  const { frame } = built;
  const picking = useSyncExternalStore(frame.subscribe, () => frame.get().picking);
  const tool = useUi((s) => s.focusTool);
  // 要素を選び始めた：範囲を選ぶのは、やめる
  useLayoutEffect(() => {
    if (picking && tool === 'region') useUi.getState().setFocusTool('idle');
  }, [picking, tool]);
  return (
    <>
      {/* biome-ignore lint/a11y/useSemanticElements: ツールバーの中の、ボタンの組（fieldset は、枠線・余白の、既定の見た目を持つ） */}
      <div className="fv-apptools" role="group" aria-label="枠の表示（幅・外観）と、要素の選択">
        <AppToolbar frame={frame} />
      </div>
      <RangeTool
        enabled={ctx.canComment}
        reason="最新版にだけ、コメントを付けられます"
        onStart={() => frame.cancelPick()}
      />
      <WidthNote built={built} ctx={ctx} />
    </>
  );
}

/** 枠の置き場（`.appscale`）の左上から見た、枠の見た目の箱（px） */
interface Layer {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * 本文の枠と、幅が違うことの注記：範囲は、枠の置き場に対する割合で保存するので、レイアウトが違うと、本文の枠では、別の要素を指しうる（添える画像は、選んだ見た目のまま）。同じ幅なら、出さない。
 * 幅は、枠のレイアウトの幅（縮小表示の前）。測れないとき（枠がない）は、出さない
 */
function WidthNote({ built, ctx }: { built: Built; ctx: FocusCtx }) {
  const { frame, iframe } = built;
  useSyncExternalStore(frame.subscribe, () => `${frame.get().width}/${frame.get().avail}`); // 幅の切り替え・ステージの大きさに追従
  const home = ctx.block?.querySelector<HTMLIFrameElement>('iframe.appframe');
  const here = Math.round(iframe.offsetWidth);
  const there = home ? Math.round(home.offsetWidth) : 0;
  if (!there || !here || here === there) return null;
  return (
    <span
      className="fv-widthnote"
      title="範囲は、枠の幅に対する割合で保存されるので、本文の枠と幅が違うと、本文の枠では、別の場所を指すことがあります。添える画像は、いま見えているとおりです"
    >
      本文の枠と幅が違います（本文 {there}px）
    </span>
  );
}

interface AppMark extends RegionMark {
  /** 枠の見た目の箱（本文の枠ではなく、個別表示の枠）に対する比率 */
  frac: { x: number; y: number; w: number; h: number };
}

/**
 * 枠の置き場（`.appscale`）の中の層：既存の範囲コメントの枠（枠の見た目の大きさに対する割合の位置：縮小・横スクロール・幅の切り替えに、追従する）と、範囲を選ぶ層。
 * 範囲の比率は、本文の（`frameOf` が指す）基準に対するもの：本文の枠の見た目の箱に、同じ相対位置を写して、換算する
 */
function AppOverlay({ built, ctx, deps }: { built: Built; ctx: FocusCtx; deps: RegionDeps }) {
  const tool = useUi((s) => s.focusTool);
  const activeTid = useUi((s) => s.active);
  const linkedTid = useUi((s) => s.linkedTid);
  const [marks, setMarks] = useState<AppMark[]>([]);
  const [layer, setLayer] = useState<Layer | null>(null);

  // 本文の範囲 → 個別表示の枠の割合。本文を描き直したとき・窓の大きさが変わったときに、取り直す
  const { block, regions } = ctx;
  useLayoutEffect(() => {
    const compute = (): void => {
      // 層は、枠の見た目の箱（縮小表示の transform の後）に、ぴったり合わせる：枠の置き場（`.appscale`）の、左上からの位置
      const sr = built.scale.getBoundingClientRect();
      const ir = built.iframe.getBoundingClientRect();
      const box: Layer = { left: ir.left - sr.left, top: ir.top - sr.top, width: ir.width, height: ir.height };
      setLayer((cur) =>
        cur && cur.left === box.left && cur.top === box.top && cur.width === box.width && cur.height === box.height
          ? cur
          : box,
      );
      const home = block?.querySelector('iframe.appframe')?.getBoundingClientRect();
      const base = block ? frameOf(block).getBoundingClientRect() : null;
      if (!block || !home || !base) {
        setMarks([]);
        return;
      }
      const next: AppMark[] = [];
      for (const m of regions) {
        const rect = clampRegionRect(m.rect); // 古い基準の極端な値で、巨大な枠にならない
        const abs = rect ? fromRatio(rect, base) : null;
        const frac = abs ? ratioOf(abs, home) : null;
        const shown = frac ? clampRegionRect(frac) : null;
        if (shown) next.push({ ...m, frac: shown });
      }
      setMarks(next);
    };
    // 本文の枠の見出し（ツールバーは、描いたあと、遅れて載る）・大きさが変わると、基準（`frameOf`）の位置が変わる：変わるたびに、取り直す（まとめて、次のフレームで）
    let raf = 0;
    const schedule = (): void => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        compute();
      });
    };
    compute();
    window.addEventListener('resize', schedule);
    const mo = new MutationObserver(schedule);
    const ro = new ResizeObserver(schedule);
    if (block) {
      mo.observe(block, { childList: true, subtree: true });
      ro.observe(block);
    }
    // 幅の切り替え（枠の style・置き場の class）・枠の高さの変化に、層を追従させる
    mo.observe(built.iframe, { attributes: true, attributeFilter: ['style', 'height'] });
    mo.observe(built.scale, { attributes: true, attributeFilter: ['style', 'class'] });
    ro.observe(built.scale);
    ro.observe(built.iframe);
    return () => {
      window.removeEventListener('resize', schedule);
      mo.disconnect();
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [block, regions, built]);

  const getBox = useCallback((): Box | null => {
    const r = built.iframe.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? r : null;
  }, [built.iframe]);
  const onSelect = (sel: DragSelection): void => {
    if (!block) return;
    finishFocusApp({ block, iframe: built.iframe, sel: sel.box, frame: built.frame }, deps);
  };
  const selectThread = (tid: string): void => {
    const t = ctx.threads.find((x) => x.id === tid);
    if (t) useUi.getState().focusThread(t);
  };

  return (
    <div className="fv-layer" style={layer ?? { display: 'none' }}>
      {marks.length ? (
        <div className="fv-regions" aria-hidden="true">
          {marks.map((m) => {
            const cls = [
              'fv-box',
              'top',
              m.tid === 'pending' && 'pending',
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
                style={{
                  left: `${m.frac.x * 100}%`,
                  top: `${m.frac.y * 100}%`,
                  width: `${m.frac.w * 100}%`,
                  height: `${m.frac.h * 100}%`,
                }}
                onClick={m.tid === 'pending' ? undefined : () => selectThread(m.tid)}
              >
                <span className="fv-no">{m.n}</span>
              </div>
            );
          })}
        </div>
      ) : null}
      {tool === 'region' && ctx.canComment ? <DragOverlay getBox={getBox} onSelect={onSelect} /> : null}
    </div>
  );
}
