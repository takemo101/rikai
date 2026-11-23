// 本文の描画（旧 app.js の `renderDoc`）。順番：Markdown → 無害化 → ブロックの番号づけ →（v2 以降）差分 → DOM の差し替え → html-app の枠 → Mermaid（非同期）→ 強調。
// 非同期の継ぎ目：Mermaid の完了を待つあいだに、別の描画が始まっていたら（`isCurrent()` が false）、ここで止める（古い描画に、強調を適用しない）。
import type { Anchor, Thread } from '../../../shared/types';
import type { View } from '../../lib/view';
import { type DocModel, nextEpoch } from '../../store/doc';
import { releaseApps } from '../appBridge';
import { type AppsContext, fillApps } from './apps';
import { markBlocks } from './blocks';
import { addDiff } from './diff';
import { applyHighlights, markPending } from './highlights';
import { mdToFragment } from './markdown';
import { fillMermaid } from './mermaid';

export interface RenderInput {
  view: View;
  markdown: string;
  /** 前の版の本文。v1 では null */
  prevMarkdown: string | null;
  showChanges: boolean;
  /** このページのスレッド */
  threads: readonly Thread[];
  /** 「この枠にコメント」を押した（枠を、コメントの対象にする） */
  onComment: (box: HTMLElement) => void;
  /** 利用者が、枠の中の要素を選んだ（枠から届いた、検査済みの情報。下書きを作る） */
  onPick?: AppsContext['onPick'];
  /** 描き終えたとき、入力中の対象（あれば）を、本文で強調するために読む（描いている間に、変わりうる） */
  pendingAnchor: () => Anchor | null;
}

/**
 * 本文を描く。`isCurrent()` が false になったら（別の描画が始まった）、null を返す。
 * 描いた結果は、DocModel（`setModel` は、呼ぶ側）。
 */
export async function renderDoc(
  art: HTMLElement,
  input: RenderInput,
  isCurrent: () => boolean,
): Promise<DocModel | null> {
  const { view } = input;
  const frag = mdToFragment(input.markdown, { slug: view.slug, kind: 'doc' });
  markBlocks(frag);
  const diff =
    input.showChanges && view.version > 1 && input.prevMarkdown != null
      ? addDiff(frag, { key: view.key, slug: view.slug, md: input.markdown, prevMd: input.prevMarkdown })
      : null;
  releaseApps(art); // いまの枠（描き直しで消える）を、橋から外す
  art.replaceChildren(frag);
  fillApps(art, { view, onComment: input.onComment, onPick: input.onPick });
  await fillMermaid(art);
  if (!isCurrent()) return null;
  const layout = applyHighlights(art, input.threads, view.version);
  const pending = markPending(art, input.pendingAnchor(), null);
  return { epoch: nextEpoch(), key: view.key, ...layout, pending, diff };
}
