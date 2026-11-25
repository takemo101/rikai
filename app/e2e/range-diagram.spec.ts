// 図（draw.io・Mermaid）の範囲：ノードを、本物のドラッグで、ちょうど囲む → 本文・再読み込み・窓幅・ダーク・拡大表示（ズーム・移動）・版の切り替えで、枠が、そのノードを囲む（誤差 2px 以内）。
// 基準は、作るときも、見せるときも、描かれた図の svg（`frameOf`）。ノードの座標は、svg 要素の `getBoundingClientRect` から取る
import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, type RikaiApp, test } from './fixtures';
import { dragBox, fillAndAdd, settled, ui } from './ui';

const BT = '```';
// ホテル予約のスイムレーン：参照資料（例 3）の drawio を、そのまま使う
const REF = fs.readFileSync(path.resolve(import.meta.dirname, '../../skills/rikai/references/drawio.md'), 'utf8');
const DIO = /## 例 3[\s\S]*?```drawio\n([\s\S]*?)```/.exec(REF)?.[1] ?? '';
const DOC = `# 図の範囲\n\n前の段落です。\n\n${BT}drawio\n${DIO}${BT}\n\n${BT}mermaid\nflowchart LR\n  A[受け取る] --> B{確認}\n  B -- はい --> C[保存]\n  B -- いいえ --> D[差し戻す]\n  C --> E[通知]\n  D --> A\n${BT}\n\n後の段落です。\n`;

interface Node {
  kind: 'drawio' | 'mermaid';
  label: string;
  nth?: number;
}
const NODES: Node[] = [
  { kind: 'drawio', label: 'お客様' }, // レーンの見出し
  { kind: 'drawio', label: 'お客様の' },
  { kind: 'drawio', label: '空室が' },
  { kind: 'drawio', label: '予約記録を', nth: 0 },
  { kind: 'drawio', label: '予約記録を', nth: 1 },
  { kind: 'mermaid', label: '受け取る' },
  { kind: 'mermaid', label: '確認' },
  { kind: 'mermaid', label: '通知' },
];

type R = { x: number; y: number; w: number; h: number };

// ノード（図形）の矩形（画面）。`root`：本文のブロック（`#article .drawio-block`）か、拡大表示のステージ（`#lightbox .lb-stage`）
const nodeRect = (page: Page, root: string, n: Node): Promise<R | null> =>
  page.evaluate(
    ([root, n]) => {
      const el = document.querySelector(root as string);
      if (!el) return null;
      const node = n as Node;
      let shape: Element | null = null;
      let k = 0;
      if (node.kind === 'drawio') {
        for (const t of el.querySelectorAll('svg text')) {
          if ((t.textContent ?? '').trim() !== node.label) continue;
          if (k++ < (node.nth ?? 0)) continue;
          const g = t.closest('g')?.parentElement; // ノードの g
          const rects = g ? [...g.children].filter((c) => /^(rect|polygon|path|ellipse)$/.test(c.localName)) : [];
          shape = node.label === 'お客様' ? (rects[1] ?? null) : (rects[0] ?? null); // レーンは、見出しの帯（2 つ目）
          break;
        }
      } else {
        for (const d of el.querySelectorAll('svg g.node')) {
          if ((d.textContent ?? '').trim() !== node.label) continue;
          shape = d.querySelector('rect, polygon, path');
          break;
        }
      }
      if (!shape) return null;
      const r = shape.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    },
    [root, node(n)] as const,
  );
const node = (n: Node): Node => n;

const SEL = { drawio: '#article .drawio-block', mermaid: '#article .mermaid-block' } as const;

const regionRects = (page: Page): Promise<Record<string, R>> =>
  page.evaluate(() => {
    const out: Record<string, R> = {};
    for (const e of document.querySelectorAll('#badges .regionbox:not(.pending)')) {
      const r = e.getBoundingClientRect();
      out[(e as HTMLElement).dataset.tid ?? ''] = { x: r.x, y: r.y, w: r.width, h: r.height };
    }
    return out;
  });

const diff = (a: R, b: R): number =>
  Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.w - b.w), Math.abs(a.h - b.h));
const fmt = (a: R | null | undefined): string =>
  a ? `[${[a.x, a.y, a.w, a.h].map((v) => v.toFixed(0)).join(',')}]` : 'null';

async function setup(page: Page, app: RikaiApp) {
  await page.setViewportSize({ width: 1365, height: 1000 });
  await app.switchTopic(page, 'dg', '図の範囲', DOC);
  await expect(page.locator('#article .drawio-block svg')).toHaveCount(1);
  await expect(page.locator('#article .mermaid-block svg')).toHaveCount(1);
  await page.waitForTimeout(800);
}

