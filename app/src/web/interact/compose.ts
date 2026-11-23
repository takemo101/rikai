// 入力欄（新しいコメント）を開く：対象を入れ、入力欄にフォーカスを移し、本文の選択を外す（旧 `startComposer`）。
import type { Anchor } from '../../shared/types';
import { type ComposerState, useUi } from '../store/ui';

/** 要素が現れるまで（右のパネルが、描き直すまで）、数フレーム待って、見つけたら渡す */
function whenFound(selector: string, then: (el: HTMLElement) => void, frames = 20): void {
  const el = document.querySelector<HTMLElement>(selector);
  if (el) then(el);
  else if (frames > 0) requestAnimationFrame(() => whenFound(selector, then, frames - 1));
}

/**
 * 入力欄を、この対象で開く。最新版でなければ、トーストを出して（ストアが）、null。
 * 開いたら、入力欄の textarea にフォーカスを移し、入力欄のカードを見える所へ動かし、文の選択を外す
 */
export function openComposer(anchor: Anchor, seed?: string): ComposerState | null {
  if (!useUi.getState().startComposer(anchor, seed)) return null;
  whenFound('textarea[data-key="composer"]', (ta) => ta.focus());
  whenFound('.thread.composer', (card) => card.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  getSelection()?.removeAllRanges();
  return useUi.getState().composer;
}
