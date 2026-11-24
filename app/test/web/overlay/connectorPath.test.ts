// 関連の線の幾何：端点を見える範囲へ寄せる・同じ側の外は引かない・パスの形・クリップの箱・本文の順の線が、交わらない。
import { expect, test } from 'vitest';
import { type Box, bottom, fromEdges, type Pt, right } from '../../../src/web/lib/geom';
import {
  BELOW,
  clampTo,
  clipBox,
  connectorPath,
  EDGE_INSET,
  endOfLastLine,
  type Frame,
  fanOutSameRow,
  HOOK,
  LEAD_GAP,
  lastLineBottom,
  linkBetween,
  MIN_CURVE,
  rightMiddle,
  STUB,
  sameFrame,
  sharedLeadX,
  sideOf,
} from '../../../src/web/overlay/connectorPath';

const edges = (left: number, top: number, right: number, bottom: number): Box =>
  fromEdges({ left, top, right, bottom });
const doc: Box = edges(230, 44, 1000, 844);
const panel: Box = edges(1010, 130, 1400, 844); // 130 までは、固定の見出し

test('rightMiddle：箱の右端の縦の中央', () => {
  expect(rightMiddle(edges(10, 20, 110, 60))).toEqual({ x: 110, y: 40 });
});

test('clampTo：範囲の中は、そのまま（edge なし）。外は、縁へ寄せる', () => {
  expect(clampTo({ x: 500, y: 300 }, doc)).toEqual({ pt: { x: 500, y: 300 }, edge: false });
  expect(clampTo({ x: 500, y: 10 }, doc)).toEqual({ pt: { x: 500, y: 44 }, edge: true });
  expect(clampTo({ x: 500, y: 2000 }, doc)).toEqual({ pt: { x: 500, y: 844 }, edge: true });
  expect(clampTo({ x: 1200, y: 300 }, doc)).toEqual({ pt: { x: 1000, y: 300 }, edge: true });
  expect(clampTo({ x: 100, y: 300 }, doc)).toEqual({ pt: { x: 230, y: 300 }, edge: true });
});

test('sideOf：上・中・下（縁は中）', () => {
  expect([sideOf(10, doc), sideOf(44, doc), sideOf(844, doc), sideOf(900, doc)]).toEqual([-1, 0, 0, 1]);
});

test('linkBetween：両方が範囲の中なら、丸と棒がある・edge なし（選んでいなくても、引く）', () => {
  const l = linkBetween('t1', { x: 600, y: 200 }, { x: 1010, y: 300 }, doc, panel, false);
  expect(l).toMatchObject({ tid: 't1', doc: { x: 600, y: 200 }, card: { x: 1010, y: 300 }, edge: false });
  expect(l?.d.startsWith('M600 200C')).toBe(true);
  expect(l?.d.endsWith(' 1010 300')).toBe(true);
});

test('linkBetween：縁へ寄せる線は、選んでいない（emphasized でない）なら、引かない。選んでいる・光らせている・入力中なら、引く', () => {
  const cases: [string, Pt, Pt][] = [
    ['本文の端が、上の外', { x: 600, y: -300 }, { x: 1010, y: 300 }],
    ['本文の端が、下の外', { x: 600, y: 3000 }, { x: 1010, y: 300 }],
    ['カードの端が、下の外', { x: 600, y: 300 }, { x: 1010, y: 5000 }],
    ['カードが、固定の見出しの下に隠れている（見える範囲の上の外）', { x: 600, y: 300 }, { x: 1010, y: 100 }],
    ['反対側の外どうし', { x: 600, y: 0 }, { x: 1010, y: 3000 }],
  ];
  for (const [name, d, c] of cases) {
    expect(linkBetween('t', d, c, doc, panel, false), `${name}：選んでいないなら、引かない`).toBeNull();
    const on = linkBetween('t', d, c, doc, panel, true);
    expect(on?.edge, `${name}：選んでいるなら、引く`).toBe(true);
  }
});

