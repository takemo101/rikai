// 前の版との差分（旧 app.js の `diffPlan`・`addDiff`・`diffBox`）。ブロックの対応づけと、文字の差分は、`shared/diff.ts`。
import { type DiffOp, diffText, type MatchStatus, matchBlocks } from '../../../shared/diff';
import { h } from '../../lib/dom';
import type { DiffSummary } from '../../store/doc';
import { blockEls, blockLabel, markBlocks, plainText } from './blocks';
import { mdToFragment } from './markdown';

interface DiffPlan {
  statuses: MatchStatus[];
  ops: Map<number, DiffOp[]>;
  removed: string[];
}

interface PlanCache {
  key: string;
  md: string;
  prev: string;
  plan: DiffPlan;
}

// 同じ版どうしなら同じ結果なので、覚えておく（コメントの操作・スレッドの変更のたびに、前の版の描画と、対応づけを、やり直さない）
let cache: PlanCache | null = null;

export interface DiffSource {
  /** `<slug>/<page>/<version>` */
  key: string;
  slug: string;
  md: string;
  prevMd: string;
}

/** 差分の計画（ブロックの対応づけと、変更ブロックの文字の差分） */
function diffPlan(frag: DocumentFragment, src: DiffSource): DiffPlan {
  // 同じ版でも、中身（Markdown）が同じときだけ使う（ページを切り替えながら読み込む途中で、違う中身が、同じ印で入る競合に備える）
  if (cache && cache.key === src.key && cache.md === src.md && cache.prev === src.prevMd) return cache.plan;
  const prev = mdToFragment(src.prevMd, { slug: src.slug, kind: 'doc' }); // 前の版も、枠の置き場にする（今の版と、同じ形で比べるため。枠は、入れない）
  markBlocks(prev);
  const pe = blockEls(prev);
  const ce = blockEls(frag);
  const info = (els: HTMLElement[]) =>
    els.map((e) => ({ hash: e.dataset.bhash ?? '', tag: e.tagName, text: plainText(e) }));
  const pi = info(pe);
  const ci = info(ce);
  const m = matchBlocks(pi, ci);
  const ops = new Map<number, DiffOp[]>();
  m.cur.forEach((c, j) => {
    if (c.status === 'changed' && c.prev !== null) ops.set(j, diffText(pi[c.prev]?.text, ci[j]?.text));
  });
  // 文字のないブロック（画像だけの段落・区切り線）は、ラベルで見せる
  const removed = m.removed.map((i) => {
    const el = pe[i] as HTMLElement;
    return pi[i]?.text || blockLabel(el) || `（${el.tagName.toLowerCase()}）`;
  });
  const plan: DiffPlan = { statuses: m.cur.map((c) => c.status), ops, removed };
  cache = { key: src.key, md: src.md, prev: src.prevMd, plan };
  return plan;
}

function diffBox(ops: DiffOp[], tag: string): HTMLElement {
  const body = h(
    'div',
    { class: 'diff' },
    ops.map((o) => (o.t === 'eq' ? o.s : h(o.t === 'del' ? 'del' : 'ins', { text: o.s }))),
  );
  const details = h(
    'details',
    { class: tag === 'LI' ? '' : 'diffbox' },
    h('summary', { text: '前の版との差分' }),
    body,
  );
  return tag === 'LI' ? h('li', { class: 'diffbox' }, details) : details;
}

/** 前の版との差分を、frag（今の版のブロック）に足す。戻り値は、件数 */
export function addDiff(frag: DocumentFragment, src: DiffSource): DiffSummary {
  const plan = diffPlan(frag, src);
  const ce = blockEls(frag);
  const sum: DiffSummary = { changed: 0, added: 0, removed: plan.removed.length };
  // ブロックの後ろに箱を足すので、後ろのブロックから処理する（前から足すと、続くブロックの位置が動く）
  for (let j = ce.length - 1; j >= 0; j--) {
    const st = plan.statuses[j];
    const el = ce[j] as HTMLElement;
    if (st === 'same') continue;
    el.classList.add('changed');
    if (st === 'added') {
      sum.added++;
      el.classList.add('added');
      continue;
    }
    sum.changed++;
    el.after(diffBox(plan.ops.get(j) ?? [], el.tagName));
  }
  if (plan.removed.length) {
    frag.append(
      h(
        'details',
        { class: 'diffbox removed' },
        h('summary', { text: `前の版からなくなったブロック (${plan.removed.length})` }),
        plan.removed.map((text) => h('div', { class: 'diff' }, h('del', { text }))),
      ),
    );
  }
  return sum;
}
