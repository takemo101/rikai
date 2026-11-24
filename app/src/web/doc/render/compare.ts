// 版を並べて比べる画面の本体（F44。命令的な島）。左右の版の Markdown を、**本文と同じ関数**（`mdToFragment`→`markBlocks`→`fillApps`→`fillMermaid`）で描き、
// ブロックを `matchBlocks`（F11 の対応づけ）で対応づけて、**ブロックごとの行**（左・右の 2 つの欄）に並べる。行の高さは、左右で揃う（空きは空白）ので、スクロールの同期は要らない。
// 読み取り専用：コメントの入口（`data-bid` を頼りにするもの・`#article` を見るもの）は、ここに付かない。枠（html-app）は、**読み取り専用の枠**（`fillApps` の `compare`）。
// 描き直しのたびに、いまの枠を、橋から外す（`releaseApps`）。
import { type BlockSig, diffText, matchBlocks } from '../../../shared/diff';
import { alignRows, groupSame, type Row, type RowStatus, type RowSummary, summarize } from '../../lib/compare';
import { h } from '../../lib/dom';
import type { FrameWidth } from '../../lib/frameWidth';
import type { ResolvedTheme } from '../../lib/theme';
import type { View } from '../../lib/view';
import type { BlockEl } from '../../store/doc';
import { type AppFrame, framesIn, releaseApps } from '../appBridge';
import { fillApps } from './apps';
import { blockEls, markBlocks, plainText, sigTag, tagLabel } from './blocks';
import { mdToFragment } from './markdown';
import { fillMermaid } from './mermaid';

/** 比べる片側：版の番号・本文（まだ・取れなかったときは null） */
export interface CompareSide {
  version: number;
  md: string | null;
}

export interface CompareInput {
  /** トピック・ページ（版は、`left`・`right` の版を使う） */
  view: View;
  left: CompareSide;
  right: CompareSide;
  /** 変更のない続きの行を、折りたたむ */
  changesOnly: boolean;
  /** 枠の最初の幅・外観（比較用ツールバーの選び。外観の null は、画面に従う） */
  frames: { width: FrameWidth; mode: ResolvedTheme | null };
  /** 枠の中で Esc が押された（枠から届いた、検査済みの知らせ）：枠の中にフォーカスがあると、親の Esc が、届かないので、閉じられるように */
  onEsc: () => void;
}

export interface CompareResult {
  summary: RowSummary;
  /** 変更が多すぎて、近さによる対応づけを、一部していない（`matchBlocks` の `limited`。そこは、追加と削除として並ぶ） */
  limited: boolean;
  /** 動く枠（html-app）が、左右のどちらかにあるか（比較用ツールバーを出す） */
  frames: readonly AppFrame[];
}

/** 比べるときの、1 つのブロック（行の 1 つの欄に入る）。`start`：番号つきの並びの項目の、通し番号（並びから 1 項目だけ取り出すので、番号を保つ） */
interface Unit {
  el: BlockEl;
  sig: BlockSig;
  start: number | null;
}

/** 本文の描き方は、`renderDoc` と同じ（無害化・ブロックの印）。ブロックを、本文の順に */
function unitsOf(md: string, slug: string): Unit[] {
  const frag = mdToFragment(md, { slug, kind: 'doc' });
  markBlocks(frag);
  const seen = new Map<Element, number>(); // 並びごとに、何項目目か（先に数える：取り出すと、並びから消える）
  return blockEls(frag).map((el) => {
    let start: number | null = null;
    const list = el.tagName === 'LI' ? el.parentElement : null;
    if (list) {
      const k = seen.get(list) ?? 0;
      seen.set(list, k + 1);
      start = (list instanceof HTMLOListElement ? list.start : 1) + k;
    }
    return { el, sig: { hash: el.dataset.bhash ?? '', tag: sigTag(el), text: plainText(el) }, start };
  });
}

/** 欄に入れる要素。並びの項目（li）は、並びの外枠（ul・ol。属性を引き継ぐ）の中に 1 つだけ入れて出す */
function nodeOf(u: Unit): Element {
  if (u.start === null) return u.el;
  const shell = u.el.parentElement?.cloneNode(false) as HTMLElement | undefined;
  if (!shell) return u.el;
  if (shell instanceof HTMLOListElement) shell.start = u.start;
  shell.append(u.el);
  return shell;
}

type Side = 'l' | 'r';

