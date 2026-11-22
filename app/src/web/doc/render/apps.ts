// 実行できる枠（html-app）の置き場に、隔離した iframe を入れる（旧 app.js の `fillApps`）。
import { $$, h } from '../../lib/dom';
import type { View } from '../../lib/view';

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
    const ht = Math.min(1200, Math.max(120, Number(box.dataset.h) || 360));
    // 枠の中は、別の文書なので、枠の上では、入口のバーが出ない（マウスの動きが、画面に届かない）。見出しの行に、コメントのボタンを置く
    const cap = box.querySelector('.cap');
    if (cap && view.isLatest)
      cap.append(' ', h('button', { class: 'link', text: 'この枠にコメント', onclick: () => ctx.onComment(box) }));
    if (live) {
      box.append(
        h('iframe', {
          class: 'appframe',
          title: `実行できる枠 ${n + 1}`,
          loading: 'lazy',
          referrerpolicy: 'no-referrer',
          sandbox: 'allow-scripts',
          allow: '',
          src: `/appframe/${encodeURIComponent(view.slug)}/${encodeURIComponent(view.page)}/${view.version}/${n}`,
          height: String(ht),
        }),
      );
    } else {
      box.append(
        h('div', {
          class: 'mm-err',
          text: 'この画面のサーバーが古いため、枠を動かせません。`rikai stop` のあと、`rikai open` で開き直してください。',
        }),
      );
    }
    // 何が動くかを、見られるように（ソースは、文字として出す）。版が変わったときに、何が変わったか、確かめられる
    const source = box.dataset.src ? safeDecodeStrict(box.dataset.src) : '';
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
