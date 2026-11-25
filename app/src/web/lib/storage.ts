// このブラウザの localStorage に覚えるもの：`rikai-seen`（見た AI のメッセージの ID）・`rikai-ui`（左の一覧の開閉・右の幅と、利用者が決めた印・関連の線の表示・コメントの印の表示・外観のモード）・`rikai-send-hint`（送信後の案内を、見せたか）。
// サーバーには送らない（資料・コメントとは別）。壊れていたら既定のまま・保存できなくても使える。
import { DEFAULT_THEME, parseTheme, type ThemeMode } from './theme';

export const SEEN_KEY = 'rikai-seen';
export const UI_KEY = 'rikai-ui';
/** 「Claude Code 以外は…」の案内を、もう見せたか（初めての送信のあとの待ちだけ、見える文字で出す） */
export const SEND_HINT_KEY = 'rikai-send-hint';
/** 覚える ID の数（新しいほうから） */
export const SEEN_MAX = 2000;

export interface UiPrefs {
  sideOpen: boolean;
  panelW: number;
  /** 右の幅を、利用者が取っ手で決めたか（値でなく、印で持つ：380 を、わざと選んでも、「既定のまま」と見分けるため）。false は、既定のまま（1100px 以下では、細い既定 280 で出す）。古い保存（この印がない）は false */
  panelUser: boolean;
  /** コメントと本文の対象を結ぶ線（関連の線）を出すか */
  links: boolean;
  /** コメントの印（文の強調・ブロックの外枠・範囲の枠・番号の丸・関連の線。本文・拡大表示）を出すか。false の間は、入力中の対象の印（pending）以外を、出さない（html-app の中の操作を、印が邪魔しない）。旧い名前 `regionBoxes`（0.1.6）も読む */
  marks: boolean;
  /** 外観のモード（ライト・ダーク・システム） */
  theme: ThemeMode;
  /** ブラウザの通知（F41）を、使うか。既定はオフ。許可（Notification.permission）が granted でなければ、オンでも、オフとして扱う */
  notify: boolean;
}
export const PANEL_MIN = 280;
export const PANEL_DEFAULT = 380;
export const DEFAULT_UI: UiPrefs = {
  sideOpen: true,
  panelW: PANEL_DEFAULT,
  panelUser: false,
  links: true,
  marks: true,
  theme: DEFAULT_THEME,
  notify: false,
};

export function loadSeen(): Set<string> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]');
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

export function saveSeen(seen: ReadonlySet<string>): void {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-SEEN_MAX)));
  } catch {
    // 保存できなくても、使える
  }
}

export function loadSendHintSeen(): boolean {
  try {
    return localStorage.getItem(SEND_HINT_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveSendHintSeen(): void {
  try {
    localStorage.setItem(SEND_HINT_KEY, '1');
  } catch {
    // 保存できなくても、使える（毎回、出るだけ）
  }
}

export function loadUi(): UiPrefs {
  const ui = { ...DEFAULT_UI };
  try {
    const v: unknown = JSON.parse(localStorage.getItem(UI_KEY) ?? '{}');
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if (typeof o.sideOpen === 'boolean') ui.sideOpen = o.sideOpen;
      if (typeof o.links === 'boolean') ui.links = o.links;
      // 旧い名前（0.1.6：`regionBoxes`。範囲の枠だけを隠す設定だった）も読む。新しい名前があれば、そちら
      if (typeof o.marks === 'boolean') ui.marks = o.marks;
      else if (typeof o.regionBoxes === 'boolean') ui.marks = o.regionBoxes;
      if (typeof o.notify === 'boolean') ui.notify = o.notify;
      ui.theme = parseTheme(o.theme);
      if (typeof o.panelW === 'number' || typeof o.panelW === 'string') {
        const w = Number(o.panelW);
        if (w) {
          ui.panelW = w;
          if (typeof o.panelUser === 'boolean') ui.panelUser = o.panelUser; // 幅が読めたときだけ、印を信じる
        }
      }
    }
  } catch {
    // 壊れていたら、既定のまま
  }
  return ui;
}

export function saveUi(ui: UiPrefs): void {
  try {
    localStorage.setItem(UI_KEY, JSON.stringify(ui));
  } catch {
    // 保存できなくても、使える
  }
}
