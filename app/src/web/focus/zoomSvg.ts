// 図（SVG）の拡大表示の、複製：押された SVG を `cloneNode(true)` で複製し（すでに無害化済みの DOM のコピー。HTML を、文字列から作らない）、
// 複製の id に接頭辞を付けて、参照（`url(#…)`・`href="#…"`・`<style>` の `#id` 選択子）も書き換える。
//
// 複製（id を付け替え）か、同じ SVG を一時的にライトボックスへ移すか → 複製を選ぶ。
// 移すと、`#article` の中身（ブロックの高さ・番号・関連の線・引用の位置づけ）が、開いている間、崩れる。
// 本文の再描画（ポーリング・外観の変更）が、移した要素を、巻き込むこともある。複製は、本文に触れない。
// 同じ id を、同じ文書に 2 つ置くと、`url(#…)` が、元を指す（元が、再描画で消えると、矢印・グラデーションが消える）ので、接頭辞を付ける。
// Mermaid の図は、`<style>` の中で、ルートの id（`#mmd5 …`）で、スタイルを絞っている：選択子も、書き換える。

import type { Size } from '../lib/geom';

/** 複製の id の接頭辞 */
export const ZOOM_ID_PREFIX = 'zoom-';

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * svg を複製して、id に接頭辞を付ける。元の svg は、変えない。
 * 書き換えるもの：id・`url(#id)`（どの属性でも。style 属性も）・`href`/`xlink:href` の `#id`・`aria-labelledby`/`aria-describedby`・`<style>` の `#id`
 */
export function cloneSvgForZoom(src: SVGSVGElement, prefix: string = ZOOM_ID_PREFIX): SVGSVGElement {
  const clone = src.cloneNode(true) as SVGSVGElement;
  const all: Element[] = [clone, ...clone.querySelectorAll('*')];
  const ids = [...new Set(all.map((e) => e.getAttribute('id')).filter((v): v is string => !!v))];
  if (!ids.length) return clone;
  // 長い id から（`a-b` が `a` に、先に、当たらないように）。直後が、id に使う文字なら、別の id
  const alt = ids
    .sort((a, b) => b.length - a.length)
    .map(escapeRe)
    .join('|');
  const urlRe = new RegExp(`url\\(\\s*(['"]?)#(${alt})\\1\\s*\\)`, 'g');
  const selRe = new RegExp(`#(${alt})(?![\\w-])`, 'g');
  const idSet = new Set(ids);
  for (const e of all) {
    for (const a of [...e.attributes]) {
      const v = a.value;
      let next = v;
      if (a.name === 'id') next = prefix + v;
      else if (a.name === 'href' || a.name === 'xlink:href') {
        if (v.startsWith('#') && idSet.has(v.slice(1))) next = `#${prefix}${v.slice(1)}`;
      } else if (a.name === 'aria-labelledby' || a.name === 'aria-describedby') {
        next = v
          .split(/\s+/)
          .map((t) => (idSet.has(t) ? prefix + t : t))
          .join(' ');
      } else if (v.includes('url('))
        next = v.replace(urlRe, (_m, q: string, id: string) => `url(${q}#${prefix}${id}${q})`);
      if (next !== v) e.setAttribute(a.name, next);
    }
    if (e.localName === 'style' && e.textContent) {
      const css = e.textContent;
      const next = css
        .replace(urlRe, (_m, q: string, id: string) => `url(${q}#${prefix}${id}${q})`)
        .replace(selRe, (_m, id: string) => `#${prefix}${id}`);
      if (next !== css) e.textContent = next;
    }
  }
  return clone;
}

/** SVG の自然な大きさ：viewBox → width・height 属性（% は除く）。どちらもなければ、画面の上の大きさ（fallback） */
export function svgNaturalSize(svg: SVGSVGElement, fallback: Size): Size {
  const vb = svg
    .getAttribute('viewBox')
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  if (vb && vb.length === 4 && vb[2] && vb[3] && vb[2] > 0 && vb[3] > 0) return { w: vb[2], h: vb[3] };
  const num = (a: string | null): number => (a && !a.includes('%') ? Number.parseFloat(a) : Number.NaN);
  const w = num(svg.getAttribute('width'));
  const h = num(svg.getAttribute('height'));
  if (w > 0 && h > 0) return { w, h };
  return fallback.w > 0 && fallback.h > 0 ? fallback : { w: 300, h: 150 };
}
