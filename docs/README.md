# ドキュメント案内

rikai の補助文書の入口。製品要件・受け入れ条件・対象外の唯一の正本は、ルートの [SPEC.md](../SPEC.md)（索引）と、その機能一覧から入る [機能の文書](features/)。`docs/` は、仕様を別管理する場所ではなく、構成の理解・開発手順・検証・書き方のために使う（機能の文書・状態・決定の記録は、SPEC.md の一部として `docs/` に置く）。

## 文書の役割

| 文書 | 答えること | 管理しないこと |
|---|---|---|
| [README](../README.md) | どんなツールか、いま何ができるか、どう使うか | 詳細な要件・検証の記録 |
| [SPEC](../SPEC.md) | 何を満たすか・何を対象にしないか（位置づけ・用語・機能の一覧・非機能要件 N1〜N7・対象外・未決事項）。索引 | 機能の要件の本文・検証の成功証拠 |
| [機能の文書](features/)（`docs/features/<group>.md`。12 個） | 機能グループ別の要件の本文（`### F43 …` の F-ID の見出し。受け入れ条件）。入口は SPEC.md §3 の一覧 | 実装の状態・検証の成功証拠 |
| [実装の状態](status.md) | 行ごとの状態（確認済み・未確認）と、確認した範囲・未確認の範囲（SPEC §6） | 新しい要件 |
| [決定の記録](decisions/README.md)（`docs/decisions/`） | 利用者の決定（日付つきの表：[user-decisions.md](decisions/user-decisions.md)＝SPEC §8）と、AI の設計の判断（ADR：`NNNN-<題>.md`。理由・採らなかった案） | 要件の本文・検証の記録 |
| [開発規約](../AGENTS.md) | どう調査・変更・検証・文書更新するか、守る不変条件 | 製品仕様の複製・作業履歴 |
| [開発手順](development.md) | 実行・検証・インストール・ライブラリの更新・mikan の Issue 進行・GitButler・PR を、どう進めるか | 追加の実施権限・Issue 状態の複製 |
| [構成説明](architecture.md) | ファイルの責務・状態の所有・時間と並行・失敗・信頼の境界はどう関係するか。既知の負債 | 確定 API・検証の結果 |
| [コーディング指針](coding-guidelines.md) | 書き方の具体的な規則（境界・失敗・並行・DOM・サーバー・スキル・テスト） | 製品要件 |
| [参考にした設計原則](references.md) | どのツール・原則を参考にし、何を選ばなかったか。調べた外部の機能と確認の状況 | 製品要件・原則の全文 |
| [リファクタリングの観点](refactoring.md) | 動作を変えずに見直すときの観点と進め方 | 製品要件・実施権限・スコア化 |
| [検証手順と記録](verification.md) | 条件をどう観測し、何をいつ確認したか、何が人間の確認待ちか | 新しい合格条件・未実施の成功 |
| [スキル本体](../skills/rikai/SKILL.md) | エージェントが `/rikai` で読む手順（資料の作り方・待ち方・返信の方針・`apply` の入力）。必要な場面で読む補助は `skills/rikai/references/`（`html-app.md`・`doc-format.md`・`poll-output.md`・`viewer.md`・`drawio.md`） | コマンドの実装 |

文書間で矛盾を見つけたら、派生文書を根拠に製品要件を変更しない。SPEC の該当節と利用者の判断を確認し、必要な修正を、関係する文書へ反映する。

## 読む順序

- **ツールを知る**：README → SPEC の位置づけ・機能の一覧・対象外 → 関係する[機能の文書](features/) → [SKILL.md](../skills/rikai/SKILL.md)。
- **作業を始める**：SPEC.md の関係する節と、機能の文書（F-ID の見出し）・[実装の状態](status.md)・SPEC §7（未決事項） → [開発規約](../AGENTS.md)・[開発手順](development.md) → [構成説明](architecture.md)の該当箇所 → [コーディング指針](coding-guidelines.md) → 実際のソース。
- **設計を判断する**：[参考にした設計原則](references.md) → [構成説明](architecture.md)。見直すときは、[リファクタリングの観点](refactoring.md)。
- **動作を確かめる**：機能の文書の受け入れ条件と [実装の状態](status.md) → [検証手順と記録](verification.md)。設計の説明だけで、動作確認を済ませない。
- **結果を判断する**：検証記録 → [実装の状態](status.md)。自動の観測（いまは手作業の観測）と、人間の確認を区別する。
- **なぜそうしたかを知る**：[利用者の決定](decisions/user-decisions.md) → その範囲の設計の判断（[ADR](decisions/README.md)）。

## 配置

