// 番号の層（`#badges`）に、番号の丸と範囲の枠を置く。測定（`getBoundingClientRect`）を含むので、jsdom では試せない（位置の計算は `layout.ts`）。
// 番号の印は、文・ブロック・範囲の、すべて、同じ見た目（丸）・同じ位置（記事の左の余白。対象の上端）に、要素の外の層に出す（`#docscroll` の中の絶対位置）。
// 要素の中に出すと、箱の overflow で切れる・横スクロールで流れる・行末の文字に重なる。大きさが変わる（図の描画・窓・幅の変更）と、合わせ直す。
// 範囲のコメントの印は、範囲の上端の高さ（画像・図の中の位置）に出す。
import type { Rect } from '../../shared/types';
import { frameOf } from '../doc/render/blocks';
import { h } from '../lib/dom';
import type { Box } from '../lib/geom';
import type { BlockEl, DocModel } from '../store/doc';
import {
  BADGE_OUTSET,
  type BadgeItem,
  badgeLeft,
  badgeTopIn,
  clampRegionRect,
  foldBadges,
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
  /** 範囲の枠を出すか（`ui.regionBoxes`）。false の間は、保存済みの範囲の枠を、DOM に置かない（番号の丸は、そのまま）。入力中の枠だけは、つかめない形（`still`）で出す */
  regionBoxes: boolean;
}

interface Region {
  tid: string;
  el: BlockEl;
  rect: Rect;
  resolved?: boolean;
  pending?: boolean;
  m?: Box;
}

/** 描く比率：html-app の枠のブロックは、基準の周りに収める（古い基準の極端な値で、本文の高さが伸びない）。それ以外は、そのまま */
const drawable = (el: BlockEl, rect: Rect): Rect | null =>
  el.classList.contains('htmlapp') ? clampRegionRect(rect) : rect;

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
    const rect = loc?.kind === 'region' ? drawable(loc.el, loc.rect) : null;
    if (loc?.kind === 'region' && rect) regions.push({ tid, el: loc.el, rect, resolved: resolved.has(tid) });
  }
  const pendingEl = input.composer ? model.pending : null; // 入力欄を開いている間だけ
  const pendingRect = input.composer?.rect ?? null;
  const pendingDraw = pendingRect && pendingEl ? drawable(pendingEl, pendingRect) : null;
  if (pendingDraw && pendingEl) regions.push({ tid: 'pending', el: pendingEl, rect: pendingDraw, pending: true });
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

  // 丸の組の右端（記事の左端 + 34px）から、層の左端までの幅（クリップの 2px 手前まで）：これに収まる数だけ、重ねて並べる
  const room = left + BADGE_OUTSET + 34 - 2;
  stackGroups(groupBadges(items), (g, top) => {
    const { shown, folded } = foldBadges(g.items, room, (b) => b.n);
    const bno = (b: BadgeItem, fold: boolean) => {
      const w = String(b.n).length;
      return h('span', {
        class: `bno${w > 1 ? ` d${Math.min(w, 4)}` : ''}${b.resolved ? ' resolved' : ''}${b.pending ? ' pending' : ''}${fold ? ' fold' : ''}`,
        'data-tid': b.tid,
        text: String(b.n),
      });
    };
    const box = h(
      'div',
      { class: 'bbadge' },
      shown.map((b) => bno(b, false)),
    );
    box.style.top = `${badgeTopIn(top, dr, ds.scrollTop)}px`;
    box.style.left = `${left}px`;
    const first = folded[0];
    if (first) {
      // 「+N」：押すと、まとめた分の、いちばん小さい番号のカード。マウスを置くと、まとめた丸が、行の下の小さなポップオーバーに開く（CSS）。
      // ポップオーバーは、左端を、本文の見える範囲の左（+4px）にそろえ、横に並べて、折り返す
      const text = `+${folded.length}`;
      const pop = h(
        'div',
        { class: 'bno-pop' },
        folded.map((b) => bno(b, true)),
      );
      pop.style.left = `${ds.scrollLeft + 4 - left}px`;
      pop.style.maxWidth = `${Math.max(60, ds.clientWidth - 8)}px`;
      // 開くとき（マウスが入ったとき）に、実際の大きさで置き直す：右端は「+N」の右端にそろえ（すきまを空けない）、左へは、見える範囲の左 +4px まで。
      // 下に入りきらなければ、行の上に開く（上にも入らなければ、下のまま）
      box.addEventListener('mouseenter', () => {
        const [sr, br] = [ds.getBoundingClientRect(), box.getBoundingClientRect()];
        const pr = pop.getBoundingClientRect();
        pop.style.left = `${Math.max(sr.left + 4, br.right - pr.width) - br.left}px`;
        pop.classList.remove('up');
        const below = br.bottom - 2 + pr.height > sr.bottom - 4;
        const room = br.top + 2 - pr.height >= sr.top + 4;
        if (below && room) pop.classList.add('up');
      });
      box.append(
        h('span', {
          class: `bno-more${text.length > 1 ? ` d${Math.min(text.length, 4)}` : ''}`,
          'data-tid': first.tid,
          'data-tids': folded.map((b) => b.tid).join(' '),
          title: `ほかに ${folded.length} 件（${folded.map((b) => b.n).join('・')}）`,
          text,
        }),
        pop,
      );
    }
    layer.append(box);
    made.push(box);
    return box.offsetHeight; // 1 行（背は、丸の高さ。ポップオーバーは、数えない）。次の組は、その下に出す
  });

  for (const g of regions) {
    if (!g.m) continue;
    if (!input.regionBoxes && !g.pending) continue; // 隠している間は、置かない（押せない・見えない）。丸の高さ（`regionTop`）は、上で決めた
    const b = regionBox(g.m, dr, { left: ds.scrollLeft, top: ds.scrollTop }, ds.clientWidth, g.rect);
    if (!b) continue;
    const still = g.pending && !input.regionBoxes; // 隠している間の入力中の枠：対象を示すだけ（つかめない）
    const rb = h('div', {
      class: `regionbox${g.resolved ? ' resolved' : ''}${g.pending ? ' pending' : ''}${still ? ' still' : ''}`,
      'data-tid': g.tid,
    });
    Object.assign(rb.style, { left: `${b.left}px`, top: `${b.top}px`, width: `${b.width}px`, height: `${b.height}px` });
    // 入力中の枠だけ、つかめる（隠している間は、つかめない）
    if (g.pending && !still) for (const k of HANDLES) rb.append(h('span', { class: `rh rh-${k}`, 'data-h': k }));
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
    if (e.dataset.tid === tid || e.dataset.tids?.split(' ').includes(tid)) e.classList.add('linked'); // 「+N」は、まとめた分のどれでも
}
