// 画像・図・html-app の枠を、画面の中に、大きく出す拡大表示（`#lightbox`。`role="dialog"`・`aria-modal`）。**添付の画像も、同じ拡大表示**（押すと閉じる専用の窓は、ない）。
// - 添付の画像（入力欄のサムネイル・送った画像・ドックの中の添付：F31）・返信の画像・図（F37）：窓に収まる大きさで出して、ズームイン／ズームアウト／全体に合わせる・ホイール・キー・移動（ドラッグ）・ダブルクリック（全体に合わせる ↔ 等倍）ができる（`ZoomView.tsx`）。
//   **見るだけ**：ドックも、「範囲を選ぶ」「要素を選ぶ」の道具も、出さない（本文のブロックではないので、対象がない）。
// - 本文（`#article`）の画像・図・html-app の枠（F43）：左にステージ（ズーム・移動／枠を大きく）・右にコメントのドック（`FocusDock.tsx`）。
//   ステージで、範囲・要素を選んで、ドックの入力欄でコメントを書ける（拡大表示を開いたまま。下書きは、本文のパネルと同じ）。
// 閉じる：Esc（`lib/escape.ts`：道具の中止が先）・背景（画像・図の外）を押す・「×」。ドラッグの終わりでは、閉じない。画像・図の上を押しても、閉じない。
// ドックの中の添付の画像を開いたときは、ドックつきの拡大表示の上に重なる（`lightboxBack`）：閉じると、ドックつきの拡大表示へ戻る。
// モーダル：開いている間、窓の後ろ（`#app` の、ほかの要素）は `inert`（キーボード・マウス・読み上げの、どれも届かない）。Tab は、窓の中を回る（外へ出ない）。
// 開いたとき、フォーカスを、ここへ。閉じたとき、開く前の要素へ戻す（なくなっていれば、本文の、その画像・図・枠の入口へ）。
import { useCallback, useEffect, useRef, useState } from 'react';
import { entryElementOf, resolveFocusBlock } from '../doc/focusBlock';
import type { AppFrame } from '../doc/frameRegistry';
import { useRegionDeps } from '../interact/useRegionDeps';
import { escapeStep } from '../lib/escape';
import { useDoc } from '../store/doc';
import { ATTACHED_ALT, type FocusRef, type LightboxTarget, toast, useUi } from '../store/ui';
import { FocusApp } from './FocusApp';
import { FocusDock } from './FocusDock';
import { useFocusCtx } from './useFocusCtx';
import { ZoomView } from './ZoomView';

type FocusTarget = LightboxTarget & { focus: FocusRef };
const hasFocus = (t: LightboxTarget): t is FocusTarget => !!t.focus;

/** Tab で届く要素（窓の中。隠れている・使えない・窓の後ろのものは、除く） */
const TABBABLE =
  'button, [href], input, select, textarea, iframe, [tabindex]:not([tabindex="-1"]), [contenteditable=""], [contenteditable="true"]';
export function tabbablesOf(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(TABBABLE)].filter(
    (el) => !el.hasAttribute('disabled') && el.tabIndex >= 0 && !el.closest('[hidden], [inert]'),
  );
}

