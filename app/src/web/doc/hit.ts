// 本文の上のマウスが、どのコメントを指しているか（`regionTidAt`・`articleTid`）。`interact/hoverLink.ts` も使う。
import { $, $$ } from '../lib/dom';
import type { DocModel } from '../store/doc';

/**
 * 範囲の枠（押せない）の下を、マウスが通っているとき、その範囲のコメントを返す（重なるときは、小さい枠）。
 * 枠は押せないので、1 つの画像に複数の範囲があっても、それぞれのコメントに、ホバー・クリックが届くように、位置で探す
 */
export function regionTidAt(x: number, y: number): string | null {
  const layer = $('#badges');
  if (!layer) return null;
  let best: string | null = null;
  let area = Number.POSITIVE_INFINITY;
  for (const rb of $$('.regionbox:not(.pending)', layer)) {
    const r = rb.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom && r.width * r.height < area) {
      best = rb.dataset.tid ?? null;
      area = r.width * r.height;
    }
  }
  return best;
}

/** 本文の中のイベントが、どのコメントを指すか。なければ null。`model` は、範囲のコメントだけのブロックを見分ける（null なら、見分けない） */
export function articleTid(
  e: { target: EventTarget | null; clientX: number; clientY: number },
  model: DocModel | null = null,
): string | null {
  const t = regionTidAt(e.clientX, e.clientY);
  if (t) return t;
  if (!(e.target instanceof Element)) return null;
  // 入力中の強調（pending）の下にある、コメントの印を選ぶ。文中の数式（`.math-inline`）は、強調が、見えない元の文字（`.math-src`）に付くので、数式を押したときも、その強調を指す
  const el =
    e.target.closest<HTMLElement>('[data-tid]:not([data-tid="pending"])') ??
    e.target.closest('.math-inline')?.querySelector<HTMLElement>('mark[data-tid]:not([data-tid="pending"])') ??
    null;
  if (!el) return null;
  // 範囲のコメントだけのブロックは、範囲の外では、どのコメントにも当てない（最後の範囲に、飛ばない）
  if (model) {
    const here = [...model.locs.values()].filter((l) => (l.kind === 'block' || l.kind === 'region') && l.el === el);
    if (here.length && here.every((l) => l.kind === 'region')) return null;
  }
  return el.dataset.tid ?? null;
}
