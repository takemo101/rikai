// draw.io の XML → 中間モデル（純粋：`DOMParser` で読む。SVG は、ここでは作らない）。
// 入力は、`<mxGraphModel>`（ファイル → エクスポート → XML）か、`<mxfile><diagram>…`（圧縮されていない形。圧縮された形は、`inflateDiagram` で、先に展開する）。
// **資料の XML は非信頼のデータ**：大きさ・セルの数・座標・入れ子の深さに上限があり、超えたら `DrawioError`（成功に見せない）。存在しない親は、最上位として扱い、記録する（`notes`）。
// セル（`mxCell`）：頂点（`vertex`）・線（`edge`）・レイヤー（親が `0` の、頂点でも線でもないセル）。頂点の座標は、親の左上からの相対（`absRect` で、絶対にする）。

import { parseStyle, type Style } from './drawioStyle';
import { htmlToText } from './drawioText';

/** 上限（資料の XML が、画面を止めないように） */
export const LIMITS = {
  /** XML の文字数 */
  xml: 500_000,
  /** セルの数 */
  cells: 2000,
  /** 座標・大きさの絶対値 */
  coord: 100_000,
  /** 親子の入れ子の深さ */
  depth: 25,
  /** 圧縮を展開した後の文字数（圧縮爆弾） */
  inflated: 2_000_000,
} as const;

export class DrawioError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DrawioError';
  }
}

