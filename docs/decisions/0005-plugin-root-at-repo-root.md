# ADR-0005 プラグインのルートは、リポジトリのルートにする

- 日付：2026-11-21
- 種別：AI の設計の判断（もとは、SPEC.md の §8 の表の 1 行。文言は、そのまま移した）
- 関連の機能：[F18](../features/ai-commands.md#f18-エージェントのスキルとして使える)
- 決定の元：[利用者の決定](user-decisions.md)（2026-11-21「opencode 以外（Claude Code・om…」）。文中の「上の…」は、この決定を指す。
- 一覧：[ADR の一覧](README.md)・[SPEC.md の §8](../../SPEC.md#8-利用者の判断)

（AI の判断。上の指示の範囲）プラグインのルートは、リポジトリのルートにする（`skills/rikai/` をそのまま使う）。マニフェストは、codex・omp・agy は、ルートの `plugin.json`（Agent Plugins 1.0.0 の項目だけ。agy の schema も満たす）、Claude Code・grok は `.claude-plugin/`、pi は `package.json` の `pi`。版は、`package.json` と `plugin.json` だけに書く（Claude Code は、版を書くと、上げるまで更新しないため、書かない）
