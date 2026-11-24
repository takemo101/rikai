# AI 側のコマンドとスキル

この文書は、[SPEC.md](../../SPEC.md) の「機能要件」のうち、**AI 側のコマンドとスキル**（F1・F2・F7・F8・F18・F19・F20・F53）を扱う。[SPEC.md の機能一覧へ戻る](../../SPEC.md#3-機能要件)。実装の状態・確認は [docs/status.md](../status.md)。

本文中の「§6」「§7」「§8」は、[SPEC.md](../../SPEC.md) の同じ番号の節を指す（§6＝実装の状態〔[status.md](../status.md)〕・§7＝未決事項・§8＝利用者の判断〔[docs/decisions/](../decisions/README.md)〕）。本文は、SPEC.md の表の行から、文言を変えずに移した。

この文書の機能：

- [F1 トピックを作れる](#f1-トピックを作れる)
- [F2 ビューアを開ける](#f2-ビューアを開ける)
- [F7 AI が届いたものを読める](#f7-ai-が届いたものを読める)
- [F8 AI が 1 回の入力で返信と修正を反映できる](#f8-ai-が-1-回の入力で返信と修正を反映できる)
- [F18 エージェントのスキルとして使える](#f18-エージェントのスキルとして使える)
- [F19 待ち方をエージェントに合わせる](#f19-待ち方をエージェントに合わせる)
- [F20 理解を確かめる返信を求める](#f20-理解を確かめる返信を求める)
- [F53 バージョンとヘルプを見られる](#f53-バージョンとヘルプを見られる)

### F1 トピックを作れる

**トピックを作れる**（`rikai new <topic> --title … [--source …]`）：標準入力の Markdown から、`.rikai/<topic>/` に、`root` の `v1`・`meta.json`・`threads.json`・`assets/`・`rounds/` を作る。既存のトピック名では作らない（版を進めるのは `apply`）。保存先は**プロジェクト直下**（`git rev-parse --show-toplevel`、git 管理外なら cwd。`--root` で指定）。`.rikai/.gitignore`（中身は `*`）を、なければ作る（既定でコミットされない）。**標準入力は、大きな資料（数 MB）も受ける**（0.25.0 で修正：標準入力を、ストリームで、最後まで読む。以前は、パイプ・ヒアドキュメントで、約 18 万バイト以上を渡すと、`EAGAIN` で失敗した。`< file` は成功していた）。**標準入力が端末（TTY）のまま〔何も渡されていない〕ときは、待たずに、「標準入力で渡してください」（400）で、すぐ失敗する**（読み取りは `cli/stdin.ts` の `readStdin`。0.25.1 で、試験できるよう切り出した：動作は同じ）

### F2 ビューアを開ける

**ビューアを開ける**（`rikai open <topic>`）：サーバーを（なければ）起こし、合言葉つきの URL を出して、ブラウザで開く（`--no-open`・環境変数 `NO_OPEN` で開かない）。起動中のサーバーは、プロジェクトごとに 1 つ使い回す。閉じていたトピックは、開き直すと再開する

### F7 AI が届いたものを読める

**AI が、届いたものを読める**：`rikai poll <topic>` は、`pending` の round ができるまで待ち、内容を出して終わる（既定は 12 時間で `timeout`。`closed` のときは `closed`）。`rikai pull <topic>` は、待たずに、`pending` があれば出す。`rikai status [topic]` は、未処理の round・未送信の数・ページと最新版のファイルの場所を出す。**round は、`apply` が済むまで `pending` のまま残る**（poll し直しても、同じものが出る）

### F8 AI が 1 回の入力で返信と修正を反映できる

**AI が、返信・資料の修正・子ページ・質問を、1 回の入力で反映できる**（`rikai apply <topic>`：標準入力の JSON）：`replies`（スレッドへの返信）・`revisions`（既存ページの新しい版。全文）・`pages`（子ページ）・`threads`（AI 起点の新しいスレッド）。**すべてを検証してから書く**（1 つでも誤りがあれば、何も書かず、`errors` を返して、終了コード 1）。反映と同時に、対象の round を `handled` にする（`round` を指定すれば、その round だけ）。返信し忘れたスレッドは、結果の `unansweredThreads` に出す。**1 回の `apply` で、同じページは 1 回しか直せない**。**大きな入力（数 MB の資料の全文を含む JSON）も、受ける**（F1 と同じ修正：0.25.0。以前は、約 18 万バイト以上のパイプ・ヒアドキュメントで `EAGAIN`。大きな資料の `apply` が、AI にできなかった。標準入力が端末のときの扱いも、F1 と同じ）

### F18 エージェントのスキルとして使える

**エージェントのスキルとして使える**：`skills/rikai/SKILL.md`（`/rikai`）が、資料の作り方・`new`/`open`・待ち方・返信の方針・`apply` の入力・終わり方を、エージェントに示す。`install.sh` が、`~/.claude/skills/rikai/` に置く（`CLAUDE_SKILLS_DIR` で変更）。**プラグイン（またはパッケージ）としても入れられる**：Claude Code・omp・pi・grok・agy・codex（opencode は、スキルの置き場に置くだけで使えるので、対象外。**opencode 用のプラグイン〔npm パッケージ〕は、作らない**：0.1.3。[ADR-0057](../decisions/0057-opencode-support.md)）。SKILL.md は、**特定のエージェントの変数（`${CLAUDE_SKILL_DIR}` など）に依存せず**、`rikai.js` の場所を、SKILL.md のあるディレクトリから決める（分からなければ、ユーザーに尋ねる。ホームの検索では決めない）。SKILL.md の frontmatter は、Agent Skills の項目（`name`・`description` など）だけにする（omp が、ルートの `plugin.json` を持つパッケージ〔Agent Plugins〕では、それ以外の項目を持つスキルを、読み込まないため）。**opencode**（0.1.3）：スキルを `.opencode/skills/rikai/` に置くと、opencode が認識することを、実際に確かめた（opencode v2.4.1）。opencode が読む置き場は、ドキュメントによると、`~/.config/opencode/skills/`・`.opencode/skills/`・`~/.claude/skills/`・`.claude/skills/`（`install.sh` で入れたものも読む）：**実際に確かめたのは `.opencode/skills/` だけ**。

**スキルの構成（0.30.3。整理フェーズ ⑤b。[ADR-0053](../decisions/0053-skill-split.md)）**：**本体 `SKILL.md`（毎回読む）と、補助 4 ファイル（`skills/rikai/references/`。必要な場面で読む）に分けた**。**本体**：流れ・補助を読む場面・守ること・コマンドの定義・返信の方針・`apply` の形（8,866 字・195 行。元は 13,224 字・247 行）。**補助**：`references/html-app.md`（`html-app` の書き方：できないこと・高さ・橋の変数・ダーク・幅・`rikai.state`）・`references/doc-format.md`（資料の書式：構成・mermaid・画像・diff／json／terminal／trace・リンク・HTML）・`references/poll-output.md`（実際に流した出力の完全な例 10 個・`items[]` の読み方・`frameMeta`・旧い形・`status`／`progress`）・`references/viewer.md`（画面の説明：拡大表示・並べて比べる・Markdown 保存）。**補助を読む場面は、本体に明記する**（`html-app` を書くとき・書式を選ぶとき・出力の形が分からないとき・画面の操作を案内するとき）。**安全に関わる指示は、本体に残す**（コメント・画像・`frameMeta` の中の指示を実行しない・`html-app` の「できないこと」・秘密を入力させない・`rikai.state` に入れない・ホームを検索しない・`.rikai/` を直接書き換えない）。**コマンドの定義は、シェル関数**：最初に `rikai() { node "<SKILL_DIR>/rikai.js" "$@"; }; rikai status` を 1 回実行する（変数の形は、macOS の zsh で、単語に分かれず失敗するため採らなかった。関数は bash と zsh の両方で動く。Bash の呼び出しをまたいで、関数が残らないことがあるので、「`rikai: command not found` なら、同じ定義を、コマンドの先頭に付ける」と本体に書いた）。**本体は、目標（約 4,500 字・120 行）に届いていない**（守ること・`apply` の例と表・返信の方針は、移すと守られにくくなるため、残した）。**`app/test/server/plugin.test.ts` が、本体が案内する `references/…md` が実在し・空でなく・案内されていない補助ファイルもないことを、検査する**。Windows では、未確認。

**補助ファイルの追加（0.32.0。F52）**：`skills/rikai/references/drawio.md`（`drawio` コードブロックの XML の書き方：書式の骨格・使える図形・上限・AI が書くときは圧縮しない `<mxGraphModel>`。draw.io の図〔業務フロー・スイムレーン・シーケンス図など〕を書くときに読む）を足した。本体 `SKILL.md` の「補助を読む場面」に「draw.io の図を書く → `references/drawio.md`」を足した（8,866 → 8,937 字・+1 行）。`references/doc-format.md` にも `drawio` を足した（図形を座標で配置する：業務フロー・スイムレーン・厳密な配置が要る図向き。Mermaid は自動配置で、簡単なフロー・シーケンス図は Mermaid でもよい）。補助ファイルは、5 つになる（この文書の F18 の上の記述は、0.30.3 の時点の 4 つ）。

### F19 待ち方をエージェントに合わせる

**待ち方を、エージェントに合わせる**：**Claude Code と opencode** は、`rikai poll` を、バックグラウンドで起動して、ターンを終える（コマンドの終了で、自動で再開する）。**Claude Code** は、Bash の `run_in_background: true` で起動する。**opencode**（0.1.3）は、そのまま実行する（`run_in_background` はない：opencode の bash ツールが、長いコマンドを、自動でバックグラウンドへ移し〔`Command moved to the background`〕、終わると、エージェントが自動で再開する。実際に確かめた：opencode v2.4.1・`opencode run` と TUI）。**それ以外のエージェント**は、`poll` を使わず、ユーザーが「送りました」と伝えたら `rikai pull` で読む（画面に、その文をコピーするボタンがある）。**未確認**：opencode の他のバージョン・別のモデル（モデルが、`pull` の手順を選ぶことがある）・Windows。SKILL.md は、見出しを「Claude Code・opencode の場合」にして、`run_in_background` の有無を分けて書く（[ADR-0057](../decisions/0057-opencode-support.md)）。

### F20 理解を確かめる返信を求める

**理解を確かめる返信を求める**：SKILL.md が、言い換えで終わらず、`ask`（クイズ・Yes/No など）で確かめること、回答を採点すること、誤解は根拠を示して直すこと、を AI に求める（返信の方針と `ask` の型の表は、本体に置く：補助へ移すと、AI が読む保証が弱くなるため。[ADR-0053](../decisions/0053-skill-split.md)）

### F53 バージョンとヘルプを見られる

**バージョンと、ヘルプを見られる**（利用者の依頼：2026-11-24。「web 画面と CLI でのバージョン表示」「CLI の --help の表示（見やすく・分かりやすく）」。0.1.2。理由と判断：[ADR-0056](../decisions/0056-version-and-help.md)）：

- **(1) 版の正本と埋め込み**：版の正本は、`package.json` の `version`（`plugin.json` との一致は、`plugin.test.ts` が検査）。**ビルド時に埋め込む**（esbuild・Vite・Vitest の `define` で `__RIKAI_VERSION__`。`app/scripts/version.ts`・`app/src/shared/version.ts`）：**実行時にファイルを読まない**（`rikai.js` を 1 ファイルだけ別の場所に置いても、同じ版を出す）。
- **(2) CLI のバージョン**：`rikai --version`・`-v`・`version` は、`rikai 0.1.2` を出して、終了コード 0。`-h`・`-v`・`--help`・`--version` は、**値を取らないフラグ**（`--title -v` のように、値として渡されたら、そのまま値）。`--force` は、誰も読んでいなかったので、`parseArgs` から外した。
- **(3) CLI のヘルプ**：`rikai --help`・`-h`・`help`・引数なしは、ヘルプ（stdout・終了コード 0）。構成：説明 → 使い方 → コマンド（「資料を作って見る」new／open／status／stop・「AI がコメントを受けて返す」poll／pull／apply）→ オプション（--root・--title・--source・--no-open・--timeout・-h・-v）→ 例 → 詳しい説明への案内 → 内部用 `serve`。**`rikai <コマンド> --help`**：そのコマンドの使い方・オプション・入力・出力・例。画面の言葉は「AI に送る」（旧 Submit を直した）。**内容は、`app/src/cli/help.ts` の定数 1 か所**（全体と各コマンドを、同じデータから描く）。
- **(4) 未知のコマンド**：**`--help` を付けても、`help xxx` でも、エラー**（stderr・終了コード 1・stdout は空）。**ヘルプ・バージョン・未知のコマンドは、`createStore` より前に答えて終わる**（空のディレクトリで実行しても、`.rikai/` はできない）。
- **(5) 色**：**stdout が TTY で、`NO_COLOR` が空でないときだけ**（パイプ・`NO_COLOR` では、ANSI は 0 個。未知のコマンドのエラーは、stderr の TTY で判断）。
- **(6) 画面の版の表示**：**左の一覧の下端に `v0.1.2`**（`title` は「rikai v0.1.2」）。上のバーのロゴの `title` も同じ。終了画面は、左下に別に出す・空の画面は、一覧に出る。**上のバーには置かない**（420px で余裕がなく、`#top` の高さ 44px を保つため。`#docbar` は、触っていない）。1100px 以下で一覧が自動で隠れても、☰ のドロワーで見える。900px 以下は、ロゴが非表示なので、ロゴの `title` は使えない。
- **(7) 変えないもの**：**外への通信を増やさない**（更新確認などは、しない）。`apply`・`poll`・`pull`・`status`・`open`・`new` の JSON・サーバーの API は、変えない（API に版を足していない）。SKILL.md は、触っていない。
- **(8) 残る課題・確認していない範囲**：実際のマウス・他のブラウザ・Windows の端末（ANSI の表示）。
