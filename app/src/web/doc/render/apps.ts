// 実行できる枠（html-app）の置き場に、隔離した iframe を入れる（旧 app.js の `fillApps`）。
import { followsTheme } from '../../../shared/htmlapp-theme';
import { $$, h } from '../../lib/dom';
import { resolvedTheme } from '../../lib/theme';
import type { View } from '../../lib/view';
import { mountToolbar } from '../AppToolbar';
import { initialFrameState, registerFrame } from '../appBridge';

/** 自動の高さの枠の、最初の高さ（px）。中身の知らせ（appBridge.ts）が届くまで */
const AUTO_INITIAL_HEIGHT = 200;

export interface AppsContext {
  view: View;
  /** 「この枠にコメント」を押した。枠（`.htmlapp`）を渡す */
  onComment: (box: HTMLElement) => void;
}

/**
 * 枠の置き場に、隔離した iframe を入れる。**sandbox は allow-scripts だけ**（allow-same-origin を付けない：オリジンのない文書になり、この画面に触れない。
 * ポップアップ・上の画面の移動・フォーム・ダウンロードも、できない）。allow は空（カメラ・位置情報・クリップボードなどを、渡さない）。src は、数だけから組み立てる
 */
export function fillApps(container: ParentNode, ctx: AppsContext): void {
  const { view } = ctx;
  // 古いサーバー（0.8 以前）は、/appframe を持たず、画面の CSP も古い。枠は、灰色の四角になるので、説明を出す
  const live = view.topic.appframe === true;
  for (const box of $$('.htmlapp', container)) {
    const n = Number(box.dataset.n);
    if (!Number.isInteger(n) || n < 0) continue;
    // 高さ：`height=480`（数）は固定・それ以外は自動（枠の中身が知らせる：appBridge.ts）。自動の最初の高さは、小さめ（知らせが届くまで）
    const fixed = Number(box.dataset.h);
    const auto = !(fixed > 0);
    const ht = auto ? AUTO_INITIAL_HEIGHT : Math.min(1200, Math.max(120, fixed));
    // 枠の中は、別の文書なので、枠の上では、入口のバーが出ない（マウスの動きが、画面に届かない）。見出しの行に、幅・外観のツールバーと、コメントのボタンを置く
    const cap = box.querySelector('.cap');
    // 資料が、画面の配色への対応を示しているか（サーバーが、同じ判定で、土台・ダークへの追従を付ける：示さない従来の枠は、常にライト）
    const source = box.dataset.src ? safeDecodeStrict(box.dataset.src) : '';
    const follows = followsTheme(source);
    if (live) {
      // 外観は、画面のいまの外観（`?mode=`）。同じ版の中で覚えている、枠だけの外観・幅があれば、それ
      const state = initialFrameState(view.key, n, resolvedTheme(), follows);
      const iframe = h('iframe', {
        class: 'appframe',
        title: `実行できる枠 ${n + 1}`,
        loading: 'lazy',
        referrerpolicy: 'no-referrer',
        sandbox: 'allow-scripts',
        allow: '',
        src: `/appframe/${encodeURIComponent(view.slug)}/${encodeURIComponent(view.page)}/${view.version}/${n}?mode=${state.mode}`,
        height: String(ht),
      });
      // 枠の置き場：`.appview`（本文の幅の基準。縮小しきれないときは、横にスクロール）> `.appscale`（縮小後の大きさを持つ箱）> iframe。選んだ幅が、本文より広いときは、縮小して見せる（appBridge.ts）。登録は、画面に付けたあと（幅を測る）
      const wrap = h('div', { class: 'appview' }, h('div', { class: 'appscale' }, iframe));
      box.append(wrap);
      const frame = registerFrame(iframe, n, auto, follows, state);
      if (cap) {
        const tools = h('span', { class: 'apptools', role: 'group', 'aria-label': '枠の表示（幅・外観）' });
        cap.append(' ', tools);
        mountToolbar(tools, frame);
      }
    } else {
      box.append(
        h('div', {
          class: 'mm-err',
          text: 'この画面のサーバーが古いため、枠を動かせません。`rikai stop` のあと、`rikai open` で開き直してください。',
        }),
      );
    }
    if (cap && view.isLatest)
      cap.append(' ', h('button', { class: 'link', text: 'この枠にコメント', onclick: () => ctx.onComment(box) }));
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
