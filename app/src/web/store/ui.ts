// 画面の状態。サーバーの状態は、api/queries.ts（TanStack Query）。
// **書き込みは、ここの関数だけ**（部品が、状態を直接書き換えない）。値は、書き換えず、作り直す（selector で、変化を見分けるため）。
// localStorage：`rikai-seen`（seen）・`rikai-ui`（ui）。読み書きは lib/storage.ts。
//
// サーバーの状態（topics・topic・md・offline・error）と、導出（page・version）は、ここにない（queries.ts・lib/view.ts）。
// 本文の DOM を指すもの（locs・nums・approx・pendingEl・regions・blkBadges…）は、store/doc.ts の DocModel。
import { create } from 'zustand';
import { FRAME_IMAGE_NOTE } from '../../shared/htmlapp-bridge';
import type { Anchor, FrameMeta, Thread } from '../../shared/types';
import type { FrameWidth } from '../doc/appBridge';
import { defaultPair, isVersion } from '../lib/compare';
import { loadSeen, loadUi, saveSeen, saveUi, type UiPrefs } from '../lib/storage';
import { applyTheme, type ResolvedTheme, type ThemeMode } from '../lib/theme';
import { getView } from '../lib/view';

export type Tab = 'live' | 'done' | 'all';
export type RegMode = 'idle' | 'selecting';
/** 個別表示（F43）のステージの道具。`region`：画像・図・枠の上で、範囲をドラッグで選んでいる（Esc で中止）。要素を選ぶ道具（html-app）は、橋が持つ（`appBridge.ts`） */
export type FocusTool = 'idle' | 'region';
export type DialogKind = 'submit' | 'end';

/**
 * 版を並べて比べる（F44）の状態。開いている間だけある（null＝通常の表示）。**開閉・左右の版・比較用ツールバーの選びの、所有者は、ここだけ**（ルート〔ハッシュ〕には、持たない：
 * 版のルート `#/…/vN` は「見ている版」で、比較は、その上の一時の画面。再読み込みで閉じる。ページ・トピックを移ると、閉じる）。
 * `left`・`right`：比べる版（同じ版を左右に選んでもよい）。`width`・`mode`：左右のすべての枠に、まとめて効く幅・枠だけの外観（mode の null は、画面に従う）。
 * `changesOnly`：変更のない続きのブロックを、折りたたむ。
 * `from`：開く前の画面（閉じるとき、戻すために控える）：見ていた版の印（`View.key`）・本文のスクロール位置・入力欄（対象つき）・選んでいたスレッド
 */
export interface CompareState {
  left: number;
  right: number;
  width: FrameWidth;
  mode: ResolvedTheme | null;
  changesOnly: boolean;
  from: {
    key: string;
    scrollTop: number;
    composer: ComposerState | null;
    active: string | null;
    solo: string | null;
    /** `<トピック>/<ページ>`（版を含まない）：同じページか（対象を、新しい版で探し直せるか） */
    pageKey: string;
  };
}

/**
 * 個別表示の対象のブロックを、DocModel の中から探し直すための印（F43）。本文は、更新のたびに描き直されて、要素が作り直されるので、要素ではなく、内容で指す：
 * `id`・`hash` は、ブロックの `data-bid`・`data-bhash`。`src`：画像の `src` 属性（画像のブロックは、内容の文字がなく、ハッシュが、どれも同じになるので、見分ける）。
 * `base`：押された画像・図が、範囲の基準（`frameOf`：ブロックの最初の画像・図）か。範囲の比率は、基準に対するものなので、基準でないものでは、範囲を選べない
 */
export interface FocusRef {
  id: string;
  hash: string;
  src: string | null;
  base: boolean;
}

/**
 * ライトボックス（個別表示）に出すもの。img：画像（zoom: false は、コメントに添付した画像：押すと閉じる・F31。zoom: true は、本文・返信の画像：ズーム・移動ができる）。
 * svg：図（Mermaid・インラインの SVG）の複製（id を付け替え済み：lib/zoomSvg.ts）。ズーム・移動ができる。
 * app：html-app の枠（F43）。**新しい iframe を作る**（本文の枠は、動かさない）。`app`：枠の番号・固定の高さ（なければ自動）・配色への対応。
 * `focus`：本文（`#article`）のブロックを指す印（右のドックに、そのブロックのコメントを出し、範囲・要素のコメントを付けられる）。返信の中の画像・図には、ない（ステージだけ）
 */
