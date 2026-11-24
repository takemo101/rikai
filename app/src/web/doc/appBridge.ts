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
// 書き戻し（F42）：枠 → 画面は、`pick`（利用者が、要素を選んだとき）・`state`（`rikai.state(obj)`）・`pick-cancel`。**`pick` は、その枠が、選択モード（利用者が、ボタンを押した）のときだけ**受ける
// （枠のコードが、利用者の操作なしに、下書きを作れない）。値は、`shared/htmlapp-bridge.ts` の検査を通ったものだけ。枠ごとの最新の `state` は、メモリだけに持つ（保存しない）。
// 枠の画像（`snapshot-req` → `snapshot`）：範囲選択の画像（F25）に枠が入るとき、枠自身に、自分の見た目を画像にさせる。応答は、**こちらが出した id の、その枠からの、1 回だけ**を受ける
// （古い・偽・兄弟の枠の応答は、捨てる）。2 秒で、時間切れ（枠が応答しない：null → 箱に戻る）。画像は、PNG の data URL・長さ・形を確かめ、**画像として読めて、大きさが上限の中**のものだけ使う。
// 枠の幅・外観の切り替えは、保存しない（再読み込みで、自動・画面の外観に戻る）。本文を描き直しても（コメントの追加など）、同じ版の中では、覚えている。
import {
  type PickInfo,
  parseEsc,
  parsePick,
  parseSnapshot,
  parseState,
  SNAPSHOT_MAX_SIDE,
  snapshotId,
} from '../../shared/htmlapp-bridge';
import { parseResize } from '../../shared/htmlapp-resize';
import type { FrameWidth } from '../lib/frameWidth';
import { isImeKey } from '../lib/keys';
import type { ResolvedTheme } from '../lib/theme';

/** 1 つの枠の高さを、反映する回数の上限（1 秒あたり）。超えた分は、最後の値だけ、あとで反映する（連打で、画面が詰まらない） */
export const APPLY_LIMIT = 6;
export const APPLY_WINDOW_MS = 1000;

/** 枠の表示の状態。`forced`：枠だけ、画面の外観とは別にしている。`avail`：本文の幅（枠の置き場の幅。px。測れる前は 0） */
export interface FrameState {
  width: FrameWidth;
  mode: ResolvedTheme;
  forced: boolean;
  avail: number;
  /** 要素を選んでいる（選択モード）：利用者が、ボタンを押してから、1 つ選ぶ・中止する・Esc・枠が消える、まで */
  picking: boolean;
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
  /** 要素を選ぶ（選択モードに入る）／やめる。同時に選べる枠は、1 つ（ほかの枠は、中止する） */
  startPick(): void;
  cancelPick(): void;
  /** この枠が知らせた、最新の状態（検査済みの JSON）。なければ null */
  latestState(): string | null;
  /** 枠自身に、自分の見た目を、画像（PNG の data URL）にさせる。応答しない・不正・読めない・大きすぎるときは null（時間切れは 2 秒） */
  requestSnapshot(): Promise<string | null>;
}

/** 枠の画像を待つ時間（ms） */
export const SNAPSHOT_TIMEOUT_MS = 2000;
let snapshotSeq = 0;

/** PNG の data URL が、画像として読めて、大きさ（幅・高さ）が上限の中か */
function decodesWithinLimit(png: string): Promise<boolean> {
  return new Promise((resolve) => {
    const im = new Image();
    im.onload = () =>
      resolve(
        im.naturalWidth > 0 &&
          im.naturalHeight > 0 &&
          im.naturalWidth <= SNAPSHOT_MAX_SIDE &&
          im.naturalHeight <= SNAPSHOT_MAX_SIDE,
      );
    im.onerror = () => resolve(false);
    im.src = png;
  });
}

/** 枠 → 画面の、書き戻しの受け口（`registerFrame` に渡す） */
export interface FrameHandlers {
  /**
   * 幅・枠だけの外観を、同じ版の中で覚えるか（既定 true）。**版を並べて比べる画面（F44）の枠は、false**：左右の枠が、同じ番号（`n`）で、同じ覚えを使い合わない・
   * 本文の枠の覚えを、上書きしない。比較用ツールバーの選びは、`ui.compare` が持つ（`compareFrameState`）
   */
  remember?: boolean;
  /** 利用者が、枠の中の要素を選んだ（検査済み）。`stateJson`：その枠の、最新の状態 */
  onPick?: (pick: PickInfo, stateJson: string | null) => void;
  /**
   * 枠の中の Esc（検査済み。頻度の上限つき）。**個別表示の枠（F43）と、版を並べて比べる画面の枠（F44）だけが渡す**：本文の枠は、渡さない（枠の Esc は、何もしない）。
   * 枠のコードが、偽の `esc` を送れば、その画面が閉じる（閉じるだけ：データには触れない。個別表示と同じ）
   * 選択モードの Esc は、橋が `pick-cancel` で知らせる（ここへは、来ない）
   */
  onEsc?: () => void;
}

