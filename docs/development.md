# 開発手順

調査・変更・検証・PR を、一つの作業単位として進める手順。製品仕様ではなく、[AGENTS.md](../AGENTS.md) の規約を、具体的な運用に結び付ける。

## 正本と開始時の読取り順

| 対象 | 正本・役割 |
|---|---|
| 製品要件・受け入れ条件・実装の状態・未決事項 | [SPEC.md](../SPEC.md) が唯一の正本 |
| 作業規約・操作権限・不変条件 | [AGENTS.md](../AGENTS.md)。本書は、その派生手順であり、追加の実施許可ではない |
| Issue の現在の状態・Report | mikan（[下記](#mikan-の-issue-進行)）。文書に Status の写しを維持しない |
| 構成・観測方法・証拠 | [構成説明](architecture.md)、[検証手順と記録](verification.md) |

1. 依頼の対象と、SPEC の該当節（機能要件・状態・未決事項）を読む。
2. AGENTS と本書を読み、変更範囲・許可された操作・確認方法を特定する。既存の利用者の変更を保持する。
3. [構成説明](architecture.md) の該当箇所と、実際のソースを読む。

## 作業単位と最小の経路

一回の作業を、利用者に見える一つの成果と、それを観測する方法で定義する。許可された範囲の**最小で安全な端から端までの経路**を早く確かめ、周辺の抽象化や将来対応を先行させない。

- 調べて分かる環境の前提は、先に読む。設定・認証を変えて、前提不足を補わない。
- **画面・実際のエージェントでしか確かめられないことは、一時のプロジェクトと作り物の資料で、先に小さく確かめる。** 試行の前に、仮説・結果を区別できる観測・停止条件を決める。
- 利用者が報告した結果は、事実として扱う。同じ失敗を確認するだけの再試行や、根拠のない推測の修正はしない。

## 環境

- **使う人**：Node.js 22 以上（SPEC N5。npm のパッケージは要らない：配布物は、依存を含めて 1 ファイルにバンドルしてある）。**開発する人**：Node.js **22.12 以上**（Vitest・Vite の要求。20 では、ネイティブの部品が入らず、`pnpm test` が落ちる）と pnpm。作者の環境の確認は 24.15.0（[検証記録](verification.md#環境記録の前提)）。
- ブラウザ：Chromium 系で確認した。Safari・Firefox は未確認。
- OS：macOS で確認した。Linux・Windows は未確認。
- `rsync`（`install.sh` が使う）。

### 開発の土台（再開発〔Hono・React〕。2026-11-22〜。SPEC §8）

サーバー・CLI（`app/src/{server,cli,shared}/`。RIK-035）と、**画面（`app/src/web/`。RIK-036）も、TypeScript に移した**。画面は、React 19・Vite・Zustand・TanStack Query・Hono RPC の型（`hc`）・Tailwind v4（theme と utilities だけ。preflight なし。見た目は、`styles/app.css`。アイコンは lucide-react）。旧 UI（`app.js`・`style.css`・`vendor/` ほか）と、ルートの `test/` は、なくなった。段階：土台（RIK-034）→ サーバーと CLI（RIK-035）→ フロント（RIK-036。済）→ 仕上げ（RIK-037）。

- **`app/` が、開発用のワークスペース**（TypeScript のソース・テスト・設定・開発の依存）。**リポジトリのルートの `package.json` には、依存を書かない**：ルートは、プラグインの宣言（pi の `pi.skills`・各エージェントのマニフェスト）で、pi が、git から入れるとき、`npm install --omit=dev` を、ルートで実行する。開発の依存がルートにあると、そのたびに、npm のレジストリへ問い合わせて、オフラインでは失敗する（レビューで、9 秒・`ENOTCACHED` を確認）。
- 開発の依存は **pnpm**（ルートで `pnpm install`。`pnpm-lock.yaml` をコミット。esbuild のビルドスクリプトは `pnpm-workspace.yaml` の `allowBuilds` で許可）。利用者の環境には、依存を要求しない（バンドルして `skills/rikai/` に同梱：SPEC N5）。
- 言語は TypeScript（strict）。`app/src/shared/`：サーバー・CLI・画面が共有する、DOM に触れない純粋な関数と型（`anchor.ts`・`diff.ts`・`progress.ts`・`types.ts`・`api.ts`）。**状態は、モジュールの変数にしない**：`createStore(root)`・`createApp` の引数・`createActions` の `hooks` で、渡す。画面の状態は、`app/src/web/store/`（Zustand）と TanStack Query（`api/`）。
- **配布物は、ビルドして `skills/rikai/` に置き、コミットする**：`pnpm run build`（= `build:server` + `build:web`）が、`skills/rikai/rikai.js`・`rikai-htmlapp-worker.js`・`THIRD-PARTY-LICENSES.txt`（サーバー・CLI）と、`skills/rikai/public/`（画面：`index.html`・`favicon.svg`・`assets/`・`THIRD-PARTY-LICENSES.txt`）を書き換える。**`app/src/` を変えたら、`pnpm run build` をして、出力もコミットする**（`app/test/build.test.ts` が、ソースから作り直したものと、コミットしたもの〔`public/` 全体を含む〕が同じか確かめる。古いと、`pnpm test` が落ちる）。これらは生成物なので、手で編集しない。`vite build` を単独で動かすと `skills/rikai/public/` を空にして書き換える（試すときは `--outDir /tmp/…`）。
- **画面の依存**（react・vite・tailwind・lucide-react〔アイコン。ISC〕・tanstack・zustand・dompurify・mermaid・marked ほか）は、`app/package.json` の `devDependencies` に置き、ビルドで `public/assets/` に同梱する。ライセンスは、ビルドが `public/THIRD-PARTY-LICENSES.txt` に出す（手で書かない）。ルートの `package.json` に `dependencies` はない。`public/` は約 5.6MB（Mermaid の図の種類ごとの chunk が大半。必要になるまで読まない）。

| コマンド（ルートで） | 内容 |
|---|---|
| `pnpm test` | Vitest（`app/test/**/*.test.{ts,tsx}`）だけ（サーバー・CLI・共有・画面〔jsdom〕・配布物）。ルートの `test/` は、なくなった。`app/vitest.web.config.ts` は、画面（`app/test/web/`）だけを、サーバーのビルドなしで動かす設定（`pnpm --dir app exec vitest run -c vitest.web.config.ts`） |
| `pnpm run build` | `build:server`（`app/scripts/build.ts`）と `build:web`（`app/vite.config.ts`）：バンドルを、`skills/rikai/` に書く（上のとおり。コミットする） |
| `pnpm run test:e2e` | Playwright（実際の Chrome）の e2e。[e2e](#e2e実際の-chrome) |
| `pnpm run typecheck` | `tsc --noEmit` |
| `pnpm run lint` | `biome check`（整形・Lint。`pnpm run format` で直す。対象は `app/src/`・`app/test/**/*.ts`・`app/scripts/`・設定ファイル） |

新しいテストは `app/test/` に `*.test.ts`（画面の部品は `*.test.tsx`。`app/test/web/`。ファイルの先頭に `// @vitest-environment jsdom`）で書く（Vitest。`node:assert/strict` も使える）。**足したテストは、実装を壊して、落ちることを、一度確かめる**（これまでと同じ）。

**プラグインの導入の確認（下の「プラグイン」の行）は、開発の複製ではなく、`/tmp` に新しく `git clone` したものから行う**：`pnpm install` 済みの複製から入れると、`node_modules`（180〜580MB。エージェントによる）まで、複製される（レビューで確認）。

## 実行

リポジトリのまま動かせる。**`--root` で、一時のプロジェクトを指す**（実際のプロジェクトの `.rikai/` を、触らない）。

```bash
RK="node $PWD/skills/rikai/rikai.js --root /tmp/rk-dev"   # skills/rikai/rikai.js は、ビルドしたバンドル。app/src/ を変えたあとは、先に pnpm run build
mkdir -p /tmp/rk-dev

$RK new demo --title "試し" <<'MD'
# 試し
作り物の本文です。
MD
NO_OPEN=1 $RK open demo --no-open      # url が出る。ブラウザで開く
$RK poll demo --timeout 60             # ブラウザで Submit すると、内容が出て終わる
$RK status
$RK apply demo <<'JSON'                 # SKILL.md の例を流す
{"replies":[{"thread":"t1","body":"返信です。"}]}
JSON
$RK stop; rm -rf /tmp/rk-dev
```

**画面の開発サーバー**（`pnpm --dir app dev`。Vite。`http://127.0.0.1:5173/`）：rikai のサーバーを、別に起こし、`RIKAI_SERVER=http://127.0.0.1:<ポート>`（`.rikai/.server.json` の `port`）を付けて動かす（付けないと、起動時にエラー）。`/api`・`/asset`・`/appframe` だけ、そこへ proxy する。**先に、サーバーの URL（`http://127.0.0.1:<ポート>/?t=<合言葉>`）を、一度開いて、Cookie を付ける**。ホスト名は 127.0.0.1 にそろえる（詳しくは、`app/vite.config.ts` の先頭のコメント）。

| コマンド | 内容 |
|---|---|
| `rikai new <topic> --title … [--source …]` | 標準入力の Markdown からトピックを作る |
| `rikai open <topic> [--no-open]` | サーバーを起こし、URL を出す（`NO_OPEN=1` でも、ブラウザを開かない） |
| `rikai poll <topic> [--timeout 秒]` | `pending` の round を待って出す（既定 12 時間） |
| `rikai pull <topic>` | 待たずに、`pending` があれば出す |
| `rikai apply <topic>` | 標準入力の JSON を反映する |
| `rikai status [topic]` | 未処理の round などを見る |
| `rikai stop` | サーバーを止める |
| `rikai serve`（内部） | サーバー本体。`open` が起こす。直接は使わない |

共通：`--root <dir>`（プロジェクトルート。省略時は `git rev-parse --show-toplevel`、なければ cwd）。

- サーバーのログ：`<root>/.rikai/.server.log`。起動の情報：`<root>/.rikai/.server.json`。
- ブラウザの URL に合言葉が入っている。画面共有・スクリーンショットで見せない。
- **サーバーを残さない**：検証のあと、`rikai stop` で止める（止め忘れたら `.server.json` の `pid` を `kill`）。

## 検証の入口

変更の確認は、**自動テスト（`pnpm test`）と、手作業**で行う。結果は [検証手順と記録](verification.md) に、日付と環境つきで残す。

```bash
pnpm test           # Vitest（app/test/**/*.test.{ts,tsx}）。ブラウザ・実際のエージェントは使わない（Node 22.12 以上）
pnpm run test:e2e   # 実際の Chrome（Playwright。先に pnpm run build。下の「e2e」）
```

| テスト（`app/test/server/`・`app/test/shared/`・`app/test/web/`・`app/test/build.test.ts`） | 試すこと |
|---|---|
| `server/store.test.ts` | トピックの作成と検査・`mutate` が失敗したら何も書かず、ロックを残さないこと・`rev` |
| `server/actions.test.ts` | 画面からの操作（コメント・返信・編集・削除・解決・Submit）の検査と、Submit の中身 |
| `server/ask.test.ts` | `ask` と回答の検査（5 つの型）・回答の流れ・送信済みの回答の拒否 |
| `server/apply.test.ts` | `apply` の検証（誤りを全部返して、何も書かない）・反映・`round` 指定・二重の改訂・未返信の通知 |
| `server/poll.test.ts` | `peek`（`poll`・`pull` の出力）・`closed`・全トピックが閉じたときの合図 |
| `shared/anchor.test.ts` | `findQuote`・`locateBlock`・`similarity`（コメントの探し直し） |
| `shared/diff.test.ts` | `diffText`（元に戻せること・変更箇所・大きな入力）・`matchBlocks`（同じ・変更・追加・削除・種類の違い・区間の制約・空・重複） |
| `server/progress.test.ts` | `progressOf`（空・解決・質問・送信済みと未送信の回答・別の質問への回答・AI 起点のスレッド）と、実際の操作の流れでの数 |
| `server/plugin.test.ts` | プラグインの宣言と配置の食い違い：スキルの場所・名前（ディレクトリ名と一致）・SKILL.md の frontmatter の項目（omp が、余計な項目のあるスキルを読み込まない）・`plugin.json` の項目と、`package.json` との名前・版の一致・各カタログの指す場所・pi の `skills`。各エージェントの検証コマンドは、含めない（手元の CLI に依存するため。上の表） |
| `server/server.test.ts`・`app.test.ts`・`serve.test.ts`・`cli.test.ts` | 合言葉・`Host`・`Origin`・Cookie・CSP・配信のパス（`app.request()`、または実際に待ち受けて）・`rikai open` の `.server.json` の権限（0600）・`rikai serve` が、すべてのトピックが閉じたら自分で終わること（バンドルした CLI を子プロセスで動かす。`serve` が終了の処理を取りつける経路） |
| `server/attach.test.ts`・`region.test.ts`・`htmlapp.test.ts`・`image.test.ts` | 添付の画像（保存・検査）・範囲（`region`）・`html-app` の取り出しと `/appframe` の応答 |
| `build.test.ts` | コミットした配布物（`skills/rikai/` のバンドル・worker・ライセンス表と、画面〔`skills/rikai/public/` 全体〕）が、ソースから作り直したものと同じこと（古いと落ちる。`pnpm run build`。画面は、別プロセス・本番の環境で `vite build` して比べる） |
| `web/`（`app/test/web/`。jsdom） | 画面：本文の描画（`doc/markdown.test.ts`：無害化・リンク・画像・形式・html-app の置き場・返信）・番号の層の位置の計算・パネル・入力のロジック・ask・入口のバーと範囲の計算・API の呼び出し（`queries`・`mutations`）・ルート・localStorage・ストア |

`app/test/server/helpers.ts` が、一時のプロジェクト（`os.tmpdir()`）と、作り物の資料・コメントを用意する。利用者の `.rikai/` には触れない。**jsdom では、位置・大きさの測定が要るもの（番号の層の置き直し・範囲の選択のドラッグ・実際の描画の見た目）は、試せない**。それは、次の e2e と、手作業で確かめる。

| 目的 | 方法 |
|---|---|
| コマンドの経路（作る → Submit → 読む → 反映） | 上の「実行」。ブラウザの代わりに、HTTP を直接叩ける（`.server.json` の `port`・`token`、ヘッダー `X-Rikai-Token`。`POST /api/comment`・`/api/submit` など） |
| `apply` の検証 | 誤った JSON（存在しない `thread`・空の `body`・不正な ID・存在しない `parent`）を流して、`errors` が返ること。成功する入力を流して、`handledRounds`・`newPages`・`revised` が返ること |
| 画面 | ブラウザで `open` の URL を開き、コメント・Submit・`apply` の反映・版の切り替え・子ページへの遷移を操作する。画面の確認に、作り物の内容を使う |
| 無害化 | 資料に `<script>`・`<img onerror>`・`[x](javascript:…)`・外部の画像 URL を入れて、実行されない・表示されないこと |
| 認証 | 合言葉なしの `GET /api/topics` が 403 になること |
| インストール | `CLAUDE_SKILLS_DIR=/tmp/x bash install.sh`。実際の `~/.claude/skills` へは、依頼があるときだけ |
| プラグイン | 各エージェントの検証コマンド：`claude plugin validate .`・`grok plugin validate .`・`agy plugin validate .`。入れる確認は、**`HOME=/tmp/x` を付けて**（`~/.claude` などを変えない）：`claude plugin marketplace add <リポジトリ> && claude plugin install rikai@rikai`・`codex plugin marketplace add <リポジトリ> && codex plugin add rikai@rikai`・`grok plugin install <リポジトリ> --trust`・`agy plugin install <リポジトリ>`・`omp plugin marketplace add <リポジトリ> && omp plugin install rikai@rikai`・`pi install <リポジトリ>`。実際のエージェントでの確認は、`claude --plugin-dir`・`omp --plugin-dir`・`pi -e` で、その実行の間だけ読み込ませる |

自動テストを足すときは、`app/test/server/<領域>.test.ts`（`anchor`・`diff` のような、共有の純粋な関数は `app/test/shared/`、画面は `app/test/web/`）に、Vitest と `node:assert/strict` で書く。**足したテストは、実装を壊して（たとえば、検査を外して）、落ちることを、一度確かめる**。

### e2e（実際の Chrome）

`pnpm run test:e2e`（ルートで。Playwright。`app/e2e/` の 20 ファイル 306 件：`shell`・`loop`・`select`・`region`・`panel`・`ask`・`versions`・`formats`・`security`・`links`・`same-line`・`theme`・`zoom`・`events`・`turn`・`htmlapp-bridge`・`notify`・`htmlapp-writeback`・`focus`・`compare`）。**実際の Chrome**（headless）で、画面を、本物のマウス・キーで操作する。ブラウザは、ダウンロードしない。

- 環境変数：`RIKAI_CHROME`（Chrome の実行ファイル。なければ、`app/e2e/env.ts` の既定の場所。どちらにもなければ、skip）・`RIKAI_CLI`（試す `rikai.js`。既定は、`skills/rikai/rikai.js`。画面は、その隣の `public/` から配られる。**先に `pnpm run build`**）。
- 1 つのテストにつき、使い捨てのプロジェクトを `os.tmpdir()` に作り、サーバーを起こす。終わりに stop して消す（利用者の `.rikai/` には触れない）。順番に（workers 1）流す。各テストは、127.0.0.1 以外への通信が 0 件であることも確かめる。
- 画面を変えたら流す（約 2 分）。自動テスト（jsdom）で試せない、選択・範囲・出方を守る。**足したテストは、実装を壊して、落ちることを、確かめる**。

## 変更の進め方

1. 守る振る舞い（SPEC の該当 ID）を確かめる方法があるか見る。なければ、先に決める（上の表）。
2. 変更して、上の方法で確かめる。
3. SKILL.md に影響するか確かめる（`apply` の入力・`ask` の型・コマンド・待ち方）。影響すれば、同じ変更で直し、**直した例の入力を、実際に `apply` に流す**。
4. SPEC（要件・§6 の状態）・構成説明・検証記録・README に影響するなら、同じ変更で更新する（[AGENTS.md](../AGENTS.md#文書とツールの保守)）。

### コマンドを足す

1. `app/src/cli/main.ts` の `main()` の `switch` に `case` を足す。引数の解釈は `app/src/cli/args.ts` の `parseArgs`（値を取るオプションは、そのまま〔`--名前 値`〕。値を取らないものだけ、`no-open`・`force` の並びに足す）。中身が検査や書き込みなら、`app/src/server/` に置く。
2. `HELP` に 1 行足す。
3. 規則・検査は、コマンドの関数に置く（`main()` に書かない）。失敗は `HttpError` を投げる（`main()` が `{ok:false,errors}` と終了コード 1 にする）。
4. `SKILL.md` の手順・`README.md` のコマンド表・`docs/development.md` の表を直す。

### ask の型を足す

1. `app/src/server/ask.ts`：`ASK_TYPES`・`normAsk`（AI の入力の検査）・`normAnswer`（人間の回答の検査）。型は `app/src/shared/types.ts`（`Ask`・`AskAnswer`）。
2. `app/src/web/panel/AskView.tsx`・`panel/logic.ts`：`askDraftValid`・ask の入力の描画・下書き。
3. `SKILL.md` の `ask` の表と、SPEC F10 を直す。

## データの形を変えるとき

`meta.json` の `schema`（`app/src/server/store.ts` の `SCHEMA`。いまは 1）が、データの形の版（SPEC N7）。版は `meta.json` にだけ書く。`threads.json`・`rounds/`・`pages/` の形の変更も、この版を上げて表す。**既存の `.rikai/` を、壊さない**。

- 形を**足すだけ**（古い形に、新しい項目がなくても読める）なら、版は上げない。読む側が、項目がなくても動くようにする。
- 形を**変える・消す**（古い形のままでは読めない）ときは、次の順で行う。
  1. `SCHEMA` を 1 つ上げる。
  2. 古い形を、新しい形へ読み替える移行を足す。`meta.json` の変更は `Store.loadMeta`、`threads.json` の変更は `Store.loadThreads`（**それぞれ、読む場所**。`loadMeta` を通らずに `loadThreads` を呼ぶ経路がある：`topicState`・`peek`・`cmdStatus`）で、版（`meta.json` から読む）を見て、1 つずつ上げる関数にする。**`meta.json` だけを読み替えて、`schema` を新しい版で保存すると、`threads.json` が古い形のまま、新しい版と書かれてしまう**。`mutate` が保存するのは、`meta.json` と `threads.json` だけなので、この 2 つは、同じ `mutate` の中で、まとめて読み替えて保存する。**`rounds/` の各ファイルは、`mutate` では保存されない**（`submit` が作り、`cmdApply` が `handled` にするときだけ書き換える）。`rounds/` の形を変えるときは、`meta.json` の版ではなく、**ファイル自身の形**（項目の有無）で判断して読み替えるか、`mutate` が、全部の round を書き換えるように広げる。移行は、読んだ値を直すだけにして、保存は、次の `mutate` に任せる（読むだけの操作が、ファイルを書き換えない）。
  3. 古い形のデータを入れた自動テストを足す（`app/test/server/store.test.ts` の「版のない古い形」を参考に）。
  4. SPEC N7・構成説明・この節を更新する。
- 新しい rikai で作られたトピックを、古い rikai が開くと、409 で断る（何も書き換えない）。古い rikai を使い続ける人は、`rikai` を更新する。

## 同梱ライブラリの更新

画面の依存（marked・DOMPurify・mermaid・react ほか）は、`app/package.json` の `devDependencies` にあり、ビルドで `skills/rikai/public/assets/` に同梱される（オフラインで動かすため）。サーバー側の marked（`html-app` の取り出し）も、同じ npm の版を、`rikai.js` にバンドルしている。**脆弱性の修正は、自動では入らない**：ときどき確かめる。

```bash
pnpm audit                 # 修正のある版を探す（ルートで）
pnpm --dir app update      # 依存を更新（pnpm-lock.yaml が変わる）
pnpm run build             # skills/rikai/ の配布物を作り直す（ライセンス表も、自動で更新される）
pnpm test && pnpm run test:e2e
```

更新したら、配布物（`skills/rikai/`）と `pnpm-lock.yaml` を、一緒にコミットする。画面で、Mermaid の図・表・無害化（[検証の入口](#検証の入口)）を確かめる。marked の描画 API（`renderer.code({text, lang})`）が変わると、`app/src/web/doc/render/markdown.ts` の `renderer` を直す必要がある。DOMPurify の設定（`PURIFY`）の挙動も、版で変わりうる。

## mikan の Issue 進行

**初期化済み**（2026-11-21。`mikan init -k RIK -n rikai`）。Issue の ID は `RIK-<番号>` で、mikan が採番する。進め方は、voice-control の運用に倣う。

- `.mikan/` 全体は Git 管理外（`.git/info/exclude`）のローカル作業状態であり、別の clone へ Issue やボード設定は引き継がれない。配下を直接参照・編集せず、文書のリンク対象にも含めない。Issue の読取り、Status 更新、Report 追加は mikan MCP だけで行う（初期化だけが CLI の `mikan init`）。
- 使える機能は、`search_tools` で発見し、`get_tool_details` で schema と分類を確認する。読取り専用と分類されたものだけを `call_read_tool`、更新または未分類を `call_write_tool` から呼ぶ。**`get_issue` は未分類で、`call_read_tool` に拒否される**（読むだけと確かめてから、`call_write_tool` を使う。2026-11-21 に確認）。
- **Issue の ID の接頭辞（`RIK`）を、作るたびに確かめる**。2026-11-21 に、RIK-001 を `completed` へ移した直後に、プロジェクトのキーが `MIK`（既定）に戻り、次の Issue が `MIK-001` で作られた（原因は未特定。再現の手順も未確認）。`mikan init -k RIK -n rikai` を、もう一度実行すると、キーが戻る（既存の Issue は消えない。作業用のコピーで確認した）。誤った ID の Issue は、`archived` に移して、作り直した。
- 実装 Issue は **`backlog → ready → active → completed`** の順で進める。各遷移の直前に、現在の Status を再読取りし、期待する前状態に一致することを確認する。

| Status | 扱い |
|---|---|
| `backlog` | 候補。Issue があるだけでは着手許可にならない |
| `ready` | 対象範囲、前提・依存、SPEC の条件と今回の操作権限を確認済み |
| `active` | 実装直前に移す。同時に active の実装 Issue は最大 1 件 |
| `blocked` | 未承認、前提不足、検査失敗、未解決レビュー、merge・同期・受け入れの阻害などを理由付きで記録する |
| `completed` | 必要な検証・レビュー・受け入れ、PR の normal merge、workspace 同期、Report が揃った後にだけ移す |

- 通常の流れ：実装 → 対象と失敗ケースの検証（[検証の入口](#検証の入口)）→ 独立レビュー → 指摘修正 → PR → `main` へ normal merge → **GitButler 同期（`but pull`。毎回）** → Report → Status を再読取りして `completed`。
- 検査失敗・未解決レビュー・未マージ・同期の未完了・受け入れの不足は、`active` または理由付き `blocked` に残し、完成を宣言して次の実装 Issue を開始しない。**人間の確認（実際の Claude Code での通し・実際のマウス操作など。[検証記録](verification.md#人間の確認待ち)）は、別の判断として残る**。Issue の完了は、製品全体の受け入れではない。
- Report に、対象と SPEC 節、実行した確認と結果、独立レビューと指摘対応、PR・merge commit、同期結果、受け入れの範囲、未実施事項を記録する。詳細な実機の証拠は [検証記録](verification.md) へリンクする。
- **Issue・Report・Status にも、利用者の資料・コメントの中身・個人の情報を書かない**（[AGENTS.md](../AGENTS.md#安全とプライバシーこの製品の不変条件)）。

## Git・GitHub・GitButler

リポジトリは GitHub の公開リポジトリ（`takemo101/rikai`）。基本のブランチは **`main`**。**GitButler で進める**：`main` を target（`origin/main`）にする。**作業ツリー（HEAD）は、適用中のブランチの数で変わる**（GitButler 0.23 以降。`but setup` は不要）：0 個なら `main`・1 個ならそのブランチ・**2 個以上を並行して適用したときだけ**、GitButler が管理する `gitbutler/workspace`。この `gitbutler/workspace` は、**手で動かさない**。

`but status` が、このリポジトリで、`but setup` なしに動くことを確認した（2026-11-21。`but` 0.23.2。`main`・`origin/main` が共通の base として出る）。

- **Git の書込みは `but`**。raw Git の `add`・`commit`・`checkout`・`merge`・`rebase`・`push` で書き込まない（読取りは可）。変更は、専用の branch に `but commit -b <branch> -m <message> <ids…>`。`main` へ直接 commit しない。新しい branch は `but branch new <名前>`。
- 変更の確認：`but diff`（未コミットの差分と ID）、`but status`（branch・commit の概観）。ID は、直前の出力からそのまま写す。
- 同期：`but pull`（target の更新を、適用中のブランチに取り込む）。先に確認したいときは `but pull --check`。
- **PR を merge したら、毎回、すぐに同期する**：`but pull` → `but status`（base が merge 後の `main`、統合された branch が消えている。HEAD は `main`、または適用中のブランチ）。同期が済むまで、次の作業・PR を始めない。
- PR：`but pr new <branch> -F <message-file>`（push を含む）。PR を依頼されたときだけ作る。PR の target・head・差分を確かめてから、`main` へ normal merge する。admin・force・保護の迂回・`but land` による PR 回避をしない。
- PR の説明に、変更の内容・確認した範囲・確認していない範囲を書く（[検証手順と記録](verification.md) と整合）。
- push・公開・リリース・認証は、利用者の依頼があるときだけ。**秘密・個人の情報（トークン・API キー・個人のパス・利用者の資料・コメント・サーバーの合言葉）をコミットしない**（コミットの前に確かめる）。`.rikai/` は、`.rikai/.gitignore` で除かれる。
- コミットの作者は、リポジトリの設定（`user.name`・`user.email`）のまま。
- **積んだ PR（スタック）、衝突の解決（`but resolve`）、`but unapply`** は、voice-control の運用で確認された手順があるが、**rikai では、まだ試していない**。必要になったら、`but --help` と voice-control の [開発手順](https://github.com/takemo101/voice-control/blob/main/docs/development.md) を読んで、試してから、この節に書く。

コミットの粒度：利用者に見える一つの変更（実装・文書）を、まとめて 1 commit。無関係な変更を混ぜない。メッセージは、何を・なぜ変えたかを、1 行目に短く（`feat:`・`fix:`・`docs:`・`chore:`）。

## リリース

タグ・GitHub Release・配布物は、まだ決めていない（SPEC §7 の「配布」）。いまの配布は、リポジトリの clone と `install.sh`、各エージェントのプラグイン（README）。リリースを行うときは、利用者の依頼があるときだけ。

### 版（プラグインの更新）

**利用者に見える変更（特に `skills/rikai/` の中身）を `main` に入れるときは、`package.json` と `plugin.json` の `version` を、同じ値に上げる**（`app/test/server/plugin.test.ts` が、食い違いを検出する）。理由：omp・codex・agy は、この版で、入れた複製を管理する。**版を上げないと、更新しても、古い複製のまま**（レビューで、omp と codex で確認）。Claude Code は、`.claude-plugin/` に版がないので、git のコミットで更新される（`.claude-plugin/` に版を足さない：足すと、Claude Code も、上げるまで更新しなくなる）。
