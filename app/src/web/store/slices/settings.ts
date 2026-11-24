// スライス E：設定・一時の状態（画面の広さ・外観・通知・トースト・ダイアログ・SSE の接続）。ほかのスライスを知らない。
import type { StateCreator } from 'zustand';
import { loadUi, saveUi, type UiPrefs } from '../../lib/storage';
import { applyTheme, type ThemeMode } from '../../lib/theme';
import type { UiStore } from '../createUi';

export type DialogKind = 'submit' | 'end';

export interface ToastState {
  /** 表示ごとに増える（Toast が、自分の表示の消し時を、見分ける） */
  id: number;
  msg: string;
  err: boolean;
}

export interface SettingsState {
  toast: ToastState | null;
  /** 画面の広さ（左の一覧の開閉・右の幅・関連の線。localStorage `rikai-ui`） */
  ui: UiPrefs;
  /** 自動で隠す窓（1100px 以下）で、☰ で、左の一覧を、本文の上に重ねて（ドロワー）出しているか（保存しない。保存した `ui.sideOpen` は、書き換えない：F23(3)） */
  narrowSideOpen: boolean;
  /** 狭い窓（〜900px）で、取っ手で変えた右の幅（保存しない：リロード・窓を広げると、保存した幅に戻る。保存した `ui.panelW` は、書き換えない：F23(3)）。null は、保存した幅のまま */
  panelWNarrow: number | null;
  /** 開いているダイアログ（`<dialog>`。`confirm()` は使わない：F34） */
  dialog: DialogKind | null;
  /** サーバーからの通知（SSE：`api/events.ts`）がつながっている間 true。true の間は、1.5 秒ごとの取得（ポーリング）を止める（保険：切れたら、取得に戻る） */
  live: boolean;
}

export interface SettingsActions {
  showToast: (msg: string, err?: boolean) => void;
  /** id の表示が、まだ出ているときだけ、消す */
  clearToast: (id: number) => void;
  openDialog: (kind: DialogKind) => void;
  closeDialog: () => void;
  setLive: (live: boolean) => void;
  /** 左の一覧を、しまう・出す。autoHidden（1100px 以下の、自動で隠す窓）では、保存せず、本文の上に重ねて出す・しまう。広い窓では、保存して、重ねて出したものは、しまう */
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
  /** 右の幅を変える。save: false は、ドラッグの途中（離したとき、persistUi で保存する）。user: false は、「もとの幅」に戻す（利用者が決めた印を消す）。既定は、利用者が決めた幅（印を付ける） */
  setPanelW: (w: number, opts?: { save?: boolean; user?: boolean }) => void;
  persistUi: () => void;
}

export type SettingsSlice = SettingsState & SettingsActions;

export function initialSettings(): SettingsState {
  return { toast: null, ui: loadUi(), narrowSideOpen: false, panelWNarrow: null, dialog: null, live: false };
}

let toastSeq = 0;

export const createSettingsSlice: StateCreator<UiStore, [], [], SettingsSlice> = (set, get) => ({
  ...initialSettings(),

  showToast: (msg, err = false) => set({ toast: { id: ++toastSeq, msg, err } }),
  clearToast: (id) => set((s) => (s.toast?.id === id ? { toast: null } : s)),
  openDialog: (dialog) => set({ dialog }),
  closeDialog: () => set({ dialog: null }),
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
    set((s) => ({ ui: { ...s.ui, panelW: w, panelUser: opts?.user ?? true } }));
    if (opts?.save !== false) saveUi(get().ui);
  },
  persistUi: () => saveUi(get().ui),
});
