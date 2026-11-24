// @vitest-environment jsdom
// draw.io のモデル → インライン SVG：図形・線・矢印・文字・色（ダークでも読める）・無害（スクリプト・外部の資源・スタイル・リンクを作らない）・上限内で止まらない
import { expect, test } from 'vitest';
import { parseDrawio } from '../../../src/web/doc/render/drawioModel';
import { buildSvg, type DrawioSvg } from '../../../src/web/doc/render/drawioSvg';
import { approxMeasure } from '../../../src/web/doc/render/drawioText';
import { cloneSvgForZoom } from '../../../src/web/focus/zoomSvg';

const wrap = (cells: string): string =>
  `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells}</root></mxGraphModel>`;
const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const v = (id: string, x: number, y: number, w: number, h: number, style = '', value = '', parent = '1') =>
  `<mxCell id="${id}" value="${esc(value)}" style="${esc(style)}" vertex="1" parent="${parent}"><mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry"/></mxCell>`;
const e = (id: string, s: string, t: string, style = '', value = '', geo = '') =>
  `<mxCell id="${id}" value="${esc(value)}" style="${esc(style)}" edge="1" parent="1" source="${s}" target="${t}"><mxGeometry relative="1" as="geometry">${geo}</mxGeometry></mxCell>`;

const draw = (cells: string, theme: 'light' | 'dark' = 'light'): DrawioSvg =>
  buildSvg(parseDrawio(wrap(cells)), { theme, measure: approxMeasure });
const all = (svg: Element, sel: string): Element[] => [...svg.querySelectorAll(sel)];
const texts = (svg: Element): string[] => all(svg, 'text').map((t) => t.textContent ?? '');

test('図形：四角・角丸・楕円・菱形・円柱・process・parallelogram・document・actor・swimlane。viewBox は、全体の境界 + 余白', () => {
  const r = draw(
    v('r', 0, 0, 100, 50, 'rounded=1', '角丸') +
      v('el', 120, 0, 100, 50, 'ellipse', '楕円') +
      v('rh', 240, 0, 100, 50, 'rhombus', '菱形') +
      v('cy', 360, 0, 100, 80, 'shape=cylinder3;size=15', '円柱') +
      v('pr', 480, 0, 100, 50, 'shape=process', 'p') +
      v('pa', 600, 0, 100, 50, 'shape=parallelogram', 'q') +
      v('doc', 720, 0, 100, 50, 'shape=document', 'd') +
      v('ac', 840, 0, 30, 60, 'shape=umlActor', '') +
      v('sw', 0, 100, 300, 200, 'swimlane;startSize=30', 'レーン'),
  );
  expect(r.svg.querySelectorAll('ellipse')).toHaveLength(1);
  expect(r.svg.querySelectorAll('polygon')).toHaveLength(2); // 菱形・平行四辺形
  expect(r.svg.querySelector('rect[rx]')).not.toBeNull(); // 角丸
  expect(r.svg.querySelectorAll('path').length).toBeGreaterThanOrEqual(3); // 円柱（本体・縁）・document
  expect(texts(r.svg)).toContain('レーン');
  const [x, y, w, h] = (r.svg.getAttribute('viewBox') ?? '').split(' ').map(Number);
  expect(x).toBeLessThan(0);
  expect(y).toBeLessThan(0);
  expect((w ?? 0) + (x ?? 0)).toBeGreaterThanOrEqual(870);
  expect((h ?? 0) + (y ?? 0)).toBeGreaterThanOrEqual(300);
  expect(r.size).toEqual({ w, h });
});

test('draw.io のフローチャートの図形（mxgraph.flowchart.*）：近い形に。parallelogram の fixedSize は px。elbow=vertical は、縦に出入り', () => {
  const r = draw(
    v('t', 0, 0, 100, 40, 'shape=mxgraph.flowchart.terminator', '開始') +
      v('d', 0, 100, 100, 60, 'shape=mxgraph.flowchart.decision', '分岐') +
      v('p', 200, 0, 100, 40, 'shape=parallelogram;fixedSize=1;size=30', '入力'),
  );
  expect(r.svg.querySelector('rect[rx="20"]')).not.toBeNull(); // 端が半円（高さ 40 の半分）
  expect(r.svg.querySelectorAll('polygon')).toHaveLength(2); // 菱形・平行四辺形
  expect(r.svg.querySelector('polygon[points^="230,0"]')).not.toBeNull(); // 固定の 30px
  const elbow = draw(
    v('a', 0, 0, 100, 40) + v('b', 200, 200, 100, 40) + e('e', 'a', 'b', 'edgeStyle=elbowEdgeStyle;elbow=vertical'),
  );
  const d = elbow.svg.querySelector('path[stroke-linejoin]')?.getAttribute('d') ?? '';
  expect(d).toMatch(/^M50 40L50 /); // 下の辺から縦に出る
});

