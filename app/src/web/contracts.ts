// W1（doc・overlay）・W2（panel）・W3（interact）が、公開する・使う関数の、型の契約。W0（`App.tsx`・`layout/`・`api/`・`store/`・`lib/`）が、これを使って、つなぐ。
// **この契約を変えるときは、W0（親）に頼む**（App.tsx の呼び方が変わる）。各スライスは、自分のディレクトリだけを書く。
//
// ## 旧 index.html の ID を、React が、同じように出す（旧 CSS・旧の確認手順を使い回すため）
//   #app > #top ／ #side ／ #doc（> #docbar ／ #docscroll（> #article ／ #badges ／ #regsel）／ #regbtn）／ #threads ／ #panel-resizer
//   #lightbox・#actbar（> #act-comment）・#toast・#submitdlg・#enddlg・#ended は、#app の外・または、固定の位置
//   W0 が出す：#app・#top・#side・#doc・#docbar・#docscroll・#panel-resizer・#toast・#submitdlg・#enddlg・#ended
//   W1 が出す：#article（Article）・#badges（Overlays）　W2 が出す：#threads・#lightbox（ThreadsPanel）　W3 が出す：#actbar・#regbtn・#regsel（Interact）
//
// ## 状態の持ち方
//   サーバーの状態：api/queries.ts（useTopics・useTopic・usePage）。部品は、props の `view` から読む（`useView()` でも、同じもの）。
//   画面の状態：store/ui.ts の `useUi`（読むのは selector・書くのは、そこのアクションだけ）。
//   本文の DOM への参照：store/doc.ts の `useDoc`（DocModel）。**書くのは Article だけ**。
//   操作（コメント・返信…）：api/mutations.ts の `useMutations()`。成功したら、トピックを、すぐ取り直す。失敗は、トースト。
//   トースト：`toast(msg, isErr?)`（store/ui.ts）。
import type { RefObject } from 'react';
import type { View } from './lib/view';

export type { View } from './lib/view';
export type { BlockRef, DiffSummary, DocModel, ThreadLoc } from './store/doc';
export type { ComposerState, UiState, UiStore } from './store/ui';

/**
 * 本文（`<article id="article" class="md">`）。**W1**：`doc/Article.tsx` が `export function Article(props: ArticleProps)` を出す。
 *
 * - 本文は、命令的な島：`<article>` は、子を持たない要素（ref つき）で出し、中身は、Markdown → 無害化 → ブロックの番号づけ → 形式・Mermaid・html-app → 差分 → 強調 の順で、
 *   DOM を作って `replaceChildren` する（`renderTok` で、古い非同期の完了を捨てる）。React は、中身を触らない。
 * - 描き直す条件（旧 `docSig`）：ページ・版・`showChanges`・このページのスレッドの（id・resolved・version・anchor の quote か blockHash）の変化。ポーリングの度には、描き直さない。
 * - 読む画面の状態（`useUi`）：`showChanges`（差分を出すか）・`composer`（入力中の対象を、本文で強調する。`DocModel.pending`）・`active`（`.hl.active`・`.blk-thread.active`）。
 *   `linkedTid` の `.linked` は、W3 の hoverLink が付ける（Article は、描き直しても、いま光っているものを、光ったままにする）。
 * - 描いたあと、`useDoc.getState().setModel(model)` で DocModel を入れる。アンマウントで `setModel(null)`。
 * - 描き直しの前後で、`#docscroll` の scrollTop を保つ。範囲を選んでいる途中（`regMode === 'selecting'`）で描き直すときは、`setRegMode('idle')`（旧 `cancelRegion`）。
 * - 描き直すとき、前のページの `view`・markdown で、新しいスレッドを使わない（App が、古い本文を、新しいのが届くまで見せ続けるが、props は、いつも、組になっている）。
 */
export interface ArticleProps {
  /** 見ているページ・版・トピック（スレッドは `view.topic.threads` のうち `page === view.page`） */
  view: View;
  /** `view.version` の本文 */
  markdown: string;
  /** `view.version - 1` の本文。v1 では null（差分を出さない） */
  prevMarkdown: string | null;
}

/**
 * 本文の外の層（`<div id="badges" aria-hidden="true">`）：番号の丸と、範囲の枠。**W1**：`overlay/Overlays.tsx` が `export function Overlays(props: OverlaysProps)` を出す。
 *
 * - `#docscroll`（`scrollRef`）の中の、絶対位置。DocModel（`useDoc`）の `locs`・`nums`・`blocks`・`pending` と、`useUi` の `composer`・`active`・`linkedTid` から作る。
 * - `view` が null・DocModel が null・`model.key !== view.key`（別のページの古い DocModel）なら、何も出さない。
 * - 置き直す契機：DocModel の変化・`ResizeObserver`（本文・`#docscroll`）・画像の読み込み・窓の大きさ・`useUi` の `ui`（左の一覧の開閉・右の幅）の変化。
 *   **`regDrag` が true の間は、置き直さない**（つかんでいる枠が消えるため）。
 * - 番号を押す：`openSolo(tid)`＋`focusThread`（旧と同じ）。枠のドラッグ：`setRegDrag(true/false)`（F31 の、枠の動き・大きさの変更の部分は、W1 と W3 が、すり合わせる）。
 */
