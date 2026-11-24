// @vitest-environment jsdom
// draw.io の XML → モデル：セル・親子の相対座標・レイヤーの順・mxfile・object の包み・上限・失敗（成功に見せない）・圧縮
import { expect, test } from 'vitest';
import {
  DrawioError,
  type DxEdge,
  type DxVertex,
  inflateDiagram,
  LIMITS,
  parseDrawio,
} from '../../../src/web/doc/render/drawioModel';

const wrap = (cells: string): string =>
  `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells}</root></mxGraphModel>`;
const geo = (x: number, y: number, w: number, h: number) =>
  `<mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry"/>`;
const vtx = (id: string, parent: string, x: number, y: number, w = 10, h = 10, style = '', value = '') =>
  `<mxCell id="${id}" value="${value}" style="${style}" vertex="1" parent="${parent}">${geo(x, y, w, h)}</mxCell>`;

const vertex = (m: ReturnType<typeof parseDrawio>, id: string) => m.byId.get(id) as DxVertex;

test('子の座標は、親の左上からの相対（絶対にして持つ）。入れ子も', () => {
  const m = parseDrawio(
    wrap(vtx('lane', '1', 100, 50, 300, 400, 'swimlane') + vtx('a', 'lane', 20, 30) + vtx('b', 'a', 5, 5)),
  );
  expect(vertex(m, 'lane').rect).toEqual({ x: 100, y: 50, w: 300, h: 400 });
  expect(vertex(m, 'a').rect).toMatchObject({ x: 120, y: 80 });
  expect(vertex(m, 'b').rect).toMatchObject({ x: 125, y: 85 });
  expect(vertex(m, 'a').container).toBe('lane');
  expect(vertex(m, 'lane').shape).toBe('swimlane');
});

test('描く順：親が子より先（定義が逆でも）・線は、そのレイヤーの図形の上・レイヤーは、定義の順', () => {
  const m = parseDrawio(
    `<mxGraphModel><root><mxCell id="0"/><mxCell id="L1" parent="0"/><mxCell id="L2" parent="0"/>` +
      vtx('child', 'parent', 1, 1) +
      vtx('parent', 'L1', 0, 0, 50, 50) +
      `<mxCell id="e" edge="1" parent="L1" source="parent" target="v2"><mxGeometry relative="1" as="geometry"/></mxCell>` +
      vtx('v2', 'L1', 80, 0) +
      vtx('top', 'L2', 0, 0) +
      `</root></mxGraphModel>`,
  );
  expect(m.items.map((i) => i.id)).toEqual(['parent', 'child', 'v2', 'e', 'top']);
});

test('線：source・target・経由点（親の座標で絶対に）・端の点・ラベルの位置。存在しない source は、無いものとして', () => {
  const m = parseDrawio(
    wrap(
      vtx('c', '1', 100, 100, 200, 200) +
        vtx('a', '1', 0, 0) +
        `<mxCell id="e" value="ラベル" edge="1" parent="c" source="a" target="ghost"><mxGeometry x="-0.5" y="7" relative="1" as="geometry"><mxPoint x="1" y="2" as="sourcePoint"/><mxPoint x="3" y="4" as="targetPoint"/><mxPoint x="9" y="8" as="offset"/><Array as="points"><mxPoint x="10" y="20"/></Array></mxGeometry></mxCell>`,
    ),
  );
  const e = m.byId.get('e') as DxEdge;
  expect(e.source).toBe('a');
  expect(e.target).toBeNull();
  expect(e.points).toEqual([{ x: 110, y: 120 }]); // 親（コンテナ）の原点を足す
  expect(e.sourcePoint).toEqual({ x: 101, y: 102 });
  expect(e.targetPoint).toEqual({ x: 103, y: 104 });
  expect(e.label).toEqual({ x: -0.5, y: 7, offset: { x: 9, y: 8 } });
  expect(e.text).toBe('ラベル');
});

test('線の上のラベル（親が線の頂点）は、onEdge で持つ。座標は、線から決まる', () => {
  const m = parseDrawio(
    wrap(
      vtx('a', '1', 0, 0) +
        vtx('b', '1', 100, 0) +
        `<mxCell id="e" edge="1" parent="1" source="a" target="b"><mxGeometry relative="1" as="geometry"/></mxCell>` +
        `<mxCell id="lab" value="あり" style="edgeLabel;html=1;" vertex="1" connectable="0" parent="e"><mxGeometry x="0.2" y="5" relative="1" as="geometry"><mxPoint as="offset"/></mxGeometry></mxCell>`,
    ),
  );
  const lab = vertex(m, 'lab');
  expect(lab.onEdge).toEqual({ edge: 'e', x: 0.2, y: 5, offset: { x: 0, y: 0 } });
  expect(m.items.map((i) => i.id)).toEqual(['a', 'b', 'e', 'lab']);
});

test('object・UserObject の包み：label がラベル・id は包みの id。<mxfile><diagram> で包まれた形も読む（最初のページだけ・記録する）', () => {
  const inner = `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><object label="包み" id="o1" link="https://evil.example"><mxCell style="html=1;" vertex="1" parent="1">${geo(0, 0, 10, 10)}</mxCell></object></root></mxGraphModel>`;
  const m = parseDrawio(
    `<mxfile><diagram id="d" name="p1">${inner}</diagram><diagram id="d2" name="p2">${inner}</diagram></mxfile>`,
  );
  expect(vertex(m, 'o1').text).toBe('包み');
  expect(m.notes.join()).toContain('2 つ');
  expect(JSON.stringify(m.items)).not.toContain('evil'); // link は、持たない
});

