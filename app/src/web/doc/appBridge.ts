// 実行できる枠（html-app）の「橋」の、画面の側（F28）。枠と画面の、狭い通信路：
//   枠 → 画面：`{ __rikai: 1, type: 'resize', height }`（自動の高さ）だけ。 画面 → 枠：`{ __rikai: 1, type: 'theme', mode }`（ライト／ダーク）だけ。
// 枠は、オリジンのない文書（sandbox に allow-same-origin がない）なので、`e.origin` は `"null"` で、枠を特定できない。**検査は、送り元の窓で行う**：
// `e.source` が、**この画面が置いた枠の `contentWindow` のどれか**でなければ、捨てる（ほかの窓・別のタブ・添付画像のプレビューなどの iframe は、受けない）。
// その枠の高さだけを変える（1 つの枠が、別の枠の高さを、変えられない）。値は、厳密な形・数・上下限を確かめる。固定の高さ（`height=480`）の枠は、報告を無視する。
// メッセージの受け口は、ドキュメントで 1 つ（枠が 1 つ以上あるあいだだけ、付ける：参照カウント）。後始末は、`releaseApps`（本文を描き直す前・本文が消えるとき）。
// 枠の外観：資料が、画面の配色への対応を示した枠（`shared/htmlapp-theme.ts`：オプトイン）だけ、画面の外観に従う（`by: 'auto'`）。
// 示さない従来の枠は、常にライト（画面の外観が変わっても、触らない）。ツールバーでの切り替え（`by: 'user'`）は、どの枠でも効く（利用者の明示の操作）。
// 枠の幅：選んだ幅で、枠の中のレイアウトを計算する（iframe の実際の幅＝選んだ幅。`@media`・`vw`・`100%` が、その幅で効く）。本文の幅より広いときは、
// `transform: scale()` で、本文の幅に収めて見せる（DevTools のデバイスモードと同じ。ラッパーの高さ＝枠の高さ × 縮小率）。選んだ幅が、本文の幅以下なら、縮小しない。
// 縮小率の下限は 50%（それ以下は読めない）：下限で止まって、まだ本文の幅に収まらないときは、枠の置き場を、横にスクロールさせる。
// 枠の幅・外観の切り替えは、保存しない（再読み込みで、自動・画面の外観に戻る）。本文を描き直しても（コメントの追加など）、同じ版の中では、覚えている。
import type { ResolvedTheme } from '../lib/theme';

/** 枠の高さの上下限（px）。枠が知らせた値は、この範囲に収める */
export const MIN_HEIGHT = 120;
export const MAX_HEIGHT = 2400;
/** 1 つの枠の高さを、反映する回数の上限（1 秒あたり）。超えた分は、最後の値だけ、あとで反映する（連打で、画面が詰まらない） */
export const APPLY_LIMIT = 6;
export const APPLY_WINDOW_MS = 1000;

/** 枠の幅の切り替え：`auto` は、本文の幅いっぱい（縮小なし）。数は px（枠の中のレイアウトの幅。本文より広いときは、縮小して、本文の幅に収める） */
export type FrameWidth = 'auto' | 375 | 768 | 1280 | 1920;
export const FRAME_WIDTHS: readonly FrameWidth[] = [375, 768, 1280, 1920, 'auto'];

/** 枠の表示の状態。`forced`：枠だけ、画面の外観とは別にしている。`avail`：本文の幅（枠の置き場の幅。px。測れる前は 0） */
export interface FrameState {
  width: FrameWidth;
  mode: ResolvedTheme;
  forced: boolean;
  avail: number;
}

/** 縮小率の下限（これより小さくすると、読めない）。本文の幅に、これでも収まらないときは、横にスクロールさせる */
export const MIN_SCALE = 0.5;

/** 縮小率：選んだ幅が、本文の幅より広いときだけ、本文の幅に収める（MIN_SCALE 〜 1）。測れていない（avail 0）・自動は、1 */
export const frameScale = (width: FrameWidth, avail: number): number =>
  width !== 'auto' && avail > 0 && width > avail ? Math.max(MIN_SCALE, avail / width) : 1;

/** 縮小しても、選んだ幅が、本文の幅に収まらない（下限で止まった）：枠の置き場を、横にスクロールさせる */
export const frameScrolls = (width: FrameWidth, avail: number): boolean =>
  width !== 'auto' && avail > 0 && width * frameScale(width, avail) > avail + 0.5;

export interface AppFrame {
  readonly iframe: HTMLIFrameElement;
  /** 自動の高さか（false：固定の高さ。報告を無視する） */
  readonly auto: boolean;
  get(): FrameState;
  subscribe(cb: () => void): () => void;
  setWidth(width: FrameWidth): void;
  /** 枠だけの外観（画面の外観とは別）。再読み込みせず、`theme` を送る */
  setMode(mode: ResolvedTheme): void;
  /** 枠を外すとき（`releaseApps`）に呼ぶ後始末を足す */
  onRelease(fn: () => void): void;
}

