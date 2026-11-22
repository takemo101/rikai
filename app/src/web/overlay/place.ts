// 番号の層（`#badges`）に、番号の丸と範囲の枠を置く（旧 app.js の `placeBadges`）。測定（`getBoundingClientRect`）を含むので、jsdom では試せない（位置の計算は `layout.ts`）。
// 番号の印は、文・ブロック・範囲の、すべて、同じ見た目（丸）・同じ位置（記事の左の余白。対象の上端）に、要素の外の層に出す（`#docscroll` の中の絶対位置）。
// 要素の中に出すと、箱の overflow で切れる・横スクロールで流れる・行末の文字に重なる。大きさが変わる（図の描画・窓・幅の変更）と、合わせ直す。
// 範囲のコメントの印は、範囲の上端の高さ（画像・図の中の位置）に出す。
import type { Rect } from '../../shared/types';
import { frameOf } from '../doc/render/blocks';
import { h } from '../lib/dom';
import type { BlockEl, DocModel } from '../store/doc';
import {
  type BadgeItem,
  type Box,
  badgeLeft,
  badgeTopIn,
  groupBadges,
  regionBox,
  regionTopOf,
  stackGroups,
} from './layout';
import { HANDLES } from './regionAdjust';

export interface PlaceInput {
  layer: HTMLElement;
  /** `#docscroll` */
  scroller: HTMLElement;
  article: HTMLElement;
  model: DocModel;
  /** 解決済みのスレッド ID */
  resolved: ReadonlySet<string>;
  /** 入力欄を開いているときだけ。`rect`：入力中の対象が、範囲のとき、その比率 */
  composer: { rect: Rect | null } | null;
  /** いま光らせているスレッド（描き直しても、光ったままにする） */
  linkedTid: string | null;
}

interface Region {
  tid: string;
  el: BlockEl;
  rect: Rect;
  resolved?: boolean;
  pending?: boolean;
  m?: Box;
}

const boxOf = (r: DOMRect): Box => ({ left: r.left, top: r.top, width: r.width, height: r.height });

// 層に、いま出している内容の署名（`linked` を除く）。置き直した結果が同じなら、いまの要素を、そのまま残す
const shown = new WeakMap<HTMLElement, string>();

/** 層の中身を、外から書き換えた（枠のドラッグ）：次の配置では、同じ内容でも、作り直す */
export function forgetShown(layer: HTMLElement): void {
  shown.delete(layer);
}

/**
 * 層に、番号の丸と範囲の枠を置く。
 * 内容が、いま出しているものと、同じなら、**DOM を取り替えない**（要素が、一瞬も、取り外されない：つかんでいる・測っている最中の要素が、消えない）。違うときは、新しいものを足してから、古いものを外す（空白の瞬間を作らない）
 */
export function placeBadges(input: PlaceInput): void {
  const { layer } = input;
  const old = [...layer.children];
  const made = build(input);
  const sig = made.map((e) => e.outerHTML).join('');
  if (old.length === made.length && shown.get(layer) === sig) {
    for (const e of made) e.remove();
  } else {
    for (const e of old) e.remove();
    shown.set(layer, sig);
  }
  markLinked(layer, input.linkedTid);
}

