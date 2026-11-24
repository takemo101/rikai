// 個別表示（F43）で、範囲を選び終えた：入力欄（右のドック。本文のパネルと同じ下書き）を開き、範囲の画像を作って付ける。
// 錨は、F25 と同じ形（ブロックに対する相対の `region`・ラベル）。ステージの座標（ズーム・移動・窓の大きさ）は、ここへ来る前に、比率になっている（`focusGeom.ts`）。
//   - 画像・図：比率は、**画像・図そのもの**に対するもの（`frameOf`＝ブロックの最初の画像・図が基準のときだけ選べる）。画像は、**元の解像度から**切り出す（`cropMedia`）。
//     図（SVG）は、自然な大きさの最大 2 倍（ズームで、画像の大きさが変わらない）。
//   - html-app の枠：枠の画像（`snapshot-req`。F42）を、選んだ範囲で切る。撮れなければ（時間切れ・不合格・枠が消えた）、0.22.1 の「枠の箱」。
//     比率は、本文の枠（ブロック）の側の幾何に写して決める（本文で、同じ相対位置を、ドラッグしたのと同じ：範囲の枠が、本文でも、同じ場所に重なる）。
import { IMG_OUT_MAX_SIDE } from '../../shared/image';
import type { Rect } from '../../shared/types';
import type { AppFrame } from '../doc/appBridge';
import { type BlockEl, blockAnchor, frameOf, mediaOf } from '../doc/render/blocks';
import { trunc } from '../lib/dom';
import { type Box, fromRatio, ratioOf, type Size } from '../lib/geom';
import { RANGE_UNMEASURABLE } from '../lib/messages';
import { toast } from '../store/ui';
import { ratioRect } from './geometry';
import {
  canvas2d,
  canvasFile,
  commentOnRegion,
  cropMedia,
  FRAME_PLACEHOLDER_TEXT,
  lightnessOf,
  loadImage,
  type RegionDeps,
  textOfBlock,
} from './region';
import { regionLabel } from './selection';

/**
 * 画像・図の上で、範囲を選んだ。`media`：ステージの画像・図（複製）・`rect`：その大きさに対する比率・`size`：図の自然な大きさ（画像は、元の解像度を、そのまま使う）。
 * 基準は、本文のブロックの最初の画像・図（`mediaOf`。呼ぶ側が、`base` を確かめる）
 */
export function finishFocusMedia(
  args: { block: BlockEl; media: Element; rect: Rect; size: Size | null },
  deps: RegionDeps,
): void {
  const { block, media, rect, size } = args;
  const origin = mediaOf(block);
  if (!origin) return;
  const crop = deps.crop ?? cropMedia;
  commentOnRegion(
    { ...blockAnchor(block), label: `${regionLabel(block, origin)}の一部`, rect },
    () => crop(media, rect, size ?? undefined),
    deps,
  );
}

/** 枠の箱（画像にできないとき）を、canvas に描く：点線の枠・地と区別できる背景・中央の文字（region.ts の `framePlaceholder` と同じ見た目） */
function drawPlaceholder(ctx: CanvasRenderingContext2D, w: number, h: number, k: number, paper: string): void {
  const light = lightnessOf(paper) > 0.5;
  ctx.fillStyle = light ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.12)';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = light ? '#71717a' : '#a1a1aa';
  ctx.lineWidth = 2 * k;
  ctx.setLineDash([6 * k, 4 * k]);
  ctx.strokeRect(k, k, w - 2 * k, h - 2 * k);
  ctx.fillStyle = light ? '#3f3f46' : '#e4e4e7';
  ctx.font = `600 ${14 * k}px -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Noto Sans JP", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(FRAME_PLACEHOLDER_TEXT, w / 2, h / 2, Math.max(1, w - 8 * k));
}

/**
 * 範囲（`sel`。画面の座標）の画像：枠の画像（`png`。検査・読み込み済みの PNG の data URL）を、枠の見た目の位置（`frame`。縮小表示の transform も含む）に敷いて、範囲で切る。
 * 枠の画像が撮れなかった（null）ときは、「枠の箱」。地は、枠の地の色（枠の画像が、透明な所）
 */
export async function frameShotFile(png: string | null, frame: Box, sel: Box, paper: string): Promise<File | null> {
  const W = Math.max(1, Math.round(sel.width));
  const H = Math.max(1, Math.round(sel.height));
  const k = Math.min(2, IMG_OUT_MAX_SIDE / Math.max(W, H));
  const { cv, ctx } = canvas2d(Math.round(W * k), Math.round(H * k), paper);
  if (png) {
    const im = await loadImage(png, '枠の画像を読めません');
    ctx.drawImage(im, (frame.left - sel.left) * k, (frame.top - sel.top) * k, frame.width * k, frame.height * k);
  } else drawPlaceholder(ctx, cv.width, cv.height, k, paper);
  return canvasFile(cv);
}

/**
 * html-app の枠の上で、範囲を選んだ。`iframe`：個別表示の枠・`sel`：選んだ範囲（画面の座標。枠の中に収めてある）・`frame`：個別表示の枠の橋の窓口。
 * 比率は、本文の枠（ブロック内の `iframe.appframe`）の見た目の箱に、同じ相対位置を写し、本文の範囲選択と同じ基準（`frameOf`）に対する比率にする
 */
export function finishFocusApp(
  args: { block: BlockEl; iframe: HTMLIFrameElement; sel: Box; frame: Pick<AppFrame, 'requestSnapshot'> },
  deps: RegionDeps,
): void {
  const { block, iframe, sel, frame } = args;
  const fr = iframe.getBoundingClientRect();
  const frac = ratioOf(sel, fr);
  const home = block.querySelector('iframe.appframe')?.getBoundingClientRect();
  const virtual = frac && home ? fromRatio(frac, home) : null;
  const base = frameOf(block).getBoundingClientRect();
  const rect = virtual ? ratioRect(virtual, base) : null;
  if (!rect) {
    toast(RANGE_UNMEASURABLE, true);
    return;
  }
  const paper = getComputedStyle(iframe).backgroundColor;
  commentOnRegion(
    // 範囲は、枠の置き場に対する割合：枠の幅（レイアウト）が違うと、本文の枠では、別の要素を指す。選んだときの、個別表示の枠の幅を、ラベルに書く（画像は、選んだ見た目のまま）
    {
      ...blockAnchor(block),
      label: `範囲：${trunc(textOfBlock(block), 30) || block.tagName.toLowerCase()}（枠の幅 ${Math.round(iframe.offsetWidth)}px で選択）`,
      rect,
    },
    async (hooks) => {
      const png = await frame.requestSnapshot();
      const file = await frameShotFile(png, fr, sel, paper);
      if (png) hooks.onFrameImages?.();
      return file;
    },
    deps,
  );
}
