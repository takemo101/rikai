# rikai（/rikai）

資料にコメントして Submit すると、AI が **返信** と **資料の修正（新しい版）** で答えるスキルです。このループを繰り返して理解を深めます。**試作**です（実装の状態は [SPEC §6](SPEC.md#6-実装の状態)。実際の Claude Code での通しは、まだ確かめていません）。

- 文や図・表を選んでコメントを付けます（Google ドキュメントのように）。コメントには番号が付き、本文の印と右のカードが対応します（マウスを置くと、お互いに光ります。入力中の対象は、本文でオレンジになります）。
- コメントと返信には、**画像**を付けられます（貼り付け・ドラッグ・ファイル選択。OS のスクリーンショットも）。AI には、画像のファイルの場所が届きます。
- 本文の**好きな範囲を選んで**コメントできます（本文の右下に浮かぶ「範囲を選ぶ」ボタン→ドラッグ。文・表・コード・図・画像・複数のブロックにまたがってもよい）。選んだ範囲の画像と位置が、コメントの対象になります。
- 資料に、コードブロックの種類で、**差分（diff）・折りたためる JSON・端末の出力（色つき）・トレース（タイムライン）**を書けます（読めないときは、ふつうのコードブロック）。
- 資料に、**JavaScript で動く部品**（```` ```html-app ````）を書けます（スライダー・計算機など、触って理解する資料）。隔離した枠の中で動き、**この画面（コメント・保存）には触れず、外への通信は（WebRTC を除いて）止めています**。枠に、秘密は入力しないでください。
- 会話が長くなっても、スレッドのカードでは、**最新のやり取りが見える**ように、古いやり取りを「これまでのやり取り」に折りたたみます（押すと開きます）。
- 左の一覧（トピック・ページ）は、上のバーのアイコンのボタンでしまえます。右のコメントの幅は、境目のドラッグ（ダブルクリックで、もとの幅）で変えられます。設定は、このブラウザに覚えます。
- 右のコメントのカードと、本文の対象は、**線で結ばれます**（右のパネルの見出し「コメント」の右端のボタン「関連の線を出す」で、出し入れできます。既定はオン）。
- **外観**は、ライト・ダーク・システム（OS に従う。既定）から選べます（上のバーのアイコンのボタンで、システム → ライト → ダークと切り替わります。選んだ外観は、このブラウザに覚えます）。`html-app` の枠の中は、変わりません。
- **本文の画像と図**（Mermaid・インラインの SVG）は、押すと、**画面の中で拡大**して見られます（ホイール・ドラッグ・ダブルクリック・＋／−／0 のキー。Esc で閉じる）。コメントの付いたものは、ブロックの上のバーの「拡大」から開きます。
- AI は選択肢・複数選択・Yes/No・5段階・自由記述で質問を返せます。
- 返信は Markdown です（Mermaid、表、コード、画像）。返信から子ページ（詳細資料）を作れ、「詳しく見る」で移れます。
- 解決したスレッドと答えた質問の数で、理解の進み具合が見られます（数だけで、理解できたかの判定ではありません）。
- 資料は版（v1, v2…）で残ります。前の版からの変更箇所を表示し、過去の版も見られます。
- 保存先は **プロジェクト直下の `.rikai/<topic>/`** です。理解の対象ごとにフォルダが分かれます。既定では git 管理外（`.rikai/.gitignore` が `*`）です。

参考にしたもの: [understand-mode](https://github.com/fkubota/understand-mode)（ローカルサーバー + ブラウザ + スキル）、[human-review](https://github.com/petergyang/human-review)（選択範囲へのコメントと Submit、poll による待機）、[sideshow](https://github.com/modem-dev/sideshow)（対象ごとのスレッドと版）。

## 必要なもの

- Node.js 22 以上（追加の npm パッケージは不要。サーバー・CLI も、画面〔React・marked・DOMPurify・mermaid ほか〕も、依存を含めて、ビルド済みのものを `skills/rikai/` に同梱している）
- Claude Code・omp・pi・grok・agy・codex・opencode など、スキル（`SKILL.md`）を読めるエージェント

## インストール

どれか 1 つの方法で入れます。入れたあと、エージェントを開き直してください。

### スキルとして置く（どのエージェントでも）

```bash
git clone https://github.com/takemo101/rikai.git
cd rikai
bash install.sh      # ~/.claude/skills/rikai/ にコピーされる
```

`~/.claude/skills/` を読むエージェント（Claude Code、opencode ほか）で使えます。ほかのエージェントは、`skills/rikai/` を、そのエージェントのスキルの置き場（opencode：`~/.config/opencode/skills/` または `.agents/skills/`、pi：`~/.pi/agent/skills/`、grok：`~/.grok/skills/`、agy：`~/.gemini/config/skills/`）にコピーします。アンインストールは、置いたディレクトリを消します。

### プラグインとして入れる

| エージェント | コマンド | 呼び出し |
|---|---|---|
| Claude Code | `claude plugin marketplace add takemo101/rikai` → `claude plugin install rikai@rikai` | `/rikai:rikai` |
| omp | `omp plugin marketplace add takemo101/rikai` → `omp plugin install rikai@rikai` | `/skill:rikai` |
| pi | `pi install git:github.com/takemo101/rikai` | `/skill:rikai` |
| grok | `grok plugin install takemo101/rikai --trust` | `/rikai` |
| agy | clone して `agy plugin install ./rikai` | `/rikai` |
| codex | `codex plugin marketplace add takemo101/rikai` → `codex plugin add rikai@rikai` | （各エージェントの表示に従う） |

プラグインの中身は、どれも同じ `skills/rikai/` です（マニフェストは、`plugin.json`・`.claude-plugin/`・`.agents/plugins/`・`package.json` の `pi`）。**どのコマンドを、実際に動かして確かめたかは、[検証手順と記録](docs/verification.md#プラグイン対応2026-11-21rik-010) を見てください**（実際のエージェントで `/rikai` を通しで使うことは、まだ確かめていません）。

## 使い方

1. `/rikai このPRを理解したい`（`/rikai` だけなら直前の回答、`/rikai src/auth.ts` ならそのファイル）。呼び出しの名前は、エージェントによって違います（[上の表](#プラグインとして入れる)）。「理解したい」などの発言から、エージェントが自動で使うこともあります（止め方は [SPEC §8](SPEC.md#8-利用者の判断)）。
2. ブラウザで資料が開きます。
   - 文を選ぶと、その上に出るバーの「コメント」。ブロック（段落・表・コード・図・画像）にマウスを置くと、そのブロックの右上に出るバーの「コメント」から。本文の好きな範囲は、右下に浮かぶ「範囲を選ぶ」ボタンから。
   - AI の質問に答えて「回答を保存」。
3. 右上の **Submit** で AI に送ります。
4. AI の返信と新しい版が画面に自動で出ます。足りなければ、またコメントして Submit します。
   - 上のバーの「あなたの番」「AIの返信待ち」「未送信 n 件」などで、いま誰の番かが分かります（押すと、該当のカードへ移ります）。タブのタイトルにも出ます。
5. 理解できたスレッドは「解決」。全部済んだら「終了」。

### AI に届く仕組み

| エージェント | 方法 |
| --- | --- |
| Claude Code | `rikai poll` をバックグラウンドで待機。Submit で終了し、その出力で AI が再開します |
| それ以外 | Submit 後に「rikai に送りました」と伝えると、AI が `rikai pull` で読みに行きます（画面にコピーできる文があります） |

## コマンド（AI が使う）

```text
rikai new <topic> --title <題名>   標準入力の Markdown から作る
rikai open <topic>                 ビューアを起動して URL を出す
rikai poll <topic>                 Submit されるまで待つ
rikai pull <topic>                 待たずに、未処理のバッチがあれば出す
rikai apply <topic>                標準入力の JSON で返信・新版・子ページ・質問を反映する
rikai status [topic]               未処理のバッチなどを見る
rikai stop                         サーバーを止める
```

詳細は `skills/rikai/SKILL.md` を見てください。

## 保存の形

```text
<project>/.rikai/
  .gitignore
  <topic>/
    meta.json         題名・ページ木・現在の版
    pages/<page>/v1.md v2.md …
    assets/           画像
    threads.json      コメント・返信・質問・回答
    rounds/001.json   Submit ごとの送信内容
```

## 安全のために

- サーバーは `127.0.0.1` だけで待ち受けます。起動ごとの合言葉（URL の `?t=`）を Cookie に移し、Host・Origin も確かめます。URL は人に見せないでください。
- AI が書いた Markdown/HTML は DOMPurify で無害化して表示します（`<script>`・`<style>`・iframe・`on*` 属性を除去）。外部の画像は表示しません。Mermaid は `securityLevel: 'strict'` です。
- AI が書いた JavaScript は、**`html-app` の枠の中だけ**で動きます。枠は、別の文書として配られ、`sandbox`（画面の DOM・Cookie・合言葉に触れない）と、外への通信を止める CSP で隔離されます。**止められない通信の抜け道（WebRTC など）が一部あります**ので、枠の中に、パスワードなどの秘密は入力しないでください（[SPEC F28](SPEC.md)）。枠の中身は、「ソースを見る」で読めます。

## まだないもの

- Markdown のソースどうしの行単位の差分と、ブロックの移動の追跡（版どうしの差分は、表示されたブロックの文字の追加・削除として見せます。移動は、削除と追加に見えます）
- 書き換えられて消えた文へのコメントの自動追従（見つからなければ「修正で文が変わりました」と表示します）
- Windows・Linux・Safari・Firefox での動作確認（macOS の Chromium 系で確認）
- Claude Code 以外のエージェントでの `poll` に近い待ち方、子ページを押したときの生成、チームでの `.rikai/` の共有の補助、`npx`・プラグインでの配布（どれも、[SPEC §7](SPEC.md#7-未決事項) の未決事項）
- 実際の Claude Code から `/rikai` を使った通しの確認（`install.sh` でコピーするところまでは確認済み）

## 開発する人へ

続きの開発は [AGENTS.md](AGENTS.md)（規約）と [docs/README.md](docs/README.md)（文書の案内）から読んでください。製品要件の正本は [SPEC.md](SPEC.md)、確認した範囲は [検証手順と記録](docs/verification.md) です。

```bash
pnpm install          # 開発の依存（Node 22.12 以上と pnpm。利用者には要らない）
pnpm test             # 自動テスト（Vitest。サーバー・CLI・画面〔jsdom〕・配布物が古くないこと）
pnpm run test:e2e     # 実際の Chrome での確認（Playwright。先に pnpm run build）
pnpm run build        # サーバー・CLI・画面を skills/rikai/ にビルドする（コミットする）
pnpm --dir app dev    # 画面の開発サーバー（RIKAI_SERVER が要る。docs/development.md）
```

## ライセンス

MIT（[LICENSE](LICENSE)）。同梱しているライブラリは、サーバー・CLI の依存が `skills/rikai/THIRD-PARTY-LICENSES.txt`、画面の依存が `skills/rikai/public/THIRD-PARTY-LICENSES.txt` を参照してください。
