// スライス D：拡大表示（個別表示）と範囲を選ぶ状態。ほかのスライスを知らない。
import type { StateCreator } from 'zustand';
import type { UiStore } from '../createUi';

export type RegMode = 'idle' | 'selecting';
/** 個別表示（F43）のステージの道具。`region`：画像・図・枠の上で、範囲をドラッグで選んでいる（Esc で中止）。要素を選ぶ道具（html-app）は、橋が持つ（`frameBridge.ts`） */
export type FocusTool = 'idle' | 'region';

/**
 * 個別表示の対象のブロックを、DocModel の中から探し直すための印（F43）。本文は、更新のたびに描き直されて、要素が作り直されるので、要素ではなく、内容で指す：
 * `id`・`hash` は、ブロックの `data-bid`・`data-bhash`。`src`：画像の `src` 属性（画像のブロックは、内容の文字がなく、ハッシュが、どれも同じになるので、見分ける）。
 * `base`：押された画像・図が、範囲の基準（`frameOf`：ブロックの最初の画像・図）か。範囲の比率は、基準に対するものなので、基準でないものでは、範囲を選べない
 */
export interface FocusRef {
  id: string;
  hash: string;
  src: string | null;
  base: boolean;
}

/**
 * 拡大表示（`#lightbox`）に出すもの。img：画像（コメントに添付した画像・本文・返信の画像）。svg：図（Mermaid・インラインの SVG）の複製（id を付け替え済み：focus/zoomSvg.ts）。img・svg は、ズーム・移動ができる。
 * app：html-app の枠（F43）。**新しい iframe を作る**（本文の枠は、動かさない）。`app`：枠の番号・固定の高さ（なければ自動）・配色への対応。
 * `focus`：本文（`#article`）のブロックを指す印（右のドックに、そのブロックのコメントを出し、範囲・要素のコメントを付けられる）。**添付の画像・返信の中の画像・図には、ない**（ステージだけ：見るだけ）
 */
export type LightboxTarget =
  | { kind: 'img'; src: string; alt: string; focus?: FocusRef }
  | { kind: 'svg'; node: SVGSVGElement; alt: string; size: { w: number; h: number }; focus?: FocusRef }
  | { kind: 'app'; alt: string; focus: FocusRef; app: { n: number; fixed: number | null; follows: boolean } };

/** コメントに添付した画像の、拡大表示の名前 */
export const ATTACHED_ALT = '添付の画像（大きく）';

export interface ZoomState {
  /** 範囲を選んでいるか（右下の「範囲を選ぶ」を押したあと〜ドラッグを終えるまで） */
  regMode: RegMode;
  /** 範囲の枠（入力中の対象）を、ドラッグでつかんでいる間 true（番号の層を、作り直さない） */
  regDrag: boolean;
  /** 個別表示のステージの道具（範囲をドラッグで選んでいるか）。個別表示を開く・閉じるたびに、idle に戻る */
  focusTool: FocusTool;
  /** 拡大表示で大きく見ているもの（添付の画像・本文の画像・図・html-app の枠） */
  lightbox: LightboxTarget | null;
  /** 拡大表示（ドックつき）の上に、添付の画像を開いたとき、閉じたら戻る、下の拡大表示（なければ null） */
  lightboxBack: LightboxTarget | null;
}

export interface ZoomActions {
  // ---- 範囲 ----
  setRegMode: (mode: RegMode) => void;
  setRegDrag: (dragging: boolean) => void;
  setFocusTool: (tool: FocusTool) => void;
  // ---- ライトボックス ----
  /**
   * 拡大表示を開く（画像・図・html-app の枠。添付の画像も）。ドックつきの拡大表示（`focus` あり）の上に、`focus` のない拡大表示（ドックの中の添付の画像）を開いたときは、
   * 閉じたら、下の拡大表示へ戻る（`lightboxBack`。重ねるのは 1 段だけ）
   */
  openZoom: (target: LightboxTarget) => void;
  /** 閉じる（上に重ねたものなら、下の拡大表示へ戻る） */
  closeLightbox: () => void;
}

export type ZoomSlice = ZoomState & ZoomActions;

export function initialZoom(): ZoomState {
  return { regMode: 'idle', regDrag: false, focusTool: 'idle', lightbox: null, lightboxBack: null };
}

/** 範囲を選ぶのを、やめる（次の状態だけを返す。ほかのスライスの操作が、自分の `set` に合成する） */
export const cancelRegSelect = (): Pick<ZoomState, 'regMode'> => ({ regMode: 'idle' });

export const createZoomSlice: StateCreator<UiStore, [], [], ZoomSlice> = (set) => ({
  ...initialZoom(),

  setRegMode: (regMode) => set({ regMode }),
  setRegDrag: (regDrag) => set({ regDrag }),
  setFocusTool: (focusTool) => set({ focusTool }),

  openZoom: (lightbox) =>
    set((s) => ({
      lightbox,
      lightboxBack: s.lightbox?.focus && !lightbox.focus ? s.lightbox : null,
      focusTool: 'idle',
    })),
  closeLightbox: () => set((s) => ({ lightbox: s.lightboxBack, lightboxBack: null, focusTool: 'idle' })),
});