test('linkBetween：選んでいる線で、本文の端が上の外：本文の右端の近く・縁の内側に、短く止める（縁に沿って、水平に走らない）。丸は出さない', () => {
  const l = linkBetween('t1', { x: 600, y: -300 }, { x: 1010, y: 300 }, doc, panel, true);
  expect(l?.doc).toBeNull();
  expect(l?.card).toEqual({ x: 1010, y: 300 });
  expect(l?.d.startsWith(`M${right(doc) - STUB} ${doc.top + EDGE_INSET}C`)).toBe(true);
  // 下の外
  const b = linkBetween('t1', { x: 300, y: 3000 }, { x: 1010, y: 300 }, doc, panel, true);
  expect(b?.d.startsWith(`M${right(doc) - STUB} ${bottom(doc) - EDGE_INSET}C`)).toBe(true);
});

test('linkBetween：選んでいる線で、カードの端が外：パネルの縁の内側に止める。棒は出さない', () => {
  const below = linkBetween('t1', { x: 600, y: 300 }, { x: 1010, y: 5000 }, doc, panel, true);
  expect(below?.card).toBeNull();
  expect(below?.doc).toEqual({ x: 600, y: 300 });
  expect(below?.d.endsWith(` 1010 ${bottom(panel) - EDGE_INSET}`)).toBe(true);
  const above = linkBetween('t1', { x: 600, y: 300 }, { x: 1010, y: 100 }, doc, panel, true);
  expect(above?.d.endsWith(` 1010 ${panel.top + EDGE_INSET}`)).toBe(true);
});

test('linkBetween：両方が同じ側の外（ともに上・ともに下）なら、選んでいても、引かない', () => {
  expect(linkBetween('t', { x: 600, y: 0 }, { x: 1010, y: 0 }, doc, panel, true)).toBeNull();
  expect(linkBetween('t', { x: 600, y: 2000 }, { x: 1010, y: 3000 }, doc, panel, true)).toBeNull();
});

test('endOfLastLine：複数行の強調は、最後の行の右端の縦の中央（先頭の矩形ではない）。矩形の順に、よらない', () => {
  const lines: Box[] = [
    edges(300, 100, 900, 120), // 1 行目（いちばん右まで）
    edges(230, 120, 900, 140),
    edges(230, 140, 420, 160), // 最後の行（短い）
  ];
  expect(endOfLastLine(lines)).toEqual({ x: 420, y: 150 });
  expect(endOfLastLine([...lines].reverse())).toEqual({ x: 420, y: 150 });
  // 最後の行が、複数の矩形（太字などで分かれた）に分かれていても、その行の、いちばん右
  expect(endOfLastLine([...lines, edges(420, 140, 505, 160)])).toEqual({ x: 505, y: 150 });
  expect(endOfLastLine([])).toBeNull();
});

test('lastLineBottom：最後の行の下端（同じ行の、いちばん下）', () => {
  const lines: Box[] = [
    edges(300, 100, 900, 120),
    edges(230, 120, 420, 140),
    edges(420, 118, 505, 143), // 同じ行で、背が高い（太字など）
  ];
  expect(lastLineBottom(lines)).toBe(143);
  expect(lastLineBottom([])).toBeNull();
});

test('connectorPath：引き出し線（leadX）があると、まず水平に、そこまで引いて（H）から、S 字に入る。なければ、これまでどおり', () => {
  expect(connectorPath({ x: 100, y: 50 }, { x: 300, y: 250 }, 140)).toBe('M100 50H140C220 50 220 250 300 250');
  expect(connectorPath({ x: 100, y: 50 }, { x: 300, y: 250 }, 100)).toBe('M100 50C200 50 200 250 300 250');
  expect(connectorPath({ x: 100, y: 50 }, { x: 300, y: 250 }, 80)).toBe('M100 50C200 50 200 250 300 250'); // 左は、無視
  // 本文側が縁へ寄った線には、使わない
  const l = linkBetween('t', { x: 600, y: -300 }, { x: 1010, y: 300 }, doc, panel, true, 700);
  expect(l?.d.includes('H')).toBe(false);
  expect(linkBetween('t', { x: 600, y: 200 }, { x: 1010, y: 300 }, doc, panel, false, 700)?.d).toBe(
    'M600 200H700C855 200 855 300 1010 300',
  );
});

