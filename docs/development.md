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

- Node.js 18 以上（作者の環境の確認は 24.15.0。[検証記録](verification.md#環境記録の前提)）。npm のパッケージは要らない。
- ブラウザ：Chromium 系で確認した。Safari・Firefox は未確認。
- OS：macOS で確認した。Linux・Windows は未確認。
- `rsync`（`install.sh` が使う）。

## 実行

リポジトリのまま動かせる。**`--root` で、一時のプロジェクトを指す**（実際のプロジェクトの `.rikai/` を、触らない）。

```bash
RK="node $PWD/skill/rikai/rikai.js --root /tmp/rk-dev"
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

変更の確認は、**自動テスト（`npm test`）と、手作業**で行う。結果は [検証手順と記録](verification.md) に、日付と環境つきで残す。

```bash
npm test        # node --test test/*.test.js。追加の依存なし（Node 18 以上）。ブラウザ・実際のエージェントは使わない
```

| テスト（`test/`） | 試すこと |
|---|---|
| `store.test.js` | トピックの作成と検査・`mutate` が失敗したら何も書かず、ロックを残さないこと・`rev` |
| `actions.test.js` | 画面からの操作（コメント・返信・編集・削除・解決・Submit）の検査と、Submit の中身 |
| `ask.test.js` | `ask` と回答の検査（5 つの型）・回答の流れ・送信済みの回答の拒否 |
| `apply.test.js` | `apply` の検証（誤りを全部返して、何も書かない）・反映・`round` 指定・二重の改訂・未返信の通知 |
| `poll.test.js` | `peek`（`poll`・`pull` の出力）・`closed`・全トピックが閉じたときの合図 |
| `anchor.test.js` | `findQuote`・`locateBlock`・`similarity`（コメントの探し直し） |
| `diff.test.js` | `diffText`（元に戻せること・変更箇所・大きな入力）・`matchBlocks`（同じ・変更・追加・削除・種類の違い・区間の制約・空・重複） |
| `server.test.js` | 実際に待ち受けて、合言葉・`Host`・`Origin`・Cookie・CSP・配信のパス・`rikai open` の `.server.json` の権限（0600） |

`test/helpers.js` が、一時のプロジェクト（`os.tmpdir()`）と、作り物の資料・コメントを用意する。利用者の `.rikai/` には触れない。**ブラウザの描画（DOMPurify・選択・パネル）は、DOM が要るので、自動テストの対象外**。次の手作業で確かめる。

| 目的 | 方法 |
|---|---|
| コマンドの経路（作る → Submit → 読む → 反映） | 上の「実行」。ブラウザの代わりに、HTTP を直接叩ける（`.server.json` の `port`・`token`、ヘッダー `X-Rikai-Token`。`POST /api/comment`・`/api/submit` など） |
| `apply` の検証 | 誤った JSON（存在しない `thread`・空の `body`・不正な ID・存在しない `parent`）を流して、`errors` が返ること。成功する入力を流して、`handledRounds`・`newPages`・`revised` が返ること |
| 画面 | ブラウザで `open` の URL を開き、コメント・Submit・`apply` の反映・版の切り替え・子ページへの遷移を操作する。画面の確認に、作り物の内容を使う |
| 無害化 | 資料に `<script>`・`<img onerror>`・`[x](javascript:…)`・外部の画像 URL を入れて、実行されない・表示されないこと |
| 認証 | 合言葉なしの `GET /api/topics` が 403 になること |
| インストール | `CLAUDE_SKILLS_DIR=/tmp/x bash install.sh`。実際の `~/.claude/skills` へは、依頼があるときだけ |

自動テストを足すときは、`test/<領域>.test.js` に、Node 標準の `node:test` と `node:assert/strict` で書く（依存を増やさない）。**足したテストは、実装を壊して（たとえば、検査を外して）、落ちることを、一度確かめる**。

## 変更の進め方

1. 守る振る舞い（SPEC の該当 ID）を確かめる方法があるか見る。なければ、先に決める（上の表）。
2. 変更して、上の方法で確かめる。
3. SKILL.md に影響するか確かめる（`apply` の入力・`ask` の型・コマンド・待ち方）。影響すれば、同じ変更で直し、**直した例の入力を、実際に `apply` に流す**。
4. SPEC（要件・§6 の状態）・構成説明・検証記録・README に影響するなら、同じ変更で更新する（[AGENTS.md](../AGENTS.md#文書とツールの保守)）。

### コマンドを足す

1. `rikai.js` の `main()` の `switch` に `case` を足す。引数の解釈は `parseArgs`（値を取るオプションは、`flags`。値を取らないものだけ、`no-open`・`force` の並びに足す）。
2. `HELP` に 1 行足す。
3. 規則・検査は、コマンドの関数に置く（`main()` に書かない）。失敗は `HttpError` を投げる（`main()` が `{ok:false,errors}` と終了コード 1 にする）。
4. `SKILL.md` の手順・`README.md` のコマンド表・`docs/development.md` の表を直す。

### ask の型を足す

1. `rikai.js`：`ASK_TYPES`・`normAsk`（AI の入力の検査）・`normAnswer`（人間の回答の検査）。
2. `app.js`：`askDraftValid`・`renderAsk`（入力の描画・下書き）。
3. `SKILL.md` の `ask` の表と、SPEC F10 を直す。

## データの形を変えるとき

`meta.json` の `schema`（`rikai.js` の `SCHEMA`。いまは 1）が、データの形の版（SPEC N7）。版は `meta.json` にだけ書く。`threads.json`・`rounds/`・`pages/` の形の変更も、この版を上げて表す。**既存の `.rikai/` を、壊さない**。

- 形を**足すだけ**（古い形に、新しい項目がなくても読める）なら、版は上げない。読む側が、項目がなくても動くようにする。
- 形を**変える・消す**（古い形のままでは読めない）ときは、次の順で行う。
  1. `SCHEMA` を 1 つ上げる。
  2. 古い形を、新しい形へ読み替える移行を足す。`meta.json` の変更は `loadMeta`、`threads.json` の変更は `loadThreads`（**それぞれ、読む場所**。`loadMeta` を通らずに `loadThreads` を呼ぶ経路がある：`topicState`・`peek`・`cmdStatus`）で、版（`meta.json` から読む）を見て、1 つずつ上げる関数にする。**`meta.json` だけを読み替えて、`schema` を新しい版で保存すると、`threads.json` が古い形のまま、新しい版と書かれてしまう**。`mutate` が保存するのは、`meta.json` と `threads.json` だけなので、この 2 つは、同じ `mutate` の中で、まとめて読み替えて保存する。**`rounds/` の各ファイルは、`mutate` では保存されない**（`submit` が作り、`cmdApply` が `handled` にするときだけ書き換える）。`rounds/` の形を変えるときは、`meta.json` の版ではなく、**ファイル自身の形**（項目の有無）で判断して読み替えるか、`mutate` が、全部の round を書き換えるように広げる。移行は、読んだ値を直すだけにして、保存は、次の `mutate` に任せる（読むだけの操作が、ファイルを書き換えない）。
  3. 古い形のデータを入れた自動テストを足す（`test/store.test.js` の「版のない古い形」を参考に）。
  4. SPEC N7・構成説明・この節を更新する。
- 新しい rikai で作られたトピックを、古い rikai が開くと、409 で断る（何も書き換えない）。古い rikai を使い続ける人は、`rikai` を更新する。

## 同梱ライブラリの更新

`skill/rikai/public/vendor/` に、固定した版を置いている（オフラインで動かすため）。そのぶん、脆弱性の修正が自動では入らない。ときどき確かめる。

| ライブラリ | 版（2026-11-21 に取得） | 写すファイル | 置き名 |
|---|---|---|---|
| marked | 18.2.1 | `lib/marked.umd.js` | `marked.min.js` |
| DOMPurify | 3.4.18 | `dist/purify.min.js` | `purify.min.js` |
| mermaid | 12.3.0 | `dist/mermaid.min.js` | `mermaid.min.js` |

```bash
mkdir /tmp/rv && cd /tmp/rv && npm init -y && npm i marked dompurify mermaid
npm audit          # 修正のある版を探す
```

写したら、ライセンス（`node_modules/<名前>/LICENSE` → `vendor/LICENSE-<名前>`）も更新し、画面で、Mermaid の図・表・無害化（[検証の入口](#検証の入口)）を確かめる。marked の描画 API（`renderer.code({text, lang})`）が変わると、`app.js` の `marked.use` を直す必要がある。DOMPurify の設定（`PURIFY`）の挙動も、版で変わりうる。

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

タグ・GitHub Release・配布物は、まだ決めていない（SPEC §7 の「配布」）。いまの配布は、リポジトリの clone と `install.sh`。リリースを行うときは、利用者の依頼があるときだけ。