interface Entry extends AppFrame {
  /** 画面の外観が変わったとき：枠だけの外観を解いて、画面に合わせる */
  follow(mode: ResolvedTheme): void;
  /** 枠が知らせた高さ（検査済み）を、反映の列に入れる */
  push(height: number): void;
  release(): void;
}

const frames = new Set<Entry>();

// 同じ版の中で、本文を描き直しても（コメントの追加など）、枠の幅・枠だけの外観を覚える。版・ページが変わったら、捨てる
let memoryKey = '';
const memory = new Map<number, { width: FrameWidth; mode: ResolvedTheme | null }>();

/**
 * 枠の、最初の状態。`viewKey`：`<トピック>/<ページ>/<版>`・`n`：枠の番号・`page`：いまの画面の外観・`follows`：資料が、画面の配色への対応を示しているか
 * （示さない従来の枠は、常にライト）。同じ版の中で覚えている幅・枠だけの外観があれば、それ（`src` の `?mode=` も、これで決める）
 */
export function initialFrameState(viewKey: string, n: number, page: ResolvedTheme, follows: boolean): FrameState {
  if (memoryKey !== viewKey) {
    memoryKey = viewKey;
    memory.clear();
  }
  const m = memory.get(n);
  return { width: m?.width ?? 'auto', mode: m?.mode ?? (follows ? page : 'light'), forced: m?.mode != null, avail: 0 };
}

/** 枠が知らせた高さの検査：`{ __rikai: 1, type: 'resize', height }`（余分なキーは、無視）。数（有限・正）だけ。整数に丸めて、上下限に収める。それ以外は null */
export function parseResize(data: unknown): number | null {
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;
  if (d.__rikai !== 1 || d.type !== 'resize') return null;
  const h = d.height;
  if (typeof h !== 'number' || !Number.isFinite(h) || h <= 0) return null;
  return Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.round(h)));
}

function onMessage(e: MessageEvent): void {
  if (!e.source) return; // 送り元の窓がない（detached な枠の contentWindow も null：一致させない）
  for (const f of frames) {
    if (f.iframe.contentWindow !== e.source) continue;
    const h = f.auto ? parseResize(e.data) : null;
    if (h !== null) f.push(h);
    return; // この枠のメッセージは、ここで終わり（ほかの枠は、見ない）
  }
}

/**
 * 枠（iframe）を、橋に登録する。`iframe` の親が、縮小後の大きさを持つ箱・その親が、本文の幅の箱（幅の基準。横にスクロールする箱）。`n`：枠の番号（覚えるときの印。`initialFrameState` と同じ版の中）。
 * `auto`：自動の高さ。`follows`：資料が、画面の配色への対応を示しているか（画面の外観の変化に従うか）。`initial`：`initialFrameState` の値。外すのは `releaseApps`
 */