interface Entry extends AppFrame {
  /** 枠から届いたメッセージ（この枠の contentWindow から来たもの）を、種類ごとに、検査して使う */
  receive(data: unknown): void;
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
  return {
    width: m?.width ?? 'auto',
    mode: m?.mode ?? (follows ? page : 'light'),
    forced: m?.mode != null,
    avail: 0,
    picking: false,
  };
}

/** 版を並べて比べる画面（F44）の枠の、最初の状態：比較用ツールバーの選び（幅・枠だけの外観。null は、画面に従う）。覚えは使わない */
export function compareFrameState(
  width: FrameWidth,
  mode: ResolvedTheme | null,
  page: ResolvedTheme,
  follows: boolean,
): FrameState {
  return { width, mode: mode ?? (follows ? page : 'light'), forced: mode !== null, avail: 0, picking: false };
}

/** 1 つの枠の、`state` を受ける頻度の上限（1 秒あたり。橋は、1 秒に 4 回まで）。超えた分は、捨てる */
const STATE_LIMIT = 8;
/** 1 つの枠の、`esc` を受ける頻度の上限（1 秒あたり。橋は、150ms に 1 回まで送る） */
const ESC_LIMIT = 6;

function onMessage(e: MessageEvent): void {
  if (!e.source) return; // 送り元の窓がない（detached な枠の contentWindow も null：一致させない）
  for (const f of frames) {
    if (f.iframe.contentWindow !== e.source) continue;
    f.receive(e.data); // この枠のメッセージは、この枠だけが受ける（ほかの枠は、見ない）
    return;
  }
}

