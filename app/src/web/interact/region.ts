// 本文の、好きな範囲（ビューポートの矩形）を選んだあと：基準のブロックと比率を決め、入力欄を開き、範囲の画像を作って添付する。
// 範囲は、**左上にあるブロック**（画像・図があれば、その最初の画像・図）の大きさに対する比率 `{x,y,w,h}`（左上が原点）で持つ。範囲がブロックの外へ出れば、0〜1 を超える。
// 範囲の画像：1 つの画像・図の中に収まるなら、元の解像度から切り出す（`cropMedia`）。そうでなければ、表示されている本文を複製して画像にする（`rasterRegion`）。
// 画像にできなくても、位置だけで、コメントできる（トーストで知らせる）。

import { IMG_MAX_BYTES, IMG_MAX_N, IMG_OUT_MAX_SIDE } from '../../shared/image';
import type { Anchor, Rect } from '../../shared/types';
import { blockAnchor, frameOf, isDiagram } from '../doc/render/blocks';
import { requestFrameSnapshot } from '../htmlapp/frameRegistry';
import { $, $$, trunc } from '../lib/dom';
import type { Box, Size } from '../lib/geom';
import { checkImage, readBase64 } from '../lib/image';
import { RANGE_TOO_SMALL } from '../lib/messages';
import { getView } from '../lib/view';
import { toast, useUi } from '../store/ui';
import { openComposer } from './compose';
import { isInsideFrame, overlaps, pickBase, rasterTooBig, ratioRect } from './geometry';
import { regionLabel } from './selection';

/** 利用者に見せる失敗（原因が分かるもの） */
export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserError';
  }
}

export interface RasterHooks {
  onFrameImages?: () => void;
}

/** 範囲の画像を作る部品（テストで、差し替える） */
export interface RegionDeps {
  /** 画像（base64）を、いまのトピックの assets/ に保存する。失敗（トーストを出した）なら null */
  attach: (slug: string, data: string) => Promise<{ name: string } | null>;
  /** `hooks.onFrameImages`：html-app の枠が、自分の見た目の画像を作って、範囲の画像に入った（F42） */
  raster?: (vr: Box, article: HTMLElement, hooks?: RasterHooks) => Promise<File | null>;
  crop?: (media: Element, rect: Rect, size?: Size) => Promise<File | null>;
}

export const textOfBlock = (blk: Element): string => {
  // <style>・<script> の中身（図の CSS など）は、名前に入れない
  const plain = blk.cloneNode(true) as Element;
  for (const x of plain.querySelectorAll('style, script')) x.remove();
  return (plain.textContent ?? '').replace(/\s+/g, ' ').trim();
};

/**
 * 範囲（ビューポートの矩形）を選び終えた。入力欄を開き、範囲の画像を、作って付ける（非同期）。
 * 本文に重なる所がない・小さすぎる・最新版でない、ときは、トーストを出して、何もしない。
 */
export function finishRegion(vr: Box, deps: RegionDeps): void {
  const article = $('#article');
  if (!article) return;
  const hits = $$('[data-bid]', article)
    .map((item) => ({ item, box: item.getBoundingClientRect() }))
    .filter((h) => overlaps(h.box, vr));
  const blk = pickBase(hits, vr);
  if (!blk) {
    toast('そこには本文がありません。本文の上で、範囲を選んでください', true);
    return;
  }
  const frame = frameOf(blk);
  // html-app の枠の置き場（基準）は、画像・図ではない：切り出さず、枠自身に撮らせる（`rasterRegion`）
  const media = frame === blk || blk.classList.contains('htmlapp') ? null : frame;
  const fr = frame.getBoundingClientRect();
  const rect = ratioRect(vr, fr);
  if (!rect) {
    toast(RANGE_TOO_SMALL, true);
    return;
  }
  // 範囲が、1 つの画像・図の中に収まるなら、元の解像度から切り出す。そうでなければ、表示されている本文を、画像にする
  const ready = media !== null && (!(media instanceof HTMLImageElement) || media.naturalWidth > 0);
  const inside = media !== null && isInsideFrame(vr, fr, ready);
  const text = isDiagram(blk) ? '図' : textOfBlock(blk);
  // 画像・図の外へ出る範囲は、画像の一部ではない
  const label =
    inside && media ? `${regionLabel(blk, media)}の一部` : `範囲：${trunc(text, 30) || blk.tagName.toLowerCase()}`;
  // 画像にする作業は、入力欄を開く前に始める（入力中の強調が、画像に写らないように。スタイルを写す所までは、同期で終わる）
  const raster = deps.raster ?? rasterRegion;
  const crop = deps.crop ?? cropMedia;
  commentOnRegion(
    { ...blockAnchor(blk), label, rect },
    (hooks) => (inside && media ? crop(media, rect) : raster(vr, article, hooks)),
    deps,
  );
}

