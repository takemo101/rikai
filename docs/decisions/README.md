# 決定の記録

[SPEC.md](../../SPEC.md) の §8「利用者の判断」の置き場。

- [利用者の決定](user-decisions.md)：日付つきの表（利用者の依頼・指摘・選択）と、決定済みになった、もとの未決事項。
- **ADR（設計の判断）**：AI の設計の判断（理由・採らなかった案・判断の範囲）。**1 判断 1 ファイル**（`NNNN-<題>.md`。番号は、足した順）。1 つの行に複数の判断が入っているものは、分けずに 1 ファイルにした。もとは SPEC.md の §8 の表の行で、文言は、そのまま移した（日付・版・RIK の番号を含む）。

## ADR の足し方

1. 次の番号で `docs/decisions/NNNN-<英小文字とハイフンの題>.md` を作る。先頭に、`# ADR-NNNN 題`・日付・関連の機能（`docs/features/` の F-ID の見出しへのリンク）・決定の元（利用者の決定）を書く。本文には、**何を決めたか・理由・採らなかった案**を書く。
2. 下の一覧に、1 行足す。[利用者の決定](user-decisions.md) の表の、元になった行の右の列にも、結ぶ。
3. 後から覆す判断は、書き換えず、新しい ADR を足して、古い ADR の先頭に「→ NNNN で変更」と書く。

## 一覧