test('図のノードを、本文でドラッグして囲む：作った直後・再読み込み（窓幅 1365・1100・760）・ダーク・版を切り替えても、枠が、ノードを囲む', async ({
  page,
  app,
}) => {
  await setup(page, app);
  expect(DIO).toContain('mxGraphModel');
  const u = ui(page);
  const made: { n: Node; tid: string; at: R }[] = [];
  for (const n of NODES) {
    await page.locator(`${SEL[n.kind]} svg`).evaluate((e) => e.scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(300);
    const r = await nodeRect(page, SEL[n.kind], n);
    if (!r) throw new Error(`node ${n.label}`);
    // ノードが、画面に収まるように、スクロール
    await page.evaluate((y) => (document.querySelector('#docscroll') as HTMLElement).scrollBy(0, y), r.y - 200);
    await page.waitForTimeout(300);
    const rr = (await nodeRect(page, SEL[n.kind], n)) as R;
    const before = new Set(Object.keys(await regionRects(page)));
    await u.regbtn.click();
    await dragBox(page, { x: rr.x, y: rr.y }, { x: rr.x + rr.w, y: rr.y + rr.h });
    await expect(u.composer).toBeVisible();
    await settled(page);
    await fillAndAdd(page, `${n.kind}:${n.label}:${n.nth ?? 0}`);
    await page.waitForTimeout(500);
    const after = await regionRects(page);
    const tid = Object.keys(after).find((k) => !before.has(k)) ?? '';
    const now = (await nodeRect(page, SEL[n.kind], n)) as R;
    made.push({ n, tid, at: after[tid] as R });
    expect(after[tid], `作った直後 ${n.label}`).toBeTruthy();
    expect(
      diff(after[tid] as R, now),
      `作った直後 ${n.label} 枠 ${fmt(after[tid])} ノード ${fmt(now)}`,
    ).toBeLessThanOrEqual(2);
  }
  // 再読み込み
  for (const w of [1365, 1100, 760]) {
    await page.setViewportSize({ width: w, height: 1000 });
    await page.reload();
    await expect(page.locator('#article .drawio-block svg')).toHaveCount(1);
    await page.waitForTimeout(1200);
    const rects = await regionRects(page);
    for (const m of made) {
      const now = await nodeRect(page, SEL[m.n.kind], m.n);
      const b = rects[m.tid];
      expect(b && now, `再読み込み w=${w} ${m.n.label}`).toBeTruthy();
      expect(
        diff(b as R, now as R),
        `再読み込み w=${w} ${m.n.label} 枠 ${fmt(b)} ノード ${fmt(now)}`,
      ).toBeLessThanOrEqual(2);
    }
  }
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.setViewportSize({ width: 1365, height: 1000 });
  await page.reload();
  await page.waitForTimeout(1500);
  {
    const rects = await regionRects(page);
    for (const m of made) {
      const now = await nodeRect(page, SEL[m.n.kind], m.n);
      const b = rects[m.tid];
      expect(b && now, `ダーク ${m.n.label}`).toBeTruthy();
      expect(diff(b as R, now as R), `ダーク ${m.n.label}`).toBeLessThanOrEqual(2);
    }
  }
  // 新しい版（変更を重ねる）・過去の版
  const near = async (name: string) => {
    await page.waitForTimeout(1200);
    for (const m of made) {
      await page.locator(`${SEL[m.n.kind]} svg`).evaluate((e) => e.scrollIntoView({ block: 'center' }));
      const now = await nodeRect(page, SEL[m.n.kind], m.n);
      const b = (await regionRects(page))[m.tid];
      expect(b && now, `${name} ${m.n.label}`).toBeTruthy();
      expect(diff(b as R, now as R), `${name} ${m.n.label}`).toBeLessThanOrEqual(2);
    }
  };
  await app.apply(
    { revisions: [{ page: 'root', markdown: DOC.replace('前の段落です。', '前の段落です。直しました。') }] },
    { topic: 'dg' },
  );
  await expect(page.locator('#docbar select option')).toHaveCount(2);
  await near('v2');
  await page.locator('.modeseg button', { hasText: '変更を重ねる' }).click();
  await near('v2 変更を重ねる');
  await page.locator('.modeseg button', { hasText: '通常' }).click();
  await page.locator('#docbar select').selectOption('1');
  await near('v1');
});

const lb = (page: Page) => page.locator('#lightbox');
const lbRects = (page: Page): Promise<Record<string, R>> =>
  page.evaluate(() => {
    const out: Record<string, R> = {};
    for (const e of document.querySelectorAll('#lightbox .fv-box:not(.pending)')) {
      const r = e.getBoundingClientRect();
      out[(e as HTMLElement).dataset.tid ?? ''] = { x: r.x, y: r.y, w: r.width, h: r.height };
    }
    return out;
  });

test('図のノードを、拡大表示（全体・ズームと移動）でドラッグして囲む：拡大表示でも、本文でも、枠が、ノードを囲む', async ({
  page,
  app,
}) => {
  test.setTimeout(120_000); // 図のノードごとに、拡大表示を開き直す：1 本で約 30 秒（負荷で、既定の 60 秒を超えうる）
  await setup(page, app);
  const made: { n: Node; tid: string }[] = [];
  const poses: { name: string; keys: string[]; pan?: [number, number] }[] = [
    { name: 'fit', keys: [] },
    { name: 'zoom', keys: ['+', '+'], pan: [-60, -40] },
  ];
  const stageRoot = '#lightbox .lb-stage';
  for (const kind of ['drawio', 'mermaid'] as const) {
    const nodes = NODES.filter((n) => n.kind === kind);
    for (const pose of poses) {
      for (const n of nodes) {
        await page.locator(`${SEL[kind]} svg`).evaluate((e) => e.scrollIntoView({ block: 'center' }));
        await page.waitForTimeout(300);
        await page.locator(`${SEL[kind]} svg`).click({ position: { x: 3, y: 3 } });
        await expect(lb(page)).toBeVisible();
        await page.waitForTimeout(600);
        for (const k of pose.keys) await page.keyboard.press(k);
        if (pose.pan) {
          const sb = (await page.locator('#lightbox .lb-view').boundingBox()) as {
            x: number;
            y: number;
            width: number;
            height: number;
          };
          await dragBox(
            page,
            { x: sb.x + sb.width / 2, y: sb.y + sb.height / 2 },
            { x: sb.x + sb.width / 2 + pose.pan[0], y: sb.y + sb.height / 2 + pose.pan[1] },
          );
          await page.waitForTimeout(200);
        }
        const rr = await nodeRect(page, stageRoot, n);
        if (!rr) throw new Error(`stage node ${n.label}`);
        const vb = (await page.locator('#lightbox .lb-view').boundingBox()) as {
          x: number;
          y: number;
          width: number;
          height: number;
        };
        // 画面外なら、選べない（ズームの姿勢では、見える所だけ）
        const visible =
          rr.x >= vb.x && rr.y >= vb.y && rr.x + rr.w <= vb.x + vb.width && rr.y + rr.h <= vb.y + vb.height;
        if (!visible) {
          await page.keyboard.press('Escape');
          continue;
        }
        const before = new Set(Object.keys(await lbRects(page)));
        await page.locator('#lightbox .fv-tools [data-tool="region"]').click();
        await dragBox(page, { x: rr.x, y: rr.y }, { x: rr.x + rr.w, y: rr.y + rr.h });
        const comp = page.locator('#lightbox .fv-dock .thread.composer');
        await expect(comp).toBeVisible();
        await expect(comp).not.toContainText('アップロード中');
        await comp.locator('textarea').fill(`lb:${pose.name}:${n.label}:${n.nth ?? 0}`);
        await comp.getByRole('button', { name: 'コメントを追加' }).click();
        await expect(comp).toHaveCount(0);
        await page.waitForTimeout(500);
        const after = await lbRects(page);
        const tid = Object.keys(after).find((k) => !before.has(k)) ?? '';
        const now = (await nodeRect(page, stageRoot, n)) as R;
        expect(after[tid], `拡大表示 ${pose.name} ${n.label}`).toBeTruthy();
        expect(
          diff(after[tid] as R, now),
          `拡大表示 ${pose.name} ${n.label} 枠 ${fmt(after[tid])} ノード ${fmt(now)}`,
        ).toBeLessThanOrEqual(2);
        made.push({ n, tid });
        await page.keyboard.press('Escape');
        await expect(lb(page)).toBeHidden();
      }
    }
  }
  // 本文で
  await page.waitForTimeout(800);
  for (const m of made) {
    await page.locator(`${SEL[m.n.kind]} svg`).evaluate((e) => e.scrollIntoView({ block: 'center' }));
    const now = await nodeRect(page, SEL[m.n.kind], m.n);
    const b = (await regionRects(page))[m.tid];
    expect(b && now, `拡大 → 本文 ${m.n.label}`).toBeTruthy();
    expect(diff(b as R, now as R), `拡大 → 本文 ${m.n.label} 枠 ${fmt(b)} ノード ${fmt(now)}`).toBeLessThanOrEqual(2);
  }
});
