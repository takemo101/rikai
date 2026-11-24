// @vitest-environment jsdom
// 図（SVG）の複製（F37）：id に接頭辞を付け、参照（url(#…)・href・style の #id 選択子）も、書き換える。元は、変えない。大きさは、viewBox から
import { afterEach, expect, test } from 'vitest';
import { cloneSvgForZoom, svgNaturalSize, ZOOM_ID_PREFIX } from '../../../src/web/focus/zoomSvg';

afterEach(() => document.body.replaceChildren());

/** Mermaid の図に近い SVG：ルートの id・矢印（marker）・グラデーション・clipPath・`<style>` の `#id` 選択子・use の href・似た名前の id（a と a-b） */
const MERMAID_LIKE = `
<svg id="mmd5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" width="100%" style="max-width: 200px" aria-labelledby="t5 d5">
  <title id="t5">題</title><desc id="d5">説明</desc>
  <style>#mmd5 .node { fill: url(#grad); } #mmd5 .edge { marker-end: url('#mmd5_pointEnd'); } #mmd5:hover .a { fill: #fff; } #mmd5_pointEnd { color: red; } #a-b { color: blue; }</style>
  <defs>
    <marker id="mmd5_pointEnd" markerWidth="8" markerHeight="8"><path d="M0,0 L8,4 L0,8z"/></marker>
    <linearGradient id="grad"><stop offset="0" stop-color="#2563eb"/></linearGradient>
    <clipPath id="clip"><rect width="50" height="50"/></clipPath>
    <g id="a"><circle r="2"/></g><g id="a-b"><circle r="3"/></g>
  </defs>
  <rect class="node" clip-path="url(#clip)" style="stroke: url(#grad)"/>
  <path class="edge" marker-end="url(#mmd5_pointEnd)" d="M0,0 L10,10"/>
  <use href="#a"/><use xlink:href="#a-b" xmlns:xlink="http://www.w3.org/1999/xlink"/>
</svg>`;
const parse = (html: string): SVGSVGElement => {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.append(host);
  return host.querySelector('svg') as SVGSVGElement;
};

test('複製：id は、すべて、接頭辞つき。参照（url(#…)・href・aria-labelledby・style の選択子）も、複製の id を指す', () => {
  const src = parse(MERMAID_LIKE);
  const c = cloneSvgForZoom(src);
  const P = ZOOM_ID_PREFIX;
  expect(c.id).toBe(`${P}mmd5`);
  expect([...c.querySelectorAll('[id]')].map((e) => e.id).sort()).toEqual(
    ['a', 'a-b', 'clip', 'd5', 'grad', 'mmd5_pointEnd', 't5'].map((i) => P + i).sort(),
  );
  expect(c.querySelector('path.edge')?.getAttribute('marker-end')).toBe(`url(#${P}mmd5_pointEnd)`);
  expect(c.querySelector('rect.node')?.getAttribute('clip-path')).toBe(`url(#${P}clip)`);
  expect(c.querySelector('rect.node')?.getAttribute('style')).toBe(`stroke: url(#${P}grad)`);
  const uses = [...c.querySelectorAll('use')];
  expect(uses[0]?.getAttribute('href')).toBe(`#${P}a`);
  expect(uses[1]?.getAttribute('xlink:href')).toBe(`#${P}a-b`); // a と a-b を、取り違えない
  expect(c.getAttribute('aria-labelledby')).toBe(`${P}t5 ${P}d5`);
  const css = c.querySelector('style')?.textContent ?? '';
  expect(css).toContain(`#${P}mmd5 .node { fill: url(#${P}grad); }`);
  expect(css).toContain(`marker-end: url('#${P}mmd5_pointEnd')`);
  expect(css).toContain(`#${P}mmd5:hover .a { fill: #fff; }`); // 色（#fff）は、そのまま
  expect(css).toContain(`#${P}mmd5_pointEnd { color: red; }`); // mmd5 と mmd5_pointEnd を、取り違えない
  expect(css).toContain(`#${P}a-b { color: blue; }`);
});

test('元の svg は、変わらない。複製を、同じ文書に置いても、id は、重ならない（url(#…) が、元を指さない）', () => {
  const src = parse(MERMAID_LIKE);
  const before = src.outerHTML;
  const c = cloneSvgForZoom(src);
  expect(src.outerHTML).toBe(before);
  document.body.append(c);
  const ids = [...document.querySelectorAll('[id]')].map((e) => e.id);
  expect(new Set(ids).size).toBe(ids.length);
});

test('id のない svg は、そのまま複製（属性・中身は同じ）', () => {
  const src = parse('<svg viewBox="0 0 10 10"><rect width="5" height="5" fill="red"/></svg>');
  const c = cloneSvgForZoom(src);
  expect(c).not.toBe(src);
  expect(c.outerHTML).toBe(src.outerHTML);
});

test('大きさ：viewBox → width・height（% は除く）→ 画面の上の大きさ → 既定', () => {
  expect(svgNaturalSize(parse('<svg viewBox="0 0 540 320" width="100%"></svg>'), { w: 1, h: 1 })).toEqual({
    w: 540,
    h: 320,
  });
  expect(svgNaturalSize(parse('<svg viewBox="0,0,40,20"></svg>'), { w: 1, h: 1 })).toEqual({ w: 40, h: 20 });
  expect(svgNaturalSize(parse('<svg width="120" height="60"></svg>'), { w: 1, h: 1 })).toEqual({ w: 120, h: 60 });
  expect(svgNaturalSize(parse('<svg width="100%" height="60"></svg>'), { w: 300, h: 100 })).toEqual({ w: 300, h: 100 });
  expect(svgNaturalSize(parse('<svg></svg>'), { w: 0, h: 0 })).toEqual({ w: 300, h: 150 });
});