test('fanOutSameRow：始点は、強調の行の下端 + 2px（行間）。同じ行（4px 未満）の 2 つ以上は、カードの高さの順に、行間の中で、上から下へ、ずらす。x は、端点のまま', () => {
  const e = (tid: string, x: number, y: number, cardY: number, gap = 5) => ({
    tid,
    p: { x, y },
    bottom: y + 10,
    gap,
    cardY,
  });
  const fan = fanOutSameRow([e('a', 300, 100, 150), e('b', 450, 101, 400), e('c', 600, 99, 650)]);
  const [a, b, c] = ['a', 'b', 'c'].map((t) => fan.get(t) as Pt);
  expect([a.x, b.x, c.x]).toEqual([300, 450, 600]);
  const base = 101 + 10 + BELOW; // 行の下端（いちばん下の端点）+ 2
  // 行間 5px：2px 下に出して、次の行まで 2px 残す → ずらせるのは 1px（3 本で 0.5px ずつ）
  expect([a.y, b.y, c.y]).toEqual([base, base + 0.5, base + 1]);
  // 行間が広ければ、2px ずつ（6 件で、全体が 6px を超えない）
  const wide = fanOutSameRow(Array.from({ length: 6 }, (_, i) => e(`t${i}`, 300 + i * 40, 100, 100 + i * 100, 12)));
  const ys = [...wide.values()].map((p) => p.y);
  expect(Math.max(...ys) - Math.min(...ys)).toBeLessThanOrEqual(6);
  expect(Math.max(...ys)).toBeLessThanOrEqual(100 + 10 + 12 - 2); // 次の行の矩形に、かからない
  // 行間が狭い（2px）：ずらさない（全員、同じ高さ。行間の真ん中）
  const tight = fanOutSameRow([e('a', 300, 100, 150, 2), e('b', 450, 100, 400, 2)]);
  expect([tight.get('a')?.y, tight.get('b')?.y]).toEqual([111, 111]);
  // カードの順が、左から右の順と違うとき：カードの高さの順で、ずらす
  const rev = fanOutSameRow([e('a', 300, 100, 650, 12), e('b', 450, 100, 150, 12)]);
  expect((rev.get('b')?.y as number) < (rev.get('a')?.y as number)).toBe(true);
  expect(fanOutSameRow([])).toEqual(new Map());
});

test('fanOutSameRow：1 件だけの行は、点を強調の右端の中央に置き（from）、始点は、そこから HOOK 右・行間の高さ。中央を指す端点（ブロック）は、そのまま', () => {
  const fan = fanOutSameRow([{ tid: 's', p: { x: 500, y: 300 }, bottom: 310, gap: 5, cardY: 200 }]);
  expect(fan.get('s')).toEqual({ x: 500 + HOOK, y: 312, from: { x: 500, y: 300 } });
  // ブロック（中央を指す。bottom = y − 2・gap 8）：下げない
  const block = fanOutSameRow([{ tid: 'b', p: { x: 700, y: 400 }, bottom: 398, gap: 8, cardY: 300 }]);
  expect(block.get('b')).toEqual({ x: 700, y: 400 });
});

test('connectorPath：1 件だけの行（hook）は、点から、小さく曲がって、引き出し線の高さへ下り、水平に引き出してから、S 字に入る', () => {
  const d = connectorPath({ x: 500, y: 300 }, { x: 1010, y: 200 }, 900, { x: 510, y: 312 });
  expect(d).toBe('M500 300C505 300 505 312 510 312H900C955 312 955 200 1010 200');
  expect(d.slice(0, d.lastIndexOf('C'))).toBe('M500 300C505 300 505 312 510 312H900'); // 引き出しの部分
  const l = linkBetween('t', { x: 500, y: 300 }, { x: 1010, y: 200 }, doc, panel, false, 900, { x: 510, y: 312 });
  expect(l).toMatchObject({ lead: true, doc: { x: 500, y: 300 }, edge: false });
  expect(l?.d).toBe(d);
  // 縁へ寄せた線には、引き出しがない
  expect(
    linkBetween('t', { x: 500, y: -300 }, { x: 1010, y: 200 }, doc, panel, true, 900, { x: 510, y: 312 })?.lead,
  ).toBe(false);
});