```text
README.md              概要・使い方
SPEC.md                製品要件の索引（位置づけ・用語・機能の一覧・非機能要件・対象外・未決事項）
AGENTS.md              開発規約・不変条件
LICENSE                MIT
install.sh             skills/rikai/ を ~/.claude/skills/rikai/ へ複製する（CLAUDE_SKILLS_DIR で変更）
package.json           pnpm のスクリプト（`test`・`test:e2e`・`build`・`typecheck`・`lint`・`format`。`app/` へ渡す）と、pi のパッケージの宣言（`pi`）・版。`dependencies` はない
pnpm-workspace.yaml    pnpm のワークスペースの設定（`app/`）。`pnpm-lock.yaml`：依存の固定
plugin.json            プラグインの宣言（codex・omp・agy。Agent Plugins 1.0.0）
.claude-plugin/        Claude Code・grok のプラグインの宣言（plugin.json・marketplace.json）
.agents/plugins/       codex のカタログ（marketplace.json）
app/                   開発用のワークスペース（TypeScript）。依存・設定（`package.json`・`tsconfig.json`・`biome.json`・`vitest.config.ts`・`vitest.web.config.ts`・`vite.config.ts`・`playwright.config.ts`）はここ
  src/cli/             コマンドの入口（main.ts）と引数の解釈（args.ts）
  src/server/          util・store・ask・actions・agent・app（Hono）・appframe・serve・image・htmlapp・htmlapp-core・htmlapp-worker
  src/shared/          共有の純粋な関数・型：anchor・diff・progress・types・api
  src/web/             画面（React）：api/・store/・doc/（本文の島。render/）・overlay/・panel/・interact/・layout/・lib/・**機能フォルダ 3 つ（`compare/`〔版を並べて比べる〕・`focus/`〔拡大表示〕・`htmlapp/`〔html-app の枠と橋〕。それぞれ CSS も持つ。他は層のまま：[architecture](architecture.md)）**・styles/・public/（favicon・`assets/theme-init.js`：外観を、描く前に付ける）・index.html・main.tsx・App.tsx
  scripts/             ビルド：build.ts（サーバー・CLI）・licenses-plugin.ts（画面のライセンス表。`vite.config.ts` が使う）
  test/                自動テスト（Vitest）。server/・shared/・web/（jsdom）・build.test.ts・setup/
  e2e/                 e2e（Playwright。実際の Chrome。`pnpm run test:e2e`）。*.spec.ts・fixtures.ts・env.ts
skills/rikai/
  SKILL.md             エージェント向けの手順（/rikai）。本体（毎回読む）
  references/          SKILL.md の補助（必要な場面で読む：html-app.md・doc-format.md・poll-output.md・viewer.md・drawio.md）
  rikai.js             ビルドしたバンドル（コマンドの入口と、サーバー。依存を含めて 1 ファイル。`app/src/` から生成。コミットする）
  rikai-htmlapp-worker.js  ビルドした worker（html-app の取り出し。rikai.js の横に置く）
  THIRD-PARTY-LICENSES.txt  サーバー・CLI のバンドルに入った依存のライセンス（ビルドで生成）
  public/              画面のビルド出力（Vite。`app/src/web/` から生成。コミットする。手で編集しない）
    index.html         画面の入口
    favicon.svg
    assets/            ハッシュなしの名前の JS・CSS（Mermaid の図の種類ごとの chunk を含む）
    THIRD-PARTY-LICENSES.txt  画面のバンドルに入った依存のライセンス（ビルドで生成）
docs/
  README.md            この索引
  development.md       実行・検証・インストール・ライブラリの更新・mikan の Issue 進行・GitButler・PR
  architecture.md      構成・状態の所有・時間と並行・信頼の境界・負債
  coding-guidelines.md 書き方の規則
  references.md        参考にしたツール・設計原則・外部の機能の確認状況
  refactoring.md       リファクタリングの観点と進め方
  verification.md      検証の手順・記録・人間の確認待ち
  status.md            実装の状態（行ごとの状態・確認した範囲。SPEC §6）
  features/            機能の要件の本文（機能グループ別の 12 文書。F-ID の見出し）：ai-commands・doc-format・comments・region-element・zoom・versions・threads・topics-pages・turn-notify・appearance・html-app・ui-cleanup
  decisions/           決定の記録（SPEC §8）：README.md（ADR の一覧と足し方）・user-decisions.md（利用者の決定）・`NNNN-<題>.md`（AI の設計の判断。ADR）
```

利用者のデータ（`<project>/.rikai/`）は、リポジトリの外（それぞれのプロジェクトの中）にあり、既定で git に入らない。`.mikan/`（Issue の作業状態）も、Git 対象外（`.git/info/exclude`）のローカルの状態で、文書のリンク対象にしない。

## 更新時の扱い

- 製品の意味・範囲を変えるときは、SPEC.md と機能の文書を正本とする。補助文書に同じ値を別管理せず、必要な節へ参照する。実装が進んだら、[実装の状態](status.md)（SPEC §6）の「状態」列を、同じ変更で更新する（SPEC.md の機能一覧の「状態」も合わせる）。**新しい追記の場所は、[AGENTS.md](../AGENTS.md#新しい追記の場所)**。
- 構成説明は、選択した境界と理由。検証記録は、実際の操作と観測。**説明・予定・結果を混ぜない。**
- 文書を追加・移動・削除したら、この索引と参照元を、同じ変更で更新する。見出しを変えたら、その見出しを参照するリンクも確認する。
- 未実施・失敗・限定的な成功を残す。後の修正や再試行は、別の記録として結び付け、過去の証拠を、全面的な成功へ書き換えない。
- 利用していないツールの操作手順や、架空のコマンドを案内しない。