export interface Pt {
  x: number;
  y: number;
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 描ける図形の種類（これ以外の shape は、四角で代用して、記録する） */
export type ShapeKind =
  | 'rect'
  | 'ellipse'
  | 'rhombus'
  | 'cylinder3'
  | 'cylinder'
  | 'process'
  | 'parallelogram'
  | 'hexagon'
  | 'document'
  | 'text'
  | 'actor'
  | 'swimlane'
  | 'table'
  | 'row'
  | 'partial'
  | 'lifeline'
  | 'triangle'
  | 'terminator';

const SHAPES: Record<string, ShapeKind> = {
  rectangle: 'rect',
  rect: 'rect',
  label: 'rect',
  ellipse: 'ellipse',
  doubleellipse: 'ellipse',
  rhombus: 'rhombus',
  cylinder3: 'cylinder3',
  cylinder: 'cylinder',
  cylinder2: 'cylinder',
  process: 'process',
  parallelogram: 'parallelogram',
  hexagon: 'hexagon',
  document: 'document',
  text: 'text',
  umlactor: 'actor',
  actor: 'actor',
  swimlane: 'swimlane',
  table: 'table',
  tablerow: 'row',
  partialrectangle: 'partial',
  umllifeline: 'lifeline',
  triangle: 'triangle',
  group: 'text',
  // draw.io の、フローチャートの図形（`mxgraph.flowchart.*`）：近い形に
  'mxgraph.flowchart.terminator': 'terminator',
  'mxgraph.flowchart.start_1': 'terminator',
  'mxgraph.flowchart.start_2': 'ellipse',
  'mxgraph.flowchart.end': 'ellipse',
  'mxgraph.flowchart.decision': 'rhombus',
  'mxgraph.flowchart.database': 'cylinder3',
  'mxgraph.flowchart.document': 'document',
  'mxgraph.flowchart.multi-document': 'document',
  'mxgraph.flowchart.process': 'rect',
  'mxgraph.flowchart.predefined_process': 'process',
  'mxgraph.flowchart.data': 'parallelogram',
  'mxgraph.flowchart.preparation': 'hexagon',
  'mxgraph.flowchart.on-page_reference': 'ellipse',
  terminator: 'terminator',
};

export interface DxCommon {
  id: string;
  /** ラベル（文字だけ。HTML は、タグを外してある） */
  text: string;
  style: Style;
  parent: string | null;
}

export interface DxVertex extends DxCommon {
  kind: 'vertex';
  shape: ShapeKind;
  /** 絶対座標 */
  rect: Rect;
  /** 親（頂点）の id。レイヤーが親なら null */
  container: string | null;
  /** 線の上のラベル（親が線）：線の中の位置（-1〜1）・直交方向のずれ・ずらし */
  onEdge: { edge: string; x: number; y: number; offset: Pt } | null;
}

export interface DxEdge extends DxCommon {
  kind: 'edge';
  source: string | null;
  target: string | null;
  /** 端の点（頂点につながっていないとき）：絶対座標 */
  sourcePoint: Pt | null;
  targetPoint: Pt | null;
  /** 経由点：絶対座標 */
  points: Pt[];
  /** 線の上のラベルの位置：x（-1〜1）・y（直交方向のずれ）・offset */
  label: { x: number; y: number; offset: Pt };
}

export interface DxModel {
  /** 描く順（レイヤーの順に：頂点は、親が子より先・線は、そのレイヤーの頂点の上） */
  items: (DxVertex | DxEdge)[];
  byId: ReadonlyMap<string, DxVertex | DxEdge>;
  /** 描けなかったこと・代用したこと（利用者に知らせる） */
  notes: string[];
}

interface RawCell {
  id: string;
  parent: string | null;
  vertex: boolean;
  edge: boolean;
  source: string | null;
  target: string | null;
  value: string;
  style: string;
  visible: boolean;
  geo: {
    x: number;
    y: number;
    w: number;
    h: number;
    relative: boolean;
    sourcePoint: Pt | null;
    targetPoint: Pt | null;
    offset: Pt;
    points: Pt[];
  } | null;
}

const inRange = (v: number): boolean => Math.abs(v) <= LIMITS.coord;

function numAttr(el: Element, name: string, def = 0): number {
  const raw = el.getAttribute(name);
  if (raw === null || raw === '') return def;
  const n = Number(raw);
  if (!Number.isFinite(n)) return def;
  if (!inRange(n)) throw new DrawioError(`座標・大きさが範囲（±${LIMITS.coord}）を超えています`);
  return n;
}

const childrenNamed = (el: Element, name: string): Element[] => [...el.children].filter((c) => c.localName === name);

function pointOf(el: Element | undefined): Pt | null {
  return el ? { x: numAttr(el, 'x'), y: numAttr(el, 'y') } : null;
}

function readGeometry(cell: Element): RawCell['geo'] {
  const g = childrenNamed(cell, 'mxGeometry')[0];
  if (!g) return null;
  const pts = (as: string): Element | undefined => childrenNamed(g, 'mxPoint').find((p) => p.getAttribute('as') === as);
  const arr = childrenNamed(g, 'Array').find((a) => a.getAttribute('as') === 'points');
  return {
    x: numAttr(g, 'x'),
    y: numAttr(g, 'y'),
    w: numAttr(g, 'width'),
    h: numAttr(g, 'height'),
    relative: g.getAttribute('relative') === '1',
    sourcePoint: pointOf(pts('sourcePoint')),
    targetPoint: pointOf(pts('targetPoint')),
    offset: pointOf(pts('offset')) ?? { x: 0, y: 0 },
    points: arr ? childrenNamed(arr, 'mxPoint').map((p) => pointOf(p) as Pt) : [],
  };
}

/** `<mxGraphModel>` の `<root>` から、セルを読む（`object`・`UserObject` の包みも読む：`label` が、ラベル） */
function readCells(root: Element): RawCell[] {
  const out: RawCell[] = [];
  for (const el of root.children) {
    const wrapper = el.localName === 'object' || el.localName === 'UserObject' || el.localName === 'Object';
    const cell = wrapper ? childrenNamed(el, 'mxCell')[0] : el.localName === 'mxCell' ? el : undefined;
    if (!cell) continue;
    if (out.length >= LIMITS.cells) throw new DrawioError(`セルが多すぎます（上限 ${LIMITS.cells}）`);
    const src = wrapper ? el : cell;
    const id = src.getAttribute('id') ?? cell.getAttribute('id');
    if (id === null || id === '') continue;
    out.push({
      id,
      parent: cell.getAttribute('parent'),
      vertex: cell.getAttribute('vertex') === '1',
      edge: cell.getAttribute('edge') === '1',
      source: cell.getAttribute('source'),
      target: cell.getAttribute('target'),
      value: wrapper ? (el.getAttribute('label') ?? '') : (cell.getAttribute('value') ?? ''),
      style: cell.getAttribute('style') ?? '',
      visible: cell.getAttribute('visible') !== '0',
      geo: readGeometry(cell),
    });
  }
  return out;
}

/** ラベルの文字：`html=1` なら、タグを外す（`htmlToText`）。そうでなければ、そのまま */
function labelOf(value: string, style: Style): string {
  if (!value) return '';
  return style.flag('html', false) ? htmlToText(value) : value.slice(0, 2000);
}

/** `<mxfile>` の `<diagram>` の、最初のページ（`<mxGraphModel>` を直接持つ形）か、圧縮された文字列 */
export interface DiagramPage {
  /** 圧縮されていない `<mxGraphModel>` の要素 */
  model: Element | null;
  /** 圧縮された文字列（`<diagram>` のテキスト） */
  compressed: string | null;
  /** ページ数 */
  pages: number;
}

function parseXml(xml: string): Document {
  if (xml.length > LIMITS.xml) throw new DrawioError(`XML が大きすぎます（上限 ${LIMITS.xml / 1000}KB）`);
  // 外部実体・内部実体の定義は、使わない（実体の展開で、大きくなるのを防ぐ）
  if (/<!(?:DOCTYPE|ENTITY)/i.test(xml)) throw new DrawioError('DOCTYPE・ENTITY は使えません');
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length)
    throw new DrawioError('XML を読めません（閉じていないタグ・不正な文字など）');
  return doc;
}

