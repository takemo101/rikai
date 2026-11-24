// スライス B：右のパネルの選択（選んでいるスレッド・光り・タブ・開いている行・「見た」の印）。ほかのスライスを知らない。
import type { StateCreator } from 'zustand';
import type { Thread } from '../../../shared/types';
import { loadSeen, saveSeen } from '../../lib/storage';
import type { UiStore } from '../createUi';

export type Tab = 'live' | 'done' | 'all';

export interface SelectState {
  /** 選んでいる（光らせている）スレッド */
  active: string | null;
  /** `focusThread` が呼ばれるたびに増える連番（同じスレッドを、もう一度選んでも、パネルが、カードを見える所へ戻すため） */
  focusSeq: number;
  /** カードと本文の印が、お互いに光っているスレッド（マウスを置いたもの） */
  linkedTid: string | null;
  /** 「前の版からの変更を表示」 */
  showChanges: boolean;
  /** 見た AI のメッセージの ID（localStorage `rikai-seen`） */
  seen: ReadonlySet<string>;
  /** 「これまでのやり取り」を開いているもの（キー：`<スレッド ID>:<最初のメッセージ ID>`） */
  olderOpen: ReadonlySet<string>;
  /** 答えないまま会話が進んだ質問を、「答える」で開いたもの（質問のメッセージ ID） */
  askOpen: ReadonlySet<string>;
  /** 右のパネルの切り替え：未解決・解決済み・すべて */
  tab: Tab;
  /** 解決済みの 1 行を、押して開いたスレッド */
  rowOpen: ReadonlySet<string>;
  /** 本文の番号を押して、そのカードだけを見ているスレッド */
  solo: string | null;
}

export interface SelectActions {
  setActive: (tid: string | null) => void;
  setLinked: (tid: string | null) => void;
  /** スレッドを選ぶ：解決済みなら、一覧の中で開く・active にする・その AI のメッセージを、見たことにする（本文・カードの DOM の操作は、呼ぶ側） */
  focusThread: (thread: Pick<Thread, 'id' | 'resolved' | 'messages'>) => void;
  markSeen: (ids: readonly string[]) => void;
  setShowChanges: (on: boolean) => void;
  setTab: (tab: Tab) => void;
  setOlderOpen: (key: string, open: boolean) => void;
  openAsk: (mid: string) => void;
  setRowOpen: (tid: string, open: boolean) => void;
  /** 番号を押して、そのカードだけを見る */
  openSolo: (tid: string) => void;
  closeSolo: () => void;
}

export type SelectSlice = SelectState & SelectActions;

export function initialSelect(): SelectState {
  return {
    active: null,
    focusSeq: 0,
    linkedTid: null,
    showChanges: true,
    seen: loadSeen(),
    olderOpen: new Set(),
    askOpen: new Set(),
    tab: 'live',
    rowOpen: new Set(),
    solo: null,
  };
}

/** カードと本文の光りを、消す（次の状態だけを返す。ほかのスライスの操作が、自分の `set` に合成する） */
export const unlinkThread = (): Pick<SelectState, 'linkedTid'> => ({ linkedTid: null });

const withMember = (set: ReadonlySet<string>, v: string, on: boolean): ReadonlySet<string> => {
  if (set.has(v) === on) return set;
  const next = new Set(set);
  if (on) next.add(v);
  else next.delete(v);
  return next;
};

export const createSelectSlice: StateCreator<UiStore, [], [], SelectSlice> = (set, get) => {
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
    ...initialSelect(),

    setActive: (active) => set({ active }),
    setLinked: (linkedTid) => set({ linkedTid }),
    focusThread: (thread) => {
      const s = get();
      const patch: Partial<SelectState> = { active: thread.id, focusSeq: s.focusSeq + 1 };
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
    setTab: (tab) => set({ tab }),
    setOlderOpen: (key, open) => set((s) => ({ olderOpen: withMember(s.olderOpen, key, open) })),
    openAsk: (mid) => set((s) => ({ askOpen: withMember(s.askOpen, mid, true) })),
    setRowOpen: (tid, open) => set((s) => ({ rowOpen: withMember(s.rowOpen, tid, open) })),
    openSolo: (solo) => set({ solo }),
    closeSolo: () => set({ solo: null }),
  };
};
