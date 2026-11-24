// 個別表示（F43）が読む、本文の状態：いまのビュー・指しているブロック（DocModel から探し直す）・そのブロックのコメント・範囲の枠。
// 本文は、更新（版・返信・コメント）のたびに、描き直されて、要素が作り直される。個別表示は、開いたまま、そのつど、探し直して、重ねを更新する。
// ブロックが見つからないのは、**描き終えた、いまの版の DocModel に、ない**とき（`lost`）だけ。描き直している途中（古い DocModel・別の版の DocModel）は、待つ（`pending`）。
import { useMemo } from 'react';
import type { Rect, Thread } from '../../shared/types';
import type { BlockEl } from '../doc/render/blocks';
import { useView, type View } from '../lib/view';
import { type DocModel, docOrder, useDoc } from '../store/doc';
import { type FocusRef, useUi } from '../store/ui';
import { resolveFocusBlock, threadsInBlock } from './focusBlock';

/** 個別表示に重ねる範囲の枠：基準（画像・図そのもの／html-app の本文の枠）に対する比率 */
export interface RegionMark {
  /** スレッドの ID。入力中の対象は 'pending' */
  tid: string;
  /** 本文の番号（入力中の対象は「新」） */
  n: number | '新';
  rect: Rect;
  resolved: boolean;
}

export type FocusStatus = 'ok' | 'pending' | 'lost';

export interface FocusCtx {
  view: View | null;
  /** 描き終えた、いまの版の DocModel（描き直している途中・別の版なら null） */
  model: DocModel | null;
  status: FocusStatus;
  block: BlockEl | null;
  /** このブロックの、このページのコメント（進行中が先・本文の順） */
  threads: Thread[];
  /** 範囲の枠（このブロックの範囲のコメント。入力中の対象が、このブロックの範囲なら、それも） */
  regions: RegionMark[];
  /** コメントを付けられるか（最新版を見ていて、トピックが終了していない） */
  canComment: boolean;
}

/** DocModel が、描き直しの途中か（本文から外れた要素を持っている）：新しい DocModel が届くまで、待つ */
const isStale = (m: DocModel): boolean => !!m.blocks[0] && !m.blocks[0].el.isConnected;

const EMPTY: Thread[] = [];

export function useFocusCtx(ref: FocusRef): FocusCtx {
  const view = useView();
  const raw = useDoc((s) => s.model);
  const composer = useUi((s) => s.composer);
  const model = view && raw && raw.key === view.key && !isStale(raw) ? raw : null;
  const block = model ? (resolveFocusBlock(model.blocks, ref)?.el ?? null) : null;
  const topicThreads = view?.topic.threads;
  const page = view?.page;
  const canComment = !!view?.isLatest && !view.readOnly;
  const pendingRect =
    composer?.anchor.rect && composer.anchor.blockId === ref.id && composer.anchor.blockHash === ref.hash
      ? composer.anchor.rect
      : null;

  // `view` は、描くたびに作り直されるので、依存に入れない（枠・コメントの配列を、安定させる）
  const derived = useMemo(() => {
    if (!model) return { status: 'pending' as const, threads: EMPTY, regions: [] as RegionMark[] };
    if (!block) return { status: 'lost' as const, threads: EMPTY, regions: [] as RegionMark[] };
    const inBlock = threadsInBlock(
      model,
      block,
      (topicThreads ?? EMPTY).filter((t) => t.page === page),
    ).sort((a, b) => docOrder(model, a.id, b.id));
    const regions: RegionMark[] = [];
    for (const t of inBlock) {
      const loc = model.locs.get(t.id);
      const n = model.nums.get(t.id);
      if (loc?.kind === 'region' && loc.el === block && n !== undefined)
        regions.push({ tid: t.id, n, rect: loc.rect, resolved: t.resolved });
    }
    if (pendingRect) regions.push({ tid: 'pending', n: '新', rect: pendingRect, resolved: false });
    return {
      status: 'ok' as const,
      threads: [...inBlock.filter((t) => !t.resolved), ...inBlock.filter((t) => t.resolved)],
      regions,
    };
  }, [model, block, topicThreads, page, pendingRect]);

  return { view, model, block, canComment, ...derived };
}