test('sharedLeadX：記事の右端 + 余白。カードから、S 字の幅（24px）以上、離す。いちばん右の端点より、左にはしない', () => {
  expect(sharedLeadX(500, 900, 1010)).toBe(900 + LEAD_GAP);
  expect(sharedLeadX(500, 900, 920)).toBe(920 - MIN_CURVE); // カードが近い（狭い窓）
  expect(sharedLeadX(960, 900, 920)).toBe(960); // 端点が、それより右なら、端点
});

test('すべての線は、交差しない：行の違う線も、同じ行の線も（始点の順＝カードの順。共通の x まで引き出して、同じ x の範囲で S 字に入る）', () => {
  // 行：y 200（4 件・x がばらばら）・y 227（1 件・x が左）・y 254（2 件）。カードは、本文の順に、上から下へ。行の下にも、上にもまたがる
  const raw = [
    { tid: 'a', x: 300, y: 200 },
    { tid: 'b', x: 520, y: 200 },
    { tid: 'c', x: 410, y: 201 },
    { tid: 'd', x: 650, y: 200 },
    { tid: 'e', x: 330, y: 227 },
    { tid: 'f', x: 700, y: 254 },
    { tid: 'g', x: 350, y: 254 },
  ];
  const ordered = [...raw].sort((p, q) => p.y - q.y || p.x - q.x); // 本文の順
  const cardYs = [140, 180, 260, 330, 420, 560, 700];
  const ends = ordered.map((r, i) => ({
    tid: r.tid,
    p: { x: r.x, y: r.y },
    bottom: r.y + 10,
    gap: 12,
    cardY: cardYs[i] as number,
  }));
  const starts = fanOutSameRow(ends);
  const leadX = sharedLeadX(Math.max(...ends.map((e) => e.p.x)), 800, 1010);
  const polylines = ends.map((e) => {
    const l = linkBetween(e.tid, starts.get(e.tid) as Pt, { x: 1010, y: e.cardY }, doc, panel, false, leadX);
    const m = (l?.d ?? '').match(/^M(\S+) (\S+)H(\S+)C(\S+) \S+ \S+ \S+ (\S+) (\S+)$/) as RegExpMatchArray;
    const [x0, y0, xs, , bx, by] = m.slice(1).map(Number) as number[];
    const pts: Pt[] = [
      { x: x0 as number, y: y0 as number },
      { x: xs as number, y: y0 as number },
    ];
    for (let k = 1; k <= 80; k++) {
      const t = k / 80;
      pts.push({
        x: (xs as number) + ((bx as number) - (xs as number)) * t,
        y: (y0 as number) + ((by as number) - (y0 as number)) * (3 * t * t - 2 * t * t * t),
      });
    }
    return pts;
  });
  // 同じ x の範囲の S 字：x を共有する点で、上下の順が、本文の順（＝カードの順）のまま
  const crosses = (p: Pt, q: Pt, r: Pt, t: Pt) => {
    const o = (a: Pt, b: Pt, c: Pt) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    return o(p, q, r) * o(p, q, t) < 0 && o(r, t, p) * o(r, t, q) < 0;
  };
  let n = 0;
  for (let i = 0; i < polylines.length; i++)
    for (let j = i + 1; j < polylines.length; j++)
      for (let a = 0; a + 1 < (polylines[i] as Pt[]).length; a++)
        for (let b = 0; b + 1 < (polylines[j] as Pt[]).length; b++)
          if (
            crosses(
              (polylines[i] as Pt[])[a] as Pt,
              (polylines[i] as Pt[])[a + 1] as Pt,
              (polylines[j] as Pt[])[b] as Pt,
              (polylines[j] as Pt[])[b + 1] as Pt,
            )
          )
            n++;
  expect(n).toBe(0);
  // 始点の高さの順が、本文の順（＝カードの順）
  const ys = ends.map((e) => (starts.get(e.tid) as Pt).y);
  expect([...ys].sort((p, q) => p - q)).toEqual(ys);
});