/** XML 文字列から、ページを取り出す（`mxGraphModel` か `mxfile`） */
export function pageOf(xml: string): DiagramPage {
  const doc = parseXml(xml);
  const top = doc.documentElement;
  if (top.localName === 'mxGraphModel') return { model: top, compressed: null, pages: 1 };
  if (top.localName === 'mxfile') {
    const pages = childrenNamed(top, 'diagram');
    const first = pages[0];
    if (!first) throw new DrawioError('<mxfile> に <diagram> がありません');
    const inner = childrenNamed(first, 'mxGraphModel')[0];
    if (inner) return { model: inner, compressed: null, pages: pages.length };
    const text = (first.textContent ?? '').trim();
    if (!text) throw new DrawioError('<diagram> が空です');
    return { model: null, compressed: text, pages: pages.length };
  }
  throw new DrawioError('<mxGraphModel> か <mxfile> で始めてください');
}

/**
 * 圧縮された `<diagram>` の中身（base64 + deflate-raw + URI エンコード）を、XML 文字列にする。ブラウザの `DecompressionStream` を使う。
 * 展開後の大きさに上限（`LIMITS.inflated`）：超えたら、そこで止めて、エラー（圧縮爆弾）。使えなければ、エラー
 */
export async function inflateDiagram(b64: string): Promise<string> {
  const DS = (globalThis as { DecompressionStream?: typeof DecompressionStream }).DecompressionStream;
  if (!DS)
    throw new DrawioError(
      'このブラウザは、圧縮された図を展開できません。draw.io の「エクスポート → XML」で、圧縮しない形で貼ってください',
    );
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    const bin = atob(b64.replace(/\s+/g, ''));
    bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    throw new DrawioError('圧縮された図を読めません（base64 ではありません）');
  }
  if (bytes.length > LIMITS.xml) throw new DrawioError(`XML が大きすぎます（上限 ${LIMITS.xml / 1000}KB）`);
  const src = new ReadableStream<BufferSource>({
    start(c) {
      c.enqueue(bytes);
      c.close();
    },
  });
  const stream = src.pipeThrough(new DS('deflate-raw'));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > LIMITS.inflated) {
        await reader.cancel();
        throw new DrawioError('圧縮された図の展開後が大きすぎます');
      }
      chunks.push(value);
    }
  } catch (e) {
    if (e instanceof DrawioError) throw e;
    throw new DrawioError('圧縮された図を展開できません（壊れているか、draw.io の圧縮形式ではありません）');
  }
  const all = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    all.set(c, off);
    off += c.length;
  }
  const text = new TextDecoder().decode(all);
  try {
    return decodeURIComponent(text);
  } catch {
    return text; // URI エンコードされていない形
  }
}

