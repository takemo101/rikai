# ADR-0007 プラグインの更新は、版で管理する

- 日付：2026-11-21
- 種別：AI の設計の判断（もとは、SPEC.md の §8 の表の 1 行。文言は、そのまま移した）
- 関連の機能：[F18](../features/ai-commands.md#f18-エージェントのスキルとして使える)
- 決定の元：[利用者の決定](user-decisions.md)（2026-11-21「opencode 以外（Claude Code・om…」）。文中の「上の…」は、この決定を指す。
- 一覧：[ADR の一覧](README.md)・[SPEC.md の §8](../../SPEC.md#8-利用者の判断)

（AI の判断。上の指示の範囲）プラグインの更新は、版で管理するエージェントがある：omp・codex・agy は、`plugin.json` の版が同じだと、入れた複製を更新しない（レビューで、omp と codex で確認）。そのため、利用者に見える変更を入れるときは、`package.json` と `plugin.json` の版を、同じ値に上げる（docs/development.md）。Claude Code は、`.claude-plugin/` に版を書かず、git のコミットで更新される