export type LightboxTarget =
  | { kind: 'img'; src: string; alt: string; zoom: boolean; focus?: FocusRef }
  | { kind: 'svg'; node: SVGSVGElement; alt: string; size: { w: number; h: number }; focus?: FocusRef }
  | { kind: 'app'; alt: string; focus: FocusRef; app: { n: number; fixed: number | null; follows: boolean } };

/** コメントに添付した画像の、ライトボックスの名前 */
export const ATTACHED_ALT = '添付の画像（大きく）';

/** 入力欄（コメントの新規）の対象。id は、入力欄ごとに増える（遅れて終わる非同期の処理が、「同じ入力欄か」を見分ける） */
export interface ComposerState {
  id: number;
  anchor: Anchor;
  /** 範囲の切り出し画像を、自動で付けたときの名前（対象を選び直したとき、この画像だけを外す） */
  regionImg?: string;
  /** 枠から取った情報（F45）で、検査済み。この入力欄の対象（錨）のもの。コメントを追加するとき、メッセージの `frameMeta` として送る（本文には、書かない） */
  frameMeta?: FrameMeta;
  /**
   * 比べる画面（F44）を開いている間に新しい版が届いて、閉じたとき：入力欄を、いったん戻したが、対象が、新しい版の本文に**まだ見つかるか**を、本文を描いたあとに確かめる印
   * （見つかれば外す。見つからなければ、入力欄を閉じて、書きかけを「対象を失った下書き」にする：`loseComposerDraft`）
   */
  verify?: boolean;
}

/** 対象を失った下書き：書きかけの文・添付の画像の名前。**次に開く入力欄には、自動で入れない**（別の対象のコメントに付いてしまうため）。パネルの上に出して、利用者が、コピー・破棄を選ぶ */
export interface LostDraft {
  text: string;
  imgs: string[];
  /** 対象が戻せなかった理由（パネルの説明に出す） */
  reason: string;
}

/** 質問の、回答の下書き（選びかけ・書きかけ。保存した回答は、AskAnswer）。型ごとに、使う項目が違う */
export type AskDraft = Partial<{
  choice: string;
  other: string;
  choices: string[];
  value: boolean | number;
  text: string;
}>;

export interface Drafts {
  /** 新規コメントの書きかけ */
  composer: string;
  /** スレッド ID → 返信の書きかけ */
  reply: Record<string, string>;
  /** メッセージ ID → 編集の書きかけ */
  edit: Record<string, string>;
  /** 質問のメッセージ ID → 回答の下書き。キーがない＝まだ保存した回答から、作っていない・null＝回答なし */
  ask: Record<string, AskDraft | null>;
  /** 入力欄ごとの、添付した画像の名前（キー：`composer`・`reply-<スレッド ID>`）。送るまで、画面だけが持つ */
  imgs: Record<string, string[]>;
}

export interface ToastState {
  /** 表示ごとに増える（Toast が、自分の表示の消し時を、見分ける） */
  id: number;
  msg: string;
  err: boolean;
}