test('html=1 のラベル：タグを外す。html でなければ、そのまま（タグも文字）', () => {
  const m = parseDrawio(
    wrap(
      vtx('h', '1', 0, 0, 10, 10, 'html=1', '一&lt;br&gt;二&lt;img src=x onerror=alert(1)&gt;&lt;b&gt;三&lt;/b&gt;') +
        vtx('p', '1', 0, 0, 10, 10, '', '&lt;b&gt;そのまま&lt;/b&gt;'),
    ),
  );
  expect(vertex(m, 'h').text).toBe('一\n二三');
  expect(vertex(m, 'p').text).toBe('<b>そのまま</b>');
});

test('存在しない親は、最上位として描き、記録する。visible=0 は、子ごと描かない。未対応の shape は、四角で代用して記録する', () => {
  const m = parseDrawio(
    wrap(
      vtx('orphan', 'nowhere', 3, 4) +
        `<mxCell id="hid" vertex="1" visible="0" parent="1">${geo(0, 0, 5, 5)}</mxCell>` +
        vtx('kid', 'hid', 0, 0) +
        vtx('odd', '1', 0, 0, 10, 10, 'shape=mxgraph.bpmn.gateway2'),
    ),
  );
  expect(vertex(m, 'orphan').rect).toMatchObject({ x: 3, y: 4 });
  expect(m.byId.has('hid')).toBe(false);
  expect(m.byId.has('kid')).toBe(false);
  expect(vertex(m, 'odd').shape).toBe('rect');
  expect(m.notes.join('\n')).toContain('存在しない親');
  expect(m.notes.join('\n')).toContain('mxgraph.bpmn.gateway2');
});

test('失敗：壊れた XML・別の根・DOCTYPE・循環した親子・深すぎる入れ子・巨大な座標・セルが多すぎる・大きすぎる XML は、DrawioError', () => {
  const bad = (xml: string, re: RegExp) => {
    let err: unknown;
    try {
      parseDrawio(xml);
    } catch (e) {
      err = e;
    }
    expect(err, xml.slice(0, 60)).toBeInstanceOf(DrawioError);
    expect((err as Error).message).toMatch(re);
  };
  bad('<mxGraphModel><root>', /読めません/);
  bad('<svg xmlns="http://www.w3.org/2000/svg"/>', /mxGraphModel/);
  bad('<!DOCTYPE x [<!ENTITY a "b">]><mxGraphModel><root/></mxGraphModel>', /DOCTYPE/);
  bad(wrap(vtx('a', 'b', 0, 0) + vtx('b', 'a', 0, 0)), /循環/);
  const deep = Array.from({ length: LIMITS.depth + 2 }, (_, i) => vtx(`n${i}`, i ? `n${i - 1}` : '1', 0, 0)).join('');
  bad(wrap(deep), /深すぎ/);
  bad(wrap(vtx('a', '1', 1e9, 0)), /範囲/);
  bad(wrap(Array.from({ length: LIMITS.cells + 1 }, (_, i) => vtx(`c${i}`, '1', 0, 0)).join('')), /セルが多すぎ/);
  bad(wrap(`<mxCell id="x" value="${'a'.repeat(LIMITS.xml)}" vertex="1" parent="1"/>`), /大きすぎ/);
  bad('<mxfile></mxfile>', /diagram/);
});

test('上限ちょうどは、通る（セル数・座標）', () => {
  const m = parseDrawio(
    wrap(
      Array.from({ length: LIMITS.cells - 3 }, (_, i) => vtx(`c${i}`, '1', 0, 0)).join('') +
        vtx('far', '1', LIMITS.coord, -LIMITS.coord),
    ),
  );
  expect(m.items).toHaveLength(LIMITS.cells - 2); // セル（0・1 を含む）が、ちょうど上限
});

test('圧縮された <diagram>（base64 + deflate-raw + URI エンコード）を、展開できる。壊れた・圧縮爆弾は、DrawioError', async () => {
  const zlib = await import('node:zlib');
  const xml = wrap(vtx('z', '1', 1, 2, 30, 40, '', 'こんにちは'));
  const b64 = zlib.deflateRawSync(Buffer.from(encodeURIComponent(xml))).toString('base64');
  if (typeof DecompressionStream === 'undefined') return; // この環境にないなら、e2e（実 Chrome）で確かめる
  expect(await inflateDiagram(b64)).toBe(xml);
  await expect(inflateDiagram('!!!not base64!!!')).rejects.toBeInstanceOf(DrawioError);
  await expect(inflateDiagram(Buffer.from('これは deflate ではない').toString('base64'))).rejects.toBeInstanceOf(
    DrawioError,
  );
  const bomb = zlib.deflateRawSync(Buffer.alloc(LIMITS.inflated + 10, 97)).toString('base64');
  await expect(inflateDiagram(bomb)).rejects.toThrow(/大きすぎ/);
});