/** 選択モードの枠があるあいだ、親の Esc で、中止する（枠の中の Esc は、枠が自分で中止して、知らせる） */
function onPickKey(e: KeyboardEvent): void {
  if (e.key !== 'Escape' || isImeKey(e)) return; // 変換中の Esc は、変換の取り消し
  for (const f of frames) f.cancelPick();
}
const pickingFrames = (except?: AppFrame): boolean => [...frames].some((f) => f !== except && f.get().picking);

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
  handlers: FrameHandlers = {},
): AppFrame {
  let state = initial;
  let stateJson: string | null = null; // この枠の、最新の状態（メモリだけ。描き直しで消えてよい）
  let stateTimes: number[] = [];
  let escTimes: number[] = [];
  const snapshots = new Map<string, { resolve: (png: string | null) => void; timer: number }>(); // 頼んで、まだ応答のない画像（id → 待っている人）
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
  const remember = handlers.remember !== false;
  const set = (next: FrameState): void => {
    state = next;
    if (remember) memory.set(n, { width: next.width, mode: next.forced ? next.mode : null });
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
    if (state.picking) iframe.contentWindow?.postMessage({ __rikai: 1, type: 'pick-start' }, '*'); // 選んでいる途中に、読み込み直した
  };
  const setPicking = (picking: boolean): void => {
    if (state.picking === picking) return;
    const others = pickingFrames(entry); // ほかに、選んでいる枠があれば、Esc の受け口は、そのまま
    state = { ...state, picking };
    if (!others) {
      if (picking) document.addEventListener('keydown', onPickKey);
      else document.removeEventListener('keydown', onPickKey);
    }
    notify();
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
      if (remember) memory.set(n, { width: state.width, mode: null });
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
    latestState: () => stateJson,
    requestSnapshot() {
      const id = snapshotId(++snapshotSeq);
      return new Promise<string | null>((resolve) => {
        const timer = window.setTimeout(() => {
          snapshots.delete(id);
          resolve(null); // 時間切れ：枠は、応答しない
        }, SNAPSHOT_TIMEOUT_MS);
        snapshots.set(id, { resolve, timer });
        iframe.contentWindow?.postMessage({ __rikai: 1, type: 'snapshot-req', id }, '*');
      });
    },
    startPick() {
      if (state.picking) return;
      for (const f of frames) if (f !== entry) f.cancelPick(); // 選べるのは、同時に 1 つの枠
      setPicking(true);
      iframe.contentWindow?.postMessage({ __rikai: 1, type: 'pick-start' }, '*');
    },
    cancelPick() {
      if (!state.picking) return;
      setPicking(false);
      iframe.contentWindow?.postMessage({ __rikai: 1, type: 'pick-cancel' }, '*');
    },
    receive(data) {
      if (typeof data !== 'object' || data === null) return;
      const type = (data as { type?: unknown }).type;
      if (type === 'resize') {
        const h = auto ? parseResize(data) : null;
        if (h !== null) entry.push(h);
      } else if (type === 'state') {
        const now = Date.now();
        stateTimes = stateTimes.filter((t) => now - t < 1000);
        if (stateTimes.length >= STATE_LIMIT) return; // 頻度の上限
        stateTimes.push(now);
        const json = parseState(data);
        if (json !== null) stateJson = json;
      } else if (type === 'pick') {
        if (!state.picking) return; // 利用者が、ボタンを押したときだけ。枠が、勝手に送っても、下書きは作らない
        const pick = parsePick(data);
        if (!pick) return;
        setPicking(false); // 1 つ選ぶと、終わる（続けて届いても、受けない：洪水で、下書きが増えない）
        handlers.onPick?.(pick, stateJson);
      } else if (type === 'esc') {
        if (!handlers.onEsc || !parseEsc(data)) return; // 個別表示・比べる画面の枠だけ。形の検査
        const now = Date.now();
        escTimes = escTimes.filter((t) => now - t < 1000);
        if (escTimes.length >= ESC_LIMIT) return; // 頻度の上限
        escTimes.push(now);
        handlers.onEsc();
      } else if (type === 'pick-cancel') {
        setPicking(false);
      } else if (type === 'snapshot') {
        const r = parseSnapshot(data);
        const waiting = r ? snapshots.get(r.id) : undefined;
        if (!r || !waiting) return; // 頼んでいない id・古い・二重の応答は、捨てる
        snapshots.delete(r.id);
        clearTimeout(waiting.timer);
        if (r.png === null) waiting.resolve(null);
        else {
          const png = r.png;
          void decodesWithinLimit(png).then((ok) => waiting.resolve(ok ? png : null));
        }
      }
    },
    release() {
      if (!frames.delete(entry)) return;
      if (state.picking) {
        const others = pickingFrames(entry);
        state = { ...state, picking: false };
        if (!others) document.removeEventListener('keydown', onPickKey);
      }
      for (const [, w] of snapshots) {
        clearTimeout(w.timer);
        w.resolve(null); // 枠が消えた：待っている人には、箱に戻らせる
      }
      snapshots.clear();
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

/** この枠（`.htmlapp`・iframe の祖先）の、最新の状態（検査済みの JSON）。なければ null（「この枠にコメント」が、下書きの `frameMeta.state` に持つ） */
export function latestStateOf(box: ParentNode): string | null {
  for (const f of frames) if (box.contains(f.iframe)) return f.latestState();
  return null;
}

/** `container` の中の、登録した枠（文書の順）。版を並べて比べる画面（F44）の、比較用ツールバーが、左右の枠に、同じ幅・外観を適用する */
export function framesIn(container: ParentNode): AppFrame[] {
  return [...frames].filter((f) => container.contains(f.iframe));
}

/** この iframe（登録した枠）に、自分の見た目を画像にさせる。枠でない・応答しない・不正なときは null */
export function requestFrameSnapshot(iframe: HTMLIFrameElement): Promise<string | null> {
  for (const f of frames) if (f.iframe === iframe) return f.requestSnapshot();
  return Promise.resolve(null);
}

/** 選択モードの枠が、1 つでもあれば、すべて中止して true（個別表示の Esc：道具の中止が、閉じるより先。F43）。なければ false */
export function cancelAllPicks(): boolean {
  let any = false;
  for (const f of [...frames]) {
    if (!f.get().picking) continue;
    any = true;
    f.cancelPick();
  }
  return any;
}

/** `container` の中の枠を、すべて外す（本文を描き直す前・本文が消えるとき）。枠が 0 になったら、メッセージの受け口も外す */
export function releaseApps(container: ParentNode): void {
  for (const f of [...frames]) if (container.contains(f.iframe)) f.release();
}

/** 試験用：登録中の枠の数（受け口が付いているのは、1 以上のあいだだけ） */
export const registeredFrames = (): number => frames.size;
