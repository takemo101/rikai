# ドキュメント案内

rikai の補助文書の入口。製品要件・受け入れ条件・対象外の唯一の正本は、ルートの [SPEC.md](../SPEC.md)。`docs/` は、仕様を別管理する場所ではなく、構成の理解・開発手順・検証・書き方のために使う。

## 文書の役割

| 文書 | 答えること | 管理しないこと |
|---|---|---|
| [README](../README.md) | どんなツールか、いま何ができるか、どう使うか | 詳細な要件・検証の記録 |
| [SPEC](../SPEC.md) | 何を満たすか・何を対象にしないか、実装の状態、未決事項、利用者の判断 | 検証の成功証拠 |
| [開発規約](../AGENTS.md) | どう調査・変更・検証・文書更新するか、守る不変条件 | 製品仕様の複製・作業履歴 |
| [開発手順](development.md) | 実行・検証・インストール・ライブラリの更新・mikan の Issue 進行・GitButler・PR を、どう進めるか | 追加の実施権限・Issue 状態の複製 |
| [構成説明](architecture.md) | ファイルの責務・状態の所有・時間と並行・失敗・信頼の境界はどう関係するか。既知の負債 | 確定 API・検証の結果 |
| [コーディング指針](coding-guidelines.md) | 書き方の具体的な規則（境界・失敗・並行・DOM・サーバー・スキル・テスト） | 製品要件 |
| [参考にした設計原則](references.md) | どのツール・原則を参考にし、何を選ばなかったか。調べた外部の機能と確認の状況 | 製品要件・原則の全文 |
| [リファクタリングの観点](refactoring.md) | 動作を変えずに見直すときの観点と進め方 | 製品要件・実施権限・スコア化 |
| [検証手順と記録](verification.md) | 条件をどう観測し、何をいつ確認したか、何が人間の確認待ちか | 新しい合格条件・未実施の成功 |
| [スキル本体](../skill/rikai/SKILL.md) | エージェントが `/rikai` で読む手順（資料の作り方・待ち方・返信の方針・`apply` の入力） | コマンドの実装 |

文書間で矛盾を見つけたら、派生文書を根拠に製品要件を変更しない。SPEC の該当節と利用者の判断を確認し、必要な修正を、関係する文書へ反映する。

## 読む順序

- **ツールを知る**：README → SPEC の位置づけ・機能要件・対象外 → [SKILL.md](../skill/rikai/SKILL.md)。
- **作業を始める**：SPEC の対象節と §6・§7 → [開発規約](../AGENTS.md)・[開発手順](development.md) → [構成説明](architecture.md)の該当箇所 → [コーディング指針](coding-guidelines.md) → 実際のソース。
- **設計を判断する**：[参考にした設計原則](references.md) → [構成説明](architecture.md)。見直すときは、[リファクタリングの観点](refactoring.md)。
- **動作を確かめる**：SPEC の受け入れ条件と §6 → [検証手順と記録](verification.md)。設計の説明だけで、動作確認を済ませない。
- **結果を判断する**：検証記録 → SPEC の状態。自動の観測（いまは手作業の観測）と、人間の確認を区別する。

## 配置

```text
README.md              概要・使い方
SPEC.md                製品要件・状態・対象外・未決事項・利用者の判断
AGENTS.md              開発規約・不変条件
LICENSE                MIT
install.sh             skill/rikai/ を ~/.claude/skills/rikai/ へ複製する（CLAUDE_SKILLS_DIR で変更）
package.json           npm test（`node --test test/*.test.js`）だけ。依存はない
test/                  自動テスト（node:test）。helpers.js・store・actions・ask・apply・poll・anchor・diff・progress・server
skill/rikai/
  SKILL.md             エージェント向けの手順（/rikai）
  rikai.js             コマンドの入口（new・open・poll・pull・apply・status・stop）と、サーバーの起動。Node 18+・依存なし
  lib/
    util.js            共通の小さな道具（エラー・時刻・JSON・入力の整形）
    store.js           .rikai の読み書き・ロック・mutate・データの形の版（ルートの状態を持つ）
    ask.js             ask の検査（質問・回答）
    actions.js         画面からの操作（comment・reply・answer・edit・delete・resolve・submit・end）
    agent.js           AI 向け（poll・pull・apply・status）
    server.js          HTTP サーバー（認証・配信・API）
  public/
    index.html         画面の骨組み
    app.js             ビューア（描画・コメントの位置づけ・パネル・ask）
    anchor.js          コメントの探し直し（DOM に触れない関数。ブラウザと Node のテストが共有）
    diff.js            版どうしの差分（DOM に触れない関数。ブラウザと Node のテストが共有）
    progress.js        理解の進み具合の数え方（DOM に触れない関数。ブラウザ・サーバー・Node のテストが共有）
    style.css          見た目
    favicon.svg
    vendor/            同梱: marked・DOMPurify・mermaid と、各ライセンス（書き換えない）
docs/
  README.md            この索引
  development.md       実行・検証・インストール・ライブラリの更新・mikan の Issue 進行・GitButler・PR
  architecture.md      構成・状態の所有・時間と並行・信頼の境界・負債
  coding-guidelines.md 書き方の規則
  references.md        参考にしたツール・設計原則・外部の機能の確認状況
  refactoring.md       リファクタリングの観点と進め方
  verification.md      検証の手順・記録・人間の確認待ち
```

利用者のデータ（`<project>/.rikai/`）は、リポジトリの外（それぞれのプロジェクトの中）にあり、既定で git に入らない。`.mikan/`（Issue の作業状態）も、Git 対象外（`.git/info/exclude`）のローカルの状態で、文書のリンク対象にしない。

## 更新時の扱い

- 製品の意味・範囲を変えるときは、SPEC を正本とする。補助文書に同じ値を別管理せず、必要な節へ参照する。実装が進んだら、SPEC §6 の「状態」を、同じ変更で更新する。
- 構成説明は、選択した境界と理由。検証記録は、実際の操作と観測。**説明・予定・結果を混ぜない。**
- 文書を追加・移動・削除したら、この索引と参照元を、同じ変更で更新する。見出しを変えたら、その見出しを参照するリンクも確認する。
- 未実施・失敗・限定的な成功を残す。後の修正や再試行は、別の記録として結び付け、過去の証拠を、全面的な成功へ書き換えない。
- 利用していないツールの操作手順や、架空のコマンドを案内しない。
