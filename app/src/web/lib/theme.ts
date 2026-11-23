// 外観のモード（F36）：ライト・ダーク・システム（OS に合わせる。既定）。選んだ値は、`rikai-ui` に保存する（lib/storage.ts）。
// 画面の色は、CSS の `color-scheme` と `light-dark()`（styles/app.css）で決める。ここは、`<html data-theme>` を付け外しするだけ：
//   light・dark：`data-theme` を付ける（OS の外観に関係なく、その外観）。system：付けない（OS に従う。OS の外観が変わっても、CSS だけで追従する）。
// Mermaid の図は、CSS では色を変えられないので、「いま、ライトか、ダークか」（`resolvedTheme`）を、ここで 1 か所で決め、変わったら（`subscribeResolved`）描き直す。
import { useSyncExternalStore } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export const DEFAULT_THEME: ThemeMode = 'system';
/** ボタンを押すと、この順に巡る */
export const THEME_ORDER: readonly ThemeMode[] = ['system', 'light', 'dark'];
export const THEME_LABEL: Record<ThemeMode, string> = { system: 'システム（自動）', light: 'ライト', dark: 'ダーク' };

/** 保存した値（知らない値は、既定に戻す） */
export const parseTheme = (v: unknown): ThemeMode =>
  v === 'light' || v === 'dark' || v === 'system' ? v : DEFAULT_THEME;

/** 次のモード（system → light → dark → system） */
export const nextTheme = (t: ThemeMode): ThemeMode =>
  THEME_ORDER[(THEME_ORDER.indexOf(t) + 1) % THEME_ORDER.length] as ThemeMode;

/** `<html>` に、モードを反映する（system は、属性なし） */
export function applyTheme(mode: ThemeMode, root: HTMLElement = document.documentElement): void {
  if (mode === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', mode);
}

const dark = (): MediaQueryList | null =>
  typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;

/** いま、描かれている外観（`data-theme` があればそれ・なければ OS の外観） */
export function resolvedTheme(root: HTMLElement = document.documentElement): ResolvedTheme {
  const t = root.getAttribute('data-theme');
  if (t === 'light' || t === 'dark') return t;
  return dark()?.matches ? 'dark' : 'light';
}

/** 解決した外観が変わりうるとき（`data-theme` の変更・OS の外観の変更）に、呼ぶ。外すと、監視をやめる */
export function subscribeResolved(cb: () => void, root: HTMLElement = document.documentElement): () => void {
  const mq = dark();
  mq?.addEventListener('change', cb);
  const mo = new MutationObserver(cb);
  mo.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  return () => {
    mq?.removeEventListener('change', cb);
    mo.disconnect();
  };
}

/** 解決した外観（React）。変わったら、描き直す */
export const useResolvedTheme = (): ResolvedTheme =>
  useSyncExternalStore(
    subscribeResolved,
    () => resolvedTheme(),
    () => 'light',
  );
