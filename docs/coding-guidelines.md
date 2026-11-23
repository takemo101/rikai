# コーディング指針

具体的な書き方の指針。原則の選択と理由は [参考にした設計原則](references.md)、構造は [構成説明](architecture.md)、見直しの観点は [リファクタリングの観点](refactoring.md)。**「守っている」と書いた規則は、いまのコードが守っているもの**。まだ守れていないもの・方針だけのものは、そう書く（[構成説明の負債](architecture.md#既知の構造上の負債)）。

## 構成と依存

- 利用者の環境で動くもの（配布物 `skills/rikai/rikai.js`）は、**依存を含めて 1 ファイルにバンドルしてある**（`pnpm run build`。利用者に `npm install` を要求しない。SPEC N5）。ソース（`app/src/`）の実行時の依存は、必要なものだけ（Hono・zod・marked。`app/package.json`）。**足すときは、バンドルに入るので、ライセンス表（`THIRD-PARTY-LICENSES.txt`）が、ビルドで更新されることも、確かめる**。
- 画面（`app/src/web/`）の依存（react・tailwind・tanstack・zustand・dompurify・mermaid・marked ほか）は、`app/package.json` の `devDependencies` に置き、ビルドで `public/assets/` に同梱する（ライセンスは、ビルドが `public/THIRD-PARTY-LICENSES.txt` に出す）。CDN・外部のスクリプト・外部の画像・外部のフォントを読み込まない（CSP でも禁じている。e2e が、127.0.0.1 以外への通信 0 件を確かめる）。**ルートの `package.json` に `dependencies` を書かない**。
- ソース（`app/src/`）は、TypeScript の **strict**（`pnpm run typecheck`）。`any`・`@ts-ignore`・`@ts-expect-error` は、使っていない。整形・Lint は biome（`pnpm run lint`）。配布物は、ビルドして `skills/rikai/` に置き、コミットする（手で編集しない）。
- 置き場所は、変わる理由で決める：コマンドの入口 → `app/src/cli/main.ts`、データの読み書き → `app/src/server/store.ts`、検査 → `server/ask.ts`（と各操作の中）、画面からの操作 → `server/actions.ts`、AI 向け（`poll`・`pull`・`apply`・`status`） → `server/agent.ts`、HTTP → `server/app.ts`（待ち受けは `server/serve.ts`）、共有の純粋な関数・型 → `app/src/shared/`、画面 → `app/src/web/`（通信 `api/`・ブラウザの状態 `store/`・本文 `doc/`・番号の層 `overlay/`・パネル `panel/`・入口 `interact/`・枠組み `layout/`）、AI への指示 → `SKILL.md`。**依存は一方向**：層の順 `server/util` → `store` → `ask` → `actions`・`agent` → `app` → `serve` → `cli/main` で、**後ろのモジュールだけが、前のモジュールを `import` できる**（逆向き・循環をさせない。前のすべてを、import するとは限らない：例えば `ask` は `util` だけ）。`shared/` は、`server/` を import しない。`web/` は、`server/` の**型だけ**（`AppType`）を import する。
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

- 失敗は `HttpError(status, message)` を**投げる**。HTTP では `app.ts` の `onError` が、コマンドでは `main` が、見せ方（状態コード・`{ok:false,…}`・終了コード）を決める（守っている）。それ以外の場所で、`process.exit`・`res.end` で失敗を終わらせない（`main`・`shutdown` 以外）。
- **握りつぶさない**。`catch (_) {}` は、失敗しても意味が変わらない所だけ（ロックの残骸の削除・片付け・ブラウザを開く・pid の `kill`・`unlink`）。`git rev-parse` の失敗は、cwd に戻す（`projectRoot`）。`readJSON` は、ファイルがないとき（`ENOENT`）だけ既定値を返し、ほかの失敗は投げる。
- 失敗を、成功に見える代用品に置き換えない。**部分的な反映をしない**：`mutate` は、`fn` が投げたら何も書かない。`apply` は、検証をすべて終えてから書く。
- ユーザーに見せる失敗の文は、**何が悪くて、どう直せばよいか**を書く（例：「最新版にだけコメントできます」）。

## 並行

- ファイルの変更は、**`mutate(slug, fn)` を通す**（ロック・読み込み・保存・`rev` の更新を 1 か所に集める）。`fn` の中は**同期だけ**。`await` を入れない。
- 他の場所（`submit`・`actions`・`cmdApply`）が、`meta.json`・`threads.json` を、`mutate` なしで書かない。
- JSON を書くときは `writeJSON`（一時ファイル → `rename`）。
- ブラウザの描画は、**非同期の途中で状態が変わりうる**。`renderDoc` は、描くたびに世代（`nextEpoch`・`isCurrent()`）を付けて、古い描画を捨てる。非同期の後に DOM を触るときは、同じ確認をする。

## 画面（React・DOM・安全）

- **サーバーの状態は TanStack Query（`web/api/`）、ブラウザの状態は Zustand（`web/store/ui.ts`・`store/doc.ts`）だけが持つ**。部品が、状態を直接書き換えない：`store` の関数を通す。値は、書き換えず、作り直す。コンポーネントに、サーバーの写しを別に持たない。
- サーバーとの通信は、`api/client.ts`（Hono RPC の `hc<AppType>`。型は、サーバーの `AppType` から）と `queries.ts`・`mutations.ts` だけ。部品から `fetch` を直接呼ばない。操作が失敗しても、例外にせず、トーストで知らせる（`mutations.ts`）。
- **本文は、命令的な「島」**：`Article` は、子を持たない要素で、中身を `renderDoc` が DOM で作って差し替える（React は中身に触れない）。島の DOM は、`lib/dom.ts` の `h`・`$`・`$$` で作る（文字は `textContent`・テキストノード）。React の部品では、使わない（JSX で書く）。島を描いたあとの「どこに何があるか」は、`DocModel`（`store/doc.ts`）に入れる。**書くのは `Article` だけ**。
- **検査していない文字を、`innerHTML`・`dangerouslySetInnerHTML` に入れない**。`dangerouslySetInnerHTML` は、使っていない。`innerHTML` は、無害化を通した文字列（`markdown.ts` の DOMPurify のあと）と、Mermaid の出力（`securityLevel: 'strict'`。`mermaid.ts`）だけ。
- AI の Markdown（本文・返信）は、同じ `mdToFragment`（marked → DOMPurify → 後処理）を通す。人間のコメント・返信・編集の文は、**常に文字として**（React の子）。
- リンク・画像は、`mdToFragment` の後処理で限定する（`page:`・`http(s)`・`mailto`・`assets/` の相対パス・`data:image/`）。許可を広げるときは、SPEC §7 の判断が先。
- 属性値に**任意の文字列**を入れない（DOMPurify が、属性ごと消すことがある。Mermaid のソースは、URI エンコードして属性に持つ）。
- 入力中の下書きは、`store/ui.ts` の `drafts` に持ち、描き直しで消さない。カードは、キーで同じ DOM を使い回し、入力欄のフォーカス・選択範囲を壊さない。
- 位置・大きさの測定が要る処理（番号の層）は、**測定（`place.ts`）と、計算（`layout.ts`。純粋）を分ける**。計算だけを、jsdom で試す。
- 見た目は、`styles/app.css`（先頭の `:root` のトークン〔色・角丸・影・文字〕を使う。ベージュ・黄色・オレンジ・紫を、装飾に使わない：アクセントは青 1 色。状態の色は、文字・アイコンだけ）と、Tailwind v4（theme と utilities だけ。preflight は入れない。utilities は `tw:` の接頭辞つき：`tw:flex` のように書く。接頭辞がないと、AI が書いた HTML の class に効いてしまう）。Tailwind のクラスを足すときは、`app.css` の見た目を崩さない（preflight を足さない）。
- **色は、トークンで持つ**（`app.css` の `:root`）。**ライトとダークの値は、`light-dark(ライト, ダーク)` で、トークンの 1 か所に書く**。**ハードコードの色を、規則やコンポーネントに書かない**（`#fff` などを直接書くと、ダークで、白い島になる）。**白い文字を載せる塗りは、塗り用のトークンで持つ**（`--done-fill` など。**文字用の色を、塗りに使わない**：文字用の色は、ダークで明るくなり、白い文字が読めなくなる）。色を足す・変えるときは、**ダークも確かめる**（文字は、ライト・ダークとも WCAG AA 4.5:1 以上。e2e の `theme.spec` が、見えている文字を、状態〔無効のボタン・placeholder・解決済み・ポップアップ・強調の中〕も含めて、総当たりで測る）。「いま、ライトか、ダークか」を JS で知りたいとき（Mermaid・画像化など）は、`lib/theme.ts` の `resolvedTheme` を使い、自分で `matchMedia` を読まない。**外観を `<html data-theme>` に付けるのは、`public/assets/theme-init.js`（同期・外部ファイル。CSP が許す）と `main.tsx`**：インラインのスクリプトは使わない。`mermaid.initialize` のようなグローバルな設定は、描画待ちの間に変わりうるので、描画を直列にし、描き終えた時点で、いまの外観を確かめる。
- **SVG を別の場所に出すときは、移さず、複製して、`id` を付け替える**（`cloneNode(true)`。`lib/zoomSvg.ts`）。同じ `id` が 2 つあると、`url(#…)`・`href="#…"`・`aria-labelledby`・`<style>` の `#id` が、元を指して、見た目が壊れる。複製の `id` には、接頭辞（`zoom-`）を付け、参照も、すべて書き換える。**元の DOM（`#article`）は、動かさない・足さない**（番号・線・位置づけが崩れる）。**HTML を文字列から作らない・`innerHTML` を使わない**。
- アイコンは、`lucide-react` のコンポーネントを、直接 import して使う（ラッパーを作らない）。`aria-hidden="true"`・`focusable="false"` を付け、大きさ・線の太さは CSS（`svg.lucide`）で決める。**アイコンだけのボタンは、`aria-label`（名前）と `title`（ツールチップ）を付ける**。
- **ブラウザの通知（F41）の規則**：**新着は、件数の差ではなく、ID の比較で決める**（`lib/notify.ts`。読んだこと・解決の取り消し・削除で、数え直されない）。通知の本文には、**トピック名と件数だけ**を載せる（AI の本文・資料の中身は載せない）。**トピック名は、制御文字と双方向文字の制御を除いて、コードポイント単位で切る**。**`icon`・`data` を付けない**（外のものを読まない）。`tag` は `rikai-<slug>`（同じトピックの通知は、置き換える）。許可を求めるのは、**利用者の操作（ベルを押す）のとき**だけ。判定・文言は純粋関数に置く（`Notification`・DOM のイベントは `useBrowserNotify.ts`）。
- **html-app の枠から来る値**（F42。`pick`・`state`・`snapshot`）は、**非信頼**：`e.source`・**形・大きさ・頻度**を検査して受け、**新しいオブジェクト**にして使う（枠が渡した object を、そのまま使わない）。**文字・画像のデータとして扱い**、`innerHTML`・`eval`・`href` に使わない。検査は `shared/htmlapp-bridge.ts` に、手で書く（画面に Zod を入れない）。`pick` は、その枠が選択モードのときだけ受ける。**枠から、利用者の操作なしに、下書きを作れる経路（`rikai.comment` のようなもの）を足さない**。下書きは、利用者が確認して Submit する（自動で Submit しない）。`input` の値を、送らない。**枠から来た文字列は、必ず `reveal()` を通す**（見えない・紛らわしい文字〔タグ文字・方向制御・ゼロ幅など〕を、`\uXXXX` の見える形にする。**取り除かない**：利用者が気づけない）。**枠が決めた文字を、JSON のブロックの外（下書きの見出し・錨のラベル）に出さない**（偽の区切りや、利用者の追記に見せかけた文が、地の文として並ぶため）。「枠から」の札は、ラベルだけでなく、錨の形（`fromFrameAnchor`）で判定する。**要素の情報は、枠の自己申告**であり、利用者が押した要素とは限らない。

## サーバー

- 待ち受けは、**127.0.0.1 のポート 0**（空きポート）。`0.0.0.0` にしない。
- すべての `/api/` と `/asset/` は、`denyReason` を通す。**新しい経路を足したら、同じ検査を通す**。静的な配布の経路は、`public/` の外へ出ないことを確かめる（`path.resolve` と `startsWith`）。
- 画面からの操作は、`actions` の関数として足し、本体の形を `app/src/shared/api.ts`（zod）に足す（`app.ts` の経路が、名前で引く）。`topic` の形は、`app.ts` が先に検査する。
- 入力の大きさに上限を置く（本体 2 MB・文字列は `str(v, max)`）。
- **SSE の経路**（`GET /api/events`）を足す・変えるときは：**既存の `denyReason` を通す**（合言葉・`Host`・`Origin`）。**通知だけ送り、データを載せない**（データは、既存の取得で取る）。**接続が切れたら、購読・タイマー・ウォッチャーを、必ず解く**（解き忘れると、接続のたびに増える。リーク試験：`pingMs` を短くして、接続・切断を繰り返す）。**同時接続の上限を置く**（保険）。`fs.watch` は `try/catch` と `'error'` リスナーを付ける。**画面側の SSE の購読は、ブラウザ全体で 1 本**（`SharedWorker`。Chrome は 1 オリジン 6 接続までで、タブごとに持つと、6 タブで全タブの操作・取得が止まる）。**`SharedWorker` がない環境は、フォールバックでタブごとの `EventSource` を作らず、ポーリングだけ**にする。購読は `App` で 1 回だけ持ち、アンマウントで `bye` を送る（StrictMode で二重にしない）。画面の `events.ts` に zod を import しない（バンドルが増える。形は手書きで確かめる）。**ポーリングは、保険として残す**（通知が切れている間の更新）。
- **「いま、誰の番か」（F39）のような、画面の状態の判定は、1 か所の純粋関数**（`lib/turn.ts`）に置く。上のバー・左の一覧・カードの札・タブのタイトルは、それを使い、各所で再計算しない。DOM・ストア・サーバーに触れない（試験は、入力の組み合わせで書く）。優先順位は、関数の先頭のコメントと、SPEC F39 に書く。**表示の読み上げに、変わる件数を入れない**（`aria-live` が、件数のたびに読み上げ直す）。
- **html-app の枠からのメッセージ**（F40。`postMessage`）は、**`e.source`（画面が置いた枠の `contentWindow`）・形・値の範囲・頻度を検査して**受ける（枠のオリジンは `null` で、オリジンでは検査できない）。受け口はドキュメントで 1 つ。画面の DOM・コメント・保存に触れさせない。通信の種類を足すときは、SPEC の N3・F28 の例外の説明を更新し、`APP_CSP` と `sandbox` は緩めない。枠の文書に足すスタイルは、`:where()`（詳細度 0）にして、AI の CSS が、つねに勝つようにする。
- **html-app の枠の配色は、オプトイン**（`shared/htmlapp-theme.ts` の `followsTheme`）：画面の配色に対応していない従来の資料には、土台のスタイル・ダークへの追従を付けない（見た目を変えない）。`theme` メッセージは `by`（`auto`＝画面の外観の変化は、対応した枠だけ／`user`＝ツールバーはどの枠でも）を、`e.source === parent`・`mode` と一緒に検査する。

## コマンドとスキル

- コマンドの出力は、**JSON**（`out`）。エージェントが読む。人間向けの飾りを足さない。失敗は `{ok:false, errors:[…]}`・終了コード 1。
- **`SKILL.md` は、コードの一部**。コマンド・入力の形・待ち方を変えたら、同じ変更で直す。例の JSON は、そのまま `apply` に流せる形にし、流して確かめる。
- AI への指示は、**日本語で、具体的に**（いつ・何を・どの形で）。AI の出力を信用しない：検証して、直せる形の `errors` を返す。
- エージェントごとの違い（Claude Code の `poll` と、それ以外の `pull`）は、SKILL.md の 1 か所に書く。

## テスト

`pnpm test`（Vitest。サーバー・共有は node、画面は jsdom〔ファイルの先頭に `// @vitest-environment jsdom`〕）。実際のブラウザは、`pnpm run test:e2e`（Playwright）。範囲と一覧は、[開発手順](development.md#検証の入口)。守っている規則：

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

- 1 ファイル 1 つの責務。500 行を超えたら、責務を見直す（いまは、`app/src/` に、超えるものはない。最大は `server/app.ts` の 378 行。[構成説明の負債](architecture.md#既知の構造上の負債)）。
- 生成物・同梱ライブラリ以外のバイナリ・個人の情報を、コミットしない。
- コミットは、利用者に見える一つの変更（実装・文書）。無関係な変更を混ぜない。
