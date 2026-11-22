# コーディング指針

具体的な書き方の指針。原則の選択と理由は [参考にした設計原則](references.md)、構造は [構成説明](architecture.md)、見直しの観点は [リファクタリングの観点](refactoring.md)。**「守っている」と書いた規則は、いまのコードが守っているもの**。まだ守れていないもの・方針だけのものは、そう書く（[構成説明の負債](architecture.md#既知の構造上の負債)）。

## 構成と依存

- 利用者の環境で動くもの（配布物 `skills/rikai/rikai.js`）は、**依存を含めて 1 ファイルにバンドルしてある**（`pnpm run build`。利用者に `npm install` を要求しない。SPEC N5）。ソース（`app/src/`）の実行時の依存は、必要なものだけ（Hono・zod・marked。`app/package.json`）。**足すときは、バンドルに入るので、ライセンス表（`THIRD-PARTY-LICENSES.txt`）が、ビルドで更新されることも、確かめる**。
- ブラウザ側（旧 UI）の依存は、`public/vendor/` に**同梱した**ものだけ（marked・DOMPurify・mermaid）。CDN・外部のスクリプト・外部の画像・外部のフォントを読み込まない（CSP でも禁じている）。
- 旧 UI の `public/` は、ビルドしない：そのまま配信する素の HTML・CSS・JavaScript（画面を React にする段階までの扱い）。サーバー・CLI（`app/src/`）は、TypeScript の **strict**（`pnpm run typecheck`）で、ビルドして配布物にする。
- 置き場所は、変わる理由で決める：コマンドの入口 → `app/src/cli/main.ts`、データの読み書き → `app/src/server/store.ts`、検査 → `server/ask.ts`（と各操作の中）、画面からの操作 → `server/actions.ts`、AI 向け（`poll`・`pull`・`apply`・`status`） → `server/agent.ts`、HTTP → `server/app.ts`（待ち受けは `server/serve.ts`）、共有の純粋な関数・型 → `app/src/shared/`、描画・操作 → 旧 UI の `app.js`、AI への指示 → `SKILL.md`。**依存は一方向**：層の順 `server/util` → `store` → `ask` → `actions`・`agent` → `app` → `serve` → `cli/main` で、**後ろのモジュールだけが、前のモジュールを `import` できる**（逆向き・循環をさせない。前のすべてを、import するとは限らない：例えば `ask` は `util` だけ）。`shared/` は、`server/` を import しない。
- **状態は、モジュールの変数に置かない**：ストアは `createStore(root)`、アプリは `createApp` の引数（ストア・合言葉・ポート・操作）、操作は `createActions(store, hooks)` で、**引数で渡す**（DI）。テストが、互いに干渉せず、ポートを開かずに試せる。
- 「util」「helper」に、無関係なものを集めない。

## 型と境界

- 外（HTTP の本体・`apply` の JSON・引数・ファイル）から来る値は、**境界で一度だけ**検査し、正規化する（守っている）：
  - トピック名・ページ ID：`checkSlug`／`SLUG_RE`
  - アンカー：`normAnchor`（文字数を切る）
  - AI の質問：`normAsk`（型・選択肢・範囲）。返ってきた**正規化した形**だけを保存する
  - 人間の回答：`normAnswer`（質問に照らして検査）
  - `apply` の入力：`cmdApply` が、まとめて検証してから書く
- 内側は、再検証しない。保存済みのデータは、検査済みとして扱う。
- JSON の形を変えるときは、保存済みの `.rikai/` との互換を考える。**形を足すだけなら、版は上げず、項目がなくても動くようにする。変える・消すなら、`SCHEMA` を上げて、読み替える処理を足す**（[開発手順](development.md#データの形を変えるとき)。SPEC N7）。

## 失敗

- 失敗は `HttpError(status, message)` を**投げる**。HTTP では `handler` が、コマンドでは `main` が、見せ方（状態コード・`{ok:false,…}`・終了コード）を決める（守っている）。それ以外の場所で、`process.exit`・`res.end` で失敗を終わらせない（`main`・`shutdown` 以外）。
- **握りつぶさない**。`catch (_) {}` は、失敗しても意味が変わらない所だけ（ロックの残骸の削除・片付け・ブラウザを開く・pid の `kill`・`unlink`）。`git rev-parse` の失敗は、cwd に戻す（`projectRoot`）。`readJSON` は、ファイルがないとき（`ENOENT`）だけ既定値を返し、ほかの失敗は投げる。
- 失敗を、成功に見える代用品に置き換えない。**部分的な反映をしない**：`mutate` は、`fn` が投げたら何も書かない。`apply` は、検証をすべて終えてから書く。
- ユーザーに見せる失敗の文は、**何が悪くて、どう直せばよいか**を書く（例：「最新版にだけコメントできます」）。

## 並行

- ファイルの変更は、**`mutate(slug, fn)` を通す**（ロック・読み込み・保存・`rev` の更新を 1 か所に集める）。`fn` の中は**同期だけ**。`await` を入れない。
- 他の場所（`submit`・`actions`・`cmdApply`）が、`meta.json`・`threads.json` を、`mutate` なしで書かない。
- JSON を書くときは `writeJSON`（一時ファイル → `rename`）。
- ブラウザの描画は、**非同期の途中で状態が変わりうる**。`renderDoc` は、世代（`renderTok`）を覚えて、古い描画を捨てる。非同期の後に DOM を触るときは、同じ確認をする。

## 画面（DOM・安全）

- DOM は、`h(tag, attrs, …children)` で作る（文字は `textContent`・テキストノード）。**検査していない文字を `innerHTML` に入れない**（守っている）。
- 例外は、**無害化を通した結果**を入れるときだけ：AI の Markdown は `mdToFragment`（marked → DOMPurify → 後処理）の戻り値（`DocumentFragment`）を使う。Mermaid の SVG は、`securityLevel: 'strict'` で描いたものだけ（`fillMermaid`）。
- 人間のコメント・返信・編集の文は、**常に文字として**（`textContent`）。
- リンク・画像は、`mdToFragment` の後処理で限定する（`page:`・`http(s)`・`mailto`・`assets/` の相対パス・`data:image/`）。許可を広げるときは、SPEC §7 の判断が先。
- 属性値に**任意の文字列**を入れない（DOMPurify が、属性ごと消すことがある。Mermaid のソースは、URI エンコードして属性に持つ）。
- 状態は `S` に集める。描画関数は、`S` から描く（`renderTop`・`renderSide`・`renderDocbar`・`renderThreads`・`renderDoc`）。入力中の下書きは、`S.drafts` に持ち、描き直しで消さない。
- 描き直しで、入力中の欄を壊さない（`data-key` を付けて、`renderThreads` が復元する）。

## サーバー

- 待ち受けは、**127.0.0.1 のポート 0**（空きポート）。`0.0.0.0` にしない。
- すべての `/api/` と `/asset/` は、`denyReason` を通す。**新しい経路を足したら、同じ検査を通す**。静的な配布の経路は、`public/` の外へ出ないことを確かめる（`path.resolve` と `startsWith`）。
- 画面からの操作は、`actions` の関数として足し、本体の形を `app/src/shared/api.ts`（zod）に足す（`app.ts` の経路が、名前で引く）。`topic` の形は、`app.ts` が先に検査する。
- 入力の大きさに上限を置く（本体 2 MB・文字列は `str(v, max)`）。

## コマンドとスキル

- コマンドの出力は、**JSON**（`out`）。エージェントが読む。人間向けの飾りを足さない。失敗は `{ok:false, errors:[…]}`・終了コード 1。
- **`SKILL.md` は、コードの一部**。コマンド・入力の形・待ち方を変えたら、同じ変更で直す。例の JSON は、そのまま `apply` に流せる形にし、流して確かめる。
- AI への指示は、**日本語で、具体的に**（いつ・何を・どの形で）。AI の出力を信用しない：検証して、直せる形の `errors` を返す。
- エージェントごとの違い（Claude Code の `poll` と、それ以外の `pull`）は、SKILL.md の 1 か所に書く。

## テスト

`pnpm test`（Vitest。旧 UI の `test/fmt.test.js` だけは `node --test`）。範囲と一覧は、[開発手順](development.md#検証の入口)。守っている規則：

- 利用者に見える不具合を捕まえる：状態遷移・境界・失敗・安全（認証・パスの検査・失敗したら何も書かないこと）。
- 書かないテスト：配線・転記・文言の固定、実装の細部に縛られるもの、「例外が出ない」だけのもの、常に真になるもの。
- 決まった入力と出力の関数（`normAsk`・`normAnswer`・`cmdApply`・`peek`・`findQuote`・`locateBlock`）と、実際に待ち受けたサーバー（127.0.0.1 の空きポート）で試す。ブラウザ・実際のエージェント・外部のネットワークに依存しない。
- DOM に触れる処理（描画・選択・無害化）は、`app/src/shared/anchor.ts` のように、**DOM に触れない純粋な関数に分けて**から試す。分けられないものは、手で確かめ、[検証記録](verification.md) に残す。
- 一時のディレクトリ（`app/test/server/helpers.ts` の `tempProject`）を使い、利用者の `.rikai/` に触れない。作り物の資料・コメントだけを使う。
- `app/src/server/` のモジュールは、`import` されたときに何も実行しない。動き出すのは `cli/main.ts` だけ（末尾の `main()`）なので、テストは `main.ts` を読み込まず、`server/` を読む（`helpers.ts` が束ねる）。CLI の動きは、バンドルを子プロセスで動かして試す（`app/test/setup/cli.ts`）。**サーバーの終了のような、プロセスを終える動作は、`hooks` で差し替えられるようにする**（既定は何もしない。`rikai serve` が、終了の処理を入れる。テストのプロセスを落とさない）。
- **足したテストが、実際に落ちることを確かめる**：検査を外す・順序を入れ替えるなどで、1 度は、赤にする。
- 実際の画面でしか確かめられないことは、手で確かめ、[検証記録](verification.md) に残す。単体テストで、合格にしない。

## 名前とコメント

- 名前は、振る舞いと一致させる。同じ概念に、複数の語を使わない（SPEC の用語に合わせる：トピック・ページ・版・スレッド・ask・round）。
- コメントは、**なぜ**を書く（理由・外れた案・実際に踏んだ落とし穴）。コードの言い換えは書かない。日本語で書く（例：DOMPurify が `-->` の属性を消すこと）。
- 文書・コメントに書いた数値は、出典（検証の記録）を持つ。測っていない値は、「仮」と書く。
- 古くなったコメント・文書は、同じ変更で直す。

## プライバシー

- 資料・コメントの中身を、**ログ・標準出力のログ・文書・コミットに残さない**。コマンドの出力（`poll`・`pull`）は、エージェントに渡すためのもので、ログではない。
- サーバーのログ（`.server.log`）に、資料・コメントを出さない。
- 検証は、作り物の資料・コメントで行う。

## ファイルとコミット

- 1 ファイル 1 つの責務。500 行を超えたら、責務を見直す（いまは、`app.js` だけが超えている。[構成説明の負債](architecture.md#既知の構造上の負債)）。
- 生成物・同梱ライブラリ以外のバイナリ・個人の情報を、コミットしない。
- コミットは、利用者に見える一つの変更（実装・文書）。無関係な変更を混ぜない。