/** `<mxGraphModel>` の要素から、モデルを作る */
export function buildModel(model: Element, pages = 1): DxModel {
  const rootEl = childrenNamed(model, 'root')[0];
  if (!rootEl) throw new DrawioError('<mxGraphModel> に <root> がありません');
  const raw = readCells(rootEl);
  const notes: string[] = [];
  if (pages > 1) notes.push(`ページが ${pages} つあります。最初のページだけ描きました`);

  const byRaw = new Map<string, RawCell>();
  for (const c of raw) {
    if (byRaw.has(c.id)) {
      if (!notes.includes('同じ id のセルがあります（最初のものだけ使いました）'))
        notes.push('同じ id のセルがあります（最初のものだけ使いました）');
      continue;
    }
    byRaw.set(c.id, c);
  }

  // 親の鎖：存在しない親は、最上位として扱う。循環・深すぎる入れ子は、エラー
  const parentOf = (c: RawCell): RawCell | null => (c.parent !== null ? (byRaw.get(c.parent) ?? null) : null);
  let orphans = 0;
  for (const c of byRaw.values()) {
    const seen = new Set<string>([c.id]);
    let d = 0;
    for (let p = parentOf(c); p; p = parentOf(p)) {
      if (seen.has(p.id)) throw new DrawioError('親子関係が循環しています');
      seen.add(p.id);
      if (++d > LIMITS.depth) throw new DrawioError(`入れ子が深すぎます（上限 ${LIMITS.depth}）`);
    }
    if (c.parent !== null && c.parent !== '' && !byRaw.has(c.parent)) orphans++;
  }
  if (orphans) notes.push(`存在しない親を指すセルが ${orphans} 個あります（最上位として描きました）`);

  const isLayer = (c: RawCell): boolean => !c.vertex && !c.edge;
  const isEdge = (c: RawCell): boolean => c.edge;

  // 見えるか：自分と、親の鎖が `visible`
  const visible = (c: RawCell): boolean => {
    for (let p: RawCell | null = c; p; p = parentOf(p)) if (!p.visible) return false;
    return true;
  };

  // 絶対座標：頂点の親（頂点）の左上からの相対。レイヤー・線が親なら、原点
  const rects = new Map<string, Rect>();
  const originOf = (c: RawCell): Pt => {
    const p = parentOf(c);
    if (!p || isLayer(p) || isEdge(p)) return { x: 0, y: 0 };
    const r = rectOf(p);
    return { x: r.x, y: r.y };
  };
  const rectOf = (c: RawCell): Rect => {
    const hit = rects.get(c.id);
    if (hit) return hit;
    const g = c.geo;
    const o = originOf(c);
    const r = { x: o.x + (g?.x ?? 0), y: o.y + (g?.y ?? 0), w: Math.max(0, g?.w ?? 0), h: Math.max(0, g?.h ?? 0) };
    rects.set(c.id, r);
    return r;
  };

  const styles = new Map<string, Style>();
  const styleOf = (c: RawCell): Style => {
    let s = styles.get(c.id);
    if (!s) {
      s = parseStyle(c.style);
      styles.set(c.id, s);
    }
    return s;
  };

  const unsupported = new Set<string>();
  const shapeOf = (st: Style): ShapeKind => {
    const named = (st.str('shape') ?? '').toLowerCase();
    const first = st.bare.find((b) => b in SHAPES);
    const key = named || first || '';
    if (!key) return 'rect';
    const hit = SHAPES[key];
    if (hit) return hit;
    if (/^[\w.-]{1,40}$/.test(key) && unsupported.size < 8) unsupported.add(key);
    return 'rect';
  };

  const vertexOf = (c: RawCell): DxVertex => {
    const st = styleOf(c);
    const p = parentOf(c);
    const onEdge =
      p && isEdge(p) && c.geo?.relative ? { edge: p.id, x: c.geo.x, y: c.geo.y, offset: c.geo.offset } : null;
    return {
      kind: 'vertex',
      id: c.id,
      text: labelOf(c.value, st),
      style: st,
      parent: c.parent,
      shape: shapeOf(st),
      rect: onEdge ? { x: 0, y: 0, w: c.geo?.w ?? 0, h: c.geo?.h ?? 0 } : rectOf(c),
      container: p && !isLayer(p) && !isEdge(p) ? p.id : null,
      onEdge,
    };
  };

  const edgeOf = (c: RawCell): DxEdge => {
    const st = styleOf(c);
    const g = c.geo;
    const o = originOf(c);
    const abs = (p: Pt | null): Pt | null => (p ? { x: o.x + p.x, y: o.y + p.y } : null);
    return {
      kind: 'edge',
      id: c.id,
      text: labelOf(c.value, st),
      style: st,
      parent: c.parent,
      source: c.source && byRaw.has(c.source) ? c.source : null,
      target: c.target && byRaw.has(c.target) ? c.target : null,
      sourcePoint: abs(g?.sourcePoint ?? null),
      targetPoint: abs(g?.targetPoint ?? null),
      points: (g?.points ?? []).map((p) => ({ x: o.x + p.x, y: o.y + p.y })),
      label: { x: g?.x ?? 0, y: g?.y ?? 0, offset: g?.offset ?? { x: 0, y: 0 } },
    };
  };

  // 描く順：レイヤーごとに、頂点（親が先・定義の順）→ 線。レイヤーは、定義の順。最上位（親がない・見つからない）のレイヤーでないセルは、最初に
  const kids = new Map<string, RawCell[]>();
  for (const c of byRaw.values()) {
    const pid = parentOf(c)?.id ?? '';
    const list = kids.get(pid);
    if (list) list.push(c);
    else kids.set(pid, [c]);
  }
  const items: (DxVertex | DxEdge)[] = [];
  const byId = new Map<string, DxVertex | DxEdge>();
  const emit = (v: DxVertex | DxEdge): void => {
    items.push(v);
    byId.set(v.id, v);
  };
  const walk = (c: RawCell, edges: RawCell[]): void => {
    if (!visible(c)) return;
    if (isEdge(c)) {
      edges.push(c);
      return;
    }
    if (c.vertex) {
      const p = parentOf(c);
      if (!(p && isEdge(p))) emit(vertexOf(c)); // 線の上のラベルは、線のあとで
    }
    for (const k of kids.get(c.id) ?? []) walk(k, edges);
  };
  const emitLayer = (cells: RawCell[]): void => {
    const edges: RawCell[] = [];
    for (const c of cells) walk(c, edges);
    for (const e of edges) {
      emit(edgeOf(e));
      for (const k of kids.get(e.id) ?? []) if (k.vertex && visible(k)) emit(vertexOf(k));
    }
  };
  const top = kids.get('') ?? [];
  emitLayer(top.filter((c) => !isLayer(c)));
  for (const root of top.filter(isLayer)) {
    // ルート（`0`）の子のレイヤーごとに。レイヤーでないセルが、直接ぶら下がっていれば、それはまとめて 1 つのレイヤー
    const direct: RawCell[] = [];
    for (const k of kids.get(root.id) ?? []) {
      if (isLayer(k)) emitLayer(kids.get(k.id) ?? []);
      else direct.push(k);
    }
    if (direct.length) emitLayer(direct);
  }

  for (const u of unsupported) notes.push(`未対応の図形（${u}）は、四角で描きました`);
  return { items, byId, notes };
}

/** 展開済みの XML（`<mxGraphModel>` か、圧縮されていない `<mxfile>`）から、モデルを作る */
export function parseDrawio(xml: string): DxModel {
  const page = pageOf(xml);
  if (!page.model) throw new DrawioError('圧縮された図は、先に展開してください');
  return buildModel(page.model, page.pages);
}
