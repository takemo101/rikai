# rikai（/rikai）

資料にコメントして Submit すると、AI が **返信** と **資料の修正（新しい版）** で答えるスキルです。このループを繰り返して理解を深めます。**試作**です（実装の状態は [SPEC §6](SPEC.md#6-実装の状態)。実際の Claude Code での通しは、まだ確かめていません）。

- 文や図・表を選んでコメントを付けます（Google ドキュメントのように）。
- AI は選択肢・複数選択・Yes/No・5段階・自由記述で質問を返せます。
- 返信は Markdown です（Mermaid、表、コード、画像）。返信から子ページ（詳細資料）を作れ、「詳しく見る」で移れます。
- 資料は版（v1, v2…）で残ります。前の版からの変更箇所を表示し、過去の版も見られます。
- 保存先は **プロジェクト直下の `.rikai/<topic>/`** です。理解の対象ごとにフォルダが分かれます。既定では git 管理外（`.rikai/.gitignore` が `*`）です。

参考にしたもの: [understand-mode](https://github.com/fkubota/understand-mode)（ローカルサーバー + ブラウザ + スキル）、[human-review](https://github.com/petergyang/human-review)（選択範囲へのコメントと Submit、poll による待機）、[sideshow](https://github.com/modem-dev/sideshow)（対象ごとのスレッドと版）。

## 必要なもの

- Node.js 18 以上（追加の npm パッケージは不要。marked / DOMPurify / mermaid は同梱）
- Claude Code など、スキルを読めるエージェント

## インストール

```bash
git clone https://github.com/takemo101/rikai.git
cd rikai
bash install.sh      # ~/.claude/skills/rikai/ にコピーされる
```

Claude Code を開き直すと `/rikai` が使えます。アンインストールは `rm -rf ~/.claude/skills/rikai`。

## 使い方

1. `/rikai このPRを理解したい`（`/rikai` だけなら直前の回答、`/rikai src/auth.ts` ならそのファイル）
2. ブラウザで資料が開きます。
   - 文を選択して「コメント」。図・表・画像は、ブロックにマウスを置くと右に出る **＋** から。
   - AI の質問に答えて「回答を保存」。
3. 右上の **Submit** で AI に送ります。
4. AI の返信と新しい版が画面に自動で出ます。足りなければ、またコメントして Submit します。
5. 理解できたスレッドは「理解できた（解決）」。全部済んだら「終了」。

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

詳細は `skill/rikai/SKILL.md` を見てください。

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
- JS を実行する資料（`html-app` のような部品）は未対応です。

## まだないもの

- Markdown のソースどうしの行単位の差分と、ブロックの移動の追跡（版どうしの差分は、表示されたブロックの文字の追加・削除として見せます。移動は、削除と追加に見えます）
- 書き換えられて消えた文へのコメントの自動追従（見つからなければ「修正で文が変わりました」と表示します）
- Windows・Linux・Safari・Firefox での動作確認（macOS の Chromium 系で確認）

## 開発する人へ

続きの開発は [AGENTS.md](AGENTS.md)（規約）と [docs/README.md](docs/README.md)（文書の案内）から読んでください。製品要件の正本は [SPEC.md](SPEC.md)、確認した範囲は [検証手順と記録](docs/verification.md) です。

```bash
npm test    # 自動テスト（Node 18 以上。追加の依存なし。ブラウザは使わない）
```

## ライセンス

MIT（[LICENSE](LICENSE)）。同梱しているライブラリは `skill/rikai/public/vendor/LICENSE-*` を参照してください。
