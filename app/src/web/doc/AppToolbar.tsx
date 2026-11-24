// 実行できる枠（html-app）の見出しの行の、小さなツールバー：枠の幅（スマートフォン・タブレット・デスクトップ・本文の幅いっぱい）と、枠だけのライト／ダーク。
// デザインの比較・UI のレビューのため：同じ枠を、幅と外観を変えて、見比べられる。アイコンだけ（`aria-label`・`title`。**本文の DOM に、文字を増やさない**）。
// 「要素を選ぶ」ボタン（F42）：押すと、枠が選択モードに入り、枠の中で押した要素の情報が、下書きのコメントになる（自動では、送らない）。選んでいる間は、見出しに、説明（`aria-live`）を出す。
// 本文は、命令的な島（`render/apps.ts`）なので、ここは、枠ごとに、小さな React の根を作って載せる（`mountToolbar`）。状態は、橋（`appBridge.ts`）が持つ。
import { ArrowLeftRight, Crosshair, Expand, Monitor, Moon, Smartphone, Sun, Tablet, Tv } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import type { ResolvedTheme } from '../lib/theme';
import { useUi } from '../store/ui';
import { type AppFrame, FRAME_WIDTHS, type FrameWidth, frameScale, frameScrolls } from './appBridge';

// 幅：名前・px。aria-label は「枠の幅：名前（px）」。title は、本文より広いとき、縮小率を足す（枠の中のレイアウトは、選んだ幅で計算して、本文の幅に収まるよう縮小して見せる）
const WIDTH_UI: Record<FrameWidth, { Icon: typeof Monitor; name: string; px?: number }> = {
  375: { Icon: Smartphone, name: 'スマートフォン', px: 375 },
  768: { Icon: Tablet, name: 'タブレット', px: 768 },
  1280: { Icon: Monitor, name: 'デスクトップ', px: 1280 },
  1920: { Icon: Tv, name: 'ワイドデスクトップ', px: 1920 },
  auto: { Icon: ArrowLeftRight, name: '本文の幅いっぱい' },
};

const PICK_LABEL = '枠の中の要素を選んでコメント';

/**
 * 幅のボタン（375・768・1280・1920・自動）。`width`：いま選んでいる幅（そろっていなければ null：どれも押されていない）・`avail`：本文の幅（縮小率を、タイトルに書く）。
 * 1 つの枠のツールバーと、版を並べて比べる画面（F44）の、比較用ツールバーが、同じものを使う
 */
export function WidthButtons({
  width,
  avail,
  onWidth,
}: {
  width: FrameWidth | null;
  avail: number;
  onWidth: (w: FrameWidth) => void;
}) {
  return (
    <>
      {FRAME_WIDTHS.map((w) => {
        const { Icon, name, px } = WIDTH_UI[w];
        const label = px ? `枠の幅：${name}（${px}px）` : `枠の幅：${name}`;
        const scale = frameScale(w, avail);
        const scrolls = frameScrolls(w, avail);
        const title =
          scale < 1
            ? `枠の幅：${name}（${px}px・表示は ${Math.round(scale * 100)}% に縮小${scrolls ? '。横にスクロールできます' : ''}）`
            : label;
        return (
          <button
            key={w}
            type="button"
            className="iconbtn"
            data-width={w}
            title={title}
            aria-label={label}
            aria-pressed={width === w}
            onClick={() => onWidth(w)}
          >
            <Icon aria-hidden="true" focusable="false" />
          </button>
        );
      })}
    </>
  );
}

/** 枠だけのライト／ダークのボタン。`mode`：いまの外観（そろっていなければ null：「不揃い」）。押すと、反対の外観（不揃いのときは、ダーク） */
export function ModeButton({ mode, onMode }: { mode: ResolvedTheme | null; onMode: (m: ResolvedTheme) => void }) {
  const dark = mode === 'dark';
  const now = mode === null ? '不揃い' : dark ? 'ダーク' : 'ライト';
  const label = `枠の外観：${now}。押すと、${dark ? 'ライト' : 'ダーク'}にします`;
  return (
    <button
      type="button"
      className="iconbtn"
      data-frame-mode={mode ?? 'mixed'}
      title={label}
      aria-label={label}
      onClick={() => onMode(dark ? 'light' : 'dark')}
    >
      {dark ? <Moon aria-hidden="true" focusable="false" /> : <Sun aria-hidden="true" focusable="false" />}
    </button>
  );
}

/** `onFocus`：「個別表示」ボタン（F43）。本文の枠の見出しだけに付ける（個別表示の中の枠には、付けない） */
export function AppToolbar({ frame, onFocus }: { frame: AppFrame; onFocus?: (() => void) | undefined }) {
  const state = useSyncExternalStore(frame.subscribe, frame.get);
  return (
    <>
      <WidthButtons width={state.width} avail={state.avail} onWidth={(w) => frame.setWidth(w)} />
      <ModeButton mode={state.mode} onMode={(m) => frame.setMode(m)} />
      <button
        type="button"
        className="iconbtn"
        data-pick
        title={PICK_LABEL}
        aria-label={PICK_LABEL}
        aria-pressed={state.picking}
        onClick={() => {
          if (state.picking) return frame.cancelPick();
          // 本文の「範囲を選ぶ」と「要素を選ぶ」は、同時に ON にしない（範囲の重ねが、枠を覆って、要素を押せなくなる）：あとから始めたほうが、前のほうを止める
          if (useUi.getState().regMode === 'selecting') useUi.getState().setRegMode('idle');
          frame.startPick();
        }}
      >
        <Crosshair aria-hidden="true" focusable="false" />
      </button>
      {onFocus ? (
        <button
          type="button"
          className="iconbtn"
          data-focus-open
          title="この枠を、個別表示で、大きく見ます（範囲・要素を選んで、コメントもできます）"
          aria-label="個別表示"
          aria-haspopup="dialog"
          onClick={onFocus}
        >
          <Expand aria-hidden="true" focusable="false" />
        </button>
      ) : null}
      <span className="apppick" role="status" aria-live="polite">
        {state.picking ? '枠の中で、要素を押してください（Esc で中止）' : ''}
      </span>
    </>
  );
}

/** `host`（見出しの行の中の空の要素）に、ツールバーを載せる。外す（`releaseApps`）と、根も外れる（React の描画の最中に、外さないよう、あとで） */
export function mountToolbar(host: HTMLElement, frame: AppFrame, onFocus?: () => void): void {
  const root = createRoot(host);
  root.render(<AppToolbar frame={frame} onFocus={onFocus} />);
  frame.onRelease(() => queueMicrotask(() => root.unmount()));
}