export interface OverlaysProps {
  view: View | null;
  /** `#docscroll` */
  scrollRef: RefObject<HTMLElement | null>;
}

/**
 * 右のパネル（`<aside id="threads">`）。**W2**：`panel/ThreadsPanel.tsx` が `export function ThreadsPanel(props: ThreadsPanelProps)` を出す。
 * 旧 index.html の `#lightbox`（ライトボックス）も、ここ（W2）が出す（`useUi` の `lightbox`・`openLightbox`・`closeLightbox`）。
 *
 * - `view` が null なら、空の `<aside id="threads">`。
 * - 状態：`tab`・`solo`・`rowOpen`・`olderOpen`・`askOpen`・`drafts`・`imgGen`・`uploading`・`editing`・`seen`・`active`・`linkedTid`・`composer`（すべて `useUi`）。
 *   スレッドの順・番号・位置・近似の表示は、DocModel（`useDoc`）から。`solo` が、このページのスレッドにないときは、`closeSolo()`。
 * - 操作は `useMutations()`：成功したら、`onOk` で下書きを消し、そのあと、自動で取り直す。回答の保存・取り消しは、`answer`（`answer: null` で取り消し）。
 * - 描き直しても、入力欄のフォーカス・選択範囲・パネルのスクロールを戻す。
 */
export interface ThreadsPanelProps {
  view: View | null;
}

/**
 * 本文の選択・ブロックのホバー・範囲選択。**W3**：`interact/Interact.tsx` が `export function Interact(props: InteractProps)` を出す。
 * App は、`<main id="doc">` の中の、`#docscroll` の次に置く。出すもの：`#actbar`（`#act-comment`・固定の位置）・`#regbtn`（右下に浮かぶ「範囲を選ぶ」）・
 * `#regsel`（範囲選択の枠。`#docscroll` の中の絶対位置なので、`createPortal(…, scrollRef.current)`）。
 *
 * - `view` が null か、最新版でない（`!view.isLatest`）間は、`#regbtn` を出さない。コメントの入口は、最新版にだけ。
 * - 入力欄を開く：`useUi.getState().startComposer(anchor)`（最新版でなければ、トーストを出して false）。開いたら、入力欄の `textarea[data-key="composer"]` にフォーカスを移す・選択を外す・バーを隠す。
 * - 範囲を選ぶ状態：`regMode`（'idle' | 'selecting'）。Esc の順：範囲選択のキャンセル → 範囲の枠をドラッグ中（`regDrag`）なら元に戻す → それ以外は、ライトボックス（`lightbox`）を閉じる。
 * - 画像化・添付：`useMutations().attach`。`beginUpload`・`endUpload`・`setComposerRegionImg(composer.id, name)`（入力欄が、同じ id のままのときだけ）。
 * - カードと本文の、お互いの光り：`setLinked(tid)`（`linkedTid`）。
 * - 左の一覧・右の幅が変わる（`useUi` の `ui`）と、配置が変わるので、入口のバーは、隠す。
 */
export interface InteractProps {
  view: View | null;
  /** `#docscroll` */
  scrollRef: RefObject<HTMLElement | null>;
}

/**
 * 関連の線（`<svg id="links" aria-hidden="true">`）。**W1**：`overlay/Connectors.tsx` が `export function Connectors(props: ConnectorsProps)` を出す。
 * App は、`#app` の外（`#toast` の前）に置く。画面に固定・押せない。本文（`#article`）の DOM には、何も足さない。
 *
 * - 右のパネルに、カードとして出ているスレッド（`#threads .thread[data-tid]`・入力欄 `.thread.composer`）だけを、本文の対象と結ぶ。端点は、実測（`getBoundingClientRect`）。
 * - 読む画面の状態（`useUi`）：`ui.links`（false なら、何も出さない・リスナーも張らない）・`active`・`linkedTid`・`tab`・`solo`・`composer`・`ui`（左の一覧・右の幅）。
 * - `view` が null・DocModel が null・`model.key !== view.key` なら、線は 0 本。
 */
export interface ConnectorsProps {
  view: View | null;
  /** `#docscroll` */
  scrollRef: RefObject<HTMLElement | null>;
}
