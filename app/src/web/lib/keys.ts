// キー判定の共通部品。日本語などの変換中（IME）の Esc・Enter は、変換の確定・取り消しなので、閉じる・送る処理に渡さない（`keyCode 229` は、変換中の印）。
// Esc・Enter を処理するキーハンドラーを足すときは、必ず `isImeKey` を通す（1 か所でも漏れると、変換の取り消しで、画面が閉じる・文が送られる）。
// 枠の中（`server/appframe-bridge.ts`）の Esc は、別の文書で動くので、ここは使わない。

/** 変換中（IME）のキーか。React のイベントは、`e.nativeEvent` を渡す */
export const isImeKey = (e: Pick<KeyboardEvent, 'isComposing' | 'keyCode'>): boolean =>
  e.isComposing || e.keyCode === 229;

/** ⌘/Ctrl + Enter（変換中を除く）。React のイベントは、`e.nativeEvent` を渡す */
export const isModEnter = (
  e: Pick<KeyboardEvent, 'metaKey' | 'ctrlKey' | 'key' | 'isComposing' | 'keyCode'>,
): boolean => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && !isImeKey(e);
