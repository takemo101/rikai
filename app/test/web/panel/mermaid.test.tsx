// @vitest-environment jsdom
// 返信の中の Mermaid：図の置き場を、描く（同じソースは、使い回す）。描けなければ、説明とソース
import { waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { fillMermaid } from '../../../src/web/doc/render';
import { svgCacheKey } from '../../../src/web/doc/render/mermaid';
import { applyTheme } from '../../../src/web/lib/theme';
import { resetAll } from '../helpers';
import { ai, renderPanel, stubScroll, thread } from './fixtures';

const defaultRender = vi.hoisted(() => async (_id: string, code: string) => {
  if (code.includes('BAD')) throw new Error('構文エラー');
  return { svg: `<svg data-code="${code.length}"><text>図</text></svg>` };
});
const render = vi.hoisted(() => vi.fn(defaultRender));
const initialize = vi.hoisted(() => vi.fn());
vi.mock('mermaid', () => ({ default: { initialize, render } }));

beforeEach(() => {
  resetAll();
  stubScroll();
  render.mockClear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

const q = (sel: string, root: ParentNode = document) => root.querySelector<HTMLElement>(sel);

test('Mermaid：図が描かれる（strict で初期化）。描けない図は、説明とソース（.mermaid-error）', async () => {
  renderPanel([
    thread({
      id: 't1',
      messages: [ai('```mermaid\ngraph TD\n  A-->B\n```\n\n```mermaid\nBAD <script>alert(1)</script>\n```')],
    }),
  ]);
  const blocks = [...document.querySelectorAll<HTMLElement>('.msg.ai .mermaid-block')];
  expect(blocks).toHaveLength(2);
  await waitFor(() => expect(q('svg', blocks[0] as HTMLElement)).not.toBeNull());
  await waitFor(() => expect(blocks[1]).toHaveClass('mermaid-error'));
  expect(q('.mm-err', blocks[1] as HTMLElement)?.textContent).toBe('図を描画できませんでした');
  const pre = q('pre', blocks[1] as HTMLElement) as HTMLElement;
  expect(pre.textContent).toBe('BAD <script>alert(1)</script>'); // ソースは、文字として
  expect(pre.querySelector('script')).toBeNull();
  expect(initialize).toHaveBeenCalledWith(
    expect.objectContaining({ securityLevel: 'strict', startOnLoad: false, theme: 'neutral' }), // ライトは、neutral
  );
});

test('同じ図は、描き直さない（描いた図を、使い回す）', async () => {
  const md = '```mermaid\ngraph LR\n  X-->Y\n```';
  renderPanel([thread({ id: 't1', messages: [ai(md, { id: 'a1' })] })]);
  await waitFor(() => expect(document.querySelectorAll('.mermaid-block svg')).toHaveLength(1));
  expect(render).toHaveBeenCalledTimes(1);
  document.body.replaceChildren();
  renderPanel([thread({ id: 't1', messages: [ai(md, { id: 'a2' })] })]);
  await waitFor(() => expect(document.querySelectorAll('.mermaid-block svg')).toHaveLength(1));
  expect(render).toHaveBeenCalledTimes(1);
});

test('外観：ダークでは、dark の配色で描く。外観が変わったら、描き直す（図のキャッシュは、外観ごと）。strict は、そのまま', async () => {
  const md = '```mermaid\ngraph LR\n  P-->Q\n```';
  const root = document.documentElement;
  root.removeAttribute('data-theme');
  renderPanel([thread({ id: 't1', messages: [ai(md, { id: 'a1' })] })]);
  await waitFor(() => expect(document.querySelectorAll('.mermaid-block svg')).toHaveLength(1));
  const light = render.mock.calls.length;
  // ダークに：同じ図を、描き直す
  root.setAttribute('data-theme', 'dark');
  await fillMermaid(document);
  expect(render.mock.calls.length).toBe(light + 1);
  expect(initialize).toHaveBeenLastCalledWith(expect.objectContaining({ theme: 'dark', securityLevel: 'strict' }));
  // もう一度、ダークで：キャッシュ（描き直さない）。ライトに戻しても、ライトの図は、キャッシュにある
  await fillMermaid(document);
  root.setAttribute('data-theme', 'light');
  await fillMermaid(document);
  expect(render.mock.calls.length).toBe(light + 1);
  root.removeAttribute('data-theme');
});

test('図のキャッシュのキーに、外観を含める', () => {
  expect(svgCacheKey('light', 'graph')).not.toBe(svgCacheKey('dark', 'graph'));
  expect(svgCacheKey('dark', 'graph')).toBe(svgCacheKey('dark', 'graph'));
});

test('描画は、1 つずつ（並べて走らせない）：毎回、その図の外観で initialize してから render する。描いている間に外観が変わった図は、キャッシュに入れない', async () => {
  let current = '';
  initialize.mockImplementation((c: { theme: string }) => {
    current = c.theme;
  });
  let inflight = 0;
  let max = 0;
  const seen: string[] = [];
  render.mockImplementation(async (_id: string, code: string) => {
    inflight++;
    max = Math.max(max, inflight);
    seen.push(`${current}:${code}`);
    await new Promise((r) => setTimeout(r, 5));
    inflight--;
    return { svg: `<svg><text>${current}</text></svg>` };
  });
  try {
    const box = document.createElement('div');
    for (const n of [1, 2, 3]) {
      const el = document.createElement('div');
      el.className = 'mermaid-block';
      el.dataset.mermaid = encodeURIComponent(`graph LR\n  Q${n}-->R${n}`);
      box.append(el);
    }
    document.body.append(box);
    applyTheme('light', document.documentElement);
    const light = fillMermaid(box); // 描画待ちの図がある間に、外観を変える
    applyTheme('dark', document.documentElement);
    const dark = fillMermaid(box);
    await Promise.all([light, dark]);
    expect(max, '同時に描かない').toBe(1);
    // 順番待ちの図が、あとから付けた外観で描かれない：どの描画も、その図の外観で、初期化されている
    expect(seen.filter((x) => x.startsWith('neutral:'))).toHaveLength(3);
    expect(seen.filter((x) => x.startsWith('dark:'))).toHaveLength(3);
    expect(seen.slice(0, 3).every((x) => x.startsWith('neutral:'))).toBe(true);
    // 画面には、いまの外観（ダーク）の図
    expect([...box.querySelectorAll('svg text')].map((t) => t.textContent)).toEqual(['dark', 'dark', 'dark']);
    // ライトの図は、ダークの間に描き終えた：キャッシュに入れていない（ライトに戻したら、ライトで描き直す）
    render.mockClear();
    seen.length = 0;
    applyTheme('light', document.documentElement);
    await fillMermaid(box);
    expect(seen.every((x) => x.startsWith('neutral:'))).toBe(true);
    expect(seen).toHaveLength(3);
    expect([...box.querySelectorAll('svg text')].map((t) => t.textContent)).toEqual(['neutral', 'neutral', 'neutral']);
  } finally {
    render.mockImplementation(defaultRender);
    initialize.mockReset();
    applyTheme('system', document.documentElement);
  }
});

test('ダークの図は、円グラフ・光る縁を直す themeVariables つき。ライトは、組み込みの neutral のまま（変数なし）', async () => {
  const box = document.createElement('div');
  const el = document.createElement('div');
  el.className = 'mermaid-block';
  el.dataset.mermaid = encodeURIComponent('pie\n  "a": 1');
  box.append(el);
  document.body.append(box);
  initialize.mockClear();
  applyTheme('dark', document.documentElement);
  try {
    await fillMermaid(box);
    const cfg = initialize.mock.calls.at(-1)?.[0] as {
      theme: string;
      securityLevel: string;
      themeVariables?: Record<string, string>;
    };
    expect(cfg.theme).toBe('dark');
    expect(cfg.securityLevel).toBe('strict');
    expect(cfg.themeVariables?.dropShadow).toBe('none');
    for (const k of [
      'pie1',
      'pie12',
      'pieStrokeColor',
      'pieOuterStrokeColor',
      'pieTitleTextColor',
      'pieLegendTextColor',
    ])
      expect(cfg.themeVariables?.[k], k).toBeTruthy();
    // ライト
    applyTheme('light', document.documentElement);
    el.dataset.mermaid = encodeURIComponent('pie\n  "b": 2');
    await fillMermaid(box);
    const light = initialize.mock.calls.at(-1)?.[0] as { theme: string; themeVariables?: unknown };
    expect(light.theme).toBe('neutral');
    expect(light.themeVariables).toBeUndefined();
  } finally {
    applyTheme('system', document.documentElement);
  }
});