/** 層の末尾に、新しい丸・枠を足す（古いものは、そのまま。丸の組の高さの実測が要るので、層の中で作る）。足したものを返す */
function build(input: PlaceInput): HTMLElement[] {
  const { layer, scroller: ds, article, model, resolved } = input;
  const made: HTMLElement[] = [];
  const dr = ds.getBoundingClientRect();
  const ar = article.getBoundingClientRect();
  const left = badgeLeft(ar, dr, ds.scrollLeft);

  // 画像・図の中の範囲（その要素の大きさに対する比率で、位置を決める）。本文の順。入力中のものは、破線
  const ordered = [...model.nums.entries()].sort((a, b) => a[1] - b[1]);
  const regions: Region[] = [];
  for (const [tid] of ordered) {
    const loc = model.locs.get(tid);
    if (loc?.kind === 'region') regions.push({ tid, el: loc.el, rect: loc.rect, resolved: resolved.has(tid) });
  }
  const pendingEl = input.composer ? model.pending : null; // 入力欄を開いている間だけ
  const pendingRect = input.composer?.rect ?? null;
  if (pendingRect && pendingEl) regions.push({ tid: 'pending', el: pendingEl, rect: pendingRect, pending: true });
  const regionTop = new Map<string, number>();
  for (const g of regions) {
    // 本文から外れた要素（描き直しの前の、古いもの）には、枠を出さない
    const m = g.el.isConnected ? frameOf(g.el).getBoundingClientRect() : null; // 保存した比率の基準（範囲を作るときと同じ）
    if (!m?.width || !m.height) continue;
    g.m = boxOf(m);
    regionTop.set(g.tid, regionTopOf(g.m, g.rect));
  }

  const items: BadgeItem[] = [];
  for (const [tid, n] of ordered) {
    const loc = model.locs.get(tid);
    if (!loc) continue;
    const isResolved = resolved.has(tid);
    if (loc.kind === 'text') {
      const first = loc.marks[0];
      const rc = first?.isConnected ? first.getClientRects()[0] : null; // 文：最初の強調の、最初の行の高さ
      if (rc) items.push({ top: rc.top, tid, n, resolved: isResolved });
    } else if (loc.kind === 'block' || loc.kind === 'region') {
      if (!loc.el.isConnected) continue;
      const r = loc.el.getBoundingClientRect();
      if (!r.width && !r.height) continue; // 閉じた <details> の中など、見えない所には、出さない
      items.push({ top: regionTop.get(tid) ?? r.top, tid, n, resolved: isResolved });
    }
  }
  if (pendingEl?.isConnected) {
    // 入力中の対象も、同じ印（濃いアクセント。「新」）
    const top = regionTop.get('pending') ?? pendingEl.getClientRects()[0]?.top;
    if (top !== undefined) items.push({ top, tid: 'pending', n: '新', pending: true });
  }

  stackGroups(groupBadges(items), (g, top) => {
    const box = h(
      'div',
      { class: 'bbadge' },
      g.items.map((b) =>
        h('span', {
          class: `bno${b.resolved ? ' resolved' : ''}${b.pending ? ' pending' : ''}`,
          'data-tid': b.tid,
          text: String(b.n),
        }),
      ),
    );
    box.style.top = `${badgeTopIn(top, dr, ds.scrollTop)}px`;
    box.style.left = `${left}px`;
    layer.append(box);
    made.push(box);
    return box.offsetHeight; // 折り返して背が高くなった組の、下に、次の組を出す
  });

  for (const g of regions) {
    if (!g.m) continue;
    const b = regionBox(g.m, dr, { left: ds.scrollLeft, top: ds.scrollTop }, ds.clientWidth, g.rect);
    if (!b) continue;
    const rb = h('div', {
      class: `regionbox${g.resolved ? ' resolved' : ''}${g.pending ? ' pending' : ''}`,
      'data-tid': g.tid,
    });
    Object.assign(rb.style, { left: `${b.left}px`, top: `${b.top}px`, width: `${b.width}px`, height: `${b.height}px` });
    // 入力中の枠だけ、つかめる
    if (g.pending) for (const k of HANDLES) rb.append(h('span', { class: `rh rh-${k}`, 'data-h': k }));
    layer.append(rb);
    made.push(rb);
  }
  return made;
}

/** 層の中で、`tid` のものだけを、光らせる（null なら、すべて消す） */
export function markLinked(layer: HTMLElement, tid: string | null): void {
  for (const e of layer.querySelectorAll('.linked')) e.classList.remove('linked');
  if (!tid) return;
  for (const e of layer.querySelectorAll<HTMLElement>('[data-tid]'))
    if (e.dataset.tid === tid) e.classList.add('linked');
}