export interface UiState {
  /** 入力欄の対象。なければ null */
  composer: ComposerState | null;
  /** 選んでいる（光らせている）スレッド */
  active: string | null;
  /** `focusThread` が呼ばれるたびに増える連番（同じスレッドを、もう一度選んでも、パネルが、カードを見える所へ戻すため） */
  focusSeq: number;
  /** カードと本文の印が、お互いに光っているスレッド（マウスを置いたもの） */
  linkedTid: string | null;
  /** 「前の版からの変更を表示」 */
  showChanges: boolean;
  /** 版を並べて比べる画面（F44）。開いていなければ null */
  compare: CompareState | null;
  /** 比べる画面を閉じて、本文を描き直したあとに、戻すスクロール位置（本文〔`Article`〕が、描き終えたら、1 度だけ受け取る）。なければ null */
  scrollRestore: number | null;
  /** 対象を失った下書き（なければ null）。1 件だけ持つ（続けて失ったときは、つなぐ） */
  lostDraft: LostDraft | null;
  drafts: Drafts;
  /** 入力欄のキー → 世代（やめる・送る・移るで進める。終わりが遅れたアップロードを、捨てるため） */
  imgGen: Record<string, number>;
  /** アップロード（と、範囲の画像化）の、実行中の数 */
  uploading: number;
  /** 入力欄のキー → その入力欄に付けている最中のアップロードの数（「アップロード中」を、その入力欄だけに出す。範囲の画像化は `composer`） */
  uploadingBy: Record<string, number>;
  /** 編集中のメッセージ ID */
  editing: string | null;
  /** 見た AI のメッセージの ID（localStorage `rikai-seen`） */
  seen: ReadonlySet<string>;
  /** 「これまでのやり取り」を開いているもの（キー：`<スレッド ID>:<最初のメッセージ ID>`） */
  olderOpen: ReadonlySet<string>;
  /** 答えないまま会話が進んだ質問を、「答える」で開いたもの（質問のメッセージ ID） */
  askOpen: ReadonlySet<string>;
  /** 右のパネルの切り替え：進行中・解決済み・すべて */
  tab: Tab;
  /** 解決済みの 1 行を、押して開いたスレッド */
  rowOpen: ReadonlySet<string>;
  /** 本文の番号を押して、そのカードだけを見ているスレッド */
  solo: string | null;
  /** 範囲を選んでいるか（右下の「範囲を選ぶ」を押したあと〜ドラッグを終えるまで） */
  regMode: RegMode;
  /** 範囲の枠（入力中の対象）を、ドラッグでつかんでいる間 true（番号の層を、作り直さない） */
  regDrag: boolean;
  /** 個別表示のステージの道具（範囲をドラッグで選んでいるか）。個別表示を開く・閉じるたびに、idle に戻る */
  focusTool: FocusTool;
  toast: ToastState | null;
  /** 画面の広さ（左の一覧の開閉・右の幅・関連の線。localStorage `rikai-ui`） */
  ui: UiPrefs;
  /** 自動で隠す窓（788px 未満）で、☰ で、左の一覧を、本文の上に重ねて（ドロワー）出しているか（保存しない。保存した `ui.sideOpen` は、書き換えない：F23(3)） */
  narrowSideOpen: boolean;
  /** 狭い窓（〜900px）で、取っ手で変えた右の幅（保存しない：リロード・窓を広げると、保存した幅に戻る。保存した `ui.panelW` は、書き換えない：F23(3)）。null は、保存した幅のまま */
  panelWNarrow: number | null;
  /** 開いているダイアログ（`<dialog>`。`confirm()` は使わない：F34） */
  dialog: DialogKind | null;
  /** ライトボックスで大きく見ているもの（添付の画像・本文の画像・図） */
  lightbox: LightboxTarget | null;
  /** サーバーからの通知（SSE：`api/events.ts`）がつながっている間 true。true の間は、1.5 秒ごとの取得（ポーリング）を止める（保険：切れたら、取得に戻る） */
  live: boolean;
}

