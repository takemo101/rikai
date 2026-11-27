# ADR-0062 数式は、KaTeX（0.18）で、GitHub と同じ 3 種類の書き方に対応する。HTML のまま拡大し、元の TeX を本文の文字として持つ

- 日付：2026-11-26
- 種別：AI の設計の判断（0.1.8）
- 関連の機能：[F57](../features/doc-format.md#f57-資料に数式を書ける)・[F37](../features/zoom.md#f37-本文の画像と図を拡大表示できる)・[F43](../features/zoom.md#f43-個別表示でコメントする)・[F25](../features/region-element.md#f25-本文の好きな範囲を選んでコメントできる)・[F52](../features/doc-format.md#f52-資料に-drawio-の図を埋め込める)
- 決定の元：[利用者の決定](user-decisions.md)（2026-11-26「markdown 表示で数式表示に対応してる？（`$$x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}$$`）」→ GitHub の書き方と、MathJax でなく KaTeX を示し「よし GitHub と同じく 3 種類対応にしましょう。そして KaTeX にしましょう」→ 見本で「問題ないです」）。
- 一覧：[ADR の一覧](README.md)

## 決めたこと

### ライブラリと版

- **KaTeX 0.18.10**（MIT）。MathJax は採らない（利用者の決定。KaTeX は同期で速く、依存が小さい）。**0.18 にした理由**：mermaid が `^0.18` を要求するので、同じ版にして 1 つの chunk を共有する（0.19.1 だと 259KB の chunk が重複した）。
- **動的 import**：数式のない資料では、KaTeX・CSS・フォントを読まない（`doc/render/math.ts`。`fillDiagrams` が呼ぶので、本文・返信・比べる画面で同じに動く）。

### 記法（GitHub と同じ 3 種類）

- 数式になるもの：文中 `$x$`・`` $`x`$ ``・文中の `$$x$$`・別行 `$$…$$`（1 行でも複数行でも）・` ```math `（`doc/render/mathSyntax.ts`。`marked` の拡張）。
- **数式にしないもの（迷うものは、ふつうの文字のまま）**：通貨 `$5 と $10`・直前が空白、または直後が数字の閉じる `$`・`\$`・コードスパン・コードブロックの中・空の式・空行をまたぐ式・閉じていない `$$`。作業中に見つかった不具合（コードの中の `$` で閉じて数式になっていた）は、コードスパンを読み飛ばして直した。

### 別行の数式は、図と同じブロックにする

- `DIAGRAM_SEL` に `.math-block` を足し、ラベルは「数式」。差分の文字・アンカー・`textIndex` から除外し、`focusable` の入口を図と同じにした。選択・拡大表示・範囲コメント・版の差分・並べて比べるまで、図と同じに通る。
- **範囲を選ぶ基準の箱は、式そのもの（`.katex`）**（`mediaOf`・`frameOf` が返す）。

### 拡大表示は、HTML をそのまま `transform: scale` で拡大する

- 採らなかった案：SVG 化（KaTeX は HTML／MathML 出力で、`foreignObject` 以外の SVG 化は難しい）。`LightboxTarget` に `math` を足した（`focus/zoomMath.ts`）。複数の式を含むブロックは、ブロック全体を 1 つの `.katex` の箱として拡大する。
- **拡大表示ボタンが出ない不具合**（利用者の報告：2026-11-26。行列の式のブロックで、バーに「コメント」だけ）：`zoomTargetOfBlock` が、ブロックの中の `img`・`svg` だけを探していて、svg を含まない式（行列・分数・和）は対象が見つからなかった。**`.math-block` なら、`.katex` を式そのものとして対象にする**。描画前に出したバーは、描画が終わったら出し直す（`ActionBar.tsx`）。

### 元の TeX を、本文の文字として持つ

- 文中の数式は、元の TeX を本文の文字として持ち、描いたあとは幅ゼロで見えなくする。**描画後の KaTeX の HTML・MathML の文字は、`textIndex`・ブロックのハッシュ・差分から除く（`.math-out`）**。描画の前後で、ハッシュ・引用・差分の文字が変わらない（単体で確認）。AI に届く引用にも、TeX が入る。コメントの強調は、見えない元の文字に付くので、描いた式にも、同じ印を CSS の `:has()` で写した。コピーすると、元の TeX が入る。
- 理由：コメントの位置づけ（ハッシュ・アンカー）が、描画の結果に左右されないようにする（[ADR-0060](0060-hide-region-boxes.md)・F56 の「見出しの文字を処理の入力にしない」と同じ考え）。

### 範囲の画像に、フォントを入れる

- 範囲の画像は、HTML を `foreignObject` の画像にするが、その中では `@font-face` の URL を読めず、数式の文字が代わりのフォントになる。→ **使う面の woff2 だけを、同じオリジンから読み、`data:` にして入れる**（`interact/katexFonts.ts`）。

### サニタイズ：許可リスト方式

- **本文の `PURIFY` は変えない**。KaTeX 専用の DOMPurify の別インスタンスで、許可リストを使う（リンク・画像・`foreignObject`・イベントハンドラは許さない）。`style` 属性は、`isSafeStyle` の許可リストと値の検査を通ったものだけ。結果は DocumentFragment のまま付け、**`innerHTML` は使わない**。
- **`trust: false`**（`\href`・`\url`・`\htmlClass` などは、命令名を赤い文字で出す）。
- 上限：ソース 20,000 文字・出力 1.5MB・`maxExpand` 1000・`maxSize` 50em・式ごとにキャッシュ・重い式は 12ms ごとに画面へ制御を返す。構文の誤りは、Mermaid と同じ見た目で、理由と元の TeX を文字で出す。

### フォントと CSP：woff2 のみ・埋め込まない

- `font-src` を足さずに済んだ（`/assets/KaTeX_*.woff2` は `default-src 'self'` に収まる）。Vite の既定の埋め込み（4KB 未満は `data:`）では、Size3 が CSP に拒まれるので、**woff2 は埋め込まない**設定にした。ファイル名はハッシュなし。woff2 は 20 個（合計 259,792 B。使う面だけを遅延で読み、通常の式で 3〜7 個）。`server/app.ts` に woff2 の MIME・`vite.config.ts` に `katex.min.css` の woff・ttf を除くプラグイン。
- **ライセンス**：KaTeX 本体は MIT・フォントは SIL OFL 1.1（Design Science と Khan Academy の著作権）。全文と著作権表示を、`THIRD-PARTY-LICENSES.txt` に入れた。
- **サイズ**：`index.js` +11,447 B（gzip +3,615 B）・`index.css` +1,868 B・`katex.js` 259,046 B（mermaid の分が既にあり、増分はほぼなし）・`katex.css` 22,276 B（数式があるときだけ読む）。

## 既知の点（残る課題）

- コピーすると、数式の前後に改行が入る（中身は元の TeX）。
- KaTeX の MathML のうち `\ulcorner` などと、`\fcolorbox` の MathML 側の `border` は、サニタイズで落ちる（表示は変わらない）。
- 本文のリストの項目の中の別行数式は、拡大できるが、範囲選択はできない。
- `\tag` は、式の右に続ける表示（KaTeX 本来の右端寄せではない）。
- 描画前のバーの出し直しは、実 Chrome の遅延での自動テストがない。実際のマウス・他のブラウザ・スクリーンリーダーは、未確認。
- 詳細：[docs/verification.md](../verification.md)
