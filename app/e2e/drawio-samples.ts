// draw.io（```drawio）の e2e で使う、作り物の XML（実際の資料ではない）。
// HOTEL：見本の画像（ホテル予約のスイムレーン：4 レーン・角丸・四角・菱形・円柱・直交の矢印・線のラベル）を、`<mxGraphModel>` で再現したもの。
// SEQUENCE：シーケンス図（生命線・メッセージ・戻り・活性化の帯）。TABLE_MXFILE：`<mxfile><diagram>` で包んだ、表（`shape=table`）のスイムレーン。
import zlib from 'node:zlib';

export const BT = '```';

export const HOTEL = `<mxGraphModel dx="1000" dy="900" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="827" pageHeight="1169" math="0" shadow="0">
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
`;

export const SEQUENCE = `<mxGraphModel>
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
    <mxCell id="m5" value="ログ送信" style="html=1;verticalAlign=bottom;endArrow=block;" edge="1" parent="1" source="u" target="d"><mxGeometry relative="1" as="geometry"/></mxCell>
    <mxCell id="note" value="ここで&lt;b&gt;認証&lt;/b&gt;&lt;br&gt;を行う" style="shape=note;whiteSpace=wrap;html=1;size=12;fillColor=#fff2cc;strokeColor=#d6b656;" vertex="1" parent="1"><mxGeometry x="360" y="260" width="120" height="50" as="geometry"/></mxCell>
  </root>
</mxGraphModel>
`;

export const TABLE_MXFILE = `<mxfile host="app.diagrams.net" modified="2026-11-24T00:00:00.000Z" agent="test" version="24.0.0">
  <diagram id="d1" name="ページ1">
    <mxGraphModel dx="800" dy="600" grid="1" gridSize="10" page="1" pageWidth="827" pageHeight="1169">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
        <mxCell id="t1" value="申請フロー" style="shape=table;childLayout=tableLayout;startSize=30;rowLines=0;columnLines=0;fontStyle=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;fontSize=14;" vertex="1" parent="1"><mxGeometry x="40" y="40" width="400" height="300" as="geometry"/></mxCell>
        <mxCell id="r1" value="" style="shape=tableRow;horizontal=0;startSize=0;swimlaneHead=0;swimlaneBody=0;top=0;left=0;bottom=0;right=0;collapsible=0;dropTarget=0;fillColor=none;points=[[0,0.5],[1,0.5]];portConstraint=eastwest;strokeColor=inherit;" vertex="1" parent="t1"><mxGeometry y="30" width="400" height="270" as="geometry"/></mxCell>
        <mxCell id="c1" value="申請者" style="shape=partialRectangle;html=1;whiteSpace=wrap;connectable=0;fillColor=none;top=0;left=0;bottom=0;right=1;overflow=hidden;strokeColor=inherit;verticalAlign=top;fontStyle=1;" vertex="1" parent="r1"><mxGeometry width="200" height="270" as="geometry"><mxRectangle width="200" height="270" as="alternateBounds"/></mxGeometry></mxCell>
        <mxCell id="c2" value="承認者" style="shape=partialRectangle;html=1;whiteSpace=wrap;connectable=0;fillColor=none;top=0;left=0;bottom=0;right=0;overflow=hidden;strokeColor=inherit;verticalAlign=top;fontStyle=1;" vertex="1" parent="r1"><mxGeometry x="200" width="200" height="270" as="geometry"><mxRectangle width="200" height="270" as="alternateBounds"/></mxGeometry></mxCell>
        <mxCell id="a" value="申請書を&lt;br&gt;書く" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#d6b656;" vertex="1" parent="1"><mxGeometry x="90" y="110" width="100" height="50" as="geometry"/></mxCell>
        <mxCell id="b" value="内容を&lt;br&gt;確認" style="rhombus;whiteSpace=wrap;html=1;fillColor=#f8cecc;strokeColor=#b85450;" vertex="1" parent="1"><mxGeometry x="290" y="180" width="100" height="80" as="geometry"/></mxCell>
        <mxCell id="e" value="提出" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;exitX=1;exitY=0.5;entryX=0.5;entryY=0;" edge="1" parent="1" source="a" target="b"><mxGeometry relative="1" as="geometry"/></mxCell>
        <mxCell id="e2" value="差し戻し" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;exitX=0;exitY=0.5;entryX=0.5;entryY=1;dashed=1;" edge="1" parent="1" source="b" target="a"><mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="140" y="220"/></Array></mxGeometry></mxCell>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
`;

/** `<mxfile>` の中の `<mxGraphModel>` を、draw.io の圧縮形式（URI エンコード → deflate-raw → base64）にした `<mxfile>` */
export function compressMxfile(xml: string): string {
  const inner = /<mxGraphModel[\s\S]*<\/mxGraphModel>/.exec(xml)?.[0] ?? xml;
  const b64 = zlib.deflateRawSync(Buffer.from(encodeURIComponent(inner))).toString('base64');
  return `<mxfile host="app.diagrams.net"><diagram id="x" name="ページ1">${b64}</diagram></mxfile>`;
}

export const drawioBlock = (xml: string): string => `${BT}drawio\n${xml.trim()}\n${BT}`;
