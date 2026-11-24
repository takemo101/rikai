# 資料に draw.io の図を埋め込む（AI が書く XML の書式）

draw.io の図（業務フロー・スイムレーン・シーケンス図など）を書くときに読む。

コードブロックの種類を `drawio` にして、中に draw.io（mxGraph）の XML を書く。Mermaid の図と同じように、本文の図として描かれ、押すと拡大表示で、範囲を選んでコメントできる。draw.io の「ファイル → エクスポート → XML」「拡張 → 編集 → 図を編集」で得る `<mxGraphModel>…</mxGraphModel>` が、そのまま使える（`<mxfile><diagram>` で包まれた形・圧縮された形も読める。**AI が書くときは、圧縮しない `<mxGraphModel>` を書く**）。

## 書式の骨格

- 最初に、`<mxCell id="0"/>` と `<mxCell id="1" parent="0"/>` の 2 つ（レイヤー）。以降のセルは、`parent="1"`（または、親になる図形の `id`）。
- 図形：`vertex="1"`。`<mxGeometry x y width height as="geometry"/>`。**子の座標は、親の左上からの相対**。
- 線：`edge="1"`・`source="図形の id"`・`target="図形の id"`・`<mxGeometry relative="1" as="geometry"/>`。
- `value` がラベル。**`html=1` を付けて、`&lt;br&gt;` で改行**する（タグは、文字に直される：`<b>` などの装飾・リンク・画像は、出ない）。`whiteSpace=wrap` を付けると、図形の幅で自動で折り返す（日本語も）。
- `value`・`style` の中の `<`・`>`・`"`・`&` は、XML の実体（`&lt;`・`&gt;`・`&quot;`・`&amp;`）にする。

## 使える図形（`style`）

| 図形 | style の例 |
| --- | --- |
| 四角 | `rounded=0;whiteSpace=wrap;html=1;` |
| 角丸 | `rounded=1;whiteSpace=wrap;html=1;`（丸みは `arcSize=20`〔%〕。`arcSize=50` で、端が半円） |
| 楕円 | `ellipse;whiteSpace=wrap;html=1;` |
| 菱形（分岐） | `rhombus;whiteSpace=wrap;html=1;` |
| 円柱（データベース） | `shape=cylinder3;whiteSpace=wrap;html=1;boundedLbl=1;backgroundOutline=1;size=25;`（`size`：上の楕円の高さの半分） |
| 定義済み処理 | `shape=process;whiteSpace=wrap;html=1;` |
| 平行四辺形（入出力） | `shape=parallelogram;whiteSpace=wrap;html=1;`（`size=0.2`〔幅の割合〕・`fixedSize=1;size=20`〔px〕） |
| 六角形 | `shape=hexagon;whiteSpace=wrap;html=1;` |
| ドキュメント | `shape=document;whiteSpace=wrap;html=1;` |
| 三角 | `triangle;direction=north;`（`east`〔既定〕・`south`・`west`） |
| テキストだけ | `text;html=1;align=left;verticalAlign=top;whiteSpace=wrap;` |
| アクター | `shape=umlActor;verticalLabelPosition=bottom;verticalAlign=top;html=1;`（ラベルは、下） |
| 生命線（シーケンス図の参加者） | `shape=umlLifeline;perimeter=lifelinePerimeter;whiteSpace=wrap;html=1;`（見出しの高さ `size=40`〔既定〕。高さ全体が、生命線の長さ） |
| スイムレーン | `swimlane;html=1;startSize=30;`（見出しの帯の高さ。横書きの見出し＝帯が上）・`swimlane;horizontal=0;startSize=30;`（帯が左・見出しは縦書き） |
| 表 | `shape=table;startSize=30;`（表題の帯）＋ 行 `shape=tableRow;…`・セル `shape=partialRectangle;top=0;left=0;bottom=0;right=1;…`（辺ごとに、線の有無） |
| フローチャートの図形 | `shape=mxgraph.flowchart.terminator`（端が半円）・`…start_2`・`…decision`（菱形）・`…database`（円柱）・`…document`・`…process`・`…predefined_process`・`…data`・`…preparation` |

**上の表にない `shape` は、四角で描き、図の下に「未対応の図形（…）は、四角で描きました」と出る**（成功には見えない）。画像（`shape=image`・`image=`）・リンク（`link=`）は、使えない（出ない）。

## 色・線・文字（style）

