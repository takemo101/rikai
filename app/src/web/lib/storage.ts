// このブラウザの localStorage に覚えるもの：`rikai-seen`（見た AI のメッセージの ID）・`rikai-ui`（左の一覧の開閉・右の幅・関連の線の表示）。
// サーバーには送らない（資料・コメントとは別）。壊れていたら既定のまま・保存できなくても使える（旧 app.js と同じ）。

export const SEEN_KEY = 'rikai-seen';
export const UI_KEY = 'rikai-ui';
/** 覚える ID の数（新しいほうから） */
export const SEEN_MAX = 2000;

export interface UiPrefs {
  sideOpen: boolean;
  panelW: number;
  /** コメントと本文の対象を結ぶ線（関連の線）を出すか */
  links: boolean;
}
export const PANEL_MIN = 280;
export const PANEL_DEFAULT = 380;
export const DEFAULT_UI: UiPrefs = { sideOpen: true, panelW: PANEL_DEFAULT, links: true };

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

export function loadUi(): UiPrefs {
  const ui = { ...DEFAULT_UI };
  try {
    const v: unknown = JSON.parse(localStorage.getItem(UI_KEY) ?? '{}');
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if (typeof o.sideOpen === 'boolean') ui.sideOpen = o.sideOpen;
      if (typeof o.links === 'boolean') ui.links = o.links;
      if (typeof o.panelW === 'number' || typeof o.panelW === 'string')
        ui.panelW = Number(o.panelW) || DEFAULT_UI.panelW;
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
