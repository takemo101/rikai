// 拡大表示（F43）の関連の線（F55）：ステージの範囲の枠（`.fv-box`）と、右のドックのコメントのカードを、本文と同じ線で結ぶ。`<svg class="fv-links">` を、拡大表示の枠（`#lightbox`）の中に、画面に固定して重ねる（押せない・`aria-hidden`）。
// 線の組み立て（`composeFrame`）・描画（`LinksSvg`）・更新の骨組み（`useLinkFrame`）・見た目（`connectors.css`）は、本文の `overlay/Connectors.tsx` と**共用**。ここは、端点の測り方と、購読だけ。
// 端点（実測：`getBoundingClientRect`）：ステージ側＝範囲の枠の右端の縦の中央（少し外。本文と同じ）。範囲を持たない「この対象全体」のコメントは、枠がないので、対象（画像・図／html-app の枠）の右端の縦の中央（本文のブロックと同じ）。
// ドック側＝カードの、番号の丸の高さの左端（本文のパネルと同じ）。入力中の対象（範囲なら `.fv-box.pending`・この対象全体なら対象の右端）は、ドックの入力欄と結ぶ。
// 引くのは、ドックにカードとして出ているスレッドだけ。ステージ・ドックのスクロール・ズーム・移動で、見える範囲の外に出た線は、本文と同じ規則（`linkBetween`）：引かない（選んでいる・光らせている・入力中の線だけ、縁の内側に止めて引く）。
// 窓が狭く（760px 未満）、ドックが下のシートになるときは、線を引かない（カードが、ステージの下で、右から出る線が、左のカードへ戻るため。番号で結ぶ）。
// html-app の拡大表示の枠は、別の文書（iframe）：線は、親側で重ねた範囲の枠と結ぶ（iframe の中へは、入れない）。
import { useEffect } from 'react';
import { type Box, bottom, fromEdges, right } from '../lib/geom';
import type { Frame } from '../overlay/connectorPath';
import { LinksSvg } from '../overlay/LinksSvg';
import { cardPoint, composeFrame, GAP, PENDING, type Row, sideEnd, unionBox, visible } from '../overlay/linkFrame';
import { useLinkFrame } from '../overlay/useLinkFrame';
import type { DocModel } from '../store/doc';
import { type FocusRef, useUi } from '../store/ui';
import type { FocusCtx } from './useFocusCtx';

/** 測る（読みだけ）。`root`：`#lightbox`。`cards` には、いま出ているカードを入れる（大きさの変化を見るため） */
function measure(
  root: HTMLElement,
  model: DocModel | null,
  wholeComposer: boolean,
  sel: { active: string | null; linked: string | null },
  cards: HTMLElement[],
): Frame | null {
  const stage = root.querySelector<HTMLElement>('.lb-view, .fv-appstage'); // ステージの、見える範囲（画像・図／html-app の枠）
  const dock = root.querySelector<HTMLElement>('.fv-dock');
  const body = dock?.querySelector<HTMLElement>('.fv-dock-body');
  if (!stage || !dock || !body) return null;
  const stageBox = stage.getBoundingClientRect();
  const dockBox = dock.getBoundingClientRect();
  // 窓が狭く（760px 未満）、ドックが、ステージの下のシートになるとき：カードは、ステージの下。右へ引き出して、左のカードへ戻る線は、描けない（番号で結ぶ）
  if (dockBox.top >= bottom(stageBox) - 1) return null;
  // 線を描いてよい箱：ステージ・ドック・そのすきま（窓が狭く、ドックが下のシートのときも）。ドックの見出し（番号のないところ）は、見える範囲の外
  const clip = unionBox(stageBox, dockBox);
  const bodyBox = body.getBoundingClientRect();
  const panelBox = fromEdges({
    left: bodyBox.left,
    top: bodyBox.top,
    right: right(bodyBox),
    bottom: bottom(bodyBox),
  });

  const boxes = new Map<string, Box>();
  for (const e of root.querySelectorAll<HTMLElement>('.fv-regions .fv-box')) {
    const r = e.getBoundingClientRect();
    if (e.dataset.tid && visible(r)) boxes.set(e.dataset.tid, r);
  }
  const mediaRect = root.querySelector('.lb-stage, .fv-app iframe')?.getBoundingClientRect();
  const media = mediaRect && visible(mediaRect) ? mediaRect : null;

  const rows: Row[] = [];
  for (const card of body.querySelectorAll<HTMLElement>('.thread.composer, .thread[data-tid]')) {
    const isComposer = card.classList.contains('composer');
    const tid = isComposer ? PENDING : card.dataset.tid;
    const r = card.getBoundingClientRect();
    if (!tid || !visible(r)) continue;
    cards.push(card);
    const box = boxes.get(tid);
    // 範囲の枠があれば、その右端。なければ、この対象全体へのコメント（本文の、ブロックのコメントと同じ）：対象の右端。ほかの種類（文）は、ここには、引く先がない
    const end = box
      ? sideEnd(box, isComposer ? GAP.pending : GAP.region)
      : media && (isComposer ? wholeComposer : model?.locs.get(tid)?.kind === 'block')
        ? sideEnd(media, GAP.block)
        : null;
    if (end) rows.push({ tid, isComposer, end, card: cardPoint(card, r) });
  }
  return composeFrame(rows, clip, stageBox, panelBox, sel, right(stageBox));
}