/**
 * 範囲の対象（`anchor`：ブロック＋比率＋名前）で、入力欄を開き、範囲の画像（`makeImage`）を作って付ける（本文の範囲選択と、個別表示の範囲選択が、共に使う：F25・F43）。
 * `makeImage` は、**入力欄を開く前**に呼ぶ（入力中の強調が、画像に写らないように）。`hooks.onFrameImages`：html-app の枠が、自分の見た目の画像を作って、範囲の画像に入った（F42）
 */
export function commentOnRegion(
  anchor: Anchor,
  makeImage: (hooks: RasterHooks) => Promise<File | null>,
  deps: RegionDeps,
): void {
  let compId = -1; // 入力欄（このあと開く）。枠の画像が入ったとき、その入力欄に、印を付ける
  const job = makeImage({ onFrameImages: () => useUi.getState().noteFrameImage(compId) });
  const comp = openComposer(anchor);
  compId = comp?.id ?? -1;
  if (!comp) {
    job.catch(() => {}); // 最新版でないとき、入力欄の起動が断った
    return;
  }
  // 画像にする（写真は 2 秒ほど、長い範囲はそれ以上かかる）間も、「アップロード中」にして、その間の送信を断る（画像が、送られずに消えないように）
  const ui = useUi.getState();
  ui.beginUpload('composer');
  job
    .then(async (file) => {
      // 画像にしている間に、入力欄をやめた・別の対象へ移ったなら、付けない
      if (!file || useUi.getState().composer?.id !== comp.id) return;
      await attachRegionImage(file, comp.id, deps);
    })
    .catch((e: unknown) =>
      toast(
        e instanceof UserError
          ? e.message
          : 'この範囲の画像を作れませんでした（このブラウザでは、できないことがあります）。位置だけで、コメントできます',
        true,
      ),
    )
    .finally(() => useUi.getState().endUpload('composer'));
}

/** 切り出した画像を、入力欄（composerId）に付ける。付ける直前に、まだ同じ入力欄・同じトピックかを確かめる */
async function attachRegionImage(file: File, composerId: number, deps: RegionDeps): Promise<void> {
  const imgs = () => useUi.getState().drafts.imgs.composer ?? [];
  const bad = checkImage(file, imgs().length);
  if (bad) {
    toast(bad.message, true);
    return;
  }
  const slug = getView()?.slug;
  if (!slug) return;
  const gen = useUi.getState().imgGen.composer ?? 0;
  const r = await deps.attach(slug, await readBase64(file));
  const s = useUi.getState();
  // 終わるまでに、入力欄をやめた・送った・別のトピックへ移った、なら、この画像は、付けない（別の入力欄に、出ないように）
  if (!r || getView()?.slug !== slug || (s.imgGen.composer ?? 0) !== gen || s.composer?.id !== composerId) return;
  if (imgs().length >= IMG_MAX_N || !s.addDraftImg('composer', r.name)) return;
  s.setComposerRegionImg(composerId, r.name); // 対象を選び直したとき、この画像だけを外すため
}

export function loadImage(src: string, failure: string): Promise<HTMLImageElement> {
  const { promise, resolve, reject } = Promise.withResolvers<HTMLImageElement>();
  const im = new Image();
  im.onload = () => resolve(im);
  im.onerror = () => reject(new Error(failure));
  im.src = src;
  return promise;
}