- `fillColor=#dae8fc;strokeColor=#6c8ebf;fontColor=#333333;`：**`#rgb`・`#rrggbb`・`none`・CSS の色名（`red` など）だけ**。`rgb(…)`・`url(…)` は、無視される（図の下に、記録が出る）。`light-dark(#ffffff,#121212)` も使える。
- 色を指定しない図形・線・文字は、画面の外観（ライト・ダーク）の標準の色。**指定した地の上の、色を指定しない文字は、地に合わせて黒か白**になる。純粋な黒（`#000000`）の線・文字と、純粋な白の地は、標準の色として扱う（ダークでも、消えない）。それ以外の色は、そのまま。
- `strokeWidth=2;dashed=1;opacity=60;fontSize=14;fontStyle=1`（1＝太字・2＝斜体・4＝下線の足し算）・`align=left|center|right`・`verticalAlign=top|middle|bottom`・`rotation=90`。
- スイムレーンの色：見出しの帯が `fillColor`・本体の地が `swimlaneFillColor`。

## 線（edge）

- `edgeStyle=orthogonalEdgeStyle;` で、直交する線（直角に曲がる）。指定しなければ、直線。`elbowEdgeStyle;elbow=vertical` は、縦に出入り。
- **接続点**：`exitX=1;exitY=0.5;`（出る辺：0〜1 の割合。右の辺の中点）・`entryX=0.5;entryY=0;`（入る辺：上の辺の中点）。指定しなければ、相対位置から自動で決める。**曲がりは 1〜3 回の簡易ルーティングで、他の図形を避けない**：図形を避けたいときは、経由点を書く。
- **経由点**：`<mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="175" y="527.5"/></Array></mxGeometry>`（座標は、線の親〔`parent="1"` なら、図全体〕の座標）。
- **ラベル**：`value="ある"`。位置は、`<mxGeometry x="-0.5" relative="1" as="geometry"><mxPoint x="10" y="-12" as="offset"/></mxGeometry>`（`x`：線の始点 −1 〜 終点 1・`offset`：px のずらし）。線の上のラベルは、紙の色の地を敷く（`labelBackgroundColor=none` で、敷かない）。
- **矢印**：`endArrow=classic`（既定）・`block`・`open`・`oval`・`diamond`・`none`。`startArrow=…`（既定は none）。`endFill=0` で、白抜き。
- 図形につながない線（シーケンス図のメッセージ）：`source`・`target` を書かず、`<mxPoint x="…" y="…" as="sourcePoint"/>`・`<mxPoint … as="targetPoint"/>`。

## 上限・失敗

XML は 500KB まで・セルは 2000 個まで・座標は ±100000・入れ子は 25 段まで・圧縮の展開後は 2MB まで。壊れた XML・上限超え・循環した親子は、**図の代わりに、理由とソースが文字で出る**（Mermaid の失敗と同じ表示）。存在しない `parent` は、最上位として描き、図の下に記録が出る。**1 つの `<mxfile>` に複数のページがあっても、最初のページだけ**。

## 例 1：分岐のある簡単な流れ（四角・角丸・菱形・円柱・直交の線・ラベル・破線）

```drawio
<mxGraphModel>
  <root>
    <mxCell id="0"/>
    <mxCell id="1" parent="0"/>
    <mxCell id="s" value="開始" style="rounded=1;arcSize=50;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;" vertex="1" parent="1"><mxGeometry x="40" y="20" width="120" height="40" as="geometry"/></mxCell>
    <mxCell id="d" value="在庫あり？" style="rhombus;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#d6b656;" vertex="1" parent="1"><mxGeometry x="30" y="100" width="140" height="80" as="geometry"/></mxCell>
    <mxCell id="ok" value="出荷する" style="rounded=0;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;" vertex="1" parent="1"><mxGeometry x="240" y="120" width="120" height="40" as="geometry"/></mxCell>
    <mxCell id="ng" value="入荷待ちを&lt;br&gt;案内する" style="rounded=0;whiteSpace=wrap;html=1;fillColor=#f8cecc;strokeColor=#b85450;" vertex="1" parent="1"><mxGeometry x="40" y="240" width="120" height="50" as="geometry"/></mxCell>
    <mxCell id="db" value="在庫DB" style="shape=cylinder3;whiteSpace=wrap;html=1;boundedLbl=1;backgroundOutline=1;size=12;fillColor=#e1d5e7;strokeColor=#9673a6;" vertex="1" parent="1"><mxGeometry x="420" y="100" width="80" height="90" as="geometry"/></mxCell>
    <mxCell id="e1" style="edgeStyle=orthogonalEdgeStyle;html=1;exitX=0.5;exitY=1;entryX=0.5;entryY=0;" edge="1" parent="1" source="s" target="d"><mxGeometry relative="1" as="geometry"/></mxCell>
    <mxCell id="e2" value="はい" style="edgeStyle=orthogonalEdgeStyle;html=1;exitX=1;exitY=0.5;entryX=0;entryY=0.5;" edge="1" parent="1" source="d" target="ok"><mxGeometry relative="1" as="geometry"/></mxCell>
    <mxCell id="e3" value="いいえ" style="edgeStyle=orthogonalEdgeStyle;html=1;exitX=0.5;exitY=1;entryX=0.5;entryY=0;" edge="1" parent="1" source="d" target="ng"><mxGeometry relative="1" as="geometry"/></mxCell>
    <mxCell id="e4" value="照会" style="edgeStyle=orthogonalEdgeStyle;html=1;dashed=1;endArrow=open;exitX=1;exitY=0.5;entryX=0;entryY=0.5;" edge="1" parent="1" source="ok" target="db"><mxGeometry relative="1" as="geometry"/></mxCell>
  </root>
</mxGraphModel>
```