test('スイムレーン：見出しの帯（startSize）・縦書き（horizontal=0）の見出しは、回転する', () => {
  const horizontal = draw(v('s', 0, 0, 200, 300, 'swimlane;startSize=40;fillColor=#aec4e3', '横'));
  const bands = all(horizontal.svg, 'rect');
  expect(bands.some((b) => b.getAttribute('height') === '40' && b.getAttribute('fill') === '#aec4e3')).toBe(true);
  expect(horizontal.svg.querySelector('g[transform^="rotate"]')).toBeNull();
  const vertical = draw(v('s', 0, 0, 300, 200, 'swimlane;horizontal=0;startSize=40', '縦'));
  expect(vertical.svg.querySelector('g[transform^="rotate(-90"]')).not.toBeNull();
  expect(all(vertical.svg, 'rect').some((b) => b.getAttribute('width') === '40')).toBe(true);
});

test('表（table・tableRow・partialRectangle）：辺ごとの線（top/left/bottom/right）。strokeColor=inherit は、親の色', () => {
  const r = draw(
    v('t', 0, 0, 200, 100, 'shape=table;startSize=30;strokeColor=#112233', '表') +
      v(
        'row',
        0,
        30,
        200,
        70,
        'shape=tableRow;top=0;left=0;bottom=0;right=0;fillColor=none;strokeColor=inherit',
        '',
        't',
      ) +
      v(
        'c',
        0,
        0,
        100,
        70,
        'shape=partialRectangle;top=0;left=0;bottom=0;right=1;fillColor=none;strokeColor=inherit',
        'セル',
        'row',
      ),
  );
  const lines = all(r.svg, 'line');
  expect(lines).toHaveLength(1); // 右の辺だけ
  expect(lines[0]?.getAttribute('stroke')).toBe('#112233'); // 親の親から、引き継ぐ
});

test('文字：日本語を折り返す（whiteSpace=wrap・幅に収まる）・wrap なしは改行だけ・中央揃え・上揃え', () => {
  const wrapped = draw(v('a', 0, 0, 80, 100, 'whiteSpace=wrap;html=1', 'お客様の希望を聞いて確認する'));
  expect(texts(wrapped.svg).length).toBeGreaterThan(1);
  expect(texts(wrapped.svg).join('')).toBe('お客様の希望を聞いて確認する');
  const noWrap = draw(v('a', 0, 0, 80, 100, 'html=1', 'お客様の希望を聞いて確認する'));
  expect(texts(noWrap.svg)).toEqual(['お客様の希望を聞いて確認する']);
  const top = draw(v('a', 0, 0, 100, 100, 'verticalAlign=top;align=left;fontSize=20', 'x'));
  const t = all(top.svg, 'text')[0] as Element;
  expect(Number(t.getAttribute('y'))).toBeLessThan(30);
  expect(t.parentElement?.getAttribute('text-anchor')).toBe('start');
  expect(t.parentElement?.getAttribute('font-size')).toBe('20');
});

