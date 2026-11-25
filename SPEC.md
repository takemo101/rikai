# rikai 仕様

製品要件・受け入れ条件・対象外・未決事項の**唯一の正本**。実装の状態は §6（[docs/status.md](docs/status.md)）の「状態」列。派生文書（[構成説明](docs/architecture.md)・[検証手順と記録](docs/verification.md) など）は、ここを根拠にし、要件を別管理しない。要件に影響する判断は、利用者の判断を反映して、ここを更新する。

**この SPEC.md は索引**：位置づけ・用語・機能の一覧・非機能要件・対象外・未決事項を持つ。機能の要件の本文は、グループ別の文書 [docs/features/](#3-機能要件)（F-ID の見出し）、実装の状態は [docs/status.md](docs/status.md)、利用者の決定は [docs/decisions/user-decisions.md](docs/decisions/user-decisions.md)、AI の設計の判断は ADR（[docs/decisions/](docs/decisions/README.md)）にある。**新しい要件・状態・決定を、どこに書くか**は、[AGENTS.md](AGENTS.md#新しい追記の場所)。**この製品の安全の不変条件（N1〜N4・N6。特に、AI が書いた HTML・JavaScript を隔離する N3）は、[§4](#4-非機能要件)。**

## 1. 位置づけ

資料にコメントして Submit すると、AI が**返信**と**資料の修正（新しい版）**で答える。このループを何度も回して、資料の内容を**理解できるまで**詰める**試作**。エージェント（主に Claude Code）のスキル `/rikai` と、そのスキルが起こすローカルのビューアで成り立つ。

- 資料は AI が作る（説明・PR の解説・設計・コードの解説）。理解するのは人間。
- 人間が書いたコメントは、AI が**資料の直し**と**返信**で受ける。AI は、理解を確かめる質問（選択肢・Yes/No など）も返す。
- 動くのは、Node.js 22 以上のある環境（確認したのは macOS だけ。[検証記録](docs/verification.md)）。
- 機能の層は決めていない。**新しい機能は、確認がそろうまで §6 の状態に「未確認」と残す。**

### 近いもの（参考にしたもの）

出典と、採用・不採用は [参考にした設計原則](docs/references.md)。

| 参考 | 借りたこと |
| --- | --- |
| [understand-mode](https://github.com/fkubota/understand-mode) | スキル → ローカルサーバー → ブラウザ、の流れ。無害化して描くビューア。合言葉つきの URL |
| [human-review](https://github.com/petergyang/human-review) | 文字列＋前後の文脈によるコメントの位置づけ。Submit で一括して送る。バックグラウンドの `poll` で AI を起こす |
| [sideshow](https://github.com/modem-dev/sideshow) | 対象ごとのスレッドと版。内容はデータで渡し、見た目はビューアが持つ |
| [hunk](https://github.com/modem-dev/hunk) | AI がまとめて注釈を付ける（`comment apply`）。1回の入力で複数を反映する |

## 2. 用語

| 用語 | 意味 |
| --- | --- |
| トピック | 理解の対象 1 つ。`.rikai/<topic>/` に保存する（`<topic>` は英小文字・数字・ハイフンで 48 字以内） |
| ページ | トピックの中の資料 1 枚。`root`（本編）と、返信から生える子ページ。ページごとに版を持つ |
| 版 | ページの Markdown の改訂。`v1`、`v2`…。作ったあとは書き換えない |
| スレッド | 1 つのコメントと、それに続く返信・質問・回答のやり取り |
| ask | AI がスレッドに付ける質問。型は `single_choice`・`multi_choice`・`yes_no`・`scale`・`free_text` |
| round | Submit 1 回分の送信内容。`rounds/NNN.json`。`pending`（AI が未処理）か `handled` |
| 未送信 | ブラウザで書いたが、まだ Submit していないコメント・返信・回答・解決の操作 |
| アンカー | コメントの位置。選んだ文（`quote`＋前後の文脈）か、ブロック（図・表・画像など）の指し方 |
| ビューア | `rikai open` が起こす、127.0.0.1 のローカルサーバーと、そのブラウザ画面 |
| 拡大表示 | 本文の画像・図・`html-app` の枠を、画面いっぱいに大きく見る表示（旧「個別表示」。F37・F43。0.28.0 で改名）。操作は「ズームイン」「ズームアウト」「全体に合わせる」（100% は、そのまま）。コードの識別子（`focus*`・`ui.lightbox`）は、そのまま |
| AI に送る | 未送信のものを、まとめて AI へ送る操作（旧「Submit」。F6。0.28.0 で、画面の言葉を改めた）。API（`/api/submit`）・この SPEC・docs の「Submit」は、そのまま（CLI には、`submit` というコマンドはない：「AI に送る」は画面の操作で、AI は `poll`／`pull` で受け取る。CLI のヘルプは、「AI に送る」と言う：F53）。「追加」「回答を保存」は、まだ AI には送られない |
| 変更の見せ方 | 本文の上のバーの切り替え：**通常｜変更を重ねる｜並べて比べる**（各 1 クリック。F11・F44・F49）。「変更を重ねる」は、前の版との差分を本文に重ねる。「並べて比べる」は、2 つの版を左右に並べる。選んでいるボタンを押すと、オフ（通常）に戻る |
| Markdown を保存 | 上のバー（ベルの左）のボタン：**いま見ているページの、いま見ている版の、元の Markdown を、ファイルとして保存する**（F50。0.30.0）。ブラウザの中で完結する（サーバーは増やさない）。コメント・差分の装飾は含まない |

## 3. 機能要件

**見た目の記述について**：F22〜F34 の、色・形・文字の具体的な記述（「オレンジ」「黄色」「温かい無彩色」「☰」など）は、**2026-11-23 に、デザインを作り直す前の見た目**（§8）。現在の見た目は、`app/src/web/styles/app.css`（**ライトとダークの 2 つ**：F36）。**要件（何ができるか・どう振る舞うか）は、変えていない**。

機能の要件の本文は、グループ別の文書にある（F-ID の見出し。複数のグループにまたがる機能は、1 か所に置き、ほかからはリンクする）。一覧の「状態」は、[docs/status.md](docs/status.md) の「状態」列の写し（F47〜F49 は、整理フェーズの行）。

### AI 側のコマンドとスキル

文書：[docs/features/ai-commands.md](docs/features/ai-commands.md)

| ID | 機能 | 状態 |
| --- | --- | --- |
| F1 | [トピックを作れる](docs/features/ai-commands.md#f1-トピックを作れる) | 確認済み |
| F2 | [ビューアを開ける](docs/features/ai-commands.md#f2-ビューアを開ける) | 確認済み |
| F7 | [AI が届いたものを読める](docs/features/ai-commands.md#f7-ai-が届いたものを読める) | 確認済み（一部） |
| F8 | [AI が 1 回の入力で返信と修正を反映できる](docs/features/ai-commands.md#f8-ai-が-1-回の入力で返信と修正を反映できる) | 確認済み |
| F18 | [エージェントのスキルとして使える](docs/features/ai-commands.md#f18-エージェントのスキルとして使える) | 実装済み・一部確認 |
| F19 | [待ち方をエージェントに合わせる](docs/features/ai-commands.md#f19-待ち方をエージェントに合わせる) | 実装済み・未確認 |
| F20 | [理解を確かめる返信を求める](docs/features/ai-commands.md#f20-理解を確かめる返信を求める) | 実装済み・未確認 |
| F53 | [バージョンとヘルプを見られる](docs/features/ai-commands.md#f53-バージョンとヘルプを見られる) | 実装済み・確認済み（e2e は 1 回・独立レビューなし） |

### 資料の書式

文書：[docs/features/doc-format.md](docs/features/doc-format.md)

| ID | 機能 | 状態 |
| --- | --- | --- |
| F9 | [返信は Markdown](docs/features/doc-format.md#f9-返信は-markdown) | 確認済み |
| F17 | [画像は assets のものだけ](docs/features/doc-format.md#f17-画像は-assets-のものだけ) | 確認済み |
| F26 | [コードブロックの種類で形式を書ける](docs/features/doc-format.md#f26-コードブロックの種類で形式を書ける) | 確認済み（一部） |
| F52 | [資料に draw.io の図を埋め込める](docs/features/doc-format.md#f52-資料に-drawio-の図を埋め込める) | 実装済み・確認済み（e2e は 1 回・独立レビューなし・利用者が見本で承認） |

### コメントする

文書：[docs/features/comments.md](docs/features/comments.md)

| ID | 機能 | 状態 |
| --- | --- | --- |
| F3 | [文を選んでコメントできる](docs/features/comments.md#f3-文を選んでコメントできる) | 確認済み |
| F4 | [ブロックにコメントできる](docs/features/comments.md#f4-ブロックにコメントできる) | 確認済み |
| F5 | [コメントは下書きとして残る](docs/features/comments.md#f5-コメントは下書きとして残る) | 確認済み |
| F6 | [未送信をまとめて AI へ送る](docs/features/comments.md#f6-未送信をまとめて-ai-へ送る) | 確認済み |
| F24 | [コメントと返信に画像を付けられる](docs/features/comments.md#f24-コメントと返信に画像を付けられる) | 確認済み（一部） |
| F27 | [画面をシンプルにする](docs/features/comments.md#f27-画面をシンプルにする) | 確認済み（一部） |

### 範囲で指す

文書：[docs/features/region-element.md](docs/features/region-element.md)

| ID | 機能 | 状態 |
| --- | --- | --- |
| F25 | [本文の好きな範囲を選んでコメントできる](docs/features/region-element.md#f25-本文の好きな範囲を選んでコメントできる) | 確認済み（一部） |
| F31 | [範囲の枠の調整と添付画像の拡大](docs/features/region-element.md#f31-範囲の枠の調整と添付画像の拡大) | 確認済み（一部） |
| F32 | [範囲を選ぶボタンは右下に浮かぶ](docs/features/region-element.md#f32-範囲を選ぶボタンは右下に浮かぶ) | 確認済み（一部） |
| F56 | [範囲の枠を隠せる](docs/features/region-element.md#f56-範囲の枠を隠せる) | 実装済み・確認済み（e2e は 1 回・既知の系統の不安定なテスト 1 件が失敗・独立レビューなし） |

### 大きく見る（拡大表示・個別表示）

文書：[docs/features/zoom.md](docs/features/zoom.md)

| ID | 機能 | 状態 |
| --- | --- | --- |
| F37 | [本文の画像と図を拡大表示できる](docs/features/zoom.md#f37-本文の画像と図を拡大表示できる) | 確認済み（一部） |
| F43 | [個別表示でコメントする](docs/features/zoom.md#f43-個別表示でコメントする) | 確認済み（一部） |
| F55 | [拡大表示でも関連の線で結ぶ](docs/features/zoom.md#f55-拡大表示でも関連の線で結ぶ) | 実装済み・確認済み（e2e は 1 回・既知の不安定なテスト 1 件が失敗・独立レビューあり〔対応後の再レビューなし〕・利用者が見本で承認） |

### 版・差分・並べて比べる・保存

文書：[docs/features/versions.md](docs/features/versions.md)

| ID | 機能 | 状態 |
| --- | --- | --- |
| F11 | [資料は版で残る](docs/features/versions.md#f11-資料は版で残る) | 確認済み |
| F12 | [コメントは版が変わっても位置が追従する](docs/features/versions.md#f12-コメントは版が変わっても位置が追従する) | 確認済み（一部） |
| F44 | [版を並べて比べる](docs/features/versions.md#f44-版を並べて比べる) | 確認済み（一部） |
| F50 | [Markdown を保存](docs/features/versions.md#f50-markdown-を保存) | 実装済み・確認済み（e2e は 1 回・独立レビューなし） |

### 質問・解決・進み具合

文書：[docs/features/threads.md](docs/features/threads.md)

| ID | 機能 | 状態 |
| --- | --- | --- |
| F10 | [AI が質問を付けられ人間が答えられる](docs/features/threads.md#f10-ai-が質問を付けられ人間が答えられる) | 確認済み |
| F14 | [スレッドの状態が分かる](docs/features/threads.md#f14-スレッドの状態が分かる) | 確認済み |
| F21 | [理解の進み具合を数で見られる](docs/features/threads.md#f21-理解の進み具合を数で見られる) | 確認済み |
| F29 | [会話が長くなっても最新が見える](docs/features/threads.md#f29-会話が長くなっても最新が見える) | 確認済み（一部） |
| F30 | [答えないまま進んだ質問は小さく見せる](docs/features/threads.md#f30-答えないまま進んだ質問は小さく見せる) | 確認済み（一部） |
| F51 | [右パネルのカードを軽くする](docs/features/threads.md#f51-右パネルのカードを軽くする) | 実装済み・確認済み（e2e は 1 回・独立レビューなし・利用者が見本で承認） |

### トピックとページ

文書：[docs/features/topics-pages.md](docs/features/topics-pages.md)

| ID | 機能 | 状態 |
| --- | --- | --- |
| F13 | [返信から子ページを作って移れる](docs/features/topics-pages.md#f13-返信から子ページを作って移れる) | 確認済み |
| F15 | [複数のトピックを扱える](docs/features/topics-pages.md#f15-複数のトピックを扱える) | 確認済み |
| F16 | [レビューを終えられる](docs/features/topics-pages.md#f16-レビューを終えられる) | 確認済み |
| F34 | [終了の確認は画面のダイアログで行う](docs/features/topics-pages.md#f34-終了の確認は画面のダイアログで行う) | 確認済み（一部） |
| F54 | [終了したトピックを閲覧専用で見られる](docs/features/topics-pages.md#f54-終了したトピックを閲覧専用で見られる) | 実装済み・確認済み（e2e は 1 回・独立レビューなし） |

### いま誰の番か・通知・更新

文書：[docs/features/turn-notify.md](docs/features/turn-notify.md)

| ID | 機能 | 状態 |
| --- | --- | --- |
| F38 | [画面の更新はサーバーの通知で届く](docs/features/turn-notify.md#f38-画面の更新はサーバーの通知で届く) | 確認済み（一部） |
| F39 | [いま誰の番かが一目で分かる](docs/features/turn-notify.md#f39-いま誰の番かが一目で分かる) | 確認済み（一部） |
| F41 | [確認すべきイベントをブラウザの通知で知らせる](docs/features/turn-notify.md#f41-確認すべきイベントをブラウザの通知で知らせる) | 確認済み（一部） |
| F46 | [ほかのトピックの新着も通知する](docs/features/turn-notify.md#f46-ほかのトピックの新着も通知する) | 確認済み（一部） |

### 見た目と広さ

文書：[docs/features/appearance.md](docs/features/appearance.md)

| ID | 機能 | 状態 |
| --- | --- | --- |
| F22 | [コメントと本文の位置が分かる](docs/features/appearance.md#f22-コメントと本文の位置が分かる) | 確認済み（一部） |
| F23 | [画面の広さを変えられる](docs/features/appearance.md#f23-画面の広さを変えられる) | 確認済み（一部） |
| F33 | [落ち着いた見た目と過去のコメントの整理](docs/features/appearance.md#f33-落ち着いた見た目と過去のコメントの整理) | 確認済み（一部） |
| F35 | [コメントと本文の対象を線で結ぶ](docs/features/appearance.md#f35-コメントと本文の対象を線で結ぶ) | 確認済み（一部） |
| F36 | [外観のモードを選べる](docs/features/appearance.md#f36-外観のモードを選べる) | 確認済み（一部） |

### html-app（実行できる枠）

文書：[docs/features/html-app.md](docs/features/html-app.md)

| ID | 機能 | 状態 |
| --- | --- | --- |
| F28 | [資料に実行できる枠 html-app を書ける](docs/features/html-app.md#f28-資料に実行できる枠-html-app-を書ける) | 確認済み（一部） |
| F40 | [html-app の枠と画面をつなぐ橋](docs/features/html-app.md#f40-html-app-の枠と画面をつなぐ橋) | 確認済み（一部） |
| F42 | [html-app の枠から下書きのコメントを作れる](docs/features/html-app.md#f42-html-app-の枠から下書きのコメントを作れる) | 確認済み（一部） |
| F45 | [枠から取った情報を情報の行にする](docs/features/html-app.md#f45-枠から取った情報を情報の行にする) | 確認済み（一部） |

### 画面の整理（ほかの機能の該当の部分を置き換える）

文書：[docs/features/ui-cleanup.md](docs/features/ui-cleanup.md)

| ID | 機能 | 状態 |
| --- | --- | --- |
| F47 | [小さな UI の直し](docs/features/ui-cleanup.md#f47-小さな-ui-の直し) | 確認済み（一部） |
| F48 | [名前と状態の言葉と上のバーの整理](docs/features/ui-cleanup.md#f48-名前と状態の言葉と上のバーの整理) | 確認済み（一部） |
| F49 | [拡大表示の統一と上のバーの切り替え](docs/features/ui-cleanup.md#f49-拡大表示の統一と上のバーの切り替え) | 実装済み・確認済み（レビューあり・一部不安定なテストあり） |

## 4. 非機能要件

N1〜N4・N6 は、この製品の安全の不変条件（[AGENTS.md](AGENTS.md#安全とプライバシーこの製品の不変条件)）。N3（隔離）の橋のメッセージの一覧は、[html-app](docs/features/html-app.md) の F40〜F44 にもある。

| ID | 要件 |
| --- | --- |
| N1 | **通信は、この Mac（127.0.0.1）だけ**：サーバーは `127.0.0.1` に、ランダムなポートで待ち受ける。ビューアの資料・コメント・回答を、外へ送らない。外部の画像・フォント・スクリプトを読み込まない（同梱のライブラリだけ）。アカウント・クラウド・API キーは要らない |
| N2 | **サーバーへの操作は、合言葉を持つ画面だけ**：起動ごとに作る合言葉（URL の `?t=`）を、HttpOnly・SameSite=Strict の Cookie に移し（URL からは外す）、API と資産の配信で照合する。**Cookie の名前には、ポートを入れる**（`rikai_t_<ポート>`。ブラウザの Cookie は、ポートで分かれず、127.0.0.1 で共有されるので、名前が固定だと、別のプロジェクトの rikai を開いたとき、先の画面が 403 になる）。`Host`・`Origin` も検査し、別のページ・別のプロセスからの操作を断る。URL は人に見せない前提 |
| N3 | **AI が書いた Markdown/HTML は、非信頼のデータとして描く**：DOMPurify で無害化し（`<script>`・`<style>`・`<iframe>`・フォーム・`on*`・`style` 属性を除く）、**画面の中では、スクリプトを実行しない**。リンクは、`http(s)`・`mailto`・`page:` だけ。Mermaid は `securityLevel: strict`。人間が書いたコメントは、文字として表示する（HTML として解釈しない）。`/asset/` の配信は、`sandbox` の CSP で、直接開かれてもスクリプトを動かさない。**唯一の例外は、`html-app`（F28）の枠**：AI が書いた JavaScript を、画面とは別の文書として、`sandbox`（`allow-same-origin` なし）と、外への通信を止める CSP で**隔離**して動かす。この隔離（`sandbox` の内容・`APP_CSP`・枠の中身を、サーバーが資料から取り出すこと）を、緩めない。**画面と枠のあいだの通信（橋）は、決まった種類だけ**：F40 の枠 → 画面の高さの報告（`resize`）と、画面 → 枠の外観（`theme`）・**F42 の枠 → 画面の `pick`（選んだ要素）・`state`（状態）・`snapshot`（枠の画像）と、画面 → 枠の、その開始・要求**・**F43 の枠 → 画面の `esc`（Escape キーの転送。`Escape` と、その 2 キーだけ。個別表示と、版を並べて比べる画面〔F44〕の枠だけが処理する：枠のコードが偽の `esc` を送ると、これらの画面が閉じる。データには触れない）**。画面は、送り元の窓（`e.source`。個別表示・比べる画面の枠も、`registerFrame` で登録簿に入れ、閉じるとき外す）・形・値の範囲・大きさ・頻度を検査して受け、**値は、文字・画像のデータとして、下書きの `frameMeta`（「情報の行」に出す。コメントの本文には書かない：F45）・範囲の画像にだけ使う**（`innerHTML`・`eval`・`href` に使わない）。**`frameMeta` は、サーバーも、受けたときに検査する**（`parseFrameMeta`。画面を信頼しない：余分なキー・型違い・上限超えを拒否し、見えない文字は `reveal` で見える形にして、新しいオブジェクトで保存する）。**利用者が確認して Submit するまで、コメントの保存には、触れさせない**。画面の DOM には、触れさせない |
| N4 | **書き込む場所は、プロジェクト直下の `.rikai/` だけ**（スキルのインストールを除く）。トピックごとの変更は、ロックの下で、すべて成功するか、何も書かないかのどちらかにする。`.rikai/` は、既定で git に入れない |
| N5 | **利用者の環境に、追加の依存を要求しない**（2026-11-22 に、再開発〔Hono・React〕に合わせて変更。§8）：実行に要るのは **Node.js 22 以上だけ**（利用者側で `npm install` は要らない）。サーバー・CLI は、依存を含めて **1 つのファイルにバンドル**し、画面は、**ビルド済みの静的ファイル**を、`skills/rikai/` に同梱する（ビルド済みを、リポジトリにコミットする）。外部の画像・フォント・スクリプトを読み込まない。同梱する依存には、ライセンスを添える。オフラインで動く。開発側の依存は devDependencies（`app/package.json`）に限り、新しいものは、ライセンス・大きさ・保守状況を確かめてから足す |
| N6 | **資料・コメントを、ログ・文書・テストに残さない**：サーバーのログに、資料・コメントの中身を出さない。開発・検証には、作り物の内容を使う（利用者の実際の資料・コメントは使わない） |
| N7 | **データの形に版がある**：`meta.json` の `schema`（いまは 1）。版のない古い形は、版 1 として読み、次の保存で版が入る。**このコードより新しい版（不正な値を含む）のトピックは、読み書きを 409 で断り、何も書き換えない**（古い rikai が、新しい形を壊さないため）。一覧には「新しい形式」の印を出す。形を変えるときは、版を上げて、古い形を読み替える処理を足す（[開発手順](docs/development.md#データの形を変えるとき)） |

## 5. 対象外

- Markdown のソースどうしの行単位の差分・ブロックの**移動**の追跡（移動したブロックは、「なくなった」と「追加」に見える）。
- AI が書いた **JavaScript を、画面の中で実行する資料**（隔離しない形）。隔離した枠（`html-app`）は、F28 で入れた。
- **複数人**での共同レビュー・ネットワーク越しの共有・クラウドへの保存。
- 資料の**手での直接編集**（コメントを介して AI が直す）。
- MCP サーバー・独自のエージェント接続（スキルと、コマンド `rikai` だけで足りる間は、足さない）。
- ブラウザへ、**データごと**サーバーから押し出すこと（WebSocket は使わない。画面の更新は、SSE の「変わった」という通知だけを使う：F38）。

## 6. 実装の状態

行ごとの状態・確認した範囲・未確認の範囲・凡例は、[docs/status.md](docs/status.md)。状態を書くのは、そこの表の「状態」列（上の機能の一覧の「状態」は、その写し）。

## 7. 未決事項

決めてから実装する。決まったら、この表を更新して、判断の日付を添える。

決定・実装済みになった行は、[docs/decisions/user-decisions.md](docs/decisions/user-decisions.md#決定済みになった元の未決事項) へ移した。ここに残るのは、未決のものと、「やらない」と決めたもの。

| 項目 | 内容 |
| --- | --- |
| 他のエージェント | Claude Code・opencode 以外で、`poll` に近い待ち方（MCP・プラグイン・通知）を持つか。いまは「送りました」の合図だけ（opencode は、バックグラウンドの `poll` で自動再開することを確かめた：0.1.3。[ADR-0057](docs/decisions/0057-opencode-support.md)） |
| 子ページの生成 | **やらない**（利用者の決定：2026-11-24）。いまは、AI が返信と同時に書く |
| コメントの追従の強化 | **やらない**（利用者の決定：2026-11-24）。文が書き換わったときの、近い文への自動の付け替えは、入れない |
| 共有 | `.rikai/` をチームで共有する運用（`.gitignore` を消す）の、注意と補助を用意するか |
| 配布 | `npx`、各エージェントの公式のマーケットプレイス・ディレクトリへの公開（Anthropic のディレクトリへの提出など）。いまは、リポジトリから、各エージェントのプラグインとして入れる（F18） |
| コメントの並べ方（案 B） | **やらない**（利用者の決定：2026-11-24）。カードを、本文の対象と同じ高さの右側に並べる案（Google ドキュメント型）は、入れない（F22 の番号・光り・強調は、そのまま） |
| 対応する環境 | Windows・Linux・Safari・Firefox の確認 |

## 8. 利用者の判断

- [利用者の決定](docs/decisions/user-decisions.md)：日付つきの表（利用者の依頼・指摘・選択）。
- [AI の設計の判断（ADR）](docs/decisions/README.md)：理由・採らなかった案。1 判断 1 ファイル（50 件）。