## 例 2：シーケンス図（生命線・メッセージ・戻りの破線・活性化の帯）

```drawio
<mxGraphModel>
  <root>
    <mxCell id="0"/>
    <mxCell id="1" parent="0"/>
    <mxCell id="u" value="ユーザー" style="shape=umlLifeline;perimeter=lifelinePerimeter;whiteSpace=wrap;html=1;container=1;dropTarget=0;collapsible=0;recursiveResize=0;outlineConnect=0;portConstraint=eastwest;newEdgeStyle={&quot;curved&quot;:0,&quot;rounded&quot;:0};fillColor=#dae8fc;strokeColor=#6c8ebf;" vertex="1" parent="1"><mxGeometry x="40" y="40" width="100" height="320" as="geometry"/></mxCell>
    <mxCell id="s" value="サーバー" style="shape=umlLifeline;perimeter=lifelinePerimeter;whiteSpace=wrap;html=1;container=1;dropTarget=0;collapsible=0;recursiveResize=0;outlineConnect=0;portConstraint=eastwest;fillColor=#d5e8d4;strokeColor=#82b366;" vertex="1" parent="1"><mxGeometry x="240" y="40" width="100" height="320" as="geometry"/></mxCell>
    <mxCell id="d" value="DB" style="shape=umlLifeline;perimeter=lifelinePerimeter;whiteSpace=wrap;html=1;container=1;dropTarget=0;collapsible=0;recursiveResize=0;outlineConnect=0;portConstraint=eastwest;fillColor=#ffe6cc;strokeColor=#d79b00;" vertex="1" parent="1"><mxGeometry x="440" y="40" width="100" height="320" as="geometry"/></mxCell>
    <mxCell id="act" value="" style="html=1;points=[];perimeter=orthogonalPerimeter;fillColor=#d5e8d4;strokeColor=#82b366;" vertex="1" parent="1"><mxGeometry x="285" y="110" width="10" height="150" as="geometry"/></mxCell>
    <mxCell id="m1" value="ログイン要求" style="html=1;verticalAlign=bottom;endArrow=block;endFill=1;" edge="1" parent="1"><mxGeometry relative="1" as="geometry"><mxPoint x="90" y="110" as="sourcePoint"/><mxPoint x="285" y="110" as="targetPoint"/></mxGeometry></mxCell>
    <mxCell id="m3" value="照会" style="html=1;verticalAlign=bottom;endArrow=block;endFill=1;" edge="1" parent="1"><mxGeometry relative="1" as="geometry"><mxPoint x="295" y="160" as="sourcePoint"/><mxPoint x="490" y="160" as="targetPoint"/></mxGeometry></mxCell>
    <mxCell id="m4" value="結果" style="html=1;verticalAlign=bottom;endArrow=open;dashed=1;endFill=0;" edge="1" parent="1"><mxGeometry relative="1" as="geometry"><mxPoint x="490" y="210" as="sourcePoint"/><mxPoint x="295" y="210" as="targetPoint"/></mxGeometry></mxCell>
    <mxCell id="m2" value="認証結果" style="html=1;verticalAlign=bottom;endArrow=open;dashed=1;endFill=0;" edge="1" parent="1"><mxGeometry relative="1" as="geometry"><mxPoint x="285" y="260" as="sourcePoint"/><mxPoint x="90" y="260" as="targetPoint"/></mxGeometry></mxCell>
    <mxCell id="note" value="ここで&lt;b&gt;認証&lt;/b&gt;&lt;br&gt;を行う" style="rounded=0;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#d6b656;" vertex="1" parent="1"><mxGeometry x="360" y="260" width="120" height="50" as="geometry"/></mxCell>
  </root>
</mxGraphModel>
```

