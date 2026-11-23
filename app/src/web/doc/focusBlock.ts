// 個別表示（F43）が、本文（`#article`）のブロックを指す・探し直す・コメントを絞る。DOM の要素は、本文の描き直しで作り直されるので、要素ではなく、内容の印（`FocusRef`）で持つ。
import type { Thread } from '../../shared/types';
import { type BlockRef, type DocModel, locEl } from '../store/doc';
import type { FocusRef } from '../store/ui';
import { type BlockEl, frameOf } from './render/blocks';

/** 画像のブロックで、最初の画像の `src` 属性（ハッシュが、画像のブロックは、どれも同じなので、見分ける） */
// ブロックそのものが `<img>`（資料の生の `<img>`）のこともある：自分自身も見る
const imgSrcOf = (el: BlockEl): string | null =>
  (el instanceof HTMLImageElement ? el : el.querySelector('img'))?.getAttribute('src') ?? null;

/**
 * 押された画像・図（`media`。html-app の枠のときは null）を含むブロックの印。`base`：範囲の基準（`frameOf`）か。
 * ブロックが、`data-bid` を持たない（返信の中の画像・図）ときは、null
 */
export function focusRefOf(block: BlockEl, media: Element | null): FocusRef | null {
  const id = block.dataset.bid;
  const hash = block.dataset.bhash;
  if (id === undefined || hash === undefined) return null;
  return {
    id,
    hash,
    src: media instanceof HTMLImageElement ? media.getAttribute('src') : null,
    base: media === null || frameOf(block) === media,
  };
}

/**
 * 印のブロックを、いまの DocModel の中から探す。内容（`data-bhash`。画像は、`src` も）が同じ、本文につながっているブロック。
 * 複数あれば、同じ `data-bid` のもの・なければ最初のもの。見つからなければ null（更新で、消えた・内容が変わった）
 */
export function resolveFocusBlock(blocks: readonly BlockRef[], ref: FocusRef): BlockRef | null {
  const same = blocks.filter(
    (b) => b.hash === ref.hash && b.el.isConnected && (ref.src === null || imgSrcOf(b.el) === ref.src),
  );
  return same.find((b) => b.id === ref.id) ?? same[0] ?? null;
}

/** ブロックの中の（ブロックそのものを含む）位置を持つスレッド：本文の順（`model.locs` の順ではなく、ページのスレッドの順）。位置のないものは、入れない */
export function threadsInBlock(model: DocModel, block: BlockEl, threads: readonly Thread[]): Thread[] {
  return threads.filter((t) => {
    const el = locEl(model.locs.get(t.id));
    return !!el && block.contains(el);
  });
}

/** 個別表示を閉じたとき、フォーカスを戻す先：本文の、そのブロックの入口（フォーカスできる画像・図／html-app の見出しの「個別表示」ボタン）。なければ null */
export function entryElementOf(block: BlockEl): HTMLElement | null {
  const el = block.closest('[data-focus-entry]') ?? block.querySelector('[data-focus-entry], button[data-focus-open]');
  return el instanceof HTMLElement ? el : null;
}
