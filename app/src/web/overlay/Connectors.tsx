// 関連の線（F35）：右のコメントのカードと、本文の対象を、線で結ぶ。`<svg id="links">` を、画面に固定して重ねる（押せない。図形だけで、文字は描かない）。
// 端点は、実測（`getBoundingClientRect`）だけで決める：本文側は、文＝強調の最後の行の右端・ブロック（画像・図は、その要素）・範囲の枠＝右端の縦の中央（ブロック・枠は、少し外）。カード側は、見出しの番号の丸の高さの、カードの左端。
// 引くのは、いま右のパネルに、カードとして出ているスレッド（`#threads .thread[data-tid]`・入力欄）だけ。DOM が事実：タブ・1 枚だけ見る・たたまれた行で、隠れたものは、引かない。
// 本文とパネルは、別々にスクロールする：両端が、見える範囲の中の線だけ、いつも引く。端点が外の線は、選んでいる（active）・光らせている（linked）・入力中のときだけ、縁の内側に短く止めて引く（縁へ寄せた線が、束にならない）。
// 同じ側の外どうしは、引かない。横スクロールする箱（`pre`・表）の外へ隠れた強調にも、引かない。線は、本文・パネル・そのすきまの中だけに、切り取る。
// 更新：スクロール・窓・大きさ・パネルの中の変化で、`requestAnimationFrame` に 1 回へまとめて、測ってから（読みだけ）、state に入れる（書き）。
import { useEffect, useRef, useState } from 'react';
import type { ConnectorsProps } from '../contracts';
import { frameOf } from '../doc/render/blocks';
import { type DocModel, type ThreadLoc, useDoc } from '../store/doc';
import { useUi } from '../store/ui';
import {
  type Box,
  clipBox,
  endOfLastLine,
  type Frame,
  type Link,
  linkBetween,
  type Pt,
  rightMiddle,
  sameFrame,
} from './connectorPath';

/** 入力中の対象の印（`#badges` の `.regionbox.pending`・`data-tid` と同じ） */
const PENDING = 'pending';

const boxOf = (r: DOMRect | Box): Box => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
const visible = (r: DOMRect): boolean => r.width > 0 || r.height > 0;

/** 本文側の端点の、対象の箱からの距離（px）：版で変えたブロックの右端の緑の線（約 3px）・入力中の枠のハンドル（`.rh-e`。外へ 6px）に、点が重ならないように */
const GAP = { block: 6, region: 4, pending: 10 } as const;

/**
 * `el` の祖先（`stop` の手前まで）のうち、中身がはみ出して、隠れているもの（`overflow` が `visible` でない）の外に、点があるか。
 * `pre`・表・形式の枠の、横スクロールの外にある強調には、線を引かない（点が、そこにないものを指さない）
 */
function hiddenByScroll(el: Element, p: Pt, stop: Element): boolean {
  for (let a = el.parentElement; a && a !== stop; a = a.parentElement) {
    if (a.scrollWidth <= a.clientWidth && a.scrollHeight <= a.clientHeight) continue; // はみ出していない（ふつうの箱は、ここで抜ける）
    const cs = getComputedStyle(a);
    if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
    const r = a.getBoundingClientRect();
    if (p.x < r.left - 1 || p.x > r.right + 1 || p.y < r.top - 1 || p.y > r.bottom + 1) return true;
  }
  return false;
}

/** 強調（`mark`）の、最後の行の右端の中央。見えない所（閉じた `<details>`・描き直しの前の古い要素・横スクロールの外）は null */
function textPoint(marks: readonly HTMLElement[], stop: Element): Pt | null {
  const rects: Box[] = [];
  let lastMark: HTMLElement | null = null;
  for (const m of marks) {
    if (!m.isConnected) continue;
    for (const r of m.getClientRects())
      if (visible(r)) {
        rects.push(boxOf(r));
        lastMark = m;
      }
  }
  const p = endOfLastLine(rects);
  return p && lastMark && !hiddenByScroll(lastMark, p, stop) ? p : null;
}

/** 本文側の端点。ブロックは、画像・図なら、その要素（`frameOf`）の右端の外 */
function docPoint(loc: ThreadLoc | undefined, regions: Map<string, Box>, tid: string, stop: Element): Pt | null {
  switch (loc?.kind) {
    case 'text':
      return textPoint(loc.marks, stop);
    case 'block': {
      if (!loc.el.isConnected) return null;
      const r = frameOf(loc.el).getBoundingClientRect();
      if (!visible(r)) return null;
      const p = rightMiddle(boxOf(r));
      return { x: p.x + GAP.block, y: p.y };
    }
    case 'region': {
      const b = regions.get(tid);
      return b ? shiftX(rightMiddle(b), GAP.region) : null;
    }
    default:
      return null;
  }
}

