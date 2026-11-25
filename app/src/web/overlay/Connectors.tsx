// 関連の線（F35）：右のコメントのカードと、本文の対象を、線で結ぶ。`<svg id="links">` を、画面に固定して重ねる（押せない。図形だけで、文字は描かない）。
// 端点は、実測（`getBoundingClientRect`）だけで決める：本文側は、文＝強調の最後の行の右端・ブロック（画像・図は、その要素）・範囲の枠＝右端の縦の中央（ブロック・枠は、少し外）。カード側は、見出しの番号の丸の高さの、カードの左端。
// 引くのは、いま右のパネルに、カードとして出ているスレッド（`#threads .thread[data-tid]`・入力欄）だけ。DOM が事実：タブ・1 枚だけ見る・たたまれた行で、隠れたものは、引かない。
// 本文とパネルは、別々にスクロールする：両端が、見える範囲の中の線だけ、いつも引く。端点が外の線は、選んでいる（active）・光らせている（linked）・入力中のときだけ、縁の内側に短く止めて引く（縁へ寄せた線が、束にならない）。
// 同じ側の外どうしは、引かない。横スクロールする箱（`pre`・表）の外へ隠れた強調にも、引かない。線は、本文・パネル・そのすきまの中だけに、切り取る。
// 更新：スクロール・窓・大きさ・パネルの中の変化で、`requestAnimationFrame` に 1 回へまとめて、測ってから（読みだけ）、state に入れる（書き）（`useLinkFrame`）。
// 線の組み立て（`composeFrame`）・描画（`LinksSvg`）・カード側の端点は、拡大表示（`focus/FocusLinks.tsx`）と共用（`linkFrame.ts`）。ここは、本文側の端点の測り方と、本文・パネルの購読。
import { useEffect, useRef } from 'react';
import type { ConnectorsProps } from '../contracts';
import { frameOf } from '../doc/render/blocks';
import { type Box, bottom, fromEdges, type Pt, right } from '../lib/geom';
import { type DocModel, type ThreadLoc, useDoc } from '../store/doc';
import { useUi } from '../store/ui';
import { clipBox, endOfLastLine, type Frame, lastLineBottom } from './connectorPath';
import { LinksSvg } from './LinksSvg';
import { cardPoint, composeFrame, type End, GAP, PENDING, type Row, sideEnd, visible } from './linkFrame';
import { useLinkFrame } from './useLinkFrame';

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
function textPoint(marks: readonly HTMLElement[], stop: Element): End | null {
  const rects: Box[] = [];
  let lastMark: HTMLElement | null = null;
  for (const m of marks) {
    if (!m.isConnected) continue;
    for (const r of m.getClientRects())
      if (visible(r)) {
        rects.push(r);
        lastMark = m;
      }
  }
  const p = endOfLastLine(rects);
  const lineBottom = lastLineBottom(rects);
  if (!p || lineBottom === null || !lastMark || hiddenByScroll(lastMark, p, stop)) return null;
  // 行間：行の高さ（`line-height`）と、強調の矩形の高さの差。`pre` の行は、本文の行より、背が低い
  const last = rects.filter((r) => bottom(r) === lineBottom).at(-1);
  const lh = Number.parseFloat(getComputedStyle(lastMark).lineHeight);
  const gap = Number.isFinite(lh) && last ? Math.max(0, lh - last.height) : 4;
  return { p, bottom: lineBottom, gap };
}

/** 本文側の端点。ブロックは、画像・図なら、その要素（`frameOf`）の右端の外 */
function docPoint(loc: ThreadLoc | undefined, regions: Map<string, Box>, tid: string, stop: Element): End | null {
  switch (loc?.kind) {
    case 'text':
      return textPoint(loc.marks, stop);
    case 'block': {
      if (!loc.el.isConnected) return null;
      const r = frameOf(loc.el).getBoundingClientRect();
      return visible(r) ? sideEnd(r, GAP.block) : null;
    }
    case 'region': {
      const b = regions.get(tid);
      return b ? sideEnd(b, GAP.region) : null;
    }
    default:
      return null;
  }
}

