# ADR-0061 隠すモードを、範囲の枠だけから、コメントの印すべてに広げた。拡大表示の html-app の番号の丸を、画像・図と同じ規則にした

- 日付：2026-11-25
- 種別：AI の設計の判断（0.1.7）。[ADR-0060](0060-hide-region-boxes.md) の一部を変更する
- 関連の機能：[F56](../features/region-element.md#f56-コメントの印を隠せる)・[F43](../features/zoom.md#f43-個別表示でコメントする)・[F55](../features/zoom.md#f55-拡大表示でも関連の線で結ぶ)
- 決定の元：[利用者の決定](user-decisions.md)（2026-11-25 (1)「非表示モードなんですが全てを非表示にするわけじゃないの？」〔スクリーンショット：隠した状態でも、図のブロック全体を囲む青い角丸の外枠と、「図全体として…」のカードから伸びる関連の線が残っていた〕(2)「html-app は番号が枠の中なんですが、図形や画像は枠の外なんですよね。これ統一しなくていいの？」〔拡大表示〕）。
- 一覧：[ADR の一覧](README.md)

## 決めたこと

### (1) 隠す対象を、コメントの印すべてにした

[ADR-0060](0060-hide-region-boxes.md) は、範囲の枠（`.regionbox`・`.fv-box`）だけを隠した。利用者の期待は「全てを非表示」だった。見本の青い角丸の外枠の正体は、**ブロックの外枠 `.blk-thread`**（図・画像・html-app・全体コメント・要素コメント）で、範囲の枠ではなかった。

- **隠す印**：文の強調 `mark.hl`（未解決・解決済み・選択中・光り・端末の枠の中）・ブロックの外枠 `.blk-thread`（resolved／active／linked）・番号の丸 `#badges .bno`・「+N」・ポップオーバー・範囲の枠 `.regionbox`・`.fv-box`・html-app の拡大表示の丸 `.fv-chip`・関連の線（`#links`・`.fv-links` の `.cn-g`。入力中の線以外）・hover の光りと、カードを選んだときの active（`.linked`／`.active`）。
- **残すもの**：入力中の対象（`mark.hl.pending`・`.blk-pending`・「新」の丸・`.regionbox.pending.still`・`.cn-g.pending`）は、押せない形で残す（何を選んだか分からなくなるため。[ADR-0060](0060-hide-region-boxes.md) と同じ理由）。右パネル・ドックのカードは、そのまま使える。
- **状態名**：`ui.regionBoxes` → **`ui.marks`**（既定は出す）。**旧キー**：`rikai-ui` は `marks` を先に読み、なければ 0.1.6 の `regionBoxes` を読む（旧い設定を失わない）。保存は `marks` のみ。新旧が両方あれば `marks` が先。
- **ボタン**：`aria-label="コメントの印を隠す"`（`title` も同じ言葉）・id は `#marks-toggle`／`.fv-marks-toggle`。`panel/RegionBoxesToggle.tsx` を削除し、`panel/MarksToggle.tsx` に置き換えた。置き場・目のアイコン・`aria-pressed` の規則は、ADR-0060 のまま。

### 隠し方：body のクラス＋CSS と、DOM に置かないことの併用

- **`<body class="hide-marks">` ＋ CSS で隠す**：`App.tsx` の `useHideMarks` が `useLayoutEffect` で付ける。リロードで隠した状態から始まるときも、初回の描画前に付くので、一瞬も見えない。文の強調・ブロックの外枠は、本文の DOM（markdown の描画結果）に直接ある印なので、DOM に置かない方式は取れない（描き直しのたびに、絞る場所が増える）。CSS で隠す。
- **範囲の枠・番号の丸・「+N」・`.fv-chip` は、DOM に置かない（`place.ts`・`useFocusCtx`）うえに、CSS でも隠す**：置き直しの 1 フレームの間も見えないため。
- **CSS の注意**：端末の枠の強調が足す暗い文字色も戻す・キーボードの焦点の輪（`:focus-visible`）は残す・`.linked` の背景は `body:not(.hide-marks)` の中に移し、ブロック自身の背景を消さない。

### (2) 拡大表示の番号の丸を、html-app も画像・図と同じ規則にした

- **原因（実測）**：丸の大きさは、画像・図・html-app とも 18×18px・11px で同じ（祖先に transform もなし）。ずれの原因は位置だけ：`top` クラス（`b.top < 24`）が `AppOverlay` に固定で付いていたため、html-app の丸が常に枠の内側（3, 3）に入っていた（画像・図は、枠の外側：dx −1・dy −21）。
- **直し**：html-app の丸は、`.fv-box` から外し、ステージ（`.fv-appstage`・`position: relative`）の中に **`.fv-chip`** として置く（枠の置き場の切り取り〔縮小・横スクロール〕に巻き込まれない）。位置は、枠の画面座標から、ステージ内の座標に換算して決め、ステージのスクロールにも追従する。**規則は画像・図と同じ**：左上の外側（左 −0.5px・上 −20.5px。枠の外側の角から測った値）。上に余地（24px）がないときだけ、内側の 3.5px・3.5px。CSS は `.fv-box .fv-no, .fv-chip` で共通化。
- 本文の html-app の番号の丸は、左の余白のまま（変更なし）。比べる画面に枠の番号はない。

## 既知の点（残る課題）

- 本文の `.blk-thread` の `cursor: pointer` は、隠している間 `cursor: auto`（印を隠したまま文を押すと、カードの選択という機能だけが残る。見た目の印は、出ない）。
- 拡大表示で、html-app の枠の上端に余地がないときの内側の丸は、小さなボタンに重なる（画像・図と同じ規則）。
- `focus-chips.spec.ts` の「ズーム 1 倍」が、負荷の高い全体実行で、一度だけ 2 秒で失敗した（原因未特定。開く直後の待ち方を強めた）。
- 詳細：[docs/verification.md](../verification.md)
