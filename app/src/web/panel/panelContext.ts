// パネルの中の部品が、パネルに頼む操作（カードを押す・追加したコメントを見せる）。ThreadsPanel が、値を出す。
import { createContext, useContext } from 'react';

export interface PanelActions {
  /**
   * スレッドを選ぶ（旧 `focusThread`）：ストアの `focusThread`（選ぶ・解決済みなら一覧の中で開く・見たことにする）と、
   * `scrollDoc`：本文の対象を、画面の真ん中へ（カードの見出しを押したとき）。そうでなければ、カードを、パネルの見える所へ（一覧の行を押したとき・コメントを追加したとき）
   */
  focusThread: (tid: string, scrollDoc: boolean) => void;
  /**
   * コメントを追加した（サーバーが受けて、スレッドの取り直しも済んだ）。入力欄を閉じ・追加したカードを選び・1 枚だけ見ていても、一覧へ戻す（旧と同じ）。
   * **追加したカードが、画面に届いたとき**に、まとめてする：先に入力欄を閉じると、パネルが、一瞬、短くなって、スクロールの位置が、詰められる
   */
  afterComment: (tid: string) => void;
}

export const PanelContext = createContext<PanelActions | null>(null);

export function usePanel(): PanelActions {
  const ctx = useContext(PanelContext);
  if (!ctx) throw new Error('ThreadsPanel の外では、使えません');
  return ctx;
}
