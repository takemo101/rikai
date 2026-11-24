# ADR-0057 opencode 対応：プラグインは作らず、スキルだけにした。待ち受けは、SKILL.md で `run_in_background` の有無を分けた

- 日付：2026-11-24
- 種別：AI の設計の判断（0.1.3）
- 関連の機能：[F18](../features/ai-commands.md#f18-エージェントのスキルとして使える)・[F19](../features/ai-commands.md#f19-待ち方をエージェントに合わせる)
- 決定の元：[利用者の決定](user-decisions.md)（2026-11-24「opencode にも対応してほしい。何かプラグインとして導入できたりする？」→ 調査結果を示したうえで「npm への公開は必要ないですが、それ以外はその進め方でお願いします」）。
- 一覧：[ADR の一覧](README.md)

## 決めたこと

- **opencode 用のプラグインは、作らない。スキル（`skills/rikai/`）だけで対応する**。
  - opencode の plugin（`opencode plugin add`）は、**npm パッケージの JS フック**で、スキルとは別物。スキルを読ませるだけなら、要らない。
  - rikai は、**npm に公開しない**（利用者の判断）。
- **スキルの置き場**：opencode が読む場所（opencode のドキュメントによる）：`~/.config/opencode/skills/`・`.opencode/skills/`・`~/.claude/skills/`・`.claude/skills/`。`install.sh` で `~/.claude/skills/rikai/` に置けば、Claude Code 用に入れたものを、opencode も読む。**実際に確かめたのは、`.opencode/skills/` だけ**（ほかは、ドキュメントによる）。README には、確かめた範囲を、そう書いた。以前の README の「opencode：`~/.config/opencode/skills/` または `.agents/skills/`」は、実際の確認がないので、外した。
- **待ち受け**：`rikai poll` は、「バックグラウンドで起動して、ターンを終え、終了で自動再開する」仕組みに頼る（Claude Code）。**opencode でも、同じ流れが動くことを、実際に確かめた**（opencode v2.4.1。親が実行）：
  - opencode の bash ツールは、**長いコマンドを、自動でバックグラウンドへ移す**（`Command moved to the background (shell ID …)`）。
  - **バックグラウンドの `poll` が終わると、エージェントが、自動で再開する**（「Shell finished」）。
  - `opencode run`（非対話）と、opencode の画面（TUI。tmux で操作）の両方で、作り物のトピックに、`rikai new`・`open --no-open`・`poll` → コメント 1 件と「AI に送る」を API で送る → 再開 → 資料を読む → 返信して `rikai apply`（v2 ができた）まで通った。
- **SKILL.md の「2. 返信を待つ」を、直した**：見出しを「Claude Code・opencode の場合」に。`rikai poll <topic>` の注記を、分けた：**Claude Code は、`run_in_background: true`**・**opencode は、そのまま実行する**（`run_in_background` はない。待つ間に、自動でバックグラウンドへ移るので、そのターンを終える）。
  - 理由：実際の確認で、プロンプトに `poll` を明示しないと、opencode のモデルが、SKILL の「それ以外のエージェント（待機できない）」の手順（ユーザーに「送った」と言ってもらい、`pull`）を選んで、ターンを終えることが、2 回あった。opencode が `poll` を選ぶよう、手順に、はっきり書いた。`run_in_background` の有無を分けたのは、opencode に、その引数がないため（書いたとおりに実行すると、エラーになる）。

## 採らなかった案

- **opencode 用の plugin（npm パッケージ）を作る**：スキルで足りる。npm に公開しない方針と合わない。
- **opencode も「それ以外のエージェント」（`pull` の手順）のままにする**：自動再開が動くので、ユーザーに「送った」と言わせる手間が、要らない。

## 確認と、残る課題・確認していない範囲

- **SKILL.md を直したあとの再確認：済み**（親が実行・2026-11-24・1 回）：直した `skills/rikai/`（0.1.3）を `.opencode/skills/rikai/` に置き、`poll` に言及しないプロンプト（「資料を作って開き、ユーザーのレビューを待って。コメントが届いたら全スレッドに返信して apply して」）で `opencode run` を流した。opencode が、自分で `rikai poll` を実行し、コメント 1 件と「AI に送る」を送ると再開して、返信・`rikai apply`（v2 ができた）まで通った。**1 回だけの小さな標本**。

- opencode の他のバージョン。`~/.config/opencode/skills/` と `~/.claude/skills/` からの読み込み（ドキュメントによる）。opencode の別のモデルでの `poll` の選び方（**モデルが、`pull` の手順を選ぶことがある**）。Windows。
- 詳細：[docs/verification.md](../verification.md)