/** 状態の札の文字（色だけに頼らない）。左は、前の版にだけある・変わる前。右は、今の版にだけある・変わったあと */
function badgeOf(side: Side, status: RowStatus): string | null {
  if (status === 'added' && side === 'r') return '追加';
  if (status === 'removed' && side === 'l') return '削除';
  if (status === 'changed') return side === 'l' ? '変更前' : '変更後';
  return null;
}

/** 変更のあるブロックの、文字の差分。開いたときに、はじめて計算する（変更のブロックが多くても、開くまで、重い計算をしない） */
function diffDetails(a: string, b: string, note: string | null): HTMLElement {
  const body = h('div', { class: 'diff' }, note ? h('div', { class: 'diffnote', text: note }) : null);
  const d = h('details', { class: 'diffbox' }, h('summary', { text: '文字の差分（左 → 右）' }), body);
  let built = false;
  d.addEventListener('toggle', () => {
    if (!d.open || built) return;
    built = true;
    body.append(...diffText(a, b).map((o) => (o.t === 'eq' ? o.s : h(o.t === 'del' ? 'del' : 'ins', { text: o.s }))));
  });
  return d;
}

function sideView(view: View, version: number): View {
  return { ...view, version, isLatest: version === view.latest, key: `${view.slug}/${view.page}/${version}` };
}

export async function renderCompare(
  el: HTMLElement,
  input: CompareInput,
  isCurrent: () => boolean,
): Promise<CompareResult | null> {
  const { view, left, right } = input;
  const lu = left.md === null ? [] : unitsOf(left.md, view.slug);
  const ru = right.md === null ? [] : unitsOf(right.md, view.slug);
  const both = left.md !== null && right.md !== null;
  const matches = both
    ? matchBlocks(
        lu.map((u) => u.sig),
        ru.map((u) => u.sig),
      )
    : null;
  const rows = alignRows(matches, lu.length, ru.length);

  // 欄の見出し（狭い窓で、上下に並ぶときに、どちらの版か分かるように。幅の広い窓では、隠す）。「最新」などは、新しい版が届くたびに変わるので、ここには書かない（描き直さない）
  const tag = (side: Side): string => `${side === 'l' ? '左' : '右'} v${(side === 'l' ? left : right).version}`;
  const cell = (side: Side, row: Row): HTMLElement => {
    const idx = side === 'l' ? row.left : row.right;
    const u = idx === null ? null : (side === 'l' ? lu : ru)[idx];
    if (!u) return h('div', { class: `cmpcell cmpgap cmp${side}`, 'aria-hidden': 'true' });
    const badge = badgeOf(side, row.status);
    const kids: (Node | null)[] = [
      h('span', { class: 'cmpside', text: tag(side) }),
      badge ? h('span', { class: 'cmpbadge', text: badge }) : null,
      nodeOf(u),
    ];
    // 変更：文字の差分は、右の欄の下に（F11 と同じ、折りたたみ）
    const l = row.left === null ? undefined : lu[row.left];
    if (side === 'r' && row.status === 'changed' && l) {
      const note =
        l.sig.tag === u.sig.tag
          ? null
          : `ブロックの種類が変わりました：${tagLabel(l.sig.tag)} → ${tagLabel(u.sig.tag)}`;
      kids.push(diffDetails(l.sig.text, u.sig.text, note));
    }
    return h('div', { class: `cmpcell md cmp${side}`, 'data-status': row.status }, kids);
  };
  const rowEl = (row: Row): HTMLElement =>
    h('div', { class: 'cmprow', 'data-status': row.status }, cell('l', row), cell('r', row));

  const nodes: HTMLElement[] = input.changesOnly
    ? groupSame(rows).map((it) =>
        it.kind === 'row'
          ? rowEl(it.row)
          : h(
              'details',
              { class: 'cmpgroup' },
              h('summary', { text: `変更のないブロック ${it.rows.length} 件（押すと開きます）` }),
              it.rows.map(rowEl),
            ),
      )
    : rows.map(rowEl);

  releaseApps(el); // いまの枠（描き直しで消える）を、橋から外す
  el.replaceChildren(...nodes);
  for (const c of el.querySelectorAll<HTMLElement>('.cmpcell:not(.cmpgap)')) {
    if (!c.querySelector('.htmlapp')) continue;
    const s = c.classList.contains('cmpl') ? left : right;
    fillApps(c, {
      view: sideView(view, s.version),
      compare: { ...input.frames, label: c.classList.contains('cmpl') ? '左' : '右', onEsc: input.onEsc },
    });
  }
  await fillMermaid(el);
  if (!isCurrent()) return null;
  return { summary: summarize(rows), limited: matches?.limited ?? false, frames: framesIn(el) };
}
