// @vitest-environment jsdom
// 返信の中の Mermaid：図の置き場を、描く（同じソースは、使い回す）。描けなければ、説明とソース
import { waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { resetAll } from '../helpers';
import { ai, renderPanel, stubScroll, thread } from './fixtures';

const render = vi.hoisted(() =>
  vi.fn(async (_id: string, code: string) => {
    if (code.includes('BAD')) throw new Error('構文エラー');
    return { svg: `<svg data-code="${code.length}"><text>図</text></svg>` };
  }),
);
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
  expect(initialize).toHaveBeenCalledWith(expect.objectContaining({ securityLevel: 'strict', startOnLoad: false }));
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