## 例 3：見本の再現（ホテル予約のスイムレーン：4 レーン・角丸・四角・菱形・円柱・直交の矢印・線のラベル）

レーンは、`swimlane;startSize=45`（見出しの帯）を横に並べ、図形は、**レーンの子**（`parent="lane2"`・座標は、レーンの左上からの相対）。線は、`parent="1"`・座標は、図全体。

```drawio
<mxGraphModel dx="1000" dy="900" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="827" pageHeight="1169" math="0" shadow="0">
  <root>
    <mxCell id="0"/>
    <mxCell id="1" parent="0"/>
    <mxCell id="lane1" value="お客様" style="swimlane;html=1;startSize=45;fillColor=#aec4e3;strokeColor=#000000;fontSize=17;fontStyle=0;whiteSpace=wrap;swimlaneLine=1;" vertex="1" parent="1"><mxGeometry x="0" y="0" width="168" height="880" as="geometry"/></mxCell>
    <mxCell id="lane2" value="オペレーター" style="swimlane;html=1;startSize=45;fillColor=#aec4e3;strokeColor=#000000;fontSize=17;fontStyle=0;whiteSpace=wrap;swimlaneLine=1;" vertex="1" parent="1"><mxGeometry x="168" y="0" width="232" height="880" as="geometry"/></mxCell>
    <mxCell id="lane3" value="予約照会&lt;br&gt;システム" style="swimlane;html=1;startSize=45;fillColor=#aec4e3;strokeColor=#000000;fontSize=17;fontStyle=0;whiteSpace=wrap;swimlaneLine=1;" vertex="1" parent="1"><mxGeometry x="400" y="0" width="168" height="880" as="geometry"/></mxCell>
    <mxCell id="lane4" value="ホテル" style="swimlane;html=1;startSize=45;fillColor=#aec4e3;strokeColor=#000000;fontSize=17;fontStyle=0;whiteSpace=wrap;swimlaneLine=1;" vertex="1" parent="1"><mxGeometry x="568" y="0" width="169" height="880" as="geometry"/></mxCell>
    <mxCell id="phone" value="ホテル予約の&lt;br&gt;電話" style="rounded=1;arcSize=20;whiteSpace=wrap;html=1;fillColor=#d5e0f0;strokeColor=#3b4a63;fontSize=15;" vertex="1" parent="lane1"><mxGeometry x="6" y="71" width="141" height="79" as="geometry"/></mxCell>
    <mxCell id="ask" value="お客様の&lt;br&gt;希望を聞く" style="rounded=0;whiteSpace=wrap;html=1;fillColor=#d5e0f0;strokeColor=#3b4a63;fontSize=15;" vertex="1" parent="lane2"><mxGeometry x="43" y="167" width="146" height="85" as="geometry"/></mxCell>
    <mxCell id="check" value="システムに&lt;br&gt;空室情報を確認" style="rounded=0;whiteSpace=wrap;html=1;fillColor=#d5e0f0;strokeColor=#3b4a63;fontSize=15;" vertex="1" parent="lane2"><mxGeometry x="43" y="277" width="146" height="84" as="geometry"/></mxCell>
    <mxCell id="avail" value="空室が" style="rhombus;whiteSpace=wrap;html=1;fillColor=#d5e0f0;strokeColor=#3b4a63;fontSize=15;" vertex="1" parent="lane2"><mxGeometry x="34" y="478" width="164" height="99" as="geometry"/></mxCell>
    <mxCell id="send" value="システムに予約&lt;br&gt;情報を送信" style="rounded=0;whiteSpace=wrap;html=1;fillColor=#d5e0f0;strokeColor=#3b4a63;fontSize=15;" vertex="1" parent="lane2"><mxGeometry x="43" y="611" width="146" height="83" as="geometry"/></mxCell>
    <mxCell id="other" value="お客様に&lt;br&gt;別の宿を提案" style="rounded=0;whiteSpace=wrap;html=1;fillColor=#d5e0f0;strokeColor=#3b4a63;fontSize=15;" vertex="1" parent="lane2"><mxGeometry x="43" y="716" width="146" height="84" as="geometry"/></mxCell>
    <mxCell id="answer" value="空室情報を&lt;br&gt;回答" style="rounded=0;whiteSpace=wrap;html=1;fillColor=#d5e0f0;strokeColor=#3b4a63;fontSize=15;" vertex="1" parent="lane3"><mxGeometry x="13" y="377" width="144" height="83" as="geometry"/></mxCell>
    <mxCell id="db1" value="予約記録を&lt;br&gt;保存" style="shape=cylinder3;whiteSpace=wrap;html=1;boundedLbl=1;backgroundOutline=1;size=25;fillColor=#d5e0f0;strokeColor=#3b4a63;fontSize=15;" vertex="1" parent="lane3"><mxGeometry x="22" y="586" width="132" height="133" as="geometry"/></mxCell>
    <mxCell id="hotel" value="ホテルに予約&lt;br&gt;情報を送信" style="rounded=0;whiteSpace=wrap;html=1;fillColor=#d5e0f0;strokeColor=#3b4a63;fontSize=15;" vertex="1" parent="lane3"><mxGeometry x="15" y="735" width="146" height="84" as="geometry"/></mxCell>
    <mxCell id="db2" value="予約記録を&lt;br&gt;保存" style="shape=cylinder3;whiteSpace=wrap;html=1;boundedLbl=1;backgroundOutline=1;size=25;fillColor=#d5e0f0;strokeColor=#3b4a63;fontSize=15;" vertex="1" parent="lane4"><mxGeometry x="21" y="711" width="132" height="132" as="geometry"/></mxCell>
    <mxCell id="e1" value="" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#000000;endArrow=classic;endFill=1;fontSize=14;exitX=1;exitY=0.5;entryX=0.5;entryY=0;" edge="1" parent="1" source="phone" target="ask"><mxGeometry relative="1" as="geometry"></mxGeometry></mxCell>
    <mxCell id="e2" value="" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#000000;endArrow=classic;endFill=1;fontSize=14;exitX=0.5;exitY=1;entryX=0.5;entryY=0;" edge="1" parent="1" source="ask" target="check"><mxGeometry relative="1" as="geometry"></mxGeometry></mxCell>
    <mxCell id="e3" value="" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#000000;endArrow=classic;endFill=1;fontSize=14;exitX=1;exitY=0.5;entryX=0.5;entryY=0;" edge="1" parent="1" source="check" target="answer"><mxGeometry relative="1" as="geometry"></mxGeometry></mxCell>
    <mxCell id="e4" value="" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#000000;endArrow=classic;endFill=1;fontSize=14;exitX=0;exitY=0.5;entryX=0.5;entryY=0;" edge="1" parent="1" source="answer" target="avail"><mxGeometry relative="1" as="geometry"></mxGeometry></mxCell>
    <mxCell id="e5" value="ある" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#000000;endArrow=classic;endFill=1;fontSize=14;exitX=0.5;exitY=1;entryX=0.5;entryY=0;" edge="1" parent="1" source="avail" target="send"><mxGeometry x="0" relative="1" as="geometry"><mxPoint x="26" y="-12" as="offset"/></mxGeometry></mxCell>
    <mxCell id="e6" value="ない" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#000000;endArrow=classic;endFill=1;fontSize=14;exitX=0;exitY=0.5;entryX=0;entryY=0.5;" edge="1" parent="1" source="avail" target="other"><mxGeometry x="-0.9" relative="1" as="geometry"><Array as="points"><mxPoint x="175" y="527.5"/></Array><mxPoint x="0" y="-14" as="offset"/></mxGeometry></mxCell>
    <mxCell id="e7" value="" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#000000;endArrow=classic;endFill=1;fontSize=14;exitX=1;exitY=0.5;entryX=0;entryY=0.5;" edge="1" parent="1" source="send" target="db1"><mxGeometry relative="1" as="geometry"></mxGeometry></mxCell>
    <mxCell id="e8" value="" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#000000;endArrow=classic;endFill=1;fontSize=14;exitX=0.5;exitY=1;entryX=0.5;entryY=0;" edge="1" parent="1" source="db1" target="hotel"><mxGeometry relative="1" as="geometry"></mxGeometry></mxCell>
    <mxCell id="e9" value="" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#000000;endArrow=classic;endFill=1;fontSize=14;exitX=1;exitY=0.5;entryX=0;entryY=0.5;" edge="1" parent="1" source="hotel" target="db2"><mxGeometry relative="1" as="geometry"></mxGeometry></mxCell>
  </root>
</mxGraphModel>
```
