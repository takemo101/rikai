// 枠（html-app）の登録簿：画面が置いた枠の集まり（`frames`）と、その問い合わせ・後始末。枠の登録・メッセージの受け口は、橋（`frameBridge.ts`）。
// 後始末は、`releaseApps`（本文を描き直す前・本文が消えるとき）。枠が 0 になったら、メッセージの受け口も外す（橋の `release`）。
import type { FrameWidth } from '../lib/frameWidth';
import type { ResolvedTheme } from '../lib/theme';
import type { FrameState } from './frameState';

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

export interface Entry extends AppFrame {
  /** 枠から届いたメッセージ（この枠の contentWindow から来たもの）を、種類ごとに、検査して使う */
  receive(data: unknown): void;
  /** 画面の外観が変わったとき：枠だけの外観を解いて、画面に合わせる */
  follow(mode: ResolvedTheme): void;
  /** 枠が知らせた高さ（検査済み）を、反映の列に入れる */
  push(height: number): void;
  release(): void;
}

export const frames = new Set<Entry>();

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

/** `container` の中の枠を、すべて外す（本文を描き直す前・本文が消えるとき）。枠が 0 になったら、メッセージの受け口も外す */
export function releaseApps(container: ParentNode): void {
  for (const f of [...frames]) if (container.contains(f.iframe)) f.release();
}

/** 試験用：登録中の枠の数（受け口が付いているのは、1 以上のあいだだけ） */
export const registeredFrames = (): number => frames.size;