| ADR | 日付 | 題 | 関連の機能 |
| --- | --- | --- | --- |
| [0001](0001-data-schema-version.md) | 2026-11-21 | データの形の版は meta.json にだけ持つ | — |
| [0002](0002-version-diff-by-block.md) | 2026-11-21 | 版の差分は、ブロックの対応づけから作る | [F11](../features/versions.md#f11-資料は版で残る) |
| [0003](0003-progress-counts-only.md) | 2026-11-21 | 理解の進み具合は、数だけを見せる | [F21](../features/threads.md#f21-理解の進み具合を数で見られる) |
| [0004](0004-split-server-into-lib.md) | 2026-11-21 | rikai.js を責務ごとに lib へ分ける | — |
| [0005](0005-plugin-root-at-repo-root.md) | 2026-11-21 | プラグインのルートは、リポジトリのルートにする | [F18](../features/ai-commands.md#f18-エージェントのスキルとして使える) |
| [0006](0006-skill-frontmatter.md) | 2026-11-21 | SKILL.md の frontmatter を絞る | [F18](../features/ai-commands.md#f18-エージェントのスキルとして使える) |
| [0007](0007-plugin-update-by-version.md) | 2026-11-21 | プラグインの更新は、版で管理する | [F18](../features/ai-commands.md#f18-エージェントのスキルとして使える) |
| [0008](0008-distribute-built-artifacts.md) | 2026-11-22 | 成果物を skills/rikai/ にコミットして配る | — |
| [0009](0009-node-22-floor.md) | 2026-11-22 | Node の下限を 20 から 22 に変える | — |
| [0010](0010-react-ui-migration.md) | 2026-11-23 | 画面を React に切り替えた | — |
| [0011](0011-design-rebuild-0-16.md) | 2026-11-23 | 画面のデザインを作り直した | [F22](../features/appearance.md#f22-コメントと本文の位置が分かる)・[F23](../features/appearance.md#f23-画面の広さを変えられる)・[F33](../features/appearance.md#f33-落ち着いた見た目と過去のコメントの整理)・[F35](../features/appearance.md#f35-コメントと本文の対象を線で結ぶ) |
| [0012](0012-same-row-comments.md) | 2026-11-23 | 同じ行の複数のコメントの見せ方 | [F22](../features/appearance.md#f22-コメントと本文の位置が分かる)・[F35](../features/appearance.md#f35-コメントと本文の対象を線で結ぶ) |
| [0013](0013-appearance-modes.md) | 2026-11-23 | 外観のモード（ライト・ダーク・システム）の方式 | [F36](../features/appearance.md#f36-外観のモードを選べる) |
| [0014](0014-narrow-window-panel.md) | 2026-11-23 | 狭い窓で右パネルの幅を自動で狭くする | [F23](../features/appearance.md#f23-画面の広さを変えられる) |
| [0015](0015-zoom-image-and-diagram.md) | 2026-11-23 | 本文の画像・図の拡大の方式 | [F37](../features/zoom.md#f37-本文の画像と図を拡大表示できる) |
| [0016](0016-sse-updates.md) | 2026-11-23 | 画面の更新を SSE にした | [F38](../features/turn-notify.md#f38-画面の更新はサーバーの通知で届く) |
| [0017](0017-turn-indicator.md) | 2026-11-23 | 「いま、誰の番か」の表示 | [F39](../features/turn-notify.md#f39-いま誰の番かが一目で分かる) |
| [0018](0018-your-turn-rule.md) | 2026-11-23 | 「あなたの番」の条件 | [F39](../features/turn-notify.md#f39-いま誰の番かが一目で分かる) |
| [0019](0019-htmlapp-bridge.md) | 2026-11-23 | html-app の橋（段階 1） | [F40](../features/html-app.md#f40-html-app-の枠と画面をつなぐ橋) |
| [0020](0020-color-supply-opt-in.md) | 2026-11-23 | 配色の供給をオプトインにした | [F40](../features/html-app.md#f40-html-app-の枠と画面をつなぐ橋) |
| [0021](0021-color-match-by-bridge-names.md) | 2026-11-23 | 配色の対応の判定を、橋が配る名前に絞った | [F40](../features/html-app.md#f40-html-app-の枠と画面をつなぐ橋) |
| [0022](0022-browser-notifications.md) | 2026-11-23 | ブラウザの通知にした | [F41](../features/turn-notify.md#f41-確認すべきイベントをブラウザの通知で知らせる) |
| [0023](0023-region-image-frame-box.md) | 2026-11-23 | 範囲選択の画像で、枠を「枠の箱」に置き換えた | [F25](../features/region-element.md#f25-本文の好きな範囲を選んでコメントできる) |
| [0024](0024-htmlapp-writeback.md) | 2026-11-23 | html-app の書き戻し（段階 2） | [F42](../features/html-app.md#f42-html-app-の枠から下書きのコメントを作れる) |
| [0025](0025-reveal-invisible-chars.md) | 2026-11-23 | 枠から来た見えない文字は、見える形にした | [F42](../features/html-app.md#f42-html-app-の枠から下書きのコメントを作れる) |
| [0026](0026-notification-icon-png.md) | 2026-11-23 | 通知の icon を PNG の data: にした | [F41](../features/turn-notify.md#f41-確認すべきイベントをブラウザの通知で知らせる) |
| [0027](0027-focus-view.md) | 2026-11-23 | 個別表示にした | [F37](../features/zoom.md#f37-本文の画像と図を拡大表示できる)・[F43](../features/zoom.md#f43-個別表示でコメントする) |
| [0028](0028-focus-frame-width-default.md) | 2026-11-23 | 個別表示の枠の幅の既定を、本文に揃えた | [F43](../features/zoom.md#f43-個別表示でコメントする) |
| [0029](0029-reveal-zwj-exception.md) | 2026-11-24 | reveal の例外（キーキャップ・絵文字の間の ZWJ） | [F42](../features/html-app.md#f42-html-app-の枠から下書きのコメントを作れる)・[F43](../features/zoom.md#f43-個別表示でコメントする) |
| [0030](0030-compare-versions-design.md) | 2026-11-24 | 版を並べて比べる（F44）の設計 | [F44](../features/versions.md#f44-版を並べて比べる) |
| [0031](0031-compare-restore-on-close.md) | 2026-11-24 | 比べる画面を閉じるときの復元 | [F44](../features/versions.md#f44-版を並べて比べる) |
| [0032](0032-stdin-eagain.md) | 2026-11-24 | 大きな標準入力の EAGAIN の修正 | [F1](../features/ai-commands.md#f1-トピックを作れる)・[F8](../features/ai-commands.md#f8-ai-が-1-回の入力で返信と修正を反映できる) |
| [0033](0033-compare-new-version-arrives.md) | 2026-11-24 | 比べている間に新しい版が届いたとき | [F44](../features/versions.md#f44-版を並べて比べる) |
| [0034](0034-read-stdin-module.md) | 2026-11-24 | readStdin を cli/stdin.ts に切り出した | — |
| [0035](0035-framemeta-data-shape.md) | 2026-11-24 | データの形の拡張（frameMeta） | [F45](../features/html-app.md#f45-枠から取った情報を情報の行にする) |
| [0036](0036-framemeta-design.md) | 2026-11-24 | F45 の設計 | [F45](../features/html-app.md#f45-枠から取った情報を情報の行にする) |
| [0037](0037-framemeta-only-comment.md) | 2026-11-24 | 本文が空で frameMeta だけのコメント | [F45](../features/html-app.md#f45-枠から取った情報を情報の行にする) |
| [0038](0038-notify-all-topics-design.md) | 2026-11-24 | F46（ほかのトピックの通知）の設計 | [F46](../features/turn-notify.md#f46-ほかのトピックの新着も通知する) |
| [0039](0039-fresh-id-cap.md) | 2026-11-24 | 一覧の fresh の上限 | [F46](../features/turn-notify.md#f46-ほかのトピックの新着も通知する) |
| [0040](0040-version-switch-keeps-draft.md) | 2026-11-24 | 版の切り替えで、書きかけのコメントを閉じない | [F11](../features/versions.md#f11-資料は版で残る)・[F39](../features/turn-notify.md#f39-いま誰の番かが一目で分かる) |
| [0041](0041-phase2-infra.md) | 2026-11-24 | 整理フェーズ ②（インフラ）の判断 | [F47](../features/ui-cleanup.md#f47-小さな-ui-の直し) |
| [0042](0042-status-words-table.md) | 2026-11-24 | 状態の言葉の表 | [F48](../features/ui-cleanup.md#f48-名前と状態の言葉と上のバーの整理) |
| [0043](0043-phase3a-review-fixes.md) | 2026-11-24 | 整理フェーズ ③a のレビューの指摘への対応 | [F48](../features/ui-cleanup.md#f48-名前と状態の言葉と上のバーの整理) |
| [0044](0044-phase3c-dedupe.md) | 2026-11-24 | 整理フェーズ ③c：コードの土台の整理 | — |
| [0045](0045-attachment-lightbox-view-only.md) | 2026-11-24 | 添付の拡大表示を、ドックなし・見るだけにした | [F49](../features/ui-cleanup.md#f49-拡大表示の統一と上のバーの切り替え) |
| [0046](0046-phase3b-review-fixes.md) | 2026-11-24 | 整理フェーズ ③b のレビューの指摘への対応 | [F49](../features/ui-cleanup.md#f49-拡大表示の統一と上のバーの切り替え) |
| [0047](0047-phase4a-structure.md) | 2026-11-24 | 整理フェーズ ④a：構造の整理 | — |
| [0048](0048-phase4b-appbridge-split.md) | 2026-11-24 | 整理フェーズ ④b：appBridge の分割 | [F40](../features/html-app.md#f40-html-app-の枠と画面をつなぐ橋) |
| [0049](0049-phase4c-folders.md) | 2026-11-24 | 整理フェーズ ④c：フォルダ化 | [F44](../features/versions.md#f44-版を並べて比べる)・[F43](../features/zoom.md#f43-個別表示でコメントする)・[F28](../features/html-app.md#f28-資料に実行できる枠-html-app-を書ける) |
| [0050](0050-save-markdown.md) | 2026-11-24 | Markdown を保存の仕様と設計 | [F50](../features/versions.md#f50-markdown-を保存) |
| [0051](0051-save-markdown-icon-only.md) | 2026-11-24 | 「Markdown を保存」を、常にアイコンだけにした | [F50](../features/versions.md#f50-markdown-を保存) |
| [0052](0052-compare-sticky-head-offset.md) | 2026-11-24 | 並べて比べる画面の版の見出しの固定位置を、容器の余白の分だけ負にして、変数で共有した | [F44](../features/versions.md#f44-版を並べて比べる) |
| [0053](0053-skill-split.md) | 2026-11-24 | 整理フェーズ ⑤b：SKILL.md を、本体と補助ファイルに分けた | [F18](../features/ai-commands.md#f18-エージェントのスキルとして使える)・[F20](../features/ai-commands.md#f20-理解を確かめる返信を求める) |
| [0054](0054-card-lighten.md) | 2026-11-24 | 右パネルのカードの軽量化（P5）：返信欄を畳む・札を外す・字と押す領域 | [F51](../features/threads.md#f51-右パネルのカードを軽くする)・[F45](../features/html-app.md#f45-枠から取った情報を情報の行にする) |