export function ZoomModal() {
  const target = useUi((s) => s.lightbox);
  const closeLightbox = useUi((s) => s.closeLightbox);
  const rootRef = useRef<HTMLDivElement>(null);
  const open = target !== null;

  // Esc：道具（範囲選択・要素選択）の中止 → もう一度で、閉じる。本文の範囲選択（interact）と、同じ順序（`lib/escape.ts`）
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') escapeStep(e);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  // モーダル：開いたとき、窓の後ろを `inert` に。閉じたとき、`inert` を外して、開く前の要素へ戻す（フォーカスできる要素だったとき。なくなっていれば、本文の入口へ）。
  // 開いたまま、中身が替わる（ドックの中の添付の画像を開く・閉じて、下の拡大表示へ戻る）ときは、開く前の要素を、控えたまま
  const lastTarget = useRef<LightboxTarget | null>(null); // 閉じるときに読む、最後に開いていたもの（閉じた時点では、target は null）
  if (target) lastTarget.current = target;
  useEffect(() => {
    if (!open) return;
    const root = rootRef.current;
    const before =
      document.activeElement instanceof HTMLElement && document.activeElement !== document.body
        ? document.activeElement
        : null;
    const dimmed: Element[] = [];
    if (root?.parentElement) {
      for (const el of root.parentElement.children) {
        if (el === root || el.hasAttribute('inert')) continue;
        el.setAttribute('inert', '');
        dimmed.push(el);
      }
    }
    return () => {
      for (const el of dimmed) el.removeAttribute('inert');
      let back: HTMLElement | null = before && document.contains(before) ? before : null;
      const focus = lastTarget.current?.focus;
      if (!back && focus) {
        const model = useDoc.getState().model;
        const block = model ? resolveFocusBlock(model.blocks, focus)?.el : null;
        back = block ? entryElementOf(block) : null;
      }
      back?.focus({ preventScroll: true });
    };
  }, [open]);

  // 中身が替わるたびに（開いたとき・ドックの中の添付を開いたとき・閉じて戻ったとき）、フォーカスを、窓へ
  // biome-ignore lint/correctness/useExhaustiveDependencies: target（中身）が替わったことが契機
  useEffect(() => {
    if (open) rootRef.current?.focus({ preventScroll: true });
  }, [target]);

  // Tab は、窓の中だけを回る（背景の本文へ、出ない）。ステージの道具・右のドックの入力欄・ボタンを、DOM の順に
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !open) return;
    const onTab = (e: KeyboardEvent): void => {
      if (e.key !== 'Tab') return;
      e.preventDefault();
      const items = tabbablesOf(root);
      if (!items.length) return;
      const i = items.indexOf(document.activeElement as HTMLElement);
      const next =
        i < 0 ? (e.shiftKey ? items.length - 1 : 0) : (i + (e.shiftKey ? -1 : 1) + items.length) % items.length;
      items[next]?.focus();
    };
    root.addEventListener('keydown', onTab);
    return () => root.removeEventListener('keydown', onTab);
  }, [open]);

  return (
    <div
      id="lightbox"
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={target?.alt ?? ATTACHED_ALT}
      tabIndex={-1}
      hidden={!open}
      className={target ? `zoomable${target.focus ? ' fv' : ''}` : undefined}
    >
      {target && hasFocus(target) ? (
        <FocusLayout target={target} onClose={closeLightbox} />
      ) : target ? (
        <ZoomView target={target} onClose={closeLightbox} />
      ) : null}
    </div>
  );
}

/** 拡大表示（ドックつき）：左にステージ・右にドック。本文の描き直し（更新）に、開いたまま追従する。対象のブロックが、いまの版から消えた・別のページへ移った、ときは、閉じて、知らせる */
function FocusLayout({ target, onClose }: { target: FocusTarget; onClose: () => void }) {
  const ctx = useFocusCtx(target.focus);
  const deps = useRegionDeps();
  const [appFrame, setAppFrame] = useState<AppFrame | null>(null); // html-app の拡大表示の枠（ドックが、状態を読む）

  // 対象のブロックが、いまの版の本文から消えた（更新で、削除・内容が変わった）：閉じて、知らせる。下書きは、パネルに残る
  useEffect(() => {
    if (ctx.status !== 'lost') return;
    toast(
      '資料の更新で、拡大表示の対象が見つからなくなったので、閉じました（書きかけのコメントは、右のパネルに残っています）',
      true,
    );
    onClose();
  }, [ctx.status, onClose]);

  // 別のページ・トピックへ移った（ハッシュの変更）：閉じる。開いた時点の場所を控えて、変わったかを比べる
  const place = ctx.view ? `${ctx.view.slug}/${ctx.view.page}` : null;
  const openedAt = useRef<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 開いた（対象が変わった）時点の場所だけを控える。場所の変化は、次の効果が見る
  useEffect(() => {
    openedAt.current = place;
  }, [target]);
  useEffect(() => {
    if (place === null) return;
    if (openedAt.current === null) openedAt.current = place;
    else if (place !== openedAt.current) onClose();
  }, [place, onClose]);

  const close = useCallback(() => onClose(), [onClose]);
  return (
    <>
      <div className={`fv-main${target.kind === 'app' ? ' app' : ''}`}>
        {target.kind === 'app' ? (
          <FocusApp target={target} ctx={ctx} deps={deps} onClose={close} onFrame={setAppFrame} />
        ) : (
          <ZoomView target={target} onClose={close} focus={target.focus} ctx={ctx} deps={deps} />
        )}
      </div>
      <FocusDock focus={target.focus} ctx={ctx} frame={appFrame} />
    </>
  );
}
