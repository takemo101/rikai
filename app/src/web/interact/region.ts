// 本文の、好きな範囲（ビューポートの矩形）を選んだあと：基準のブロックと比率を決め、入力欄を開き、範囲の画像を作って添付する。
// 範囲は、**左上にあるブロック**（画像・図があれば、その最初の画像・図）の大きさに対する比率 `{x,y,w,h}`（左上が原点）で持つ。範囲がブロックの外へ出れば、0〜1 を超える。
// 範囲の画像：1 つの画像・図の中に収まるなら、元の解像度から切り出す（`cropMedia`）。そうでなければ、表示されている本文を複製して画像にする（`rasterRegion`）。
// 画像にできなくても、位置だけで、コメントできる（トーストで知らせる）。
import type { Rect } from '../../shared/types';
import { blockAnchor, frameOf } from '../doc/render/blocks';
import { $, $$, trunc } from '../lib/dom';
import { getView } from '../lib/view';
import { toast, useUi } from '../store/ui';
import { openComposer } from './compose';
import { isInsideFrame, overlaps, pickBase, rasterTooBig, ratioRect, type ViewportRect } from './geometry';
import { regionLabel } from './selection';

const IMG_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const IMG_MAX_MB = 5;
const IMG_MAX_N = 4;
/** 出力の、長い辺の上限 */
const OUT_MAX = 2400;

/** 利用者に見せる失敗（原因が分かるもの） */
export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserError';
  }
}

/** 範囲の画像を作る部品（テストで、差し替える） */
export interface RegionDeps {
  /** 画像（base64）を、いまのトピックの assets/ に保存する。失敗（トーストを出した）なら null */
  attach: (slug: string, data: string) => Promise<{ name: string } | null>;
  raster?: (vr: ViewportRect, article: HTMLElement) => Promise<File | null>;
  crop?: (media: Element, rect: Rect) => Promise<File | null>;
}

const textOfBlock = (blk: Element): string => {
  // <style>・<script> の中身（図の CSS など）は、名前に入れない
  const plain = blk.cloneNode(true) as Element;
  for (const x of plain.querySelectorAll('style, script')) x.remove();
  return (plain.textContent ?? '').replace(/\s+/g, ' ').trim();
};

/**
 * 範囲（ビューポートの矩形）を選び終えた。入力欄を開き、範囲の画像を、作って付ける（非同期）。
 * 本文に重なる所がない・小さすぎる・最新版でない、ときは、トーストを出して、何もしない。
 */
export function finishRegion(vr: ViewportRect, deps: RegionDeps): void {
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
  const media = frame === blk ? null : frame;
  const fr = frame.getBoundingClientRect();
  const rect = ratioRect(vr, fr);
  if (!rect) {
    toast('範囲が小さすぎます。ドラッグで、範囲を選んでください', true);
    return;
  }
  // 範囲が、1 つの画像・図の中に収まるなら、元の解像度から切り出す。そうでなければ、表示されている本文を、画像にする
  const ready = media !== null && (!(media instanceof HTMLImageElement) || media.naturalWidth > 0);
  const inside = media !== null && isInsideFrame(vr, fr, ready);
  const text = blk.classList.contains('mermaid-block') ? '図' : textOfBlock(blk);
  // 画像・図の外へ出る範囲は、画像の一部ではない
  const label =
    inside && media ? `${regionLabel(blk, media)}の一部` : `範囲：${trunc(text, 30) || blk.tagName.toLowerCase()}`;
  // 画像にする作業は、入力欄を開く前に始める（入力中のオレンジの強調が、画像に写らないように。スタイルを写す所までは、同期で終わる）
  const raster = deps.raster ?? rasterRegion;
  const crop = deps.crop ?? cropMedia;
  const job = inside && media ? crop(media, rect) : raster(vr, article);
  const comp = openComposer({ ...blockAnchor(blk), label, rect });
  if (!comp) {
    job.catch(() => {}); // 最新版でないとき、入力欄の起動が断った
    return;
  }
  // 画像にする（写真は 2 秒ほど、長い範囲はそれ以上かかる）間も、「アップロード中」にして、その間の送信を断る（画像が、送られずに消えないように）
  const ui = useUi.getState();
  ui.beginUpload();
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
    .finally(() => useUi.getState().endUpload());
}

