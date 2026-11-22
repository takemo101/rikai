// 関連の線の幾何：端点を見える範囲へ寄せる・同じ側の外は引かない・パスの形・クリップの箱・本文の順の線が、交わらない。
import { expect, test } from 'vitest';
import {
  type Box,
  clampTo,
  clipBox,
  connectorPath,
  EDGE_INSET,
  endOfLastLine,
  type Frame,
  linkBetween,
  type Pt,
  rightMiddle,
  STUB,
  sameFrame,
  sideOf,
} from '../../../src/web/overlay/connectorPath';

const doc: Box = { left: 230, top: 44, right: 1000, bottom: 844 };
const panel: Box = { left: 1010, top: 130, right: 1400, bottom: 844 }; // 130 までは、固定の見出し

test('rightMiddle：箱の右端の縦の中央', () => {
  expect(rightMiddle({ left: 10, top: 20, right: 110, bottom: 60 })).toEqual({ x: 110, y: 40 });
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
  expect(l?.d.startsWith(`M${doc.right - STUB} ${doc.top + EDGE_INSET}C`)).toBe(true);
  // 下の外
  const b = linkBetween('t1', { x: 300, y: 3000 }, { x: 1010, y: 300 }, doc, panel, true);
  expect(b?.d.startsWith(`M${doc.right - STUB} ${doc.bottom - EDGE_INSET}C`)).toBe(true);
});

test('linkBetween：選んでいる線で、カードの端が外：パネルの縁の内側に止める。棒は出さない', () => {
  const below = linkBetween('t1', { x: 600, y: 300 }, { x: 1010, y: 5000 }, doc, panel, true);
  expect(below?.card).toBeNull();
  expect(below?.doc).toEqual({ x: 600, y: 300 });
  expect(below?.d.endsWith(` 1010 ${panel.bottom - EDGE_INSET}`)).toBe(true);
  const above = linkBetween('t1', { x: 600, y: 300 }, { x: 1010, y: 100 }, doc, panel, true);
  expect(above?.d.endsWith(` 1010 ${panel.top + EDGE_INSET}`)).toBe(true);
});

test('linkBetween：両方が同じ側の外（ともに上・ともに下）なら、選んでいても、引かない', () => {
  expect(linkBetween('t', { x: 600, y: 0 }, { x: 1010, y: 0 }, doc, panel, true)).toBeNull();
  expect(linkBetween('t', { x: 600, y: 2000 }, { x: 1010, y: 3000 }, doc, panel, true)).toBeNull();
});

test('endOfLastLine：複数行の強調は、最後の行の右端の縦の中央（先頭の矩形ではない）。矩形の順に、よらない', () => {
  const lines: Box[] = [
    { left: 300, top: 100, right: 900, bottom: 120 }, // 1 行目（いちばん右まで）
    { left: 230, top: 120, right: 900, bottom: 140 },
    { left: 230, top: 140, right: 420, bottom: 160 }, // 最後の行（短い）
  ];
  expect(endOfLastLine(lines)).toEqual({ x: 420, y: 150 });
  expect(endOfLastLine([...lines].reverse())).toEqual({ x: 420, y: 150 });
  // 最後の行が、複数の矩形（太字などで分かれた）に分かれていても、その行の、いちばん右
  expect(endOfLastLine([...lines, { left: 420, top: 140, right: 505, bottom: 160 }])).toEqual({ x: 505, y: 150 });
  expect(endOfLastLine([])).toBeNull();
});

test('connectorPath：水平に出て、水平に入る、S 字の cubic bezier（制御点の x は、中点）', () => {
  expect(connectorPath({ x: 100, y: 50 }, { x: 300, y: 250 })).toBe('M100 50C200 50 200 250 300 250');
  // 小数は 1 桁
  expect(connectorPath({ x: 100.123, y: 50.456 }, { x: 300, y: 250 })).toBe('M100.1 50.5C200.1 50.5 200.1 250 300 250');
  // 同じ高さは、まっすぐ（制御点も同じ高さ）
  expect(connectorPath({ x: 0, y: 5 }, { x: 10, y: 5 })).toBe('M0 5C5 5 5 5 10 5');
});

test('clipBox：本文・パネル・そのすきまの、縦は重なり。左の一覧・上のバーには出ない', () => {
  expect(clipBox(doc, { ...panel, top: 44 })).toEqual({ left: 230, top: 44, right: 1400, bottom: 844 });
  expect(clipBox({ ...doc, bottom: 700 }, panel)).toMatchObject({ top: 130, bottom: 700 });
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
    links: [{ tid: 'a', d: 'M0 0C1 1 1 1 2 2', doc: { x: 0, y: 0 }, card: null, edge: true }],
  });
  expect(sameFrame(null, frame())).toBe(false);
  expect(sameFrame(frame(), frame())).toBe(true);
  const moved = frame();
  moved.links[0] = { tid: 'a', d: 'M0 0C1 1 1 1 2 3', doc: { x: 0, y: 0 }, card: null, edge: true };
  expect(sameFrame(frame(), moved)).toBe(false);
  const dot = frame();
  dot.links[0] = { ...frame().links[0], doc: { x: 0, y: 1 } } as Frame['links'][number];
  expect(sameFrame(frame(), dot)).toBe(false);
  expect(sameFrame(frame(), { clip: { ...doc, top: 1 }, links: frame().links })).toBe(false);
  expect(sameFrame(frame(), { clip: doc, links: [] })).toBe(false);
});
