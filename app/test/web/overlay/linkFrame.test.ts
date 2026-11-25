// 関連の線の、共用の部品（本文・拡大表示）：端点の置き方・線の組み立て（見える範囲の中・縁へ寄せる・同じ行の引き出し・共通の x）。DOM・React に触れない純粋な関数。
import { expect, test } from 'vitest';
import { boxAt } from '../../../src/web/lib/geom';
import { EDGE_INSET, LEAD_GAP, MIN_CURVE } from '../../../src/web/overlay/connectorPath';
import { centered, composeFrame, GAP, type Row, sideEnd, unionBox } from '../../../src/web/overlay/linkFrame';

const NONE = { active: null, linked: null };
// ステージ（0,0 〜 600,800）・ドックの本体（640,40 〜 980,800）・すきま。カードの左端は 656
const STAGE = boxAt(0, 0, 600, 800);
const BODY = boxAt(640, 40, 340, 760);
const CLIP = unionBox(STAGE, boxAt(640, 0, 340, 800));
const row = (
  tid: string,
  box: { left: number; top: number; width: number; height: number },
  cardY: number,
  isComposer = false,
): Row => ({
  tid,
  isComposer,
  end: sideEnd(box, isComposer ? GAP.pending : GAP.region),
  card: { x: 656, y: cardY },
});

test('sideEnd：箱の右端の縦の中央の、少し外。引き出し線も、その高さ（中央を指す端点）', () => {
  const e = sideEnd(boxAt(100, 200, 300, 100), 4);
  expect(e.p).toEqual({ x: 404, y: 250 });
  expect(e).toEqual(centered({ x: 404, y: 250 }));
  expect(e.bottom).toBeLessThan(e.p.y);
});

test('unionBox：2 つの箱を含む最小の箱（左右に並ぶ・上下に並ぶ、どちらも）', () => {
  expect(unionBox(boxAt(0, 0, 600, 800), boxAt(640, 0, 340, 800))).toEqual(boxAt(0, 0, 980, 800));
  expect(unionBox(boxAt(0, 0, 400, 300), boxAt(0, 320, 400, 200))).toEqual(boxAt(0, 0, 400, 520));
});

test('両端が見える範囲の中：線が 1 本ずつ。本文側の丸＝端点・カード側の棒＝カードの左端。edge でない・全体は、共通の x から S 字', () => {
  const rows = [row('a', boxAt(100, 100, 200, 60), 120), row('b', boxAt(100, 300, 200, 60), 300)];
  const f = composeFrame(rows, CLIP, STAGE, BODY, NONE, 600);
  expect(f.links.map((l) => l.tid)).toEqual(['a', 'b']);
  expect(f.links[0]?.doc).toEqual({ x: 304, y: 130 }); // 右端 300 + 4・中央 130
  expect(f.links[0]?.card).toEqual({ x: 656, y: 120 });
  expect(f.links.every((l) => !l.edge && l.lead)).toBe(true);
  // 共通の x：ステージの右端 + LEAD_GAP を、カードから MIN_CURVE 以上離す。いちばん右の端点（304）より、左にはしない
  expect(f.leadX).toBe(Math.max(304, Math.min(600 + LEAD_GAP, 656 - MIN_CURVE)));
  expect(f.clip).toEqual(CLIP);
});

test('本文側の端点が、見える範囲の外：選んでいない線は、引かない。選んでいる（active）・光らせている（linked）・入力中の線だけ、縁の内側に止めて引く（丸なし）', () => {
  const below = boxAt(100, 900, 200, 60); // ステージの下の外
  const rows = [row('a', boxAt(100, 100, 200, 60), 120), row('far', below, 300), row('pend', below, 400, true)];
  const plain = composeFrame(rows, CLIP, STAGE, BODY, NONE, 600);
  expect(plain.links.map((l) => l.tid)).toEqual(['a', 'pend']); // 入力中は、いつも
  const active = composeFrame(rows, CLIP, STAGE, BODY, { active: 'far', linked: null }, 600);
  expect(active.links.map((l) => l.tid)).toEqual(['a', 'far', 'pend']);
  const far = active.links.find((l) => l.tid === 'far');
  expect(far?.edge).toBe(true);
  expect(far?.doc).toBeNull(); // 縁へ寄せた端は、丸を出さない
  const linked = composeFrame(rows, CLIP, STAGE, BODY, { active: null, linked: 'far' }, 600);
  expect(linked.links.map((l) => l.tid)).toEqual(['a', 'far', 'pend']);
  // 縁の内側に止める（縁そのものに止めない）
  expect(far?.d).toContain(`${600 - 10} ${800 - EDGE_INSET}`);
});

test('両端が、同じ側の外（ともに下）：選んでいても、引かない。カードが、ドックの見える範囲の外（スクロールで隠れた）なら、同じ', () => {
  const rows = [{ ...row('x', boxAt(100, 900, 200, 60), 900), card: { x: 656, y: 900 } }];
  expect(composeFrame(rows, CLIP, STAGE, BODY, { active: 'x', linked: null }, 600).links).toEqual([]);
  // カードだけが、上の外（ドックの見出しの下に隠れた）・端点は、中：選んでいなければ、引かない
  const hidden = [{ ...row('y', boxAt(100, 400, 200, 60), 10) }];
  expect(composeFrame(hidden, CLIP, STAGE, BODY, NONE, 600).links).toEqual([]);
  expect(composeFrame(hidden, CLIP, STAGE, BODY, { active: 'y', linked: null }, 600).links).toHaveLength(1);
});

test('同じ高さの端点が、複数：始点を、カードの順に、少しずつずらす（交差しない）。同じ x の範囲で、S 字に入る', () => {
  // 3 つの枠が、同じ高さ（中央 130）に並ぶ。カードの順は、c・a・b（上から）
  const rows = [
    row('a', boxAt(100, 100, 80, 60), 300),
    row('b', boxAt(300, 100, 80, 60), 500),
    row('c', boxAt(450, 100, 80, 60), 120),
  ];
  const f = composeFrame(rows, CLIP, STAGE, BODY, NONE, 600);
  expect(f.links).toHaveLength(3);
  const startY = (tid: string) => Number((f.links.find((l) => l.tid === tid)?.d.match(/^M[\d.-]+ ([\d.-]+)/) ?? [])[1]);
  expect(startY('c')).toBeLessThan(startY('a'));
  expect(startY('a')).toBeLessThan(startY('b'));
  // どの線も、同じ x（共通の x）から S 字に入る：最後の C の、始点の x が、leadX
  const bend = (tid: string) => (f.links.find((l) => l.tid === tid)?.d.match(/H([\d.-]+)C/) ?? [])[1];
  expect(new Set(['a', 'b', 'c'].map(bend)).size).toBe(1);
});

test('線が 0 本（行がない・すべてが範囲の外）：leadX は null・clip は、そのまま', () => {
  const f = composeFrame([], CLIP, STAGE, BODY, NONE, 600);
  expect(f).toEqual({ clip: CLIP, leadX: null, links: [] });
});
