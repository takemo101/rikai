// ストアが、外から受け取るもの（作成時に渡す）。ストアは、上の層（api・lib/view）を import しない。

/** いま見ている版の、ストアが使う分だけ（`lib/view.ts` の `View` が、これに合う） */
export interface ViewRef {
  /** `<slug>/<page>/<version>`：「どの版を見ているか」の印 */
  key: string;
  /** 見ている版 */
  version: number;
  /** ページの最新版 */
  latest: number;
  /** 最新版を見ているか。コメントは、最新版にだけ付けられる */
  isLatest: boolean;
  /** 終了したトピックか（閲覧専用：コメントの入力欄は、開けない） */
  readOnly: boolean;
}

export interface UiDeps {
  /** いま見ている版（ルートか、取得済みのトピックがなければ null） */
  getView: () => ViewRef | null;
}