export interface UiActions {
  // ---- 入力欄（コメントの新規） ----
  /** 最新版でなければ、トーストを出して、false。入力欄を開いた（対象を選び直した）ら、true。前の入力欄の切り出し画像は、外す。書きかけの文は、残す */
  /** `frameMeta`：枠から取った情報（html-app の枠。F45。検査済み）。**本文には書かない**（入力欄は、書きかけのまま）。前の入力欄の情報は、持ち越さない（置き換え・外れたときは、トーストで知らせる） */
  startComposer: (anchor: Anchor, frameMeta?: FrameMeta) => boolean;
  /** 範囲の画像に、枠自身が作った画像が入った：錨のラベルに注記・`frameMeta.imageFromFrame`（F42・F45）。その入力欄が、まだ開いているときだけ */
  noteFrameImage: (composerId: number) => void;
  /** 入力欄の、枠から取った情報だけを外す（錨・本文は残る。元に戻せない。トーストで知らせる） */
  removeFrameMeta: () => void;
  /** 入力欄を閉じる（やめる・送った・別のページへ移った）：対象・書きかけの文・画像を消し、画像の世代を進める */
  closeComposer: () => void;
  /** 対象だけを、閉じる（書きかけの文・画像は、残す。ページ内のリンクを押したとき） */
  dropComposerTarget: () => void;
  /** 範囲の切り出し画像を、付けた。入力欄が、同じもの（id）のときだけ */
  setComposerRegionImg: (composerId: number, name: string) => void;
  // ---- 選択・光り ----
  setActive: (tid: string | null) => void;
  setLinked: (tid: string | null) => void;
  /** スレッドを選ぶ：解決済みなら、一覧の中で開く・active にする・その AI のメッセージを、見たことにする（本文・カードの DOM の操作は、呼ぶ側） */
  focusThread: (thread: Pick<Thread, 'id' | 'resolved' | 'messages'>) => void;
  markSeen: (ids: readonly string[]) => void;
  setShowChanges: (on: boolean) => void;
  // ---- 下書き ----
  setComposerDraft: (text: string) => void;
  setReplyDraft: (tid: string, text: string) => void;
  setEditDraft: (mid: string, text: string) => void;
  clearEditDraft: (mid: string) => void;
  setAskDraft: (mid: string, draft: AskDraft | null) => void;
  clearAskDraft: (mid: string) => void;
  setEditing: (mid: string | null) => void;
  // ---- 画像 ----
  /** 付けた画像を足す（同じ名前は、足さない）。足したら true */
  addDraftImg: (key: string, name: string) => boolean;
  removeDraftImg: (key: string, name: string) => void;
  /** 入力欄の画像を、空にして、世代を進める（やめる・送る・別の対象へ移る） */
  resetImgs: (key: string) => void;
  /** `key`：付けている入力欄（なければ、全体の数だけ） */
  beginUpload: (key?: string) => void;
  endUpload: (key?: string) => void;
  /** 別のトピックへ移った：添付した画像は、そのトピックの assets/ にあるので、持ち越さない */
  leaveTopic: () => void;
  // ---- パネル ----
  setTab: (tab: Tab) => void;
  setOlderOpen: (key: string, open: boolean) => void;
  openAsk: (mid: string) => void;
  setRowOpen: (tid: string, open: boolean) => void;
  /** 番号を押して、そのカードだけを見る */
  openSolo: (tid: string) => void;
  closeSolo: () => void;
  // ---- 範囲 ----
  setRegMode: (mode: RegMode) => void;
  setRegDrag: (dragging: boolean) => void;
  setFocusTool: (tool: FocusTool) => void;
  // ---- トースト・ダイアログ・ライトボックス ----
  showToast: (msg: string, err?: boolean) => void;
  /** id の表示が、まだ出ているときだけ、消す */
  clearToast: (id: number) => void;
  openDialog: (kind: DialogKind) => void;
  closeDialog: () => void;
  /** コメントに添付した画像を、大きく出す（押すと閉じる） */
  openLightbox: (src: string) => void;
  /** 本文・返信の画像・図を、大きく出す（ズーム・移動ができる） */
  openZoom: (target: LightboxTarget) => void;
  closeLightbox: () => void;
  setLive: (live: boolean) => void;
  // ---- 版を並べて比べる（F44） ----
  /**
   * 開く：版が 2 つ以上あるページで、いま見ている版と、その 1 つ前（`defaultPair`）。開けたら true。`scrollTop`：本文のスクロール位置（閉じたら戻す）。
   * コメントの入力欄（対象つき）・選んでいるスレッドは、`compare.from` に控えて、いったん外す（書きかけの文・添付の画像は、そのまま残る）
   */
  openCompare: (scrollTop?: number) => boolean;
  /**
   * 閉じる。`restore`（既定 true）：開く前の入力欄の対象・選んでいたスレッド・スクロール位置を、戻す。**見ている版が同じとき（`View.key` が同じ。版の本文は変わらないので、対象は、まだ本文にある）だけ**
   * 戻す（ページ・トピックを移った・新しい版が届いて最新版が替わったときは、戻さない：書きかけの文・画像は、下書きとして残る）。別の入力欄が、すでに開いていれば、そちらを優先する
   */
  closeCompare: (restore?: boolean) => void;
  /** 戻すスクロール位置を、1 度だけ受け取る（受け取ると、なくなる） */
  takeScrollRestore: () => number | null;
  /**
   * 入力欄の対象を戻せなかった：入力欄を閉じ、書きかけの文・添付の画像を、`lostDraft` へ移す（`drafts` は空にする：**次に開く別の対象の入力欄に、入らない**）。
   * 利用者に、トーストで知らせる。文も画像もなければ、ただ閉じる。`reason`：「対象が、〜」に続く文
   */
  loseComposerDraft: (reason: string) => void;
  /** 戻した入力欄の対象が、新しい版の本文に見つかった：確かめの印（`verify`）を外す */
  confirmComposer: (id: number) => void;
  discardLostDraft: () => void;
  /**
   * 同じページの、見ている版が変わった：書きかけの入力欄を、黙って閉じない。**最新版へ**（新しい版が届いた）：入力欄を残し、対象が新しい本文に見つかるかを、描いたあとに確かめる（`verify`。F44 と同じ）。
   * **最新版でない版へ**（コメントは最新版にだけ付けられる）：対象を、「対象を失った下書き」へ移す（トーストで知らせる）。入力欄がなければ、何もしない
   */
  moveComposer: (toLatest: boolean) => void;
  /** 左右の版を選ぶ。存在しない版（0・最新版より後・整数でない）は、受けない */
  setCompareVersion: (side: 'left' | 'right', version: number) => void;
  setCompareWidth: (width: FrameWidth) => void;
  /** 枠だけの外観（null は、画面に従う）。画面の外観が変わると、null に戻る（`useFollowAppFrames`） */
  setCompareMode: (mode: ResolvedTheme | null) => void;
  setCompareChangesOnly: (on: boolean) => void;
  // ---- 画面の広さ ----
  /** 左の一覧を、しまう・出す。autoHidden（788px 未満の、自動で隠す窓）では、保存せず、本文の上に重ねて出す・しまう。広い窓では、保存して、重ねて出したものは、しまう */
  toggleSide: (autoHidden?: boolean) => void;
  /** 重ねて出した左の一覧（ドロワー）を、しまう */
  closeSideDrawer: () => void;
  /** 狭い窓で、取っ手で変えた右の幅（保存しない）。null で、保存した幅に戻す */
  setPanelWNarrow: (w: number | null) => void;
  /** 関連の線（コメントと本文の対象を結ぶ線）の、出す・隠す */
  toggleLinks: () => void;
  /** ブラウザの通知（F41）を、オン・オフにする（保存する）。許可を求めるのは、呼ぶ側（ベルの押下） */
  setNotify: (on: boolean) => void;
  /** 外観のモードを選ぶ（ライト・ダーク・システム）。`<html data-theme>` に反映して、保存する */
  setTheme: (mode: ThemeMode) => void;
  /** 右の幅を変える。save: false は、ドラッグの途中（離したとき、persistUi で保存する） */
  setPanelW: (w: number, opts?: { save?: boolean }) => void;
  persistUi: () => void;
}