export function registerFrame(
  iframe: HTMLIFrameElement,
  n: number,
  auto: boolean,
  follows: boolean,
  initial: FrameState,
): AppFrame {
  let state = initial;
  const subs = new Set<() => void>();
  const cleanups: Array<() => void> = [];
  let wanted = 0;
  let applied = 0;
  let raf = 0;
  let timer = 0;
  let times: number[] = [];

  const notify = (): void => {
    for (const cb of subs) cb();
  };
  const set = (next: FrameState): void => {
    state = next;
    memory.set(n, { width: next.width, mode: next.forced ? next.mode : null });
    showMode();
    notify();
  };
  // 幅：枠の中のレイアウトは、選んだ幅（iframe の実際の幅）で計算する。本文の幅より広いときは、左上を基点に縮小して、本文の幅に収める。
  // ラッパーの高さ＝枠の高さ × 縮小率（transform は、レイアウトの大きさを変えないので、ラッパーが、はみ出す分を切って、高さを持つ）
  const layout = (): void => {
    const inner = iframe.parentElement; // 縮小後の大きさを持つ箱（iframe の直接の親）
    const outer = inner?.parentElement; // 本文の幅の箱（幅の基準。縮小しきれないときは、横にスクロールする）
    if (!inner || !outer) return;
    const avail = outer.clientWidth;
    if (avail !== state.avail) {
      state = { ...state, avail };
      notify();
    }
    const scale = frameScale(state.width, avail);
    iframe.style.width = state.width === 'auto' ? '' : `${state.width}px`;
    iframe.style.transform = scale < 1 ? `scale(${scale})` : '';
    // transform は、レイアウトの大きさを変えない（スクロールできる範囲も、縮小前の幅になってしまう）ので、縮小後の大きさを持つ箱が、はみ出す分を切る
    inner.classList.toggle('appscaled', scale < 1);
    inner.style.width = scale < 1 && typeof state.width === 'number' ? `${state.width * scale}px` : '';
    inner.style.height = scale < 1 ? `${(Number(iframe.getAttribute('height')) || 0) * scale}px` : '';
    outer.classList.toggle('appscroll', frameScrolls(state.width, avail));
  };
  const showMode = (): void => {
    iframe.dataset.mode = state.mode;
  };
  const postTheme = (by: 'auto' | 'user'): void => {
    iframe.contentWindow?.postMessage({ __rikai: 1, type: 'theme', mode: state.mode, by }, '*'); // オリジンは、指定できない（null）。中身は、外観の名前だけ
  };
  // 読み込みの遅い枠（lazy）・読み込み中に外観が変わった枠のために、読み込みが終わったら、いまの外観を、もう一度送る（対応を示さない枠は、枠だけの外観のときだけ）
  const onLoad = (): void => {
    if (state.forced) postTheme('user');
    else if (follows) postTheme('auto');
  };
  iframe.addEventListener('load', onLoad);
  // 本文の幅の変化（窓・パネル・一覧の開閉）に追従する。ResizeObserver の通知の中で、観測している要素を変えないよう、rAF で（幅が変わったときだけ）
  let layoutRaf = 0;
  const ro = new ResizeObserver(() => {
    const w = iframe.parentElement?.parentElement?.clientWidth ?? 0;
    if (w === state.avail || layoutRaf) return;
    layoutRaf = requestAnimationFrame(() => {
      layoutRaf = 0;
      layout();
    });
  });
  const outerBox = iframe.parentElement?.parentElement;
  if (outerBox) ro.observe(outerBox);
  showMode();
  layout();

  // 反映：rAF でまとめる。1 秒に APPLY_LIMIT 回まで（超えたら、窓が空くまで待って、最後の値だけ反映する）
  const flush = (): void => {
    raf = 0;
    const now = Date.now();
    times = times.filter((t) => now - t < APPLY_WINDOW_MS);
    if (times.length >= APPLY_LIMIT) {
      if (!timer)
        timer = window.setTimeout(
          () => {
            timer = 0;
            flush();
          },
          APPLY_WINDOW_MS - (now - (times[0] as number)),
        );
      return;
    }
    if (wanted === applied) return;
    applied = wanted;
    times.push(now);
    iframe.setAttribute('height', String(applied));
    layout(); // 縮小しているときの、ラッパーの高さ
  };

  const entry: Entry = {
    iframe,
    auto,
    get: () => state,
    subscribe(cb) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    setWidth(width) {
      if (width === state.width) return;
      set({ ...state, width });
      layout();
    },
    setMode(mode) {
      if (mode === state.mode && state.forced) return;
      set({ ...state, mode, forced: true });
      postTheme('user');
    },
    follow(mode) {
      if (!follows) return; // 対応を示さない従来の枠は、画面の外観に従わない（常にライト）
      if (mode === state.mode && !state.forced) return;
      const changed = mode !== state.mode;
      state = { ...state, mode, forced: false };
      memory.set(n, { width: state.width, mode: null });
      showMode();
      notify();
      if (changed) postTheme('auto');
    },
    push(height) {
      wanted = height;
      if (!raf && !timer) raf = requestAnimationFrame(flush);
    },
    onRelease: (fn) => {
      cleanups.push(fn);
    },
    release() {
      if (!frames.delete(entry)) return;
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      raf = timer = 0;
      iframe.removeEventListener('load', onLoad);
      ro.disconnect();
      cancelAnimationFrame(layoutRaf);
      for (const fn of cleanups.splice(0)) fn();
      if (frames.size === 0) window.removeEventListener('message', onMessage);
    },
  };
  if (frames.size === 0) window.addEventListener('message', onMessage);
  frames.add(entry);
  return entry;
}

/** 画面の外観が変わった：対応を示した枠を、その外観にする（枠だけの外観は、解く）。対応を示さない枠は、触らない。再読み込みしない（枠の中の状態は、保たれる） */
export function followPageTheme(mode: ResolvedTheme): void {
  for (const f of frames) f.follow(mode);
}

/** `container` の中の枠を、すべて外す（本文を描き直す前・本文が消えるとき）。枠が 0 になったら、メッセージの受け口も外す */
export function releaseApps(container: ParentNode): void {
  for (const f of [...frames]) if (container.contains(f.iframe)) f.release();
}

/** 試験用：登録中の枠の数（受け口が付いているのは、1 以上のあいだだけ） */
export const registeredFrames = (): number => frames.size;
