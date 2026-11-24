// draw.io のモデル（`DxModel`）→ インライン SVG の要素。**`createElementNS` と `setAttribute`・`textContent` だけで組み立てる**（`innerHTML`・文字列の連結で SVG を作らない：資料の XML は非信頼のデータ）。
// 色・数は、`drawioStyle.ts` が検査したものだけを、属性に入れる（CSS の文字列は、組み立てない：`style` 属性を使わない）。`<foreignObject>`・`<script>`・`<image>`・`href` は、作らない。
// 矢印は、多角形で描く（`<marker>` の `url(#…)` を使わない：id がないので、拡大表示の複製（`id` の付け替え）・画像の切り出し〔SVG を単独の画像にする〕で、壊れない）。
// 標準の色（`fillColor` なしの地・線・文字）は、テーマのトークン（`var(--dx-ink, #リテラル)`）：同じページでは、外観に追従する。`var()` を持たない単独の画像（範囲の切り出し）は、
// 描いた時点の外観のリテラルになる（外観が変わると、描き直す：`fillDrawio`）。指定された色は、そのまま。指定の地に、指定のない文字は、地に合わせた黒か白（薄い青の地の黒い文字が、ダークでも読める）。

import { DrawioError, type DxEdge, type DxModel, type DxVertex, type Pt, type Rect } from './drawioModel';
import {
  arrowKind,
  arrowShape,
  autoDir,
  centerOf,
  type Dir,
  explicitPort,
  labelPoint,
  type Port,
  pathData,
  perimeterPoint,
  routeOrthogonal,
  sidePort,
} from './drawioRoute';
import { inkOn } from './drawioStyle';
import { type Measure, wrapText } from './drawioText';

const NS = 'http://www.w3.org/2000/svg';
export const FONT = '-apple-system, BlinkMacSystemFont, "Hiragino Sans", "Noto Sans JP", "Segoe UI", sans-serif';

/** 図の上下左右の余白 */
const PAD = 12;
/** aria-label の長さの上限 */
const ARIA_MAX = 300;

export interface SvgOptions {
  theme: 'light' | 'dark';
  measure: Measure;
}

export interface DrawioSvg {
  svg: SVGSVGElement;
  /** スクリーンリーダー向けの文字（図の文字を集めたもの） */
  label: string;
  /** 自然な大きさ */
  size: { w: number; h: number };
  /** 描けなかったこと・代用したこと（図の下に、小さく出す） */
  notes: string[];
}

type Attrs = Record<string, string | number | undefined>;

function el<K extends string>(name: K, attrs: Attrs = {}, kids: Element[] = []): SVGElement {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined) e.setAttribute(k, String(v));
  for (const k of kids) e.append(k);
  return e;
}

const BLACK = new Set(['#000', '#000000', 'black']);
const WHITE = new Set(['#fff', '#ffffff', 'white']);

const r2 = (n: number): number => Math.round(n * 100) / 100;

interface Palette {
  ink: string;
  fill: string;
  /** 画面の紙の色（線の上のラベルの地） */
  paper: string;
}

