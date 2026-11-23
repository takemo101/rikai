// 画面の状態（旧 app.js の `S` と、モジュールの `let` のうち、サーバーの状態でないもの）。サーバーの状態は、api/queries.ts（TanStack Query）。
// **書き込みは、ここの関数だけ**（部品が、状態を直接書き換えない）。値は、書き換えず、作り直す（selector で、変化を見分けるため）。
// localStorage：`rikai-seen`（seen）・`rikai-ui`（ui）。読み書きは lib/storage.ts。
//
// 旧の `S` との対応：composer・active・showChanges・drafts・imgGen・uploading・editing・seen・olderOpen・askOpen・tab・rowOpen・solo は、同じ名前。
// 旧の `linkedTid`（モジュールの let）・`regState`（範囲を選んでいる間）・`S.regDrag` は、linkedTid・regMode・regDrag。
// サーバーの状態（topics・topic・md・offline・error）と、導出（page・version）は、ここにない（queries.ts・lib/view.ts）。
// 本文の DOM を指すもの（locs・nums・approx・pendingEl・regions・blkBadges…）は、store/doc.ts の DocModel。
import { create } from 'zustand';
import { FRAME_IMAGE_LINE, FRAME_IMAGE_NOTE, FROM_FRAME_IMAGE } from '../../shared/htmlapp-bridge';
import type { Anchor, Thread } from '../../shared/types';
import { loadSeen, loadUi, saveSeen, saveUi, type UiPrefs } from '../lib/storage';
import { applyTheme, type ThemeMode } from '../lib/theme';
import { getView } from '../lib/view';

export type Tab = 'live' | 'done' | 'all';
export type RegMode = 'idle' | 'selecting';
/** 個別表示（F43）のステージの道具。`region`：画像・図・枠の上で、範囲をドラッグで選んでいる（Esc で中止）。要素を選ぶ道具（html-app）は、橋が持つ（`appBridge.ts`） */
export type FocusTool = 'idle' | 'region';
export type DialogKind = 'submit' | 'end';

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
  /** 枠から来た情報（要素・状態）で、本文に入れた初期値（F42）。対象を選び直したとき、利用者が書き足していなければ、これを入れ替える */
  seed?: string;
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
  /** `seed`：本文の初期値（html-app の枠から来た情報。F42）。書きかけがあれば、空行をあけて、あとに足す */
  startComposer: (anchor: Anchor, seed?: string) => boolean;
  /** 入力欄を閉じる（やめる・送った・別のページへ移った）：対象・書きかけの文・画像を消し、画像の世代を進める */
  /** 範囲の画像に、枠自身が作った画像が入った：錨のラベルに注記・本文の先頭に 1 行（F42）。その入力欄が、まだ開いているときだけ */
  noteFrameImage: (composerId: number) => void;
  closeComposer: () => void;
  /** 対象だけを、閉じる（書きかけの文・画像は、残す。ページ内のリンクを押したとき：旧と同じ） */
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

    startComposer: (anchor, seed) => {
      if (!getView()?.isLatest) {
        get().showToast('コメントは最新版にだけ付けられます', true);
        return false;
      }
      const { composer, drafts } = get();
      const prevCrop = composer?.regionImg;
      const imgs = prevCrop
        ? { ...drafts.imgs, composer: (drafts.imgs.composer ?? []).filter((n) => n !== prevCrop) }
        : drafts.imgs;
      // 本文：前の枠からの初期値（`composer.seed`）が、そのままなら、新しい対象のものに入れ替える（別の対象に、前の枠の情報が残らない）。書き足していれば、書きかけを残す
      const prev = drafts.composer === composer?.seed ? '' : drafts.composer;
      const text = seed ? (prev.trim() ? `${prev.replace(/\s+$/, '')}\n\n${seed}` : seed) : prev;
      set({
        composer: { id: ++composerSeq, anchor, ...(seed ? { seed } : {}) },
        drafts: { ...drafts, composer: text, imgs },
      });
      return true;
    },
    noteFrameImage: (composerId) =>
      set((s) => {
        const c = s.composer;
        if (!c || c.id !== composerId || c.anchor.label.includes(FRAME_IMAGE_NOTE)) return s;
        const label = `${c.anchor.label.slice(0, 120 - FRAME_IMAGE_NOTE.length)}${FRAME_IMAGE_NOTE}`;
        const text = s.drafts.composer.startsWith(FROM_FRAME_IMAGE)
          ? s.drafts.composer
          : `${FRAME_IMAGE_LINE}${s.drafts.composer}`;
        return { composer: { ...c, anchor: { ...c.anchor, label } }, drafts: { ...s.drafts, composer: text } };
      }),
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
    leaveTopic: () => patchDrafts({ imgs: {} }),

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

/** React の外から、トーストを出す（旧 `toast()`） */
export const toast = (msg: string, err = false): void => useUi.getState().showToast(msg, err);
