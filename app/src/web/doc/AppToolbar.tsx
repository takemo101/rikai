// 実行できる枠（html-app）の見出しの行の、小さなツールバー：枠の幅（375・768・1280・1920・自動）と、枠だけのライト／ダーク。
// デザインの比較・UI のレビューのため：同じ枠を、幅と外観を変えて、見比べられる。**文字のボタン**（幅は数字・外観は現在の状態の文字・要素を選ぶ／拡大表示はアイコン＋短い文字）：アイコンだけだと、押す前に意味が分からないため。
// 1 回押せば変わる（メニューを開かない）。`aria-label`・`aria-pressed`・`data-*` は、アイコンのころと同じ（見える文字を、名前に含める）。
// 「要素を選ぶ」ボタン（F42）：押すと、枠が選択モードに入り、枠の中で押した要素の情報が、下書きのコメントになる（自動では、送らない）。選んでいる間は、見出しに、説明（`aria-live`）を出す。
// 本文は、命令的な島（`render/apps.ts`）なので、ここは、枠ごとに、小さな React の根を作って載せる（`mountToolbar`）。状態は、橋（`frameBridge.ts`）が持つ。
import { Crosshair, Expand, Moon, Sun } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { FRAME_WIDTHS, type FrameWidth } from '../lib/frameWidth';
import type { ResolvedTheme } from '../lib/theme';
import { useUi } from '../store/ui';
import type { AppFrame } from './frameRegistry';
import { frameScale, frameScrolls } from './frameState';

// 幅：名前・px。aria-label は「枠の幅：名前（px）」。title は、本文より広いとき、縮小率を足す（枠の中のレイアウトは、選んだ幅で計算して、本文の幅に収まるよう縮小して見せる）
const WIDTH_UI: Record<FrameWidth, { text: string; name: string; px?: number }> = {
  375: { text: '375', name: 'スマートフォン', px: 375 },
  768: { text: '768', name: 'タブレット', px: 768 },
  1280: { text: '1280', name: 'デスクトップ', px: 1280 },
  1920: { text: '1920', name: 'ワイドデスクトップ', px: 1920 },
  auto: { text: '自動', name: '自動（本文の幅いっぱい）' },
};

/** 「要素を選ぶ」の名前（見える文字「要素を選ぶ」を含む）と、説明 */
const PICK_LABEL = '要素を選ぶ（枠の中の要素を選んでコメント）';

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
        const { text, name, px } = WIDTH_UI[w];
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
            className="tbtn"
            data-width={w}
            title={title}
            aria-label={label}
            aria-pressed={width === w}
            onClick={() => onWidth(w)}
          >
            {text}
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
      className="tbtn"
      data-frame-mode={mode ?? 'mixed'}
      title={label}
      aria-label={label}
      onClick={() => onMode(dark ? 'light' : 'dark')}
    >
      {dark ? <Moon aria-hidden="true" focusable="false" /> : <Sun aria-hidden="true" focusable="false" />}
      {now}
    </button>
  );
}

/** `onFocus`：「拡大表示」ボタン（F43）。本文の枠の見出しだけに付ける（拡大表示の中の枠には、付けない） */
export function AppToolbar({ frame, onFocus }: { frame: AppFrame; onFocus?: (() => void) | undefined }) {
  const state = useSyncExternalStore(frame.subscribe, frame.get);
  return (
    <>
      {/* biome-ignore lint/a11y/useSemanticElements: ツールバーの中の、ボタンの組（fieldset は、枠線・余白の、既定の見た目を持つ） */}
      <span className="grp" role="group" aria-label="枠の幅（px）">
        <span className="grp-l" aria-hidden="true">
          幅
        </span>
        <WidthButtons width={state.width} avail={state.avail} onWidth={(w) => frame.setWidth(w)} />
      </span>
      {/* biome-ignore lint/a11y/useSemanticElements: 同上 */}
      <span className="grp" role="group" aria-label="枠の外観">
        <span className="grp-l" aria-hidden="true">
          外観
        </span>
        <ModeButton mode={state.mode} onMode={(m) => frame.setMode(m)} />
      </span>
      <button
        type="button"
        className="tbtn"
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
        要素を選ぶ
      </button>
      {onFocus ? (
        <button
          type="button"
          className="tbtn"
          data-focus-open
          title="この枠を、拡大表示で、大きく見ます（範囲・要素を選んで、コメントもできます）"
          aria-label="拡大表示"
          aria-haspopup="dialog"
          onClick={onFocus}
        >
          <Expand aria-hidden="true" focusable="false" />
          拡大表示
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