/** 要素の、見えている背景色（親をたどって、最初の不透明でない色。なければ白）。ダークでも、画像の地を、画面の紙の色にする（暗い文字が、暗い地に沈まないように） */
export function paperOf(el: Element): string {
  for (let e: Element | null = el; e; e = e.parentElement) {
    const c = getComputedStyle(e).backgroundColor;
    if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') return c;
  }
  return '#fff';
}

export function canvas2d(
  w: number,
  h: number,
  paper = '#fff',
): { cv: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, w);
  cv.height = Math.max(1, h);
  const ctx = cv.getContext('2d');
  if (!ctx) throw new Error('canvas を使えません');
  ctx.fillStyle = paper; // 透明な図は、PNG にしたとき、見えなくならないよう、地を付ける（画像は白地・図は、画面の紙の色）
  ctx.fillRect(0, 0, cv.width, cv.height);
  return { cv, ctx };
}

export async function canvasFile(cv: HTMLCanvasElement): Promise<File | null> {
  const toBlob = (type: string, q?: number) => new Promise<Blob | null>((resolve) => cv.toBlob(resolve, type, q));
  let blob = await toBlob('image/png');
  let name = 'region.png';
  if (blob && blob.size > IMG_MAX_BYTES * 0.98) {
    blob = await toBlob('image/jpeg', 0.88);
    name = 'region.jpg';
  }
  return blob ? new File([blob], name, { type: blob.type }) : null;
}

/**
 * 範囲を、画像にする。画像は、元の解像度から。図（svg）と、ベクターの画像（SVG の img）は、表示の大きさの最大 2 倍で描く。
 * 出力は、長い辺が 2400px まで（写真の元の解像度は、5MB を超えるため）。PNG が大きすぎるときは、JPEG にする。
 * 画像は同じオリジン（/asset/・data:）なので、canvas が汚れない。svg は、外部のものを読まない（data: の画像にする）
 */