const shiftX = (p: Pt, dx: number): Pt => ({ x: p.x + dx, y: p.y });

/** 入力中の対象：範囲なら枠（`.regionbox.pending`）・文・ブロックなら、強調した要素 */
function pendingPoint(model: DocModel, regions: Map<string, Box>, stop: Element): Pt | null {
  const b = regions.get(PENDING);
  if (b) return shiftX(rightMiddle(b), GAP.pending);
  const el = model.pending;
  if (!el?.isConnected) return null;
  if (el.tagName === 'MARK') return textPoint([el as HTMLElement], stop);
  const r = el.getBoundingClientRect();
  return visible(r) ? shiftX(rightMiddle(boxOf(r)), GAP.block) : null;
}

/** カード側の端点：見出しの番号の丸の高さの、カードの左端（丸がなければ、見出し・カードの上） */
function cardPoint(card: HTMLElement, r: DOMRect): Pt {
  const mark = card.querySelector('.no') ?? card.querySelector('.th-head');
  const m = mark?.getBoundingClientRect();
  return { x: r.left, y: m && visible(m) ? (m.top + m.bottom) / 2 : r.top + Math.min(18, r.height / 2) };
}

/** 測る（読みだけ）。`cards` には、いま出ているカードを入れる（大きさの変化を見るため） */
function measure(
  scroller: HTMLElement,
  panel: HTMLElement,
  model: DocModel | null,
  composerOpen: boolean,
  sel: { active: string | null; linked: string | null },
  cards: HTMLElement[],
): Frame {
  const docBox = boxOf(scroller.getBoundingClientRect());
  const panelRect = boxOf(panel.getBoundingClientRect());
  const clip = clipBox(docBox, panelRect);
  const links: Link[] = [];
  if (!model) return { clip, links };

  // 固定の見出し（`.panel-top`）の下に隠れたカードは、見えない：パネルの見える範囲は、その下から
  const head = panel.querySelector('.panel-top');
  const panelBox = head
    ? { ...panelRect, top: Math.max(panelRect.top, head.getBoundingClientRect().bottom) }
    : panelRect;

  const regions = new Map<string, Box>();
  for (const e of scroller.querySelectorAll<HTMLElement>('#badges .regionbox')) {
    const r = e.getBoundingClientRect();
    if (e.dataset.tid && visible(r)) regions.set(e.dataset.tid, boxOf(r));
  }

  for (const card of panel.querySelectorAll<HTMLElement>('.thread.composer, .thread[data-tid]')) {
    const isComposer = card.classList.contains('composer');
    const tid = isComposer ? PENDING : card.dataset.tid;
    const r = card.getBoundingClientRect();
    if (!tid || !visible(r)) continue;
    cards.push(card);
    if (isComposer && !composerOpen) continue;
    const doc = isComposer
      ? pendingPoint(model, regions, scroller)
      : docPoint(model.locs.get(tid), regions, tid, scroller);
    if (!doc) continue;
    const emphasized = isComposer || tid === sel.active || tid === sel.linked; // 縁へ寄せた線は、これだけ引く
    const link = linkBetween(tid, doc, cardPoint(card, r), docBox, panelBox, emphasized);
    if (link) links.push(link);
  }
  return { clip, links };
}