export function buildSvg(model: DxModel, opts: SvgOptions): DrawioSvg {
  const { theme, measure } = opts;
  const lit =
    theme === 'dark'
      ? { ink: '#e4e4e7', fill: '#18181b', paper: '#09090b' }
      : { ink: '#000000', fill: '#ffffff', paper: '#ffffff' };
  const P: Palette = {
    ink: `var(--dx-ink, ${lit.ink})`,
    fill: `var(--dx-fill, ${lit.fill})`,
    paper: `var(--paper, ${lit.paper})`,
  };

  const bounds = {
    x1: Number.POSITIVE_INFINITY,
    y1: Number.POSITIVE_INFINITY,
    x2: Number.NEGATIVE_INFINITY,
    y2: Number.NEGATIVE_INFINITY,
  };
  const grow = (x: number, y: number): void => {
    bounds.x1 = Math.min(bounds.x1, x);
    bounds.y1 = Math.min(bounds.y1, y);
    bounds.x2 = Math.max(bounds.x2, x);
    bounds.y2 = Math.max(bounds.y2, y);
  };
  const growRect = (r: Rect): void => {
    grow(r.x, r.y);
    grow(r.x + r.w, r.y + r.h);
  };

  const root = el('g');
  const texts: string[] = [];
  const paths = new Map<string, Pt[]>();

  const vertexOf = (id: string | null): DxVertex | null => {
    const v = id ? model.byId.get(id) : undefined;
    return v && v.kind === 'vertex' ? v : null;
  };

  /** 色の解決：`inherit` は、親（頂点）から。未指定・使えない値は null */
  const colorOf = (item: DxVertex | DxEdge, key: string): string | null => {
    let c = item.style.color(key, theme);
    let cur: DxVertex | DxEdge | null = item;
    for (let i = 0; c === 'inherit' && i < 25; i++) {
      cur = cur && cur.kind === 'vertex' ? vertexOf(cur.container) : null;
      c = cur ? cur.style.color(key, theme) : null;
    }
    if (c === 'inherit') return null;
    // draw.io の既定の色（純粋な黒の線・文字／純粋な白の地）は、テーマの標準の色にする：ライトの図の黒い線が、ダークで見えなくならないように（draw.io 自身の、ダークモードの反転と同じ向き）。
    // これ以外の色は、そのまま
    if (c && (key === 'strokeColor' || key === 'fontColor') && BLACK.has(c)) return P.ink;
    if (c && (key === 'fillColor' || key === 'swimlaneFillColor' || key === 'labelBackgroundColor') && WHITE.has(c))
      return P.fill;
    return c;
  };

  const strokeAttrs = (item: DxVertex | DxEdge, stroke: string | null, defStroke: string): Attrs => {
    const st = item.style;
    const sw = st.num('strokeWidth', 1, 0, 20);
    const col = stroke ?? defStroke;
    const a: Attrs = { stroke: col, 'stroke-width': col === 'none' ? undefined : sw };
    if (st.flag('dashed', false)) {
      const pat = st.str('dashPattern');
      const nums =
        pat && /^[\d.]+(?: [\d.]+){0,7}$/.test(pat.trim().replace(/\s+/g, ' '))
          ? pat.trim().replace(/\s+/g, ' ')
          : null;
      a['stroke-dasharray'] = nums ?? `${r2(3 * Math.max(1, sw))} ${r2(3 * Math.max(1, sw))}`;
    }
    const so = st.num('strokeOpacity', 100, 0, 100);
    if (so < 100) a['stroke-opacity'] = so / 100;
    return a;
  };
  const fillAttrs = (item: DxVertex | DxEdge, fill: string | null, defFill: string): Attrs => {
    const fo = item.style.num('fillOpacity', 100, 0, 100);
    return { fill: fill ?? defFill, 'fill-opacity': fo < 100 ? fo / 100 : undefined };
  };

  /** ラベルを、箱（`box`）の中に置く。折り返し・揃え・回転 */
  function drawLabel(
    parent: SVGElement,
    item: DxVertex | DxEdge,
    text: string,
    box: Rect,
    o: {
      wrap: boolean;
      align: string;
      valign: string;
      color: string;
      fontSize: number;
      rotate: boolean;
      bg?: string | null;
      padX?: number;
      padY?: number;
    },
  ): void {
    if (!text) return;
    const st = item.style;
    const fs = o.fontSize;
    const fstyle = st.num('fontStyle', 0, 0, 15);
    const bold = (fstyle & 1) !== 0;
    const ital = (fstyle & 2) !== 0;
    const under = (fstyle & 4) !== 0;
    const padX = o.padX ?? 4 + st.num('spacing', 0, 0, 200);
    const padY = o.padY ?? 2 + st.num('spacing', 0, 0, 200);
    const sl = st.num('spacingLeft', 0, 0, 200);
    const sr = st.num('spacingRight', 0, 0, 200);
    const stp = st.num('spacingTop', 0, 0, 200);
    const sb = st.num('spacingBottom', 0, 0, 200);
    const c = centerOf(box);
    // 回転（horizontal=0）：箱の縦横を入れ替えて、中心のまわりに -90°
    const b: Rect = o.rotate ? { x: c.x - box.h / 2, y: c.y - box.w / 2, w: box.h, h: box.w } : box;
    const innerW = b.w - 2 * padX - sl - sr;
    const lines = wrapText(text, o.wrap ? Math.max(1, innerW) : null, fs, bold, measure);
    const lh = fs * 1.2;
    const bh = lines.length * lh;
    let top: number;
    if (o.valign === 'top') top = b.y + padY + stp;
    else if (o.valign === 'bottom') top = b.y + b.h - padY - sb - bh;
    else top = b.y + (b.h - bh) / 2 + (stp - sb) / 2;
    const anchor = o.align === 'left' ? 'start' : o.align === 'right' ? 'end' : 'middle';
    const x =
      o.align === 'left'
        ? b.x + padX + sl
        : o.align === 'right'
          ? b.x + b.w - padX - sr
          : b.x + b.w / 2 + (sl - sr) / 2;
    const g = el('g', {
      fill: o.color,
      'font-size': fs,
      'font-weight': bold ? 'bold' : undefined,
      'font-style': ital ? 'italic' : undefined,
      'text-decoration': under ? 'underline' : undefined,
      'text-anchor': anchor,
      transform: o.rotate ? `rotate(-90 ${r2(c.x)} ${r2(c.y)})` : undefined,
    });
    if (o.bg && o.bg !== 'none') {
      const w = Math.max(...lines.map((l) => measure(l, fs, bold)), 0);
      const bx = anchor === 'start' ? x : anchor === 'end' ? x - w : x - w / 2;
      g.append(el('rect', { x: r2(bx - 2), y: r2(top), width: r2(w + 4), height: r2(bh), fill: o.bg, stroke: 'none' }));
    }
    lines.forEach((line, i) => {
      if (!line) return;
      const t = el('text', { x: r2(x), y: r2(top + i * lh + lh / 2 + fs * 0.33) });
      t.textContent = line; // 文字として入れる（textContent）
      g.append(t);
    });
    parent.append(g);
    if (lines.length) {
      const w = Math.max(...lines.map((l) => measure(l, fs, bold)), 0);
      if (o.rotate) {
        grow(c.x - bh / 2, c.y - w / 2);
        grow(c.x + bh / 2, c.y + w / 2);
      } else {
        grow(x - (anchor === 'start' ? 0 : anchor === 'end' ? w : w / 2), top);
        grow(x + (anchor === 'start' ? w : anchor === 'end' ? 0 : w / 2), top + bh);
      }
    }
    texts.push(...lines.filter(Boolean));
  }

  // ---- 頂点 ----
  /** 斜めの辺・縦の線の位置：`size`（幅に対する割合。`fixedSize=1` なら px。既定は 20）。幅の半分まで */
  const offsetOf = (v: DxVertex, def: number): number =>
    v.style.flag('fixedSize', false)
      ? Math.min(v.rect.w / 2, v.style.num('size', 20, 0, 100_000))
      : v.rect.w * Math.min(0.5, v.style.num('size', def, 0, 0.5));

  function drawVertex(v: DxVertex): void {
    const st = v.style;
    const r = v.rect;
    growRect(r);
    const g = el('g');
    const noPaint = v.shape === 'text';
    const fill = colorOf(v, 'fillColor');
    const stroke = colorOf(v, 'strokeColor');
    const fa = fillAttrs(v, fill, noPaint ? 'none' : P.fill);
    const sa = strokeAttrs(v, stroke, noPaint ? 'none' : P.ink);
    const paint: Attrs = { ...fa, ...sa };
    const rot = st.num('rotation', 0, -360, 360);
    if (rot) g.setAttribute('transform', `rotate(${rot} ${r2(r.x + r.w / 2)} ${r2(r.y + r.h / 2)})`);
    const op = st.num('opacity', 100, 0, 100);
    if (op < 100) g.setAttribute('opacity', String(op / 100));

    const horizontal = st.flag('horizontal', true);
    let labelBox: Rect = r;
    let wrapW = true;
    let rotate = false;
    switch (v.shape) {
      case 'ellipse':
        g.append(
          el('ellipse', { cx: r2(r.x + r.w / 2), cy: r2(r.y + r.h / 2), rx: r2(r.w / 2), ry: r2(r.h / 2), ...paint }),
        );
        labelBox = { x: r.x + r.w * 0.09, y: r.y + r.h * 0.09, w: r.w * 0.82, h: r.h * 0.82 };
        break;
      case 'rhombus':
        g.append(
          poly(
            [
              { x: r.x + r.w / 2, y: r.y },
              { x: r.x + r.w, y: r.y + r.h / 2 },
              { x: r.x + r.w / 2, y: r.y + r.h },
              { x: r.x, y: r.y + r.h / 2 },
            ],
            paint,
          ),
        );
        labelBox = { x: r.x + r.w * 0.19, y: r.y + r.h * 0.19, w: r.w * 0.62, h: r.h * 0.62 };
        break;
      case 'terminator':
        g.append(
          el('rect', {
            x: r2(r.x),
            y: r2(r.y),
            width: r2(r.w),
            height: r2(r.h),
            rx: r2(Math.min(r.w, r.h) / 2),
            ry: r2(Math.min(r.w, r.h) / 2),
            ...paint,
          }),
        );
        labelBox = { x: r.x + r.h / 4, y: r.y, w: Math.max(0, r.w - r.h / 2), h: r.h };
        break;
      case 'cylinder3':
      case 'cylinder': {
        const dy = Math.min(r.h / 2, Math.max(0, st.num('size', v.shape === 'cylinder3' ? 15 : 10, 0, 1000)));
        const rx = r.w / 2;
        const { x, y, w, h } = r;
        g.append(
          el('path', {
            d: `M${r2(x)} ${r2(y + dy)}L${r2(x)} ${r2(y + h - dy)}A${r2(rx)} ${r2(dy)} 0 0 0 ${r2(x + w)} ${r2(y + h - dy)}L${r2(x + w)} ${r2(y + dy)}A${r2(rx)} ${r2(dy)} 0 0 0 ${r2(x)} ${r2(y + dy)}Z`,
            ...paint,
          }),
        );
        g.append(
          el('path', {
            d: `M${r2(x)} ${r2(y + dy)}A${r2(rx)} ${r2(dy)} 0 0 0 ${r2(x + w)} ${r2(y + dy)}`,
            fill: 'none',
            ...sa,
          }),
        );
        labelBox = { x, y: y + dy * 2, w, h: Math.max(0, h - dy * 2) };
        break;
      }
      case 'process': {
        const s = offsetOf(v, 0.1);
        g.append(el('rect', { x: r2(r.x), y: r2(r.y), width: r2(r.w), height: r2(r.h), ...paint }));
        for (const x of [r.x + s, r.x + r.w - s])
          g.append(el('line', { x1: r2(x), y1: r2(r.y), x2: r2(x), y2: r2(r.y + r.h), fill: 'none', ...sa }));
        labelBox = { x: r.x + s, y: r.y, w: Math.max(0, r.w - 2 * s), h: r.h };
        break;
      }
      case 'parallelogram': {
        const o = offsetOf(v, 0.2);
        g.append(
          poly(
            [
              { x: r.x + o, y: r.y },
              { x: r.x + r.w, y: r.y },
              { x: r.x + r.w - o, y: r.y + r.h },
              { x: r.x, y: r.y + r.h },
            ],
            paint,
          ),
        );
        labelBox = { x: r.x + o / 2, y: r.y, w: Math.max(0, r.w - o), h: r.h };
        break;
      }
      case 'hexagon': {
        const o = offsetOf(v, 0.25);
        const my = r.y + r.h / 2;
        g.append(
          poly(
            [
              { x: r.x + o, y: r.y },
              { x: r.x + r.w - o, y: r.y },
              { x: r.x + r.w, y: my },
              { x: r.x + r.w - o, y: r.y + r.h },
              { x: r.x + o, y: r.y + r.h },
              { x: r.x, y: my },
            ],
            paint,
          ),
        );
        labelBox = { x: r.x + o / 2, y: r.y, w: Math.max(0, r.w - o), h: r.h };
        break;
      }
      case 'triangle': {
        const { x, y, w, h } = r;
        const dir = st.str('direction') ?? 'east';
        const pts: Pt[] =
          dir === 'north'
            ? [
                { x, y: y + h },
                { x: x + w / 2, y },
                { x: x + w, y: y + h },
              ]
            : dir === 'south'
              ? [
                  { x, y },
                  { x: x + w, y },
                  { x: x + w / 2, y: y + h },
                ]
              : dir === 'west'
                ? [
                    { x: x + w, y },
                    { x, y: y + h / 2 },
                    { x: x + w, y: y + h },
                  ]
                : [
                    { x, y },
                    { x: x + w, y: y + h / 2 },
                    { x, y: y + h },
                  ];
        g.append(poly(pts, paint));
        labelBox = { x: x + w * 0.2, y: y + h * 0.2, w: w * 0.6, h: h * 0.6 };
        break;
      }
      case 'document': {
        const { x, y, w, h } = r;
        const fy = h * 0.12;
        g.append(
          el('path', {
            d: `M${r2(x)} ${r2(y)}L${r2(x + w)} ${r2(y)}L${r2(x + w)} ${r2(y + h - fy)}Q${r2(x + w * 0.75)} ${r2(y + h - fy * 2)} ${r2(x + w / 2)} ${r2(y + h - fy)}T${r2(x)} ${r2(y + h - fy)}Z`,
            ...paint,
          }),
        );
        labelBox = { x, y, w, h: h - fy };
        break;
      }
      case 'actor': {
        const { x, y, w, h } = r;
        const hr = Math.min(w / 2, h * 0.16);
        const cx = x + w / 2;
        g.append(el('circle', { cx: r2(cx), cy: r2(y + hr + 1), r: r2(hr), ...paint }));
        const body: [number, number, number, number][] = [
          [cx, y + hr * 2 + 1, cx, y + h * 0.62],
          [x + w * 0.05, y + h * 0.38, x + w * 0.95, y + h * 0.38],
          [cx, y + h * 0.62, x + w * 0.1, y + h],
          [cx, y + h * 0.62, x + w * 0.9, y + h],
        ];
        for (const [x1, y1, x2, y2] of body)
          g.append(el('line', { x1: r2(x1), y1: r2(y1), x2: r2(x2), y2: r2(y2), fill: 'none', ...sa }));
        labelBox = r;
        break;
      }
      case 'lifeline': {
        const hh = Math.min(r.h, st.num('size', 40, 0, 1000));
        const cx = r.x + r.w / 2;
        g.append(el('rect', { x: r2(r.x), y: r2(r.y), width: r2(r.w), height: r2(hh), ...paint }));
        const line = strokeAttrs(v, stroke, P.ink);
        line['stroke-dasharray'] = st.flag('dashed', true) ? (line['stroke-dasharray'] ?? '8 8') : undefined;
        g.append(el('line', { x1: r2(cx), y1: r2(r.y + hh), x2: r2(cx), y2: r2(r.y + r.h), fill: 'none', ...line }));
        labelBox = { x: r.x, y: r.y, w: r.w, h: hh };
        break;
      }
      case 'swimlane':
      case 'table': {
        const ss = Math.min(horizontal ? r.h : r.w, st.num('startSize', v.shape === 'swimlane' ? 23 : 0, 0, 100_000));
        const bodyFill = colorOf(v, 'swimlaneFillColor');
        // 外枠と本体の地
        g.append(
          el('rect', {
            x: r2(r.x),
            y: r2(r.y),
            width: r2(r.w),
            height: r2(r.h),
            ...(v.shape === 'table' && !ss ? paint : { fill: bodyFill ?? 'none' }),
            ...sa,
          }),
        );
        if (ss > 0) {
          const head: Rect = horizontal ? { x: r.x, y: r.y, w: r.w, h: ss } : { x: r.x, y: r.y, w: ss, h: r.h };
          g.append(el('rect', { x: r2(head.x), y: r2(head.y), width: r2(head.w), height: r2(head.h), ...fa, ...sa }));
          labelBox = head;
          rotate = !horizontal;
        } else labelBox = { x: r.x, y: r.y, w: 0, h: 0 };
        break;
      }
      case 'row':
      case 'partial': {
        // 辺ごとの線（top・left・bottom・right。既定は、すべて 1）。地は、枠なし
        g.append(el('rect', { x: r2(r.x), y: r2(r.y), width: r2(r.w), height: r2(r.h), ...fa, stroke: 'none' }));
        const sides: [string, number, number, number, number][] = [
          ['top', r.x, r.y, r.x + r.w, r.y],
          ['right', r.x + r.w, r.y, r.x + r.w, r.y + r.h],
          ['bottom', r.x, r.y + r.h, r.x + r.w, r.y + r.h],
          ['left', r.x, r.y, r.x, r.y + r.h],
        ];
        for (const [k, x1, y1, x2, y2] of sides)
          if (st.flag(k, true) && sa.stroke !== 'none')
            g.append(el('line', { x1: r2(x1), y1: r2(y1), x2: r2(x2), y2: r2(y2), fill: 'none', ...sa }));
        break;
      }
      case 'text':
        if (fa.fill !== 'none' || sa.stroke !== 'none')
          g.append(el('rect', { x: r2(r.x), y: r2(r.y), width: r2(r.w), height: r2(r.h), ...paint }));
        break;
      default: {
        const rounded = st.flag('rounded', false);
        const arc = st.flag('absoluteArcSize', false)
          ? st.num('arcSize', 10, 0, 1000)
          : (Math.min(r.w, r.h) * st.num('arcSize', 15, 0, 50)) / 100;
        g.append(
          el('rect', {
            x: r2(r.x),
            y: r2(r.y),
            width: r2(r.w),
            height: r2(r.h),
            rx: rounded ? r2(arc) : undefined,
            ry: rounded ? r2(arc) : undefined,
            ...paint,
          }),
        );
      }
    }

    if (v.text) {
      // 外側のラベル（図形の下・上・右・左）
      const vlp = st.str('verticalLabelPosition');
      const lp = st.str('labelPosition');
      let align = st.str('align') ?? 'center';
      let valign = st.str('verticalAlign') ?? 'middle';
      if (vlp === 'bottom') {
        labelBox = { x: r.x, y: r.y + r.h, w: r.w, h: 0 };
        valign = 'top';
      } else if (vlp === 'top') {
        labelBox = { x: r.x, y: r.y, w: r.w, h: 0 };
        valign = 'bottom';
      } else if (lp === 'right') {
        labelBox = { x: r.x + r.w, y: r.y, w: 0, h: r.h };
        align = 'left';
        wrapW = false;
      } else if (lp === 'left') {
        labelBox = { x: r.x, y: r.y, w: 0, h: r.h };
        align = 'right';
        wrapW = false;
      }
      const wrap = wrapW && st.str('whiteSpace') === 'wrap';
      // 文字の色：指定があればそれ。なければ、指定の地（具体的な色）の上は、地に合わせた黒か白・それ以外は、テーマの色
      const specified = colorOf(v, 'fontColor');
      const onFill =
        fill && fill !== 'none' && !(v.shape === 'swimlane' || v.shape === 'table')
          ? inkOn(fill)
          : v.shape === 'swimlane' || v.shape === 'table'
            ? fill && fill !== 'none'
              ? inkOn(fill)
              : null
            : null;
      const color = specified && specified !== 'none' ? specified : (onFill ?? P.ink);
      const bg = colorOf(v, 'labelBackgroundColor');
      drawLabel(g, v, v.text, labelBox, {
        wrap,
        align,
        valign,
        color,
        fontSize: st.num('fontSize', 12, 4, 120),
        rotate:
          rotate ||
          (!horizontal &&
            v.shape !== 'swimlane' &&
            v.shape !== 'table' &&
            v.shape !== 'row' &&
            v.shape !== 'partial' &&
            v.shape !== 'lifeline'),
        bg,
      });
    }
    root.append(g);
  }

  function poly(pts: Pt[], attrs: Attrs): SVGElement {
    return el('polygon', { points: pts.map((p) => `${r2(p.x)},${r2(p.y)}`).join(' '), ...attrs });
  }

  // ---- 線 ----
  function drawEdge(e: DxEdge): void {
    const st = e.style;
    const sv = vertexOf(e.source);
    const tv = vertexOf(e.target);
    const sp = e.sourcePoint;
    const tp = e.targetPoint;
    if (!sv && !sp) return;
    if (!tv && !tp) return;
    const sRect: Rect = sv ? sv.rect : { x: (sp as Pt).x, y: (sp as Pt).y, w: 0, h: 0 };
    const tRect: Rect = tv ? tv.rect : { x: (tp as Pt).x, y: (tp as Pt).y, w: 0, h: 0 };
    const edgeStyle = (st.str('edgeStyle') ?? '').toLowerCase();
    const orth = /orthogonal|elbow|entityrelation/.test(edgeStyle);
    const first = e.points[0];
    const last = e.points[e.points.length - 1];
    const optNum = (k: string): number | null => (st.str(k) === undefined ? null : st.num(k, 0.5, -1000, 1000));
    const exitP = sv
      ? explicitPort(sRect, optNum('exitX'), optNum('exitY'), st.num('exitDx', 0), st.num('exitDy', 0))
      : null;
    const entryP = tv
      ? explicitPort(tRect, optNum('entryX'), optNum('entryY'), st.num('entryDx', 0), st.num('entryDy', 0))
      : null;
    const tCenter = centerOf(tRect);
    const sCenter = centerOf(sRect);

    // 生命線（umlLifeline）：相手の高さで、中心の縦線に水平につなぐ
    const lifelinePort = (v: DxVertex | null, other: Pt, otherIsLifeline: boolean): Port | null => {
      if (v?.shape !== 'lifeline') return null;
      const hh = Math.min(v.rect.h, v.style.num('size', 40, 0, 1000));
      const y = otherIsLifeline ? v.rect.y + hh + 24 : Math.min(v.rect.y + v.rect.h, Math.max(v.rect.y + hh, other.y));
      const cx = v.rect.x + v.rect.w / 2;
      return { p: { x: cx, y }, dir: other.x >= cx ? 'E' : 'W' };
    };
    const sLife = lifelinePort(sv, first ?? tCenter, tv?.shape === 'lifeline');
    const tLife = lifelinePort(tv, last ?? sCenter, sv?.shape === 'lifeline');

    let pts: Pt[];
    if (sv && tv && sv.id === tv.id && !e.points.length && !exitP && !entryP) {
      const { x, y, w, h } = sv.rect;
      pts = [
        { x: x + w, y: y + h * 0.3 },
        { x: x + w + 30, y: y + h * 0.3 },
        { x: x + w + 30, y: y + h * 0.7 },
        { x: x + w, y: y + h * 0.7 },
      ];
    } else if (orth) {
      // elbowEdgeStyle：`elbow=vertical` なら縦に出入り（上下の辺）・それ以外は、横（左右の辺）。orthogonalEdgeStyle は、相対位置から決める
      const elbow = edgeStyle.includes('elbow');
      const dirTo = (r: Rect, to: Pt, size?: { w: number; h: number }): Dir => {
        if (!elbow) return autoDir(r, to, size);
        const c = centerOf(r);
        return st.str('elbow') === 'vertical' ? (to.y >= c.y ? 'S' : 'N') : to.x >= c.x ? 'E' : 'W';
      };
      const a: Port =
        exitP ??
        sLife ??
        sidePort(
          sRect,
          dirTo(sRect, first ?? (tLife ? tLife.p : tCenter), first ? undefined : { w: tRect.w, h: tRect.h }),
        );
      const aToward = a.p;
      const b: Port =
        entryP ??
        tLife ??
        sidePort(tRect, dirTo(tRect, last ?? aToward, last ? undefined : { w: sRect.w, h: sRect.h }));
      // 点だけの端（図形につながっていない）：向かう向きに、点から出る
      const a2: Port = sv ? a : { p: a.p, dir: dirTo(sRect, first ?? b.p) };
      const b2: Port = tv ? b : { p: b.p, dir: dirTo(tRect, last ?? a2.p) };
      pts = routeOrthogonal(a2, b2, e.points);
    } else {
      // まっすぐな線（経由点を通る折れ線）
      const startToward = first ?? (tLife ? tLife.p : tCenter);
      const endToward = last ?? (sLife ? sLife.p : sCenter);
      const start = exitP ? exitP.p : sLife ? sLife.p : sv ? perimeterPoint(sRect, sv.shape, startToward) : sRect;
      const end = entryP ? entryP.p : tLife ? tLife.p : tv ? perimeterPoint(tRect, tv.shape, endToward) : tRect;
      pts = [{ x: start.x, y: start.y }, ...e.points, { x: end.x, y: end.y }];
      // 経由点がなく、生命線どうしなら、水平にそろえる
      if (!e.points.length && sLife && tLife) pts = [sLife.p, { x: tLife.p.x, y: sLife.p.y }];
    }
    if (pts.length < 2) return;
    paths.set(e.id, pts);

    const sw = st.num('strokeWidth', 1, 0, 20);
    const stroke = colorOf(e, 'strokeColor') ?? P.ink;
    const endK = arrowKind(st.str('endArrow'), 'classic');
    const startK = arrowKind(st.str('startArrow'), 'none');
    const endSz = st.num('endSize', 6, 1, 40);
    const startSz = st.num('startSize', 6, 1, 40);
    const g = el('g');
    const op = st.num('opacity', 100, 0, 100);
    if (op < 100) g.setAttribute('opacity', String(op / 100));

    const dirAt = (a: Pt, b: Pt): Pt => {
      const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      return { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
    };
    const n = pts.length;
    const endDir = dirAt(pts[n - 2] as Pt, pts[n - 1] as Pt);
    const startDir = dirAt(pts[1] as Pt, pts[0] as Pt);
    const endShape = arrowShape(endK, pts[n - 1] as Pt, endDir, endSz, sw);
    const startShape = arrowShape(startK, pts[0] as Pt, startDir, startSz, sw);
    // 線は、矢印の分だけ縮める
    const line = pts.map((p) => ({ ...p }));
    const shorten = (i: number, j: number, by: number): void => {
      const a = line[i] as Pt;
      const b = line[j] as Pt;
      const l = Math.hypot(b.x - a.x, b.y - a.y);
      const k = Math.min(by, l * 0.8) / (l || 1);
      line[i] = { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
    };
    if (endShape) shorten(n - 1, n - 2, endShape.shorten);
    if (startShape) shorten(0, 1, startShape.shorten);
    const radius = st.flag('rounded', false) ? 10 : 0;
    g.append(
      el('path', {
        d: pathData(line, radius),
        fill: 'none',
        'stroke-linejoin': 'round',
        ...strokeAttrs(e, stroke, P.ink),
      }),
    );
    for (const [shape, fillKey] of [
      [endShape, 'endFill'],
      [startShape, 'startFill'],
    ] as const) {
      if (!shape) continue;
      const solid = st.flag(fillKey, true);
      const common: Attrs = {
        stroke,
        'stroke-width': sw,
        'stroke-linejoin': 'round',
        fill: shape.filled ? (solid ? stroke : P.fill) : 'none',
      };
      if (shape.circle)
        g.append(
          el('circle', { cx: r2(shape.circle.c.x), cy: r2(shape.circle.c.y), r: r2(shape.circle.r), ...common }),
        );
      else if (shape.filled) g.append(poly(shape.points, common));
      else g.append(el('polyline', { points: shape.points.map((p) => `${r2(p.x)},${r2(p.y)}`).join(' '), ...common }));
    }
    for (const p of pts) grow(p.x, p.y);
    root.append(g);

    if (e.text) {
      const at = labelPoint(pts, e.label.x, e.label.y, e.label.offset);
      // 線の上のラベルは、既定で、画面の紙の色の地を敷く（線と重なっても読める。draw.io の既定と同じ）。`labelBackgroundColor=none` で、敷かない
      const bgSpecified = colorOf(e, 'labelBackgroundColor');
      const bg = bgSpecified ?? P.paper;
      const specified = colorOf(e, 'fontColor');
      const color =
        specified && specified !== 'none'
          ? specified
          : ((bgSpecified && bgSpecified !== 'none' ? inkOn(bgSpecified) : null) ?? P.ink);
      const box: Rect = { x: at.x, y: at.y, w: 0, h: 0 };
      const lg = el('g');
      const va = st.str('verticalAlign');
      drawLabel(lg, e, e.text, box, {
        wrap: false,
        align: 'center',
        valign: va === 'bottom' || va === 'top' ? va : 'middle',
        color,
        fontSize: st.num('fontSize', 11, 4, 120),
        rotate: false,
        bg,
        padX: 0,
        padY: 4,
      });
      root.append(lg);
    }
  }

  // 線の上のラベル（親が線の頂点）
  function drawEdgeLabel(v: DxVertex): void {
    const o = v.onEdge;
    const pts = o ? paths.get(o.edge) : undefined;
    if (!o || !pts || !v.text) return;
    const at = labelPoint(pts, o.x, o.y, o.offset);
    const fill = colorOf(v, 'fillColor');
    const bgSpecified = colorOf(v, 'labelBackgroundColor') ?? (fill && fill !== 'none' ? fill : null);
    const bg = bgSpecified ?? P.paper;
    const specified = colorOf(v, 'fontColor');
    const color =
      specified && specified !== 'none'
        ? specified
        : ((bgSpecified && bgSpecified !== 'none' ? inkOn(bgSpecified) : null) ?? P.ink);
    const g = el('g');
    drawLabel(
      g,
      v,
      v.text,
      { x: at.x, y: at.y, w: 0, h: 0 },
      {
        wrap: false,
        align: 'center',
        valign: 'middle',
        color,
        fontSize: v.style.num('fontSize', 11, 4, 120),
        rotate: false,
        bg,
        padX: 0,
        padY: 0,
      },
    );
    root.append(g);
  }

  for (const it of model.items) {
    if (it.kind === 'vertex') {
      if (it.onEdge) drawEdgeLabel(it);
      else drawVertex(it);
    } else drawEdge(it);
  }

  if (!Number.isFinite(bounds.x1))
    throw new DrawioError('描ける図形がありません（セルがない・すべて非表示・つなぎ先のない線だけ）');
  const x = Math.floor(bounds.x1 - PAD);
  const y = Math.floor(bounds.y1 - PAD);
  const w = Math.ceil(bounds.x2 - bounds.x1 + PAD * 2);
  const h = Math.ceil(bounds.y2 - bounds.y1 + PAD * 2);
  const label = `draw.io の図：${texts.join(' ').replace(/\s+/g, ' ').trim()}`.slice(0, ARIA_MAX);
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('xmlns', NS);
  svg.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);
  svg.setAttribute('width', String(w));
  svg.setAttribute('height', String(h));
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', label);
  svg.setAttribute('font-family', FONT);
  svg.setAttribute('font-size', '12');
  svg.setAttribute('class', 'dx-svg');
  svg.append(root);
  const notes = [...model.notes];
  const bad = new Set<string>();
  for (const it of model.items) for (const k of it.style.badColors) bad.add(k);
  if (bad.size) notes.push('使えない色の指定は、無視しました（#rrggbb・色名・none だけ使えます）');
  return { svg, label, size: { w, h }, notes };
}