/** 切り出した画像を、入力欄（composerId）に付ける。付ける直前に、まだ同じ入力欄・同じトピックかを確かめる */
async function attachRegionImage(file: File, composerId: number, deps: RegionDeps): Promise<void> {
  if (!IMG_TYPES.includes(file.type)) {
    toast('画像は、png・jpeg・gif・webp だけ付けられます', true);
    return;
  }
  if (file.size > IMG_MAX_MB * 1024 * 1024) {
    toast(`画像が大きすぎます（${IMG_MAX_MB}MB まで）`, true);
    return;
  }
  const slug = getView()?.slug;
  if (!slug) return;
  const imgs = () => useUi.getState().drafts.imgs.composer ?? [];
  if (imgs().length >= IMG_MAX_N) {
    toast(`画像は ${IMG_MAX_N} 枚までです`, true);
    return;
  }
  const gen = useUi.getState().imgGen.composer ?? 0;
  const r = await deps.attach(slug, await readBase64(file));
  const s = useUi.getState();
  // 終わるまでに、入力欄をやめた・送った・別のトピックへ移った、なら、この画像は、付けない（別の入力欄に、出ないように）
  if (!r || getView()?.slug !== slug || (s.imgGen.composer ?? 0) !== gen || s.composer?.id !== composerId) return;
  if (imgs().length >= IMG_MAX_N || !s.addDraftImg('composer', r.name)) return;
  s.setComposerRegionImg(composerId, r.name); // 対象を選び直したとき、この画像だけを外すため
}

function readBase64(file: Blob): Promise<string> {
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
  r.onerror = () => reject(r.error ?? new Error('画像を読めません'));
  r.readAsDataURL(file);
  return promise;
}

function loadImage(src: string, failure: string): Promise<HTMLImageElement> {
  const { promise, resolve, reject } = Promise.withResolvers<HTMLImageElement>();
  const im = new Image();
  im.onload = () => resolve(im);
  im.onerror = () => reject(new Error(failure));
  im.src = src;
  return promise;
}

function canvas2d(w: number, h: number): { cv: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, w);
  cv.height = Math.max(1, h);
  const ctx = cv.getContext('2d');
  if (!ctx) throw new Error('canvas を使えません');
  ctx.fillStyle = '#fff'; // 透明な図は、PNG にしたとき、見えなくならないよう、白地に
  ctx.fillRect(0, 0, cv.width, cv.height);
  return { cv, ctx };
}

async function canvasFile(cv: HTMLCanvasElement): Promise<File | null> {
  const toBlob = (type: string, q?: number) => new Promise<Blob | null>((resolve) => cv.toBlob(resolve, type, q));
  let blob = await toBlob('image/png');
  let name = 'region.png';
  if (blob && blob.size > IMG_MAX_MB * 1024 * 1024 * 0.98) {
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
export async function cropMedia(media: Element, rect: Rect): Promise<File | null> {
  const isImg = media instanceof HTMLImageElement;
  const b = media.getBoundingClientRect();
  const vectorScale = Math.min(2, OUT_MAX / Math.max(b.width, b.height));
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
  const k = Math.min(1, OUT_MAX / Math.max(cw, ch)); // 出力の縮小
  const { cv, ctx } = canvas2d(Math.round(cw * k), Math.round(ch * k));
  const f = fit ?? { x: 0, y: 0, w: sw, h: sh };
  ctx.drawImage(src, (f.x - sx) * k, (f.y - sy) * k, f.w * k, f.h * k); // 全体を、ずらして描く（はみ出す所は、切れる）。k が 1 なら、切り出しと同じ
  return canvasFile(cv);
}

/**
 * 本文の、任意の範囲（vr。画面の座標）を、画像にする。表示されている本文のブロックを、見た目（computed style）を写して複製し、SVG の foreignObject に入れて画像にし、canvas に描く。
 * 複製は、画像として読むだけで、スクリプトは動かない（無害化した本文を、そのまま写す）。img は、先に data: にする（同じオリジンのものだけ。canvas は汚れない）。
 * 番号・枠・強調の層は、入らない（本文だけ）。::before などの疑似要素は、写らない
 */
export async function rasterRegion(vr: ViewportRect, art: HTMLElement): Promise<File | null> {
  const W = Math.max(1, Math.round(vr.width));
  const H = Math.max(1, Math.round(vr.height));
  const k = Math.min(2, OUT_MAX / Math.max(W, H));
  const paper = getComputedStyle(art).backgroundColor;
  const root = document.createElement('div');
  root.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  root.style.cssText = `position:relative;width:${W}px;height:${H}px;overflow:hidden;background:${paper === 'rgba(0, 0, 0, 0)' ? '#fff' : paper}`;
  const imgs: [HTMLImageElement, HTMLImageElement][] = [];
  const targets = [...art.children].filter((el) => overlaps(el.getBoundingClientRect(), vr));
  let count = 0;
  for (const el of targets) count += 1 + el.querySelectorAll('*').length;
  if (rasterTooBig(count))
    throw new UserError(
      '範囲に重なるブロック（表・リストなど）が大きすぎて、画像にできません（要素の合計が 3000 を超えています）。位置だけで、コメントできます',
    );
  // 入力中の強調（オレンジ）は、画像に写さない：スタイルを写す間だけ、外す（同期のうちに戻す）
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
  } finally {
    for (const [e, cl] of pend) e.classList.add(...cl);
  }
  await Promise.all(imgs.map(([a, b]) => inlineImage(a, b))); // 画像は、あとで（スタイルを写し終えてから）data: にする
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
  const { cv, ctx } = canvas2d(Math.round(W * k), Math.round(H * k));
  ctx.drawImage(im, 0, 0, cv.width, cv.height);
  return canvasFile(cv);
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
