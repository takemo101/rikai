# 参考にした設計原則

実装とレビューで使う、設計原則の選択。製品要件の正本は [SPEC](../SPEC.md)、構成は [構成説明](architecture.md)、書き方は [コーディング指針](coding-guidelines.md)。ここに書いた原則は、設計判断の根拠であり、製品要件ではない。

## 出典と扱い

- 進め方・文書の構成・検証の方法：同じ作者の voice-control（`AGENTS.md`・`docs/`）に倣い、このプロジェクトに合わせて書き直した。**開発の進め方（mikan の Issue 進行・GitButler と PR）は、voice-control と同じ**にした（利用者の判断：2026-11-21）。Swift・音声・Tiny-Jev・製品の不変条件に関するものは、移していない。
- 参考にしたツール（コードは複製していない。考え方と、公開されている仕様の読みだけを借りた）：

| ツール | 借りたこと | 借りなかったこと |
|---|---|---|
| [understand-mode](https://github.com/fkubota/understand-mode) | スキルがローカルのサーバーを起こし、ブラウザで開き、ターンを終える流れ。合言葉つきの URL・`Host`/`Origin` の検査。`marked` → `DOMPurify` → 描画。ライブラリの同梱（オフライン）。作業フォルダの使い捨て | 質問のたびに `claude -p --fork-session` で分身を呼ぶ方式（rikai は、AI のターンを使い、別プロセスを呼ばない）。付箋のキャンバス |
| [human-review](https://github.com/petergyang/human-review) | 選んだ文の位置づけ（`quote`＋前後の文脈、空白を許す再検索）。コメントを Submit で一括して送る。AI が `poll` をバックグラウンドで待ち、終了で再開する。AI の入力の検査 | ファイルの直接編集・移動・画像の貼り付け・localhost のページのレビュー |
| [sideshow](https://github.com/modem-dev/sideshow) | 対象ごとの「ポスト（スレッド）」と版の考え方。内容をデータで渡し、見た目をビューアが持つ（AI が CSS を書かない）。AI が返信・更新・待機を、決まったコマンドで行う | サーバーの常駐・Cloudflare 上の実行・MCP・多様な部品（terminal・trace など） |
| [hunk](https://github.com/modem-dev/hunk)（`hunk-review` スキル） | AI が、複数の注釈を 1 回の入力（`comment apply`）で反映する。反映前に、まとめて検証する | ターミナルの差分ビューア |

- 設計原則の元：[j5ik2o/okite-ai](https://github.com/j5ik2o/okite-ai)（voice-control が参照している）。ほかに、次を参照した。原則の全文・コード例は転載しない。
  - Alexis King, [Parse, don't validate](https://lexi-lambda.github.io/blog/2019/11/05/parse-don-t-validate/)：境界で一度だけ型にする。
  - John Ousterhout『A Philosophy of Software Design』：深いモジュール（小さな口で、多くを隠す）。
  - Gary Bernhardt, [Functional Core, Imperative Shell](https://www.destroyallsoftware.com/screencasts/catalog/functional-core-imperative-shell)：検査・規則と、外との接点を分ける。
  - [OWASP Top 10 for LLM Applications](https://owasp.org/www-project-top-10-for-large-language-model-applications/)：出力の不適切な扱い（AI が書いた文字を、検査せずに表示・実行しない）。
  - 最小権限・多層防御：合言葉・`Host`/`Origin`・CSP・無害化を、重ねる。
- 対象は、ローカルで動く小さなスキルとサーバー。**規模に見合わない儀式は、持ち込まない。**

## 選んだ原則

| 原則 | 判断 | このプロジェクトでの適用 | レビュー質問 |
|---|---|---|---|
| 境界で一度だけ型にする（parse, don't validate） | 採用 | `checkSlug`・`normAnchor`・`normAsk`・`normAnswer`。`apply` は、まとめて検証してから書く | 検証が内側で繰り返されていないか。検査していない値が、保存・表示に届いていないか |
| 非信頼の入力を命令・コードにしない | 採用 | AI の Markdown/HTML は DOMPurify・CSP・Mermaid strict を通す。コメントは `textContent` | AI または利用者の文字が、検査なしに、HTML・URL・属性・パスへ入っていないか |
| 最小権限・多層防御 | 採用 | 127.0.0.1 のみ・合言葉（Cookie）・`Host`/`Origin`・CSP・`sandbox`・`assets/` だけの画像・外部画像のブロック | 1 つの防御が破れても、次が効くか。許可を広げる変更が、SPEC の判断を経ているか |
| 内容はデータで渡し、見た目はビューアが持つ | 採用 | 質問（`ask`）は型つきのデータ。AI は HTML・CSS で UI を作らない（トークンの節約と、安全のため） | AI に書かせている見た目の部分はないか。データにできないか |
| まとめて検証してから書く（all or nothing） | 採用 | `mutate` は、失敗したら何も書かない。`apply` は、書く前に全部検査する | 部分的に書かれて、止まる経路がないか |
| 状態の所有者を 1 か所にする | 採用 | データは `.rikai/` のファイル（書くのは `mutate`）。ブラウザは `S`。表示用の写しを、正本にしない | 同じ情報を、2 か所で持って、ずれる経路がないか |
| 回復できる失敗は型にする | 採用 | `HttpError`。見せ方は `handler`・`main` だけ | 失敗が握り潰されていないか。成功に見える代用品になっていないか |
| 差し替えが要る所だけ抽象化する | 採用 | 抽象は作らない（関数と、素のオブジェクト）。`actions` は、名前で引く表 | 実装が 1 つの抽象がないか |
| 確かめてから「できた」と言う | 採用 | [検証手順と記録](verification.md) に、実際の操作と観測を残す。未確認を、確認済みにしない | 観測の根拠があるか。確認していない範囲を書いたか |
| ファイルを介して渡し合う | 採用 | エージェントとサーバーは、`.rikai/` のファイルを介する（`poll` は、ファイルを見る）。サーバーが止まっても、round は残る | 片方が落ちたとき、渡す途中のデータが失われないか |

## 持ち込まないもの

- **データベース**（SQLite など）。ファイルで足りる間は、足さない。
- **MCP サーバー・常駐のエージェント接続**。スキルとコマンドで足りる間は、足さない（SPEC §5）。
- **WebSocket・SSE**。1.5 秒の確認で足りる間は、足さない。
- **iframe の `html-app`**（AI が書いた JavaScript を動かす部品）。必要になるまで入れない。入れるなら、SPEC §7 の判断と、安全の検査が先。
- **ビルド・バンドル・フレームワーク**（React など）。素の JavaScript で足りる間は、足さない。
- **git でバージョンを管理すること**。版は、ファイルの連番（`vN.md`）で持つ。`.rikai/` を git に入れる前提にしない。
- **DDD の語彙と部品**・リポジトリ・UseCase クラス・全プリミティブのラップ。
- **クラウド・解析・テレメトリ**。

## 調べた外部の機能（確認の状況）

実装の判断に使った、外部の機能。**確認した範囲だけを、確認済みとして書く。** 日付・環境は [検証手順と記録](verification.md#環境記録の前提)。

| 機能 | 用途 | 確認 |
|---|---|---|
| Claude Code のバックグラウンドコマンドの終了での再開 | `rikai poll` の終了で、AI が起きる | **未確認**（human-review の `SKILL.md` の記述による）。実際の Claude Code での通しは、人間の確認待ち |
| DOMPurify の属性の除去 | `data-mermaid` に図のソースを入れる | **確認済み（落とし穴）**：属性値に `-->` を含むと、属性ごと消える。ソースを URI エンコードして持つことで、回避した（DOMPurify 3.4.18） |
| marked の `renderer.code` が `false` を返すと既定の描画に戻る | Mermaid のコードブロックだけを差し替える | **確認済み**（marked 18.2.1） |
| mermaid の `render` と CSP（`script-src 'self'`・`style-src 'unsafe-inline'`） | 図を描く | **確認済み**：`flowchart`・`sequenceDiagram` が描ける（mermaid 12.3.0。Chromium） |
| `Range`／`Selection`／`compareBoundaryPoints` | 選んだ文のアンカー化 | **確認済み**（Chromium）。Safari・Firefox は未確認 |
| `Atomics.wait`（メインスレッドでの同期の待ち） | ロックの競合時の待ち（`sleepSync`） | **未確認**：ロックが競合する経路は、検証で通っていない。サーバーのイベントループを止める（[構成説明の負債](architecture.md#既知の構造上の負債)） |
| `gh pr merge --merge` | PR を merge commit で入れる | **確認済み**（初回の PR #1。GitButler を使う前の、`gh` による手順） |