export function Connectors({ view, scrollRef }: ConnectorsProps) {
  const enabled = useUi((s) => s.ui.links);
  const active = useUi((s) => s.active);
  const linkedTid = useUi((s) => s.linkedTid);
  const composerOpen = useUi((s) => s.composer !== null);
  const tab = useUi((s) => s.tab);
  const solo = useUi((s) => s.solo);
  const ui = useUi((s) => s.ui);
  const doc = useDoc((s) => s.model);
  const model = doc && view && doc.key === view.key ? doc : null; // 別のページの古い DocModel は、使わない
  const threads = view?.topic.threads;
  const [frame, setFrame] = useState<Frame | null>(null);

  // 測るときに読む、いまの値（effect を、作り直さないため）
  const latest = useRef({ model, composerOpen, active, linkedTid });
  latest.current = { model, composerOpen, active, linkedTid };
  const schedule = useRef(() => {});

  // 購読：スクロール・窓・大きさ・パネルの中の変化。本文の DOM は、DocModel ごとに作り直されるので、DocModel ごとに、つなぎ直す
  // biome-ignore lint/correctness/useExhaustiveDependencies: doc（DocModel）が、つなぎ直す契機。scrollRef は、安定した ref
  useEffect(() => {
    if (!enabled) {
      setFrame(null);
      return;
    }
    const scroller = scrollRef.current;
    const panel = document.getElementById('threads');
    if (!scroller || !panel) return;

    let raf = 0;
    const watched = new Set<HTMLElement>(); // 大きさを見ているカード
    const request = (): void => {
      if (!raf) raf = requestAnimationFrame(run);
    };
    const ro = new ResizeObserver(request);
    const mo = new MutationObserver(request);
    const run = (): void => {
      raf = 0;
      const cards: HTMLElement[] = [];
      const { model: m, composerOpen: open, active: a, linkedTid: l } = latest.current;
      const next = measure(scroller, panel, m, open, { active: a, linked: l }, cards); // 読み：ここまで
      setFrame((prev) => (sameFrame(prev, next) ? prev : next)); // 書き：ここから
      const now = new Set(cards);
      for (const c of watched) {
        if (now.has(c)) continue;
        ro.unobserve(c);
        watched.delete(c);
      }
      for (const c of now) {
        if (watched.has(c)) continue;
        ro.observe(c);
        watched.add(c);
      }
    };

    // capture：本文の中の、横にスクロールする箱（`pre`・表・形式の枠）の scroll も受ける（scroll は、バブルしない）
    scroller.addEventListener('scroll', request, { passive: true, capture: true });
    panel.addEventListener('scroll', request, { passive: true });
    window.addEventListener('resize', request);
    ro.observe(scroller);
    ro.observe(panel);
    const article = scroller.querySelector('#article');
    if (article) ro.observe(article);
    // カードの増減・タブ・1 枚だけ見る・折りたたみ（`<details>` の open）
    mo.observe(panel, { childList: true, subtree: true, attributes: true, attributeFilter: ['open', 'hidden'] });
    schedule.current = request;
    request();

    return () => {
      schedule.current = () => {};
      if (raf) cancelAnimationFrame(raf);
      scroller.removeEventListener('scroll', request, { capture: true });
      panel.removeEventListener('scroll', request);
      window.removeEventListener('resize', request);
      ro.disconnect();
      mo.disconnect();
    };
  }, [enabled, doc]);

  // 状態の変化：DOM は、React が書いたあと（このあと）に、測る。左の一覧の開閉・右の幅（ui）は、大きさが変わらず位置だけ動くこともある
  // biome-ignore lint/correctness/useExhaustiveDependencies: これらが、測り直す契機（値は、effect の中で使わない）
  useEffect(() => {
    schedule.current();
  }, [model, view?.key, threads, tab, solo, composerOpen, active, linkedTid, ui]);

  if (!enabled || !frame) return null;
  const { clip } = frame;
  const resolved = new Set(threads?.filter((t) => t.resolved).map((t) => t.id));
  const weight = (l: Link): number => (l.tid === active || l.tid === linkedTid ? 2 : l.tid === PENDING ? 1 : 0);
  const links = [...frame.links].sort((a, b) => weight(a) - weight(b)); // 強調する線は、手前（あとに描く）
  const focus = links.some((l) => weight(l) === 2);
  return (
    <svg id="links" className={focus ? 'focus' : undefined} aria-hidden="true">
      <defs>
        <clipPath id="links-clip">
          <rect x={clip.left} y={clip.top} width={clip.right - clip.left} height={clip.bottom - clip.top} />
        </clipPath>
      </defs>
      <g clipPath="url(#links-clip)">
        {links.map((l) => {
          const cls = [
            'cn-g',
            l.tid === active && 'active',
            l.tid === linkedTid && 'linked',
            l.tid === PENDING && 'pending',
            resolved.has(l.tid) && 'resolved',
            l.edge && 'edge',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <g key={l.tid} className={cls} data-tid={l.tid}>
              <path className="cn" data-tid={l.tid} d={l.d} />
              {l.doc ? <circle className="cn-dot" cx={l.doc.x} cy={l.doc.y} r={3} /> : null}
              {l.card ? (
                <line className="cn-bar" x1={l.card.x} y1={l.card.y - 5} x2={l.card.x} y2={l.card.y + 5} />
              ) : null}
            </g>
          );
        })}
      </g>
    </svg>
  );
}