test('文字の色：指定の地（薄い青）には黒・濃い地には白（ダークでも）。指定のない地・線は、テーマのトークン。fontColor は、そのまま', () => {
  for (const theme of ['light', 'dark'] as const) {
    const r = draw(
      v('light', 0, 0, 100, 50, 'fillColor=#dae8fc', '薄い') +
        v('dark', 120, 0, 100, 50, 'fillColor=#0b2a5c', '濃い') +
        v('plain', 240, 0, 100, 50, '', '標準') +
        v('own', 360, 0, 100, 50, 'fillColor=#dae8fc;fontColor=#ff0000', '指定'),
      theme,
    );
    const fillOf = (label: string) =>
      all(r.svg, 'g')
        .find((g) => [...g.children].some((c) => c.localName === 'text' && c.textContent === label))
        ?.getAttribute('fill');
    expect(fillOf('薄い')).toBe('#000000');
    expect(fillOf('濃い')).toBe('#ffffff');
    expect(fillOf('標準')).toMatch(/^var\(--dx-ink, #[0-9a-f]{6}\)$/);
    expect(fillOf('指定')).toBe('#ff0000');
  }
  const dark = draw(v('plain', 0, 0, 100, 50, '', '標準'), 'dark');
  expect(dark.svg.innerHTML).toContain('var(--dx-ink, #e4e4e7)'); // 単独の画像（範囲の切り出し）にしたときの、ダークの既定
  expect(dark.svg.innerHTML).toContain('var(--dx-fill, #18181b)');
});

test('純粋な黒の線・文字／白の地は、テーマの標準の色にする（ダークで、黒い線が消えない）。ほかの色は、そのまま', () => {
  const r = draw(
    v('a', 0, 0, 100, 50, 'strokeColor=#000000;fillColor=#ffffff;fontColor=black', 'a') +
      v('b', 200, 0, 100, 50, 'strokeColor=#112233;fillColor=#fafafa', 'b') +
      e('e', 'a', 'b', 'strokeColor=#000000'),
    'dark',
  );
  const rects = all(r.svg, 'rect');
  expect(rects[0]?.getAttribute('stroke')).toMatch(/^var\(--dx-ink/);
  expect(rects[0]?.getAttribute('fill')).toMatch(/^var\(--dx-fill/);
  expect(rects[1]?.getAttribute('stroke')).toBe('#112233');
  expect(rects[1]?.getAttribute('fill')).toBe('#fafafa');
  expect(all(r.svg, 'path')[0]?.getAttribute('stroke')).toMatch(/^var\(--dx-ink/);
});

test('線：直交（曲がりを持つ）・矢印（classic は多角形・none は描かない・open は折れ線）・dashed・ラベル・経由点・矢印の分だけ、線を縮める', () => {
  const r = draw(
    v('a', 0, 0, 100, 50) +
      v('b', 300, 200, 100, 50) +
      e('e', 'a', 'b', 'edgeStyle=orthogonalEdgeStyle;exitX=1;exitY=0.5;entryX=0.5;entryY=0;dashed=1', 'ラベル') +
      e('n', 'a', 'b', 'endArrow=none') +
      e('o', 'a', 'b', 'endArrow=open;startArrow=block'),
  );
  const paths = all(r.svg, 'path');
  expect(paths).toHaveLength(3);
  expect(paths[0]?.getAttribute('d')).toMatch(/^M100 25L350 25L3?\d+ /); // 右へ出て、下へ曲がる
  expect(paths[0]?.getAttribute('stroke-dasharray')).toBeTruthy();
  expect(texts(r.svg)).toContain('ラベル');
  // classic：多角形（4 点）。e と o の 2 本の線のうち、e は classic・n は none・o は open（折れ線）+ 始点の block
  expect(all(r.svg, 'polygon').length).toBe(2); // e の classic・o の startArrow block
  expect(all(r.svg, 'polyline')).toHaveLength(1);
  // 縮める：線の終点は、b の上端（y=200）の手前
  const end = (paths[0]?.getAttribute('d') ?? '').split('L').at(-1) ?? '';
  expect(Number(end.split(' ')[1])).toBeLessThan(200);
});

test('線の端が、図形につながっていない（sourcePoint・targetPoint だけ）線も、描く。つなぎ先がまったくない線は、描かない', () => {
  const r = draw(
    `<mxCell id="m" edge="1" parent="1" style="endArrow=block"><mxGeometry relative="1" as="geometry"><mxPoint x="10" y="20" as="sourcePoint"/><mxPoint x="210" y="20" as="targetPoint"/></mxGeometry></mxCell>` +
      `<mxCell id="x" edge="1" parent="1"><mxGeometry relative="1" as="geometry"/></mxCell>`,
  );
  expect(all(r.svg, 'path')).toHaveLength(1);
});

test('生命線（umlLifeline）：見出しの四角と、破線の縦線。メッセージは、水平', () => {
  const r = draw(
    v('u', 0, 0, 100, 200, 'shape=umlLifeline;fillColor=#dae8fc', 'ユーザー') +
      `<mxCell id="m" value="要求" style="endArrow=block" edge="1" parent="1"><mxGeometry relative="1" as="geometry"><mxPoint x="50" y="80" as="sourcePoint"/><mxPoint x="250" y="80" as="targetPoint"/></mxGeometry></mxCell>`,
  );
  const line = all(r.svg, 'line')[0];
  expect(line?.getAttribute('stroke-dasharray')).toBeTruthy();
  expect(line?.getAttribute('x1')).toBe('50');
  expect(line?.getAttribute('y1')).toBe('40'); // 見出し（既定 40）の下から
  expect(all(r.svg, 'path')[0]?.getAttribute('d')).toMatch(/^M50 80L/);
});

test('無害：スクリプト・外部の資源・スタイル・リンク・イベントの属性を、一切作らない（悪意のある XML でも）', () => {
  const evil = `x" onload="alert(1)`;
  const r = draw(
    v(
      'a',
      0,
      0,
      100,
      50,
      `html=1;fillColor=url(https://evil.example/x);strokeColor=${evil};fontColor=red;background:url(x);fontFamily=${evil};image=https://evil.example/i.png;shape=image;link=javascript:alert(1)`,
      `<script>alert(1)</script><img src=x onerror=alert(2)><a href="javascript:alert(3)">リンク</a>安全`,
    ) +
      v(
        'b',
        200,
        0,
        100,
        50,
        'html=1;fillColor=#fff;strokeColor=red;rotation=99999;opacity=abc;fontSize=1e99;strokeWidth=-5',
        '<svg onload=alert(4)>',
      ) +
      e('e', 'a', 'b', `html=1;strokeColor=${evil};endArrow=${evil};edgeStyle=${evil}`, `<b onclick=alert(5)>線</b>`),
  );
  const html = r.svg.outerHTML;
  expect(r.svg.querySelectorAll('script, foreignObject, image, style, use, a, iframe, link, animate, set').length).toBe(
    0,
  );
  for (const el of [r.svg, ...r.svg.querySelectorAll('*')]) {
    for (const a of el.attributes) {
      expect(a.name, `${el.localName}[${a.name}]`).not.toMatch(/^(on|style$|href|xlink)/i);
      expect(a.value).not.toMatch(/javascript|evil|alert|url\(/i);
    }
  }
  expect(html).not.toMatch(/onload|onerror|onclick|<script|<img/i);
  expect(texts(r.svg).join('')).toContain('安全'); // 文字は、文字として残る
  expect(texts(r.svg).join('')).not.toMatch(/alert|script|evil/);
  // 数は、範囲に収まる
  for (const a of ['opacity', 'font-size', 'stroke-width'])
    for (const el of r.svg.querySelectorAll(`[${a}]`)) expect(Number.isFinite(Number(el.getAttribute(a)))).toBe(true);
});

test('html でないラベルの `<script>` は、ただの文字（要素にならない）', () => {
  const r = draw(v('a', 0, 0, 100, 50, '', '<script>alert(1)</script><img src=x onerror=alert(2)>'));
  expect(r.svg.querySelectorAll('script, img, foreignObject').length).toBe(0);
  expect(texts(r.svg).join('')).toContain('<script>');
  expect(r.svg.outerHTML).not.toMatch(/<script|<img/); // シリアライズしても、タグにならない（&lt;）
});

test('aria：role=img・aria-label は、文字を集めたもの（長さの上限つき）', () => {
  const r = draw(v('a', 0, 0, 100, 50, '', '見出し') + v('b', 200, 0, 100, 50, '', 'あ'.repeat(1000)));
  expect(r.svg.getAttribute('role')).toBe('img');
  const label = r.svg.getAttribute('aria-label') ?? '';
  expect(label).toContain('見出し');
  expect(label.length).toBeLessThanOrEqual(300);
});

test('拡大表示の複製：id も、url(#…) も、使わない（矢印は多角形）ので、複製しても、壊れない。元は、変えない', () => {
  const r = draw(v('a', 0, 0, 100, 50, '', 'a') + v('b', 200, 0, 100, 50, '', 'b') + e('e', 'a', 'b'));
  expect(r.svg.querySelectorAll('[id]')).toHaveLength(0);
  expect(r.svg.outerHTML).not.toContain('url(#');
  const before = r.svg.outerHTML;
  const clone = cloneSvgForZoom(r.svg);
  expect(clone.outerHTML).toBe(before);
  expect(r.svg.outerHTML).toBe(before);
});

test('大きな図（セル数の上限・長い文字）でも、止まらない（数秒以内）', () => {
  const cells = Array.from({ length: 1990 }, (_, i) =>
    v(
      `n${i}`,
      (i % 50) * 60,
      Math.floor(i / 50) * 40,
      50,
      30,
      'whiteSpace=wrap;html=1',
      `ノード${i}の長めのラベルです`,
    ),
  ).join('');
  const t0 = performance.now();
  const r = draw(cells);
  expect(performance.now() - t0).toBeLessThan(5000);
  expect(r.svg.querySelectorAll('rect')).toHaveLength(1990);
});

test('空・すべて非表示は、描けない（DrawioError）', () => {
  expect(() => draw('')).toThrow(/描ける図形がありません/);
  expect(() =>
    draw(`<mxCell id="x" vertex="1" visible="0" parent="1"><mxGeometry width="1" height="1" as="geometry"/></mxCell>`),
  ).toThrow(/描ける図形がありません/);
});
