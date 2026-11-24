// 実行できる枠（html-app）の置き場に、隔離した iframe を入れる。
import type { PickInfo } from '../../shared/htmlapp-bridge';
import { followsTheme } from '../../shared/htmlapp-theme';
import { $$, h } from '../lib/dom';
import type { FrameWidth } from '../lib/frameWidth';
import { type ResolvedTheme, resolvedTheme } from '../lib/theme';
import type { View } from '../lib/view';
import { mountToolbar } from './AppToolbar';
import { registerFrame } from './frameBridge';
import { compareFrameState, initialFrameState } from './frameState';

/** 自動の高さの枠の、最初の高さ（px）。中身の知らせ（frameBridge.ts）が届くまで */
const AUTO_INITIAL_HEIGHT = 200;

export interface AppsContext {
  view: View;
  /** 「この枠にコメント」を押した。枠（`.htmlapp`）を渡す。なければ、ボタンを出さない（版を並べて比べる画面：`compare`） */
  onComment?: (box: HTMLElement) => void;
  /** 利用者が、枠の中の要素を選んだ（検査済み）。枠（`.htmlapp`）・要素の情報・その枠の最新の状態（JSON）を渡す */
  onPick?: (box: HTMLElement, pick: PickInfo, stateJson: string | null) => void;
  /** 「個別表示」を押した（F43）。枠（`.htmlapp`）を渡す */
  onFocus?: (box: HTMLElement) => void;
  /**
   * 版を並べて比べる画面の枠（F44）：**読み取り専用**。個別のツールバー・「この枠にコメント」・要素を選ぶ入口を出さない（比較用ツールバーが、左右の枠に、まとめて効く）。
   * 最初の幅・外観は、`ui.compare` の選び（外観の null は、画面に従う）。幅・外観は、同じ版の中でも、覚えない（本文の枠の覚えと、混ぜない）。`label`：枠の名前に足す（「左」「右」）
   */
  compare?: { width: FrameWidth; mode: ResolvedTheme | null; label: string; onEsc: () => void };
}

/** 枠の置き場（`.htmlapp`）の、枠の仕様：番号・固定の高さ（`height=480`。なければ null＝自動）・資料のソース・画面の配色への対応。番号が読めなければ null */
export interface AppSpec {
  n: number;
  fixed: number | null;
  source: string;
  follows: boolean;
}

export function appSpecOf(box: HTMLElement): AppSpec | null {
  const n = Number(box.dataset.n);
  if (!Number.isInteger(n) || n < 0) return null;
  const fixed = Number(box.dataset.h);
  // 資料が、画面の配色への対応を示しているか（サーバーが、同じ判定で、土台・ダークへの追従を付ける：示さない従来の枠は、常にライト）
  const source = box.dataset.src ? safeDecodeStrict(box.dataset.src) : '';
  return { n, fixed: fixed > 0 ? fixed : null, source, follows: followsTheme(source) };
}

/**
 * 隔離した iframe と、その置き場（`.appview` > `.appscale` > iframe）。**sandbox は allow-scripts だけ**（allow-same-origin を付けない：オリジンのない文書になり、この画面に触れない。
 * ポップアップ・上の画面の移動・フォーム・ダウンロードも、できない）。allow は空（カメラ・位置情報・クリップボードなどを、渡さない）。src は、数だけから組み立てる。
 * 本文の枠と、個別表示（F43）の枠が、同じ形・同じ隔離で作る
 */
