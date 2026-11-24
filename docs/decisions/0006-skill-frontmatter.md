# ADR-0006 SKILL.md の frontmatter を絞る

- 日付：2026-11-21
- 種別：AI の設計の判断（もとは、SPEC.md の §8 の表の 1 行。文言は、そのまま移した）
- 関連の機能：[F18](../features/ai-commands.md#f18-エージェントのスキルとして使える)
- 決定の元：[利用者の決定](user-decisions.md)（2026-11-21「opencode 以外（Claude Code・om…」）。文中の「上の…」は、この決定を指す。
- 一覧：[ADR の一覧](README.md)・[SPEC.md の §8](../../SPEC.md#8-利用者の判断)

（AI の判断。上の指示の範囲）SKILL.md の frontmatter から、`disable-model-invocation: true` と `argument-hint` を外した（omp が、Agent Plugins のパッケージで、これらの項目があると、スキルごと読み込まないことを、実機で確認したため）。**影響**：モデルが、「理解したい」などの発言から、自動で rikai を使えるようになる（description は、もともと、そう書いてあった）。引数のヒントは、description に書いた。**自動で使われたくないとき**：`install.sh` で置いた複製（個人のスキル）は、Claude Code の設定 `skillOverrides` の `"rikai": "user-invocable-only"`（ファイルを編集しない）、または置いた先の SKILL.md に `disable-model-invocation: true` を足す。**Claude Code のプラグインのスキルは、`skillOverrides` の対象外**（公式ドキュメント）で、止めるには、プラグインを無効にするしかない。omp のプラグインのスキルには、この項目を足せない（足すと、スキルが消える）
