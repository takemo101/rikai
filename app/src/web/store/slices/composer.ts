// スライス A：入力欄（コメントの新規）・下書き・添付した画像・対象を失った下書き。
// 入力欄の対象を、新しい版の本文で確かめる規則（`verify`：`moveComposer` が付け、本文を描いたあと `confirmComposer` が外す。見つからなければ `loseComposerDraft`）は、ここだけ。
// 他のスライスの操作は、トースト（`showToast`）だけを呼ぶ。`drafts` の形・`imgGen` の世代の規則（遅れて終わるアップロードを捨てる）は、ここだけが持つ。
import type { StateCreator } from 'zustand';
import { FRAME_IMAGE_NOTE } from '../../../shared/htmlapp-note';
import type { Anchor, FrameMeta } from '../../../shared/types';
import { READ_ONLY_REASON } from '../../lib/messages';
import type { UiStore } from '../createUi';
import type { UiDeps } from '../deps';

/** 入力欄（コメントの新規）の対象。id は、入力欄ごとに増える（遅れて終わる非同期の処理が、「同じ入力欄か」を見分ける） */
export interface ComposerState {
  id: number;
  anchor: Anchor;
  /** 範囲の切り出し画像を、自動で付けたときの名前（対象を選び直したとき、この画像だけを外す） */
  regionImg?: string;
  /** 枠から取った情報（F45）で、検査済み。この入力欄の対象（錨）のもの。コメントを追加するとき、メッセージの `frameMeta` として送る（本文には、書かない） */
  frameMeta?: FrameMeta;
  /**
   * 同じページの、見ている版が、最新版へ変わった（新しい版が届いた。版を並べて比べている間〔F44〕を含む）：入力欄を残したが、対象が、新しい版の本文に**まだ見つかるか**を、本文を描いたあとに確かめる印
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

export interface DraftState {
  /** 入力欄の対象。なければ null */
  composer: ComposerState | null;
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
}

export interface DraftActions {
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
  // ---- 対象を失った下書き・確かめ ----
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
}

export type DraftSlice = DraftState & DraftActions;

export function initialDraft(): DraftState {
  return {
    composer: null,
    lostDraft: null,
    drafts: { composer: '', reply: {}, edit: {}, ask: {}, imgs: {} },
    imgGen: {},
    uploading: 0,
    uploadingBy: {},
    editing: null,
  };
}

const without = <T>(rec: Record<string, T>, key: string): Record<string, T> => {
  if (!(key in rec)) return rec;
  const { [key]: _drop, ...rest } = rec;
  return rest;
};

let composerSeq = 0;

export const createDraftSlice =
  ({ getView }: UiDeps): StateCreator<UiStore, [], [], DraftSlice> =>
  (set, get) => {
    const patchDrafts = (p: Partial<Drafts>): void => set((s) => ({ drafts: { ...s.drafts, ...p } }));
    const resetImgs = (key: string): void =>
      set((s) => ({
        drafts: { ...s.drafts, imgs: { ...s.drafts.imgs, [key]: [] } },
        imgGen: { ...s.imgGen, [key]: (s.imgGen[key] ?? 0) + 1 },
      }));

    return {
      ...initialDraft(),

      startComposer: (anchor, frameMeta) => {
        const v = getView();
        if (v?.readOnly) {
          get().showToast(READ_ONLY_REASON, true);
          return false;
        }
        if (!v?.isLatest) {
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

      setComposerDraft: (text) => patchDrafts({ composer: text }),
      setReplyDraft: (tid, text) =>
        set((s) => ({ drafts: { ...s.drafts, reply: { ...s.drafts.reply, [tid]: text } } })),
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
        set((s) =>
          s.composer?.id === id && s.composer.verify ? { composer: { ...s.composer, verify: undefined } } : s,
        ),
      discardLostDraft: () => set({ lostDraft: null }),
      moveComposer: (toLatest) => {
        const c = get().composer;
        if (!c) return;
        if (toLatest) set({ composer: { ...c, verify: true } });
        else get().loseComposerDraft('過去の版にあります');
      },
    };
  };