export function appFrameDom(
  view: View,
  n: number,
  fixed: number | null,
  mode: ResolvedTheme,
  opts: { title?: string; eager?: boolean } = {},
): { wrap: HTMLElement; iframe: HTMLIFrameElement } {
  // 高さ：`height=480`（数）は固定・それ以外は自動（枠の中身が知らせる：frameBridge.ts）。自動の最初の高さは、小さめ（知らせが届くまで）
  const ht = fixed === null ? AUTO_INITIAL_HEIGHT : Math.min(1200, Math.max(120, fixed));
  const iframe = h('iframe', {
    class: 'appframe',
    title: opts.title ?? `実行できる枠 ${n + 1}`,
    loading: opts.eager ? 'eager' : 'lazy',
    referrerpolicy: 'no-referrer',
    sandbox: 'allow-scripts',
    allow: '',
    src: `/appframe/${encodeURIComponent(view.slug)}/${encodeURIComponent(view.page)}/${view.version}/${n}?mode=${mode}`,
    height: String(ht),
  });
  // 枠の置き場：`.appview`（本文の幅の基準。縮小しきれないときは、横にスクロール）> `.appscale`（縮小後の大きさを持つ箱）> iframe。選んだ幅が、本文より広いときは、縮小して見せる（frameBridge.ts）。登録は、画面に付けたあと（幅を測る）
  return { wrap: h('div', { class: 'appview' }, h('div', { class: 'appscale' }, iframe)), iframe };
}

/**
 * 枠の置き場に、隔離した iframe を入れる。
 */
export function fillApps(container: ParentNode, ctx: AppsContext): void {
  const { view } = ctx;
  // 古いサーバー（0.8 以前）は、/appframe を持たず、画面の CSP も古い。枠は、灰色の四角になるので、説明を出す
  const live = view.topic.appframe === true;
  for (const box of $$('.htmlapp', container)) {
    const spec = appSpecOf(box);
    if (!spec) continue;
    const { n, fixed, source, follows } = spec;
    const auto = fixed === null;
    // 枠の中は、別の文書なので、枠の上では、入口のバーが出ない（マウスの動きが、画面に届かない）。見出しの行に、幅・外観のツールバーと、コメントのボタンを置く
    const cap = box.querySelector('.cap');
    if (live) {
      // 外観は、画面のいまの外観（`?mode=`）。同じ版の中で覚えている、枠だけの外観・幅があれば、それ
      const cmp = ctx.compare;
      const state = cmp
        ? compareFrameState(cmp.width, cmp.mode, resolvedTheme(), follows)
        : initialFrameState(view.key, n, resolvedTheme(), follows);
      const { wrap, iframe } = appFrameDom(
        view,
        n,
        fixed,
        state.mode,
        cmp ? { title: `${cmp.label}の実行できる枠 ${n + 1}` } : {},
      );
      box.append(wrap);
      const frame = registerFrame(
        iframe,
        n,
        auto,
        follows,
        state,
        cmp
          ? { remember: false, onEsc: cmp.onEsc }
          : { onPick: (pick, stateJson) => ctx.onPick?.(box, pick, stateJson) },
      );
      if (cap && !cmp) {
        const tools = h('span', { class: 'apptools', role: 'group', 'aria-label': '枠の表示（幅・外観）' });
        cap.append(' ', tools);
        mountToolbar(tools, frame, ctx.onFocus ? () => ctx.onFocus?.(box) : undefined, !view.readOnly);
      }
    } else {
      box.append(
        h('div', {
          class: 'mm-err',
          text: 'この画面のサーバーが古いため、枠を動かせません。`rikai stop` のあと、`rikai open` で開き直してください。',
        }),
      );
    }
    const onComment = ctx.onComment;
    if (cap && view.isLatest && !view.readOnly && onComment && !ctx.compare)
      cap.append(' ', h('button', { class: 'link', text: 'この枠にコメント', onclick: () => onComment(box) }));
    // 何が動くかを、見られるように（ソースは、文字として出す）。版が変わったときに、何が変わったか、確かめられる
    if (source)
      box.append(h('details', { class: 'appsrc' }, h('summary', { text: 'ソースを見る' }), h('pre', { text: source })));
  }
}

// 読めないものは、出さない（`safeDecode` は、読めないとき、そのまま返すので、使わない）
function safeDecodeStrict(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return '';
  }
}
