# 検証手順と記録

[SPEC](../SPEC.md) の条件を、どう観測し、何をいつ確認したか。**未実施・失敗・限定的な成功を残す。過去の記録を、後から、全面的な成功へ書き換えない。** 設計の説明は [構成説明](architecture.md)。

## 環境（記録の前提）

| 項目 | 値 |
|---|---|
| 日付 | 2026-11-21 |
| OS・機種 | macOS 27（darwin 27.0.0）・Apple silicon |
| Node.js | 24.15.0（npm 11.12.1） |
| ブラウザ | Chromium 系（エージェントのブラウザ操作ツール `browser`。画面は 1495×1348 の PiP の領域） |
| 同梱ライブラリ | marked 18.2.1・DOMPurify 3.4.18・mermaid 12.3.0 |
| 対象のコミット | `main`（PR #1 の merge 後。初期実装 `0166841`） |
| 使った環境 | 一時のプロジェクト（`/tmp/rk-proj`。`--root` で指定）。作り物の題材（トピック `auth-flow`・「認証の流れ」）。終わったあと、サーバーを `rikai stop` で止め、一時のものを消した |

## 検証の入口

[開発手順](development.md#検証の入口) を参照。**自動テストは、まだない。** 下の記録は、すべて、手作業（コマンド・HTTP の直接の呼び出し・ブラウザの操作）の観測。

**検証は、作り物の資料・コメントで行う。** 利用者の実際の資料・コメントを使わない。画面の内容・コメントを、記録（ファイル・文書）に、そのまま残さない。

## 記録

### 初期実装の通し（2026-11-21）

**対象**：SPEC F1〜F17・N1〜N5。**操作**：次の順に、コマンドと、ブラウザ（`browser`）で行った。

1. `rikai new auth-flow …`（標準入力から Markdown。Mermaid・表を含む）→ `rikai open … --no-open`。
2. 合言葉なしで `GET /api/topics`。→ **403**。
3. HTTP で `POST /api/comment`（アンカーつき）→ `POST /api/submit`（round 1）→ `rikai pull`・`rikai poll`。
4. 誤った `apply`（存在しない `thread`・空の `body`・不正な ID・存在しない `parent`・存在しないページへの改訂）→ `errors` が 6 件返り、終了コード 1。
5. 正しい `apply`（返信・改訂・子ページ・AI 起点のスレッド・`ask`）→ `handledRounds:[1]`・`newPages`・`revised:{root:2}`・`repliedThreads`・`newThreads`。`rikai status` で `pendingRounds:[]`。
6. 待機中の `rikai poll`（バックグラウンド）が、別の呼び出し（`POST /api/submit`。全体メモのみ）で終わること（round 2。`items:[]`・`overallNote`）。
7. ブラウザで、トピックを開く：Mermaid の図・表・変更ブロックの印（v2 の新しい段落と直した段落）・スレッド 2 件（文のアンカーの強調・`ask`・「詳しく見る」カード・「資料を v2 に更新」）。
8. ブラウザで、本文の文を選択（合成した `Selection` ＋ `mouseup`）→「コメント」→ 追加。ブロック（表）の「＋」→ ブロックへのコメント。
9. ブラウザで、`single_choice` の回答を選んで「回答を保存」、`multi_choice` も。→「保存済み（未送信）」・「Submit (4)」。
10. ブラウザで Submit（全体メモつき）→ round 3。`rounds/003.json` に、回答（`answer`）・コメント（`comment`）・全体メモが入る。
11. `apply`（返信 4 件・v3 への改訂・子ページ `token-issue`。子ページに画像・`<script>`・`<img onerror>`・`[x](javascript:…)` を含む）→ `handledRounds:[2,3]`。
12. ブラウザが自動で v3 に追従し、「AIの返信待ち」が消え、4 つのスレッドが「AIの返信」になること。変更ブロックの印（表・追加の段落）。外部画像のブロック（`.img-blocked` が 1）。
13. 「詳しく見る」→ 子ページ：パンくず（「認証の流れ › トークンの発行」）・`assets/shot.png` の表示（`naturalWidth > 0`）。`<script>`・`onerror` 属性は 0 件。`javascript:` のリンクは出ない（文字として表示）。
14. 版の切り替え（`#/auth-flow/root/v1`）：「過去の版 v1 を表示中」・最新版へのリンク・後の版のコメントの印。
15. 返信を追加 → 編集 → 「理解できた（解決）」→「解決済み (1)」に折りたたまれる。「Submit (2)」。
16. `install.sh` を、`CLAUDE_SKILLS_DIR=/tmp/rk-skills` で実行し、`SKILL.md`・`public`・`rikai.js` がコピーされること。

**観測した結果**：上の 1〜16 は、期待どおり（または、下の不具合を直したあとで、期待どおり）。

**見つけて、直した不具合**（どちらも、この通しの中で見つけ、同じ初期実装の PR に含めた）：

| 不具合 | 原因 | 直し方 |
|---|---|---|
| `rikai poll`・`pull` の出力の `status` が `feedback` でなく `pending` だった | round のレコードの `status: 'pending'` が、出力の `status: 'feedback'` を上書きしていた（`{status:'feedback', ...round}` の順） | 出力を `{...round, status:'feedback'}` の順にした。直したあと、`poll` が `feedback` を返すことを確認 |
| Mermaid の図が、すべて「図を描画できませんでした」になった | 図のソースを `data-mermaid` 属性に入れていたが、DOMPurify が、値に `-->` を含む属性を、属性ごと除いていた（図のソース `A --> B`） | 図のソースを `encodeURIComponent` で持ち、描画の直前に復号する。直したあと、本文と返信の両方で、図が描画されることを確認 |

**制約・確認していない範囲**（SPEC §6 の「一部」の理由）：

- **マウスを置いて「＋」が出ること**：エージェントのブラウザ操作の `hover` が、ページへ実際の `mousemove` を届けなかった（ページ側のリスナーで、0 回を確認）。合成した `mousemove`（`dispatchEvent`）では、ボタンが出て、クリックでコメントになった。**実際のマウス入力は、未確認**。
- **文の選択**：合成した `Selection` ＋ `mouseup`。マウスのドラッグでの選択は、未確認。
- 次は、操作していない：コメントの**削除**・回答の**取り消し**・`yes_no`・`scale`・`free_text`・`allowOther`・**「再開」**・複数トピックの切り替え・「終了」・サーバーの自動終了・`rikai stop` 以外のサーバーの終わり方・`pull` の「まだない」・`apply` の `round` 指定・`unansweredThreads`・書き換わって消えた文の「修正で文が変わりました」・ブロックへのコメントの版をまたぐ追従・`page:` の本文中のリンク・Submit に送るものがないときの拒否・`Host`/`Origin` の拒否・ロックの競合。
- **ほかのブラウザ（Safari・Firefox）・Windows・Linux**：未確認。
- **長い資料・多数のスレッド**での速さ：未測定。
- 自動テスト：なし。

### 人間の確認待ち

AI は、これらを合格にしない。

| 確認すること | 期待 |
|---|---|
| **実際の Claude Code で、`/rikai` を使って通す** | `install.sh` のあと、Claude Code を開き直すと `/rikai` が使える。依頼 → 資料の生成 → URL → ブラウザでコメント → Submit → **`rikai poll`（バックグラウンド）の終了で、Claude が再開する** → 返信と新版が出る。`poll` を、再度起動する |
| 実際のマウス・キーボードでの操作 | 文のドラッグ選択・「＋」・⌘/Ctrl＋Enter での追加・ダイアログ |
| 「送りました」の経路 | Claude Code 以外（Codex など）で、`rikai pull` から返信までを通す |
| AI の返信の質 | SKILL.md の方針（結論から・誤りの訂正・理解の確認・質問の出しすぎ）が、実際の AI の振る舞いに出るか |
| 実際の資料での使い心地 | 長い資料・多数のスレッド・日本語以外 |
| ほかのブラウザ・OS | Safari・Firefox・Linux・Windows |

## 更新の扱い

- 新しい確認を足すときは、日付・環境・操作・観測・制約を書く。過去の記録は、書き換えず、新しい記録で結び付ける。
- 確認が済んだら、SPEC §6 の「状態」を、同じ変更で更新する。
