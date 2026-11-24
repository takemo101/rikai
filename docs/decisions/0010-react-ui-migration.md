# ADR-0010 画面を React に切り替えた

- 日付：2026-11-23
- 種別：AI の設計の判断（もとは、SPEC.md の §8 の表の 1 行。文言は、そのまま移した）
- 決定の元：[利用者の決定](user-decisions.md)（2026-11-22「仕様が固まったので、サーバーは Hono、フロントは…」）。文中の「上の…」は、この決定を指す。
- 一覧：[ADR の一覧](README.md)・[SPEC.md の §8](../../SPEC.md#8-利用者の判断)

（AI の判断。上の判断の範囲）**画面を React に切り替えた**（RIK-036。0.15.0）。画面は `app/src/web/`（React 19・Vite・TypeScript strict・Zustand・TanStack Query・Hono RPC の型）。ビルドした成果物（`index.html`・`favicon.svg`・`assets/`・`THIRD-PARTY-LICENSES.txt`）を、`skills/rikai/public/` にコミットする（2026-11-22 の「配布」の判断のとおり）。旧 UI（`app.js`・`style.css`・`anchor.js`・`diff.js`・`progress.js`・`fmt.js`・`vendor/`）と、ルートの `test/` は、なくした。**意図した、旧との違い**：本文の強調（`.hl.active`・`.blk-thread.active`）が、描き直しをまたいで残る／AI の返信の描画が、本文と同じ `mdToFragment`（`kind: 'reply'`。`html-app` は、返信では、ふつうのコードブロック）／本文の取得が失敗している間は、コメントの入口を出さない／取得の失敗からの復帰が、旧より早い。**見た目は、旧の CSS（`legacy.css`。クラス名は同じ）のまま**にした。**Tailwind v4 は、土台（theme と utilities だけ。preflight なし。utilities は `tw:` の接頭辞つき）として入れたが、`tw:` のクラスは、1 つも使われなかった**（0.27.2 で外した：2026-11-24 の利用者の決定）。**e2e**（Playwright。`app/e2e/`。83 件）を、実際の Chrome の確認として加えた：旧 UI に対して書き、新しい画面で通した。画面の更新は、これまでどおり、1.5 秒ごとのポーリング（SSE は、別の PR）