/** 入力中の対象：範囲なら枠（`.regionbox.pending`）・文・ブロックなら、強調した要素 */
function pendingPoint(model: DocModel, regions: Map<string, Box>, stop: Element): End | null {
  const b = regions.get(PENDING);
  if (b) return sideEnd(b, GAP.pending);
  const el = model.pending;
  if (!el?.isConnected) return null;
  if (el.tagName === 'MARK') return textPoint([el as HTMLElement], stop);
  const r = el.getBoundingClientRect();
  return visible(r) ? sideEnd(r, GAP.block) : null;
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
  const docBox = scroller.getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();
  const clip = clipBox(docBox, panelRect);
  if (!model) return { clip, leadX: null, links: [] };

  // 固定の見出し（`.panel-top`）の下に隠れたカードは、見えない：パネルの見える範囲は、その下から
  const head = panel.querySelector('.panel-top');
  const panelBox = head
    ? fromEdges({
        left: panelRect.left,
        top: Math.max(panelRect.top, head.getBoundingClientRect().bottom),
        right: right(panelRect),
        bottom: bottom(panelRect),
      })
    : panelRect;

  const regions = new Map<string, Box>();
  for (const e of scroller.querySelectorAll<HTMLElement>('#badges .regionbox')) {
    const r = e.getBoundingClientRect();
    if (e.dataset.tid && visible(r)) regions.set(e.dataset.tid, r);
  }

  // カードごとの、本文側・カード側の端点
  const rows: Row[] = [];
  for (const card of panel.querySelectorAll<HTMLElement>('.thread.composer, .thread[data-tid]')) {
    const isComposer = card.classList.contains('composer');
    const tid = isComposer ? PENDING : card.dataset.tid;
    const r = card.getBoundingClientRect();
    if (!tid || !visible(r)) continue;
    cards.push(card);
    if (isComposer && !composerOpen) continue;
    const end = isComposer
      ? pendingPoint(model, regions, scroller)
      : docPoint(model.locs.get(tid), regions, tid, scroller);
    if (end) rows.push({ tid, isComposer, end, card: cardPoint(card, r) });
  }
  const article = scroller.querySelector('#article')?.getBoundingClientRect();
  return composeFrame(rows, clip, docBox, panelBox, sel, article?.right ?? 0);
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

  // 測るときに読む、いまの値（購読を、作り直さないため）
  const latest = useRef({ model, composerOpen, active, linkedTid });
  latest.current = { model, composerOpen, active, linkedTid };

  const { frame, request } = useLinkFrame(
    {
      enabled,
      // 購読：スクロール・窓・大きさ・パネルの中の変化。本文の DOM は、DocModel ごとに作り直されるので、DocModel ごとに、つなぎ直す
      observe: (request, ro) => {
        const scroller = scrollRef.current;
        const panel = document.getElementById('threads');
        if (!scroller || !panel) return null;
        const mo = new MutationObserver(request);
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
        return () => {
          scroller.removeEventListener('scroll', request, { capture: true });
          panel.removeEventListener('scroll', request);
          window.removeEventListener('resize', request);
          mo.disconnect();
        };
      },
      measure: (watch) => {
        const scroller = scrollRef.current;
        const panel = document.getElementById('threads');
        if (!scroller || !panel) return null;
        const { model: m, composerOpen: open, active: a, linkedTid: l } = latest.current;
        const cards: HTMLElement[] = [];
        const f = measure(scroller, panel, m, open, { active: a, linked: l }, cards);
        watch.push(...cards);
        return f;
      },
    },
    doc,
  );

  // 状態の変化：DOM は、React が書いたあと（このあと）に、測る。左の一覧の開閉・右の幅（ui）は、大きさが変わらず位置だけ動くこともある
  // biome-ignore lint/correctness/useExhaustiveDependencies: これらが、測り直す契機（値は、effect の中で使わない）
  useEffect(() => {
    request();
  }, [request, model, view?.key, threads, tab, solo, composerOpen, active, linkedTid, ui]);

  if (!frame) return null;
  const resolved = new Set(threads?.filter((t) => t.resolved).map((t) => t.id));
  return <LinksSvg id="links" clipId="links" frame={frame} active={active} linked={linkedTid} resolved={resolved} />;
}