/** マウスを置いている枠が、付けた `linkedTid`（なければ null）。拡大表示が閉じるとき、これだけ外す（枠が消えると `mouseleave` が来ない。ほかの経路で付いた `linkedTid` は、消さない） */
let hovered: string | null = null;

/** 閉じるとき（`FocusLinks` が外れる）：枠にマウスを置いたまま閉じたなら、その光りだけ外す */
function releaseHover(): void {
  const tid = hovered;
  hovered = null;
  if (tid !== null && useUi.getState().linkedTid === tid) useUi.getState().setLinked(null);
}

/**
 * ステージの範囲の枠に、マウスを置くと、ドックの同じスレッドのカードを光らせる（`linkedTid`：本文の、番号・枠にマウスを置いたときと同じ）。線も、光る。入力中の枠は、対象外。
 * 離したとき、まだこの枠が光っているなら、消す（ドックのカードへ移ったときは、カードが決める）。置いたまま閉じたときは、`releaseHover`
 */
export const hoverBox = (tid: string) =>
  tid === PENDING
    ? {}
    : {
        onMouseEnter: () => {
          hovered = tid;
          useUi.getState().setLinked(tid);
        },
        onMouseLeave: () => {
          if (hovered === tid) hovered = null;
          if (useUi.getState().linkedTid === tid) useUi.getState().setLinked(null);
        },
      };

export function FocusLinks({ focus, ctx }: { focus: FocusRef; ctx: FocusCtx }) {
  const enabled = useUi((s) => s.ui.links);
  const active = useUi((s) => s.active);
  const linkedTid = useUi((s) => s.linkedTid);
  const composer = useUi((s) => s.composer);
  const { model, threads, regions } = ctx;
  // 入力中の対象が、この対象全体（範囲なし）か。範囲なら、`.fv-box.pending` が引く先
  const wholeComposer =
    !!composer &&
    !composer.anchor.rect &&
    composer.anchor.blockId === focus.id &&
    composer.anchor.blockHash === focus.hash;

  useEffect(() => releaseHover, []);

  const { frame, request } = useLinkFrame(
    {
      enabled,
      observe: (request, ro) => {
        const root = document.getElementById('lightbox');
        if (!root) return null;
        // ステージの描き直し（ズーム・移動は、`style` の変化）・html-app の枠の範囲の枠・ドックのカードの増減・折りたたみ
        const mo = new MutationObserver(request);
        mo.observe(root, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['style', 'class', 'open', 'hidden'],
        });
        // capture：ステージ（html-app の枠のスクロール）・ドックの本体のスクロールを受ける（scroll は、バブルしない）
        root.addEventListener('scroll', request, { passive: true, capture: true });
        window.addEventListener('resize', request);
        ro.observe(root);
        for (const e of root.querySelectorAll('.lb-view, .fv-appstage, .fv-dock, .fv-dock-body')) ro.observe(e);
        return () => {
          root.removeEventListener('scroll', request, { capture: true });
          window.removeEventListener('resize', request);
          mo.disconnect();
        };
      },
      measure: (watch) => {
        const root = document.getElementById('lightbox');
        if (!root) return null;
        const cards: HTMLElement[] = [];
        const f = measure(root, model, wholeComposer, { active, linked: linkedTid }, cards);
        watch.push(...cards);
        return f;
      },
    },
    focus,
  );

  // 状態の変化：DOM は、React が書いたあと（このあと）に、測る
  // biome-ignore lint/correctness/useExhaustiveDependencies: これらが、測り直す契機（値は、effect の中で使わない）
  useEffect(() => {
    request();
  }, [request, model, threads, regions, active, linkedTid, wholeComposer, composer]);

  if (!frame) return null;
  const resolved = new Set(threads.filter((t) => t.resolved).map((t) => t.id));
  return (
    <LinksSvg
      className="fv-links"
      clipId="zoom-fv-links"
      frame={frame}
      active={active}
      linked={linkedTid}
      resolved={resolved}
    />
  );
}