export type UiStore = UiState & UiActions;

/** 状態の初期値（localStorage から、seen・ui を読む）。テストが、ストアを戻すのにも使う */
export function initialUi(): UiState {
  return {
    composer: null,
    active: null,
    focusSeq: 0,
    linkedTid: null,
    showChanges: true,
    compare: null,
    scrollRestore: null,
    lostDraft: null,
    drafts: { composer: '', reply: {}, edit: {}, ask: {}, imgs: {} },
    imgGen: {},
    uploading: 0,
    uploadingBy: {},
    editing: null,
    seen: loadSeen(),
    olderOpen: new Set(),
    askOpen: new Set(),
    tab: 'live',
    rowOpen: new Set(),
    solo: null,
    regMode: 'idle',
    regDrag: false,
    focusTool: 'idle',
    toast: null,
    ui: loadUi(),
    narrowSideOpen: false,
    panelWNarrow: null,
    dialog: null,
    lightbox: null,
    live: false,
  };
}

const withMember = (set: ReadonlySet<string>, v: string, on: boolean): ReadonlySet<string> => {
  if (set.has(v) === on) return set;
  const next = new Set(set);
  if (on) next.add(v);
  else next.delete(v);
  return next;
};

const without = <T>(rec: Record<string, T>, key: string): Record<string, T> => {
  if (!(key in rec)) return rec;
  const { [key]: _drop, ...rest } = rec;
  return rest;
};

let composerSeq = 0;
let toastSeq = 0;