test('connectorPath：水平に出て、水平に入る、S 字の cubic bezier（制御点の x は、中点）', () => {
  expect(connectorPath({ x: 100, y: 50 }, { x: 300, y: 250 })).toBe('M100 50C200 50 200 250 300 250');
  // 小数は 1 桁
  expect(connectorPath({ x: 100.123, y: 50.456 }, { x: 300, y: 250 })).toBe('M100.1 50.5C200.1 50.5 200.1 250 300 250');
  // 同じ高さは、まっすぐ（制御点も同じ高さ）
  expect(connectorPath({ x: 0, y: 5 }, { x: 10, y: 5 })).toBe('M0 5C5 5 5 5 10 5');
});

test('clipBox：本文・パネル・そのすきまの、縦は重なり。左の一覧・上のバーには出ない', () => {
  expect(clipBox(doc, edges(1010, 44, 1400, 844))).toEqual(edges(230, 44, 1400, 844));
  expect(clipBox(edges(230, 44, 1000, 700), panel)).toMatchObject({ top: 130, height: 570 });
});

test('単調性：本文の順の端点（上から下）の線は、交わらない（同じ x の端点で、y の大小が、全体で保たれる）', () => {
  const docs: Pt[] = [100, 180, 260, 340, 700].map((y) => ({ x: 600, y }));
  const cards: Pt[] = [140, 300, 330, 520, 640].map((y) => ({ x: 1010, y }));
  const ys = (d: string, t: number): number => {
    // 両端の制御点の y は端点と同じ：y(t) = y1 + (y2 - y1) * (3t² - 2t³)
    const m = d.match(/^M(\S+) (\S+)C\S+ \S+ \S+ \S+ (\S+) (\S+)$/);
    const [y1, y2] = [Number(m?.[2]), Number(m?.[4])];
    return y1 + (y2 - y1) * (3 * t * t - 2 * t * t * t);
  };
  const links = docs.map((p, i) => linkBetween(`t${i}`, p, cards[i] as Pt, doc, panel, false));
  for (let i = 0; i + 1 < links.length; i++)
    for (let k = 0; k <= 20; k++) expect(ys(links[i]?.d ?? '', k / 20)).toBeLessThan(ys(links[i + 1]?.d ?? '', k / 20));
});

test('sameFrame：同じ内容なら、同じ（state を入れ替えない）。違いは、検出する', () => {
  const frame = (): Frame => ({
    clip: doc,
    leadX: null,
    links: [{ tid: 'a', d: 'M0 0C1 1 1 1 2 2', doc: { x: 0, y: 0 }, card: null, edge: true, lead: false }],
  });
  expect(sameFrame(null, frame())).toBe(false);
  expect(sameFrame(frame(), frame())).toBe(true);
  const moved = frame();
  moved.links[0] = { tid: 'a', d: 'M0 0C1 1 1 1 2 3', doc: { x: 0, y: 0 }, card: null, edge: true, lead: false };
  expect(sameFrame(frame(), moved)).toBe(false);
  const dot = frame();
  dot.links[0] = { ...frame().links[0], doc: { x: 0, y: 1 } } as Frame['links'][number];
  expect(sameFrame(frame(), dot)).toBe(false);
  expect(sameFrame(frame(), { clip: { ...doc, top: 1 }, leadX: null, links: frame().links })).toBe(false);
  expect(sameFrame(frame(), { clip: doc, leadX: null, links: [] })).toBe(false);
  expect(sameFrame(frame(), { clip: doc, leadX: 900, links: frame().links })).toBe(false);
});