export async function cropMedia(media: Element, rect: Rect, size?: Size): Promise<File | null> {
  const isImg = media instanceof HTMLImageElement;
  // 図・ベクターの画像の、画像にする大きさの基準：表示の大きさ（本文）。個別表示（F43）では、ズームで変わらないよう、自然な大きさ（`size`）を渡す
  const b = size ? { width: size.w, height: size.h } : media.getBoundingClientRect();
  const vectorScale = Math.min(2, IMG_OUT_MAX_SIDE / Math.max(b.width, b.height));
  const vector = isImg && /^data:image\/svg|\.svg(?:[?#]|$)/i.test(media.currentSrc || media.src);
  let src: CanvasImageSource;
  let sw: number;
  let sh: number; // 描く元と、それを画像にしたときの大きさ（切り出しの座標は、この大きさで測る）
  let fit: { w: number; h: number; x: number; y: number } | null = null; // ベクターの img は、箱の中に、縦横比を保って収まる（表示と同じに、中央にそろえる）
  if (isImg && !vector) {
    src = media;
    sw = media.naturalWidth;
    sh = media.naturalHeight;
  } else if (isImg) {
    src = media;
    sw = Math.round(b.width * vectorScale);
    sh = Math.round(b.height * vectorScale);
    const nw = media.naturalWidth;
    const nh = media.naturalHeight;
    if (nw && nh) {
      const s = Math.min(sw / nw, sh / nh);
      fit = { w: nw * s, h: nh * s, x: (sw - nw * s) / 2, y: (sh - nh * s) / 2 };
    }
  } else {
    sw = Math.round(b.width * vectorScale);
    sh = Math.round(b.height * vectorScale);
    const clone = media.cloneNode(true) as Element;
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    if (!clone.getAttribute('viewBox')) clone.setAttribute('viewBox', `0 0 ${b.width} ${b.height}`);
    clone.setAttribute('width', String(sw));
    clone.setAttribute('height', String(sh));
    src = await loadImage(
      `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(clone))}`,
      'svg を読めません',
    );
  }
  const sx = Math.round(rect.x * sw);
  const sy = Math.round(rect.y * sh);
  const cw = Math.max(1, Math.min(sw - sx, Math.round(rect.w * sw)));
  const ch = Math.max(1, Math.min(sh - sy, Math.round(rect.h * sh)));
  const k = Math.min(1, IMG_OUT_MAX_SIDE / Math.max(cw, ch)); // 出力の縮小
  const { cv, ctx } = canvas2d(Math.round(cw * k), Math.round(ch * k), isImg ? '#fff' : paperOf(media));
  const f = fit ?? { x: 0, y: 0, w: sw, h: sh };
  ctx.drawImage(src, (f.x - sx) * k, (f.y - sy) * k, f.w * k, f.h * k); // 全体を、ずらして描く（はみ出す所は、切れる）。k が 1 なら、切り出しと同じ
  return canvasFile(cv);
}

/**
 * 本文の、任意の範囲（vr。画面の座標）を、画像にする。表示されている本文のブロックを、見た目（computed style）を写して複製し、SVG の foreignObject に入れて画像にし、canvas に描く。
 * 複製は、画像として読むだけで、スクリプトは動かない（無害化した本文を、そのまま写す）。img は、先に data: にする（同じオリジンのものだけ。canvas は汚れない）。
 * 番号・枠・強調の層は、入らない（本文だけ）。::before などの疑似要素は、写らない
 * **html-app の枠（iframe）は、別オリジンの隔離した文書で、複製の中では読み込まれず、空になる**（地の色だけが写って、真っ黒・真っ白になる）。複製からは外し、
 * 画面で見えているとおりの位置・大きさに、「実行できる枠（画像にできません）」の箱を重ねる（`framePlaceholder`）
 */
export async function rasterRegion(vr: Box, art: HTMLElement, hooks: RasterHooks = {}): Promise<File | null> {
  const W = Math.max(1, Math.round(vr.width));
  const H = Math.max(1, Math.round(vr.height));
  const k = Math.min(2, IMG_OUT_MAX_SIDE / Math.max(W, H));
  const paper = paperOf(art);
  const root = document.createElement('div');
  root.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  root.style.cssText = `position:relative;width:${W}px;height:${H}px;overflow:hidden;background:${paper}`;
  const imgs: [HTMLImageElement, HTMLImageElement][] = [];
  const boxes: FramePlaceholder[] = []; // html-app の枠の代わりの箱（複製のあと、重ねる。枠自身が作った画像が届けば、その画像に入れ替える）
  const targets = [...art.children].filter((el) => overlaps(el.getBoundingClientRect(), vr));
  let count = 0;
  for (const el of targets) count += 1 + el.querySelectorAll('*').length;
  if (rasterTooBig(count))
    throw new UserError(
      '範囲に重なるブロック（表・リストなど）が大きすぎて、画像にできません（要素の合計が 3000 を超えています）。位置だけで、コメントできます',
    );
  // 入力中の強調（アクセントの破線）は、画像に写さない：スタイルを写す間だけ、外す（同期のうちに戻す）
  const pend = [...art.querySelectorAll('.pending, .blk-pending')].map(
    (e) => [e, ['pending', 'blk-pending'].filter((c) => e.classList.contains(c))] as const,
  );
  for (const [e, cl] of pend) e.classList.remove(...cl);
  const pendingMarks = new Set(pend.map(([e]) => e).filter((e) => e.tagName === 'MARK')); // 入力中の文の強調は、背景も、写さない
  try {
    for (const el of targets) {
      const r = el.getBoundingClientRect();
      const c = el.cloneNode(true) as Element;
      const src = [el, ...el.querySelectorAll('*')];
      const dst = [c, ...c.querySelectorAll('*')];
      for (let i = 0; i < src.length; i++) {
        const s = src[i];
        const d = dst[i];
        if (!s || !d) continue;
        const cs = getComputedStyle(s);
        let css = '';
        for (const p of cs) css += `${p}:${cs.getPropertyValue(p)};`;
        // 選んでいるコメントの枠線（outline）・入力中の文の強調は、画像に入れない
        d.setAttribute('style', `${css}outline:none;${pendingMarks.has(s) ? 'background:none;' : ''}`);
        if (s instanceof HTMLImageElement && d instanceof HTMLImageElement) imgs.push([s, d]);
        if (s instanceof HTMLIFrameElement) {
          const ph = framePlaceholder(s, art, vr, paper);
          if (ph) boxes.push(ph);
          d.remove(); // 複製の中の iframe は、空（読み込まれない）。祖先の transform・overflow の複製に、位置を左右されないよう、箱は、root に直接置く
        }
      }
      // 位置は、!important で決める（写した computed style の、論理プロパティ〔inset-inline-start など〕に、負けないように）
      const place: Record<string, string> = {
        position: 'absolute',
        margin: '0',
        'box-sizing': 'border-box',
        left: `${r.left - vr.left}px`,
        top: `${r.top - vr.top}px`,
        width: `${r.width}px`,
        height: `${r.height}px`,
      };
      if (c instanceof HTMLElement)
        for (const [name, value] of Object.entries(place)) c.style.setProperty(name, value, 'important');
      root.append(c);
    }
    root.append(...boxes.map((b) => b.box));
  } finally {
    for (const [e, cl] of pend) e.classList.add(...cl);
  }
  // 枠自身に、自分の見た目を画像にさせる（スタイルを写し終えたあと・並行して）。届いた画像は、箱の代わりに使う。応答しない・不正なときは、箱のまま
  const snaps = boxes.map((b) => requestFrameSnapshot(b.iframe));
  await Promise.all(imgs.map(([a, b]) => inlineImage(a, b))); // 画像は、あとで（スタイルを写し終えてから）data: にする
  const pngs = await Promise.all(snaps);
  let framed = 0;
  for (const [i, ph] of boxes.entries()) {
    const png = pngs[i];
    if (png) {
      ph.box.replaceWith(frameImageBox(ph, png));
      framed++;
    }
  }
  if (framed) hooks.onFrameImages?.();
  // XML として不正な文字（制御文字・対になっていないサロゲート）は、除く（画像として読めなくなるため）
  const xml = new XMLSerializer().serializeToString(root).replace(
    // biome-ignore lint/suspicious/noControlCharactersInRegex: 制御文字を除くのが目的
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
    '',
  );
  if (xml.length > 40e6)
    throw new UserError('範囲が大きすぎて、画像にできません。小さい範囲を選んでください。位置だけで、コメントできます');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(W * k)}" height="${Math.round(H * k)}" viewBox="0 0 ${W} ${H}"><foreignObject x="0" y="0" width="${W}" height="${H}">${xml}</foreignObject></svg>`;
  const im = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, '範囲を画像にできません');
  const { cv, ctx } = canvas2d(Math.round(W * k), Math.round(H * k), paper);
  ctx.drawImage(im, 0, 0, cv.width, cv.height);
  return canvasFile(cv);
}