export const useUi = create<UiStore>()((set, get) => {
  const patchDrafts = (p: Partial<Drafts>): void => set((s) => ({ drafts: { ...s.drafts, ...p } }));
  const resetImgs = (key: string): void =>
    set((s) => ({
      drafts: { ...s.drafts, imgs: { ...s.drafts.imgs, [key]: [] } },
      imgGen: { ...s.imgGen, [key]: (s.imgGen[key] ?? 0) + 1 },
    }));
  const markSeen = (ids: readonly string[]): void => {
    const seen = new Set(get().seen);
    let changed = false;
    for (const id of ids) {
      if (!seen.has(id)) {
        seen.add(id);
        changed = true;
      }
    }
    if (!changed) return;
    set({ seen });
    saveSeen(seen);
  };

  return {
    ...initialUi(),

    startComposer: (anchor, frameMeta) => {
      if (!getView()?.isLatest) {
        get().showToast('コメントは最新版にだけ付けられます', true);
        return false;
      }
      const { composer, drafts } = get();
      const prevCrop = composer?.regionImg;
      const imgs = prevCrop
        ? { ...drafts.imgs, composer: (drafts.imgs.composer ?? []).filter((n) => n !== prevCrop) }
        : drafts.imgs;
      // 本文（書きかけ）は、そのまま残す（枠から取った情報は、本文に書かない：F45）。枠から取った情報は、対象（錨）のもの：新しい対象に、前の対象の情報は持ち越さない。
      // 1 つの下書きに、持てるのは 1 組：置き換えた・外れたときは、トーストで知らせる
      const prevMeta = composer?.frameMeta;
      set({
        composer: { id: ++composerSeq, anchor, ...(frameMeta ? { frameMeta } : {}) },
        drafts: { ...drafts, imgs },
      });
      if (prevMeta && (prevMeta.pick || prevMeta.state !== undefined) && prevMeta !== frameMeta)
        get().showToast(
          frameMeta
            ? '枠から取った情報を、新しいものに置き換えました'
            : '前の対象の、枠から取った情報は、外しました（対象が変わったため）',
        );
      return true;
    },
    noteFrameImage: (composerId) =>
      set((s) => {
        const c = s.composer;
        if (!c || c.id !== composerId || c.frameMeta?.imageFromFrame) return s;
        const noted = c.anchor.label.includes(FRAME_IMAGE_NOTE);
        const label = noted
          ? c.anchor.label
          : `${c.anchor.label.slice(0, 120 - FRAME_IMAGE_NOTE.length)}${FRAME_IMAGE_NOTE}`;
        return {
          composer: {
            ...c,
            anchor: { ...c.anchor, label },
            frameMeta: { ...c.frameMeta, imageFromFrame: true as const },
          },
        };
      }),
    removeFrameMeta: () => {
      const c = get().composer;
      if (!c?.frameMeta) return;
      const { frameMeta: _drop, ...rest } = c;
      set({ composer: rest });
      get().showToast('枠から取った情報を外しました（元には戻せません）。コメントの対象と本文は、そのままです');
    },
    closeComposer: () => {
      set((s) => ({ composer: null, drafts: { ...s.drafts, composer: '' } }));
      resetImgs('composer');
    },
    dropComposerTarget: () => set({ composer: null }),
    setComposerRegionImg: (composerId, name) =>
      set((s) => (s.composer?.id === composerId ? { composer: { ...s.composer, regionImg: name } } : s)),

    setActive: (active) => set({ active }),
    setLinked: (linkedTid) => set({ linkedTid }),
    focusThread: (thread) => {
      const s = get();
      const patch: Partial<UiState> = { active: thread.id, focusSeq: s.focusSeq + 1 };
      // 解決済みを、本文から選んだ：一覧の中で、開いて見せる
      if (thread.resolved && !s.solo && (s.tab === 'live' || !s.rowOpen.has(thread.id))) {
        if (s.tab === 'live') patch.tab = 'all';
        patch.rowOpen = withMember(s.rowOpen, thread.id, true);
      }
      set(patch);
      markSeen(thread.messages.filter((m) => m.author === 'ai').map((m) => m.id));
    },
    markSeen,
    setShowChanges: (showChanges) => set({ showChanges }),
    openCompare: (scrollTop = 0) => {
      const v = getView();
      const pair = v ? defaultPair(v.version, v.latest) : null;
      if (!v || !pair) return false;
      const { composer, active, solo } = get();
      set({
        compare: {
          ...pair,
          width: 'auto',
          mode: null,
          changesOnly: false,
          from: { key: v.key, scrollTop, composer, active, solo, pageKey: `${v.slug}/${v.page}` },
        },
        composer: null,
        active: null,
        solo: null,
        regMode: 'idle',
        linkedTid: null,
      });
      return true;
    },
    closeCompare: (restore = true) => {
      const { compare } = get();
      if (!compare) return;
      const v = getView();
      const { composer, active, solo, scrollTop, key, pageKey } = compare.from;
      const sameKey = restore && v !== null && v.key === key;
      // 版が替わった（新しい版が届いた）が、同じページの最新版：対象を、新しい版の本文で探し直せる（描いたあとに確かめる：`verify`）
      const relocate = restore && !sameKey && v?.isLatest === true && `${v.slug}/${v.page}` === pageKey;
      const mine = get().composer === null; // 別の入力欄が、すでに開いていれば、そちらを優先
      set((s) => ({
        compare: null,
        scrollRestore: sameKey ? scrollTop : null,
        ...(sameKey
          ? {
              composer: s.composer ?? (v?.isLatest ? composer : null),
              active: s.active ?? active,
              solo: s.solo ?? solo,
            }
          : {}),
        ...(relocate && composer && mine ? { composer: { ...composer, verify: true } } : {}),
      }));
      // 対象を戻せない（別のページへ移った）：書きかけを、別の対象に付けない
      if (composer && mine && !sameKey && !relocate) get().loseComposerDraft('別のページにあります');
    },
    takeScrollRestore: () => {
      const r = get().scrollRestore;
      if (r !== null) set({ scrollRestore: null });
      return r;
    },
    loseComposerDraft: (reason) => {
      const { drafts, lostDraft } = get();
      const text = drafts.composer;
      const imgs = drafts.imgs.composer ?? [];
      get().closeComposer(); // 文・画像は、ここで空になる（次の入力欄に、残らない）
      if (!text.trim() && !imgs.length) return;
      set({
        lostDraft: {
          text: lostDraft ? `${lostDraft.text}\n\n${text}`.trim() : text,
          imgs: [...(lostDraft?.imgs ?? []), ...imgs.filter((n) => !lostDraft?.imgs.includes(n))],
          reason,
        },
      });
      get().showToast(`書きかけのコメントの対象が、${reason}。文は、下書きとして残しています`);
    },
    confirmComposer: (id) =>
      set((s) => (s.composer?.id === id && s.composer.verify ? { composer: { ...s.composer, verify: undefined } } : s)),
    discardLostDraft: () => set({ lostDraft: null }),
    moveComposer: (toLatest) => {
      const c = get().composer;
      if (!c) return;
      if (toLatest) set({ composer: { ...c, verify: true } });
      else get().loseComposerDraft('過去の版にあります');
    },
    setCompareVersion: (side, version) => {
      const v = getView();
      if (!v || !isVersion(version, v.latest)) return;
      set((s) => (s.compare ? { compare: { ...s.compare, [side]: version } } : s));
    },
    setCompareWidth: (width) => set((s) => (s.compare ? { compare: { ...s.compare, width } } : s)),
    setCompareMode: (mode) =>
      set((s) => (s.compare && s.compare.mode !== mode ? { compare: { ...s.compare, mode } } : s)),
    setCompareChangesOnly: (changesOnly) => set((s) => (s.compare ? { compare: { ...s.compare, changesOnly } } : s)),

    setComposerDraft: (text) => patchDrafts({ composer: text }),
    setReplyDraft: (tid, text) => set((s) => ({ drafts: { ...s.drafts, reply: { ...s.drafts.reply, [tid]: text } } })),
    setEditDraft: (mid, text) => set((s) => ({ drafts: { ...s.drafts, edit: { ...s.drafts.edit, [mid]: text } } })),
    clearEditDraft: (mid) => set((s) => ({ drafts: { ...s.drafts, edit: without(s.drafts.edit, mid) } })),
    setAskDraft: (mid, draft) => set((s) => ({ drafts: { ...s.drafts, ask: { ...s.drafts.ask, [mid]: draft } } })),
    clearAskDraft: (mid) => set((s) => ({ drafts: { ...s.drafts, ask: without(s.drafts.ask, mid) } })),
    setEditing: (editing) => set({ editing }),

    addDraftImg: (key, name) => {
      const cur = get().drafts.imgs[key] ?? [];
      if (cur.includes(name)) return false;
      set((s) => ({ drafts: { ...s.drafts, imgs: { ...s.drafts.imgs, [key]: [...cur, name] } } }));
      return true;
    },
    removeDraftImg: (key, name) =>
      set((s) => ({
        drafts: {
          ...s.drafts,
          imgs: { ...s.drafts.imgs, [key]: (s.drafts.imgs[key] ?? []).filter((n) => n !== name) },
        },
      })),
    resetImgs,
    beginUpload: (key) =>
      set((s) => ({
        uploading: s.uploading + 1,
        uploadingBy: key ? { ...s.uploadingBy, [key]: (s.uploadingBy[key] ?? 0) + 1 } : s.uploadingBy,
      })),
    endUpload: (key) =>
      set((s) => {
        const by = { ...s.uploadingBy };
        if (key) {
          const n = (by[key] ?? 0) - 1;
          if (n > 0) by[key] = n;
          else delete by[key];
        }
        return { uploading: Math.max(0, s.uploading - 1), uploadingBy: by };
      }),
    leaveTopic: () => {
      patchDrafts({ imgs: {} });
      set((s) => ({ lostDraft: s.lostDraft ? { ...s.lostDraft, imgs: [] } : null })); // 添付の画像は、そのトピックの assets/ にある
    },

    setTab: (tab) => set({ tab }),
    setOlderOpen: (key, open) => set((s) => ({ olderOpen: withMember(s.olderOpen, key, open) })),
    openAsk: (mid) => set((s) => ({ askOpen: withMember(s.askOpen, mid, true) })),
    setRowOpen: (tid, open) => set((s) => ({ rowOpen: withMember(s.rowOpen, tid, open) })),
    openSolo: (solo) => set({ solo }),
    closeSolo: () => set({ solo: null }),

    setRegMode: (regMode) => set({ regMode }),
    setRegDrag: (regDrag) => set({ regDrag }),
    setFocusTool: (focusTool) => set({ focusTool }),

    showToast: (msg, err = false) => set({ toast: { id: ++toastSeq, msg, err } }),
    clearToast: (id) => set((s) => (s.toast?.id === id ? { toast: null } : s)),
    openDialog: (dialog) => set({ dialog }),
    closeDialog: () => set({ dialog: null }),
    openLightbox: (src) => set({ lightbox: { kind: 'img', src, alt: ATTACHED_ALT, zoom: false } }),
    openZoom: (lightbox) => set({ lightbox, focusTool: 'idle' }),
    closeLightbox: () => set({ lightbox: null, focusTool: 'idle' }),
    setLive: (live) => set({ live }),

    toggleSide: (autoHidden = false) => {
      if (autoHidden) {
        set((s) => ({ narrowSideOpen: !s.narrowSideOpen }));
        return;
      }
      set((s) => ({ narrowSideOpen: false, ui: { ...s.ui, sideOpen: !s.ui.sideOpen } }));
      saveUi(get().ui);
    },
    closeSideDrawer: () => set({ narrowSideOpen: false }),
    setPanelWNarrow: (w) => set({ panelWNarrow: w }),
    setNotify: (on) => {
      set((s) => ({ ui: { ...s.ui, notify: on } }));
      saveUi(get().ui);
    },
    setTheme: (mode) => {
      applyTheme(mode);
      set((s) => ({ ui: { ...s.ui, theme: mode } }));
      saveUi(get().ui);
    },
    toggleLinks: () => {
      set((s) => ({ ui: { ...s.ui, links: !s.ui.links } }));
      saveUi(get().ui);
    },
    setPanelW: (w, opts) => {
      set((s) => ({ ui: { ...s.ui, panelW: w } }));
      if (opts?.save !== false) saveUi(get().ui);
    },
    persistUi: () => saveUi(get().ui),
  };
});

/** React の外から、トーストを出す */
export const toast = (msg: string, err = false): void => useUi.getState().showToast(msg, err);
