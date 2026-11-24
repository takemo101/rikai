// 本文の印と、右のカードを、マウスを置いたとき、お互いに光らせる（どのコメントが、どの対象のものかが、すぐ分かるように）。
// 光らせるのは、`.linked` クラス。光っているスレッドは、`useUi` の `linkedTid`。
//   - 本文（`#article`）にマウスを置く → `setLinked`＋右のカードを見える所へ（入力欄を開いている間は、動かさない）
//   - 右のカード（`#threads`）にマウスを置く → `setLinked`
//   - 番号・範囲の枠（`#badges`）にマウスを置く → `overlay/` が `setLinked` する
//   - `linkedTid` が変わる・本文が描き直される・層（番号・カード）が置き直される → `.linked` を付け直す（置き直されても、光ったまま）
import { articleTid } from '../doc/hit';
import { locEl, type ThreadLoc, useDoc } from '../store/doc';
import { useUi } from '../store/ui';

/** `.linked` を付ける要素：`data-tid` がスレッド ID のもの（本文の印・番号・枠・カード）と、位置の要素（1 つのブロックに複数のコメントがあるとき、`data-tid` は最後の 1 つだけなので） */
export function linkedTargets(root: ParentNode, tid: string, locs: ReadonlyMap<string, ThreadLoc> | null): Element[] {
  const out = new Set<Element>();
  for (const e of root.querySelectorAll('[data-tid]'))
    if (e instanceof HTMLElement && e.dataset.tid === tid) out.add(e);
  const loc = locs?.get(tid);
  const el = locEl(loc);
  if (el) out.add(el);
  if (loc?.kind === 'text') for (const m of loc.marks) out.add(m);
  return [...out];
}

/** `.linked` を、tid のものだけにする（null なら、すべて外す） */
export function applyLinked(root: ParentNode, tid: string | null, locs: ReadonlyMap<string, ThreadLoc> | null): void {
  const want = new Set(tid ? linkedTargets(root, tid, locs) : []);
  for (const e of root.querySelectorAll('.linked')) if (!want.has(e)) e.classList.remove('linked');
  for (const e of want) if (!e.classList.contains('linked')) e.classList.add('linked');
}

const regionExists = (): boolean => {
  const locs = useDoc.getState().model?.locs;
  if (!locs) return false;
  for (const l of locs.values()) if (l.kind === 'region') return true;
  return false;
};

const inside = (e: Event, selector: string): Element | null =>
  e.target instanceof Element ? e.target.closest(selector) : null;

/** 本文・カード・層の、`.linked` を保つ。解除の関数を返す */
export function installHoverLink(doc: Document = document): () => void {
  const sync = (): void => applyLinked(doc, useUi.getState().linkedTid, useDoc.getState().model?.locs ?? null);

  const hoverArticle = (e: MouseEvent): void => {
    const tid = articleTid(e, useDoc.getState().model);
    if (tid === useUi.getState().linkedTid) return;
    useUi.getState().setLinked(tid);
    if (!tid || useUi.getState().composer) return;
    // 右のカードが見えない所にあるときだけ、動かす。入力欄を開いている間は、動かさない（入力欄が、見えなくなるため）
    for (const c of doc.querySelectorAll<HTMLElement>('.thread[data-tid]')) {
      if (c.dataset.tid === tid) c.scrollIntoView({ block: 'nearest' });
    }
  };
  const onOver = (e: MouseEvent): void => {
    if (inside(e, '#article')) {
      hoverArticle(e);
      return;
    }
    if (!inside(e, '#threads')) return;
    const card = inside(e, '.thread[data-tid]');
    const tid = card instanceof HTMLElement ? (card.dataset.tid ?? null) : null;
    if (tid === useUi.getState().linkedTid && (!card || card.classList.contains('linked'))) return;
    useUi.getState().setLinked(tid);
  };
  // 同じ画像の中で、範囲から範囲へ動くとき
  const onMove = (e: MouseEvent): void => {
    if (inside(e, '#article') && regionExists()) hoverArticle(e);
  };
  // 本文・右のパネルから、外へ出たとき（中の要素から要素への移動は、出たことにしない）
  const onOut = (e: MouseEvent): void => {
    for (const sel of ['#article', '#threads']) {
      const from = inside(e, sel);
      if (from && !(e.relatedTarget instanceof Node && from.contains(e.relatedTarget)))
        useUi.getState().setLinked(null);
    }
  };
  doc.addEventListener('mouseover', onOver);
  doc.addEventListener('mousemove', onMove);
  doc.addEventListener('mouseout', onOut);

  const unsubUi = useUi.subscribe((s, prev) => {
    if (s.linkedTid !== prev.linkedTid) sync();
  });
  const unsubDoc = useDoc.subscribe((s, prev) => {
    if (s.model !== prev.model) sync();
  });
  // 層（番号・範囲の枠・カード）が、置き直されたとき
  let frame = 0;
  const observer = new MutationObserver(() => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      sync();
    });
  });
  for (const sel of ['#badges', '#threads']) {
    const el = doc.querySelector(sel);
    if (el) observer.observe(el, { childList: true, subtree: true });
  }
  sync();
  return () => {
    doc.removeEventListener('mouseover', onOver);
    doc.removeEventListener('mousemove', onMove);
    doc.removeEventListener('mouseout', onOut);
    unsubUi();
    unsubDoc();
    observer.disconnect();
    if (frame) cancelAnimationFrame(frame);
  };
}