/** 画像にできない枠（html-app の iframe）の箱の文字 */
export const FRAME_PLACEHOLDER_TEXT = '実行できる枠（画像にできません）';

/** 「rgb(r, g, b)」「rgba(…)」の明るさ（0〜1）。読めなければ、明るい（1）とみなす */
export function lightnessOf(color: string): number {
  const m = /rgba?\(\s*(\d+(?:\.\d+)?)[,\s]+(\d+(?:\.\d+)?)[,\s]+(\d+(?:\.\d+)?)/.exec(color);
  if (!m) return 1;
  return (0.2126 * Number(m[1]) + 0.7152 * Number(m[2]) + 0.0722 * Number(m[3])) / 255;
}

/** html-app の枠の代わりの箱と、その位置（範囲の左上が原点）：`view`＝見えている分（祖先の切れを引いた）・`full`＝枠の見た目の全体（縮小後） */
export interface FramePlaceholder {
  box: HTMLElement;
  iframe: HTMLIFrameElement;
  view: { x: number; y: number; w: number; h: number };
  full: { x: number; y: number; w: number; h: number };
  /** 枠の地の色（枠の中の文書が、地を描かない所に、見える色：従来の資料は、白・ダークは黒） */
  paper: string;
}

/**
 * html-app の枠の代わりの箱：画面で見えている位置・大きさ（`getBoundingClientRect`。縮小表示の transform・横スクロールの切れ目も、その値に入っている）に、
 * 点線の枠・地と区別できる背景・中央の文字。文字・枠の色は、画像の地（paper）の明るさで決める（ライト・ダークの両方で、読める）。
 * 祖先に overflow の切れ（`.appscale`・横スクロールする `.appview`）があれば、見えている分だけ。範囲（vr）の外は、root の overflow:hidden が切る。見える所がなければ null
 */
export function framePlaceholder(
  iframe: HTMLIFrameElement,
  art: HTMLElement,
  vr: Box,
  paper: string,
): FramePlaceholder | null {
  const r = iframe.getBoundingClientRect();
  let [left, top, right, bottom] = [r.left, r.top, r.right, r.bottom];
  for (let e = iframe.parentElement; e && e !== art; e = e.parentElement) {
    const cs = getComputedStyle(e);
    if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
    const b = e.getBoundingClientRect();
    left = Math.max(left, b.left);
    top = Math.max(top, b.top);
    right = Math.min(right, b.right);
    bottom = Math.min(bottom, b.bottom);
  }
  if (right - left < 1 || bottom - top < 1) return null;
  const light = lightnessOf(paper) > 0.5;
  const ink = light ? '#3f3f46' : '#e4e4e7';
  const box = document.createElement('div');
  box.textContent = FRAME_PLACEHOLDER_TEXT;
  box.setAttribute('data-frame-placeholder', '');
  box.setAttribute(
    'style',
    [
      'position:absolute',
      'box-sizing:border-box',
      `left:${left - vr.left}px`,
      `top:${top - vr.top}px`,
      `width:${right - left}px`,
      `height:${bottom - top}px`,
      `border:2px dashed ${light ? '#71717a' : '#a1a1aa'}`,
      'border-radius:6px',
      `background:${light ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.12)'}`,
      `color:${ink}`,
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'text-align:center',
      'padding:4px',
      'overflow:hidden',
      'font:600 14px/1.4 -apple-system,BlinkMacSystemFont,"Hiragino Sans","Noto Sans JP","Segoe UI",sans-serif',
    ].join(';'),
  );
  return {
    box,
    iframe,
    view: { x: left - vr.left, y: top - vr.top, w: right - left, h: bottom - top },
    full: { x: r.left - vr.left, y: r.top - vr.top, w: r.width, h: r.height },
    paper: getComputedStyle(iframe).backgroundColor,
  };
}

/**
 * 枠自身が作った画像（検査・読み込み済みの PNG の data URL）の箱：見えている分（view）で切り、枠の見た目の全体（full）の大きさに、画像を置く
 * （縮小表示・横スクロールで一部が隠れていても、位置が合う）。画像が透明な所は、枠の地の色
 */
function frameImageBox(ph: FramePlaceholder, png: string): HTMLElement {
  const wrap = document.createElement('div');
  wrap.setAttribute('data-frame-image', '');
  wrap.setAttribute(
    'style',
    `position:absolute;overflow:hidden;box-sizing:border-box;left:${ph.view.x}px;top:${ph.view.y}px;width:${ph.view.w}px;height:${ph.view.h}px;background:${ph.paper}`,
  );
  const img = document.createElement('img');
  img.setAttribute('src', png); // data URL（検査済み）。属性としてだけ入れる
  img.setAttribute(
    'style',
    `position:absolute;display:block;max-width:none;left:${ph.full.x - ph.view.x}px;top:${ph.full.y - ph.view.y}px;width:${ph.full.w}px;height:${ph.full.h}px`,
  );
  wrap.append(img);
  return wrap;
}

/** 複製の img に、元の画像を、data: として入れる（SVG の中の画像は、外のファイルを読めないため）。表示の大きさの 2 倍まで */
function inlineImage(img: HTMLImageElement, copy: HTMLImageElement): void {
  copy.removeAttribute('srcset');
  try {
    const rc = img.getBoundingClientRect();
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    const cw = Math.max(1, Math.round(nw ? Math.min(nw, rc.width * 2) : rc.width * 2));
    const ch = Math.max(1, Math.round(nw ? (cw * nh) / nw : rc.height * 2));
    const cv = document.createElement('canvas');
    cv.width = cw;
    cv.height = ch;
    cv.getContext('2d')?.drawImage(img, 0, 0, cw, ch);
    copy.setAttribute('src', cv.toDataURL('image/png'));
  } catch {
    copy.removeAttribute('src'); // 壊れた画像（読み込めない）は、画像なしで写す（範囲全体の画像を、失敗させない）
  }
}
