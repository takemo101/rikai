// @vitest-environment jsdom
// 本文・返信の画像と図の拡大表示（F37）：押すと、拡大表示（`#lightbox`）に出る（図は、id を付け替えた複製）。本文の DOM は、変わらない。添付の画像も、同じ拡大表示（見るだけ）。
// 文字を選ぶドラッグ・選択範囲・範囲を選ぶ最中・リンクの中・外部画像・html-app は、開かない。ズーム・移動・閉じる・フォーカス。
import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { topicKey } from '../../../src/web/api/queries';
import { queryClient } from '../../../src/web/api/queryClient';
import { Article } from '../../../src/web/doc/Article';
import { ZoomModal } from '../../../src/web/focus/ZoomModal';
import { zoomableAt } from '../../../src/web/focus/zoomOpen';
import { buildView } from '../../../src/web/lib/view';
import { useUi } from '../../../src/web/store/ui';
import { installPointerCapture, meta, mockFetch, renderWithClient, resetAll, topicState } from '../helpers';
import { ai, renderPanel, stubScroll, thread } from '../panel/fixtures';

const MERMAID_SVG =
  '<svg id="mmd1" viewBox="0 0 1000 500" width="100%" style="max-width: 1000px"><style>#mmd1 .n { fill: url(#mmd1_g); }</style><defs><marker id="mmd1_m" markerWidth="8" markerHeight="8"/><linearGradient id="mmd1_g"/></defs><path class="n" marker-end="url(#mmd1_m)" d="M0,0 L9,9"/></svg>';
vi.mock('mermaid', () => ({
  default: { initialize: () => {}, render: async () => ({ svg: MERMAID_SVG }) },
}));

beforeAll(installPointerCapture);
beforeEach(() => {
  resetAll();
  stubScroll();
  Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 768, configurable: true });
});
afterEach(() => {
  getSelection()?.removeAllRanges();
  document.body.replaceChildren();
});

const MD = [
  '# 題',
  '',
  '文章の段落です。',
  '',
  '![図](assets/fig.png)',
  '',
  '![外部](https://example.invalid/x.png)',
  '',
  '[![リンクの画像](assets/link.png)](https://example.invalid/page)',
  '',
  '```mermaid',
  'graph LR',
  '  A-->B',
  '```',
  '',
  '<svg id="in1" viewBox="0 0 100 50"><defs><marker id="mk" markerWidth="4" markerHeight="4"></marker></defs><path marker-end="url(#mk)" d="M0,0 L10,10"></path></svg>',
  '',
].join('\n');

function mountArticle() {
  const topic = topicState({
    threads: [],
    meta: meta({ pages: { root: { title: 'T', parent: null, versions: 1, createdAt: '' } } }),
  });
  const view = buildView({ slug: 'demo', page: 'root', version: 1 }, topic);
  if (!view) throw new Error('view');
  // 拡大表示（F43）の右のドックは、トピックを TanStack Query から読む（ルート・取得済みのトピック）。ここでは、作り物のものを、置く
  mockFetch((req) => (req.path === '/api/topic/demo' ? { body: topic } : undefined));
  queryClient.setQueryData(topicKey('demo'), topic);
  location.hash = '#/demo/root';
  renderWithClient(
    <>
      <div id="docscroll">
        <Article view={view} markdown={MD} prevMarkdown={null} />
      </div>
      <ZoomModal />
    </>,
  );
  return { art: document.getElementById('article') as HTMLElement };
}
const settle = () => act(async () => {});
const q = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) =>
  root.querySelector(sel) as T | null;
const lb = () => q('#lightbox') as HTMLElement;
/** 押す：mousedown（位置を控える）→ click */
const press = (el: Element, at = { clientX: 10, clientY: 10 }, upAt = at) => {
  fireEvent.mouseDown(el, at);
  return fireEvent.click(el, upAt);
};
const pct = () => Number.parseInt(q('.lb-pct')?.textContent ?? '0', 10);
const close = () => act(() => useUi.getState().closeLightbox());

test('本文の画像を押す：拡大表示に出る。role="dialog"・aria-modal・名前。Esc で閉じる', async () => {
  const { art } = mountArticle();
  await settle();
  const img = q<HTMLImageElement>('img[alt="図"]', art) as HTMLImageElement;
  expect(lb().hidden).toBe(true);
  press(img);
  expect(lb().hidden).toBe(false);
  expect(useUi.getState().lightbox).toMatchObject({ kind: 'img', focus: { base: true } });
  expect(q<HTMLImageElement>('.lb-stage img')?.getAttribute('src')).toContain('/asset/demo/fig.png'); // 画像の src（絶対 URL）
  expect(lb().getAttribute('role')).toBe('dialog');
  expect(lb().getAttribute('aria-modal')).toBe('true');
  expect(lb().getAttribute('aria-label')).toBe('図');
  expect(document.activeElement).toBe(lb());
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(lb().hidden).toBe(true);
});

test('Mermaid の図を押す：複製が出る。id は付け替え済み（元と重ならない）。元の図は、変わらない', async () => {
  const { art } = mountArticle();
  await settle();
  const orig = q<SVGSVGElement>('.mermaid-block svg', art) as SVGSVGElement;
  expect(orig.id).toBe('mmd1');
  const before = orig.outerHTML;
  press(orig);
  const clone = q<SVGSVGElement>('.lb-stage svg') as SVGSVGElement;
  expect(clone).not.toBeNull();
  expect(clone).not.toBe(orig);
  expect(clone.id).toBe('zoom-mmd1');
  expect(clone.querySelector('path')?.getAttribute('marker-end')).toBe('url(#zoom-mmd1_m)');
  expect(clone.querySelector('style')?.textContent).toContain('#zoom-mmd1 .n { fill: url(#zoom-mmd1_g); }');
  expect(orig.outerHTML).toBe(before);
  const ids = [...document.querySelectorAll('[id]')].map((e) => e.id);
  expect(new Set(ids).size).toBe(ids.length); // 文書の中で、id が、重ならない
  expect(clone.getAttribute('width')).toBe('1000'); // 自然な大きさ（viewBox）
});

test('インラインの svg を押す：複製（defs の id も付け替え）', async () => {
  const { art } = mountArticle();
  await settle();
  press(q<SVGSVGElement>('#in1', art) as SVGSVGElement);
  const clone = q<SVGSVGElement>('.lb-stage svg') as SVGSVGElement;
  expect(clone.id).toBe('zoom-in1');
  expect(clone.querySelector('marker')?.id).toBe('zoom-mk');
  expect(clone.querySelector('path')?.getAttribute('marker-end')).toBe('url(#zoom-mk)');
});

test('本文の DOM は、変わらない：開いても・ズームしても・閉じても、#article の innerHTML が、同じ', async () => {
  const { art } = mountArticle();
  await settle();
  const before = art.innerHTML;
  press(q('.mermaid-block svg', art) as Element);
  expect(art.innerHTML).toBe(before);
  fireEvent.click(q('button[aria-label="ズームイン"]') as HTMLElement);
  fireEvent.keyDown(document, { key: '0' });
  expect(art.innerHTML).toBe(before);
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(art.innerHTML).toBe(before);
  press(q('img[alt="図"]', art) as Element);
  close();
  expect(art.innerHTML).toBe(before);
});

test('開かないもの：外部画像のブロック表示・リンクの中の画像・本文の文字', async () => {
  const { art } = mountArticle();
  await settle();
  press(q('.img-blocked', art) as Element);
  expect(useUi.getState().lightbox).toBeNull();
  press(q('img[alt="リンクの画像"]', art) as Element);
  expect(useUi.getState().lightbox).toBeNull();
  press(q('p', art) as Element);
  expect(useUi.getState().lightbox).toBeNull();
});

test('html-app の枠（iframe・.htmlapp）・ボタンの中の svg は、対象外。入れ子の svg は、いちばん外の図', () => {
  const root = document.createElement('div');
  root.innerHTML =
    '<div class="htmlapp"><iframe></iframe><svg id="s0"></svg></div><button><svg id="s1"></svg></button><svg id="o"><svg id="i"><rect/></svg></svg><img id="im" src="/asset/a.png">';
  document.body.append(root);
  expect(zoomableAt(root.querySelector('iframe'), root)).toBeNull();
  expect(zoomableAt(root.querySelector('#s0'), root)).toBeNull();
  expect(zoomableAt(root.querySelector('#s1'), root)).toBeNull();
  expect(zoomableAt(root.querySelector('rect'), root)?.id).toBe('o');
  expect(zoomableAt(root.querySelector('#im'), root)?.id).toBe('im');
  expect(zoomableAt(document.body, root)).toBeNull(); // root の外
});

test('文字を選ぶドラッグ（押した位置から動いた）・選択範囲がある・範囲を選ぶ最中は、開かない。修飾キー・右ボタンも', async () => {
  const { art } = mountArticle();
  await settle();
  const img = q('img[alt="図"]', art) as Element;
  press(img, { clientX: 10, clientY: 10 }, { clientX: 80, clientY: 12 }); // ドラッグ
  expect(useUi.getState().lightbox).toBeNull();
  getSelection()?.selectAllChildren(q('p', art) as Element); // 文字を選んでいる
  press(img);
  expect(useUi.getState().lightbox).toBeNull();
  getSelection()?.removeAllRanges();
  act(() => useUi.getState().setRegMode('selecting'));
  press(img);
  expect(useUi.getState().lightbox).toBeNull();
  act(() => useUi.getState().setRegMode('idle'));
  fireEvent.mouseDown(img, { clientX: 5, clientY: 5 });
  fireEvent.click(img, { clientX: 5, clientY: 5, shiftKey: true });
  fireEvent.click(img, { clientX: 5, clientY: 5, ctrlKey: true });
  fireEvent.click(img, { clientX: 5, clientY: 5, button: 2 });
  expect(useUi.getState().lightbox).toBeNull();
  press(img, { clientX: 5, clientY: 5 }, { clientX: 7, clientY: 6 }); // ほとんど動かない：押す
  expect(useUi.getState().lightbox).not.toBeNull();
});

test('返信の本体の、画像・図も、開く（ズーム・移動ができる）。返信の文字・添付の画像は、これまでどおり', async () => {
  renderPanel([
    thread({ id: 't1', messages: [ai('文です。\n\n![図](assets/fig.png)\n\n```mermaid\ngraph TD\n  A-->B\n```')] }),
  ]);
  await settle();
  press(q('.msg.ai .body.md img') as Element);
  expect(useUi.getState().lightbox).toMatchObject({ kind: 'img' });
  expect(useUi.getState().lightbox?.focus).toBeUndefined(); // 返信の画像：ステージだけ（ドックなし）
  close();
  press(q('.msg.ai .body.md .mermaid-block svg') as Element);
  expect(useUi.getState().lightbox).toMatchObject({ kind: 'svg' });
  expect((q('.lb-stage svg') as Element).id).toBe('zoom-mmd1');
  close();
  press(q('.msg.ai .body.md p') as Element);
  expect(useUi.getState().lightbox).toBeNull();
});

test('ズーム：＋／−／全体に合わせる・キー（＋ − 0）・ホイール・ダブルクリック（全体に合わせる ↔ 等倍）。範囲は、全体に合わせる〜上限', async () => {
  const { art } = mountArticle();
  await settle();
  press(q('.mermaid-block svg', art) as Element);
  expect(pct()).toBe(94); // 全体に合わせる：窓 1024 の 92%（942）/ 自然な幅 1000
  const out = q<HTMLButtonElement>('button[aria-label="ズームアウト"]') as HTMLButtonElement;
  const inn = q<HTMLButtonElement>('button[aria-label="ズームイン"]') as HTMLButtonElement;
  const fit = q<HTMLButtonElement>('button[aria-label="全体に合わせる"]') as HTMLButtonElement;
  expect(out.disabled).toBe(true); // 全体に合わせるより、縮めない
  expect(fit.disabled).toBe(true);
  fireEvent.click(inn);
  expect(pct()).toBe(118); // × 1.25
  expect(out.disabled).toBe(false);
  fireEvent.click(out);
  expect(pct()).toBe(94);
  fireEvent.keyDown(document, { key: '+' });
  fireEvent.keyDown(document, { key: '=' });
  expect(pct()).toBe(147);
  fireEvent.keyDown(document, { key: '-' });
  expect(pct()).toBe(118);
  fireEvent.keyDown(document, { key: '0' });
  expect(pct()).toBe(94);
  fireEvent.wheel(lb(), { deltaY: -100, clientX: 600, clientY: 300 });
  expect(pct()).toBeGreaterThan(94);
  fireEvent.wheel(lb(), { deltaY: 100000, clientX: 600, clientY: 300 });
  expect(pct()).toBe(94);
  for (let i = 0; i < 30; i++) fireEvent.click(inn.disabled ? fit : inn);
  fireEvent.wheel(lb(), { deltaY: -100000, clientX: 600, clientY: 300 });
  expect(pct()).toBe(800); // 上限
  expect(inn.disabled).toBe(true);
  fireEvent.click(fit);
  fireEvent.doubleClick(q('.lb-stage') as Element, { clientX: 500, clientY: 400 });
  expect(pct()).toBe(100); // 全体に合わせる → 等倍
  fireEvent.doubleClick(q('.lb-stage') as Element, { clientX: 500, clientY: 400 });
  expect(pct()).toBe(94); // → 全体に合わせる
});

test('閉じる：X・Esc・背景（図の外）を押す。図の上を押しても・ドラッグの終わりでは、閉じない。ツールバーを押しても、閉じない', async () => {
  const { art } = mountArticle();
  await settle();
  const svg = q('.mermaid-block svg', art) as Element;
  const open = () => press(svg);
  open();
  const view = q('.lb-view') as HTMLElement;
  const stage = q('.lb-stage') as HTMLElement;
  // 図の上を押す：閉じない
  fireEvent.pointerDown(stage, { button: 0, clientX: 500, clientY: 400, pointerId: 1 });
  fireEvent.pointerUp(stage, { button: 0, clientX: 500, clientY: 400, pointerId: 1 });
  expect(lb().hidden).toBe(false);
  // ズームして、ドラッグ：閉じない・動く
  fireEvent.click(q('button[aria-label="ズームイン"]') as HTMLElement);
  fireEvent.click(q('button[aria-label="ズームイン"]') as HTMLElement);
  const t0 = (q('.lb-stage') as HTMLElement).style.transform;
  fireEvent.pointerDown(view, { button: 0, clientX: 100, clientY: 100, pointerId: 2 });
  fireEvent.pointerMove(view, { clientX: 160, clientY: 100, pointerId: 2 });
  fireEvent.pointerUp(view, { button: 0, clientX: 160, clientY: 100, pointerId: 2 });
  expect(lb().hidden).toBe(false); // 背景の上で、ドラッグを終えても、閉じない
  expect((q('.lb-stage') as HTMLElement).style.transform).not.toBe(t0); // 移動した
  // ツールバーの余白を押す：閉じない
  const tools = q('.lb-tools') as HTMLElement;
  fireEvent.pointerDown(tools, { button: 0, clientX: 1000, clientY: 20, pointerId: 3 });
  fireEvent.pointerUp(tools, { button: 0, clientX: 1000, clientY: 20, pointerId: 3 });
  expect(lb().hidden).toBe(false);
  // 背景を押す（動かさない）：閉じる
  fireEvent.pointerDown(view, { button: 0, clientX: 5, clientY: 5, pointerId: 4 });
  fireEvent.pointerUp(view, { button: 0, clientX: 5, clientY: 5, pointerId: 4 });
  expect(lb().hidden).toBe(true);
  // X
  open();
  fireEvent.click(q('button[aria-label="閉じる"]') as HTMLElement);
  expect(lb().hidden).toBe(true);
  // Esc（範囲の枠をドラッグしている間は、閉じない：既存）
  open();
  act(() => useUi.getState().setRegDrag(true));
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(lb().hidden).toBe(false);
  act(() => useUi.getState().setRegDrag(false));
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(lb().hidden).toBe(true);
});

test('添付の画像も、同じ拡大表示：ズーム・移動の道具がある。見るだけ（ドックも、範囲の道具も出ない）。背景を押す・×・Esc で閉じる', () => {
  render(<ZoomModal />);
  act(() => useUi.getState().openZoom({ kind: 'img', src: '/asset/demo/a.png', alt: '添付の画像（大きく）' }));
  expect(lb().hidden).toBe(false);
  expect(lb().getAttribute('role')).toBe('dialog');
  expect(lb().getAttribute('aria-label')).toBe('添付の画像（大きく）');
  expect(q('.lb-tools button[aria-label="ズームイン"]')).not.toBeNull();
  expect(q('.lb-tools button[aria-label="全体に合わせる"]')).not.toBeNull();
  expect(q<HTMLImageElement>('.lb-stage img')?.getAttribute('src')).toBe('/asset/demo/a.png');
  expect(q('.fv-dock')).toBeNull(); // ドックなし
  expect(q('.fv-tools')).toBeNull(); // 「範囲を選ぶ」の道具なし
  expect(lb().classList.contains('fv')).toBe(false);
  // 画像の上を押しても、閉じない（ひとつ前の「押すと閉じる」とは違う）
  const stage = q('.lb-stage') as HTMLElement;
  fireEvent.pointerDown(stage, { button: 0, clientX: 500, clientY: 400, pointerId: 1 });
  fireEvent.pointerUp(stage, { button: 0, clientX: 500, clientY: 400, pointerId: 1 });
  expect(lb().hidden).toBe(false);
  // 背景を押す：閉じる
  const view = q('.lb-view') as HTMLElement;
  fireEvent.pointerDown(view, { button: 0, clientX: 5, clientY: 5, pointerId: 2 });
  fireEvent.pointerUp(view, { button: 0, clientX: 5, clientY: 5, pointerId: 2 });
  expect(lb().hidden).toBe(true);
  // ×・Esc
  act(() => useUi.getState().openZoom({ kind: 'img', src: '/asset/demo/a.png', alt: '添付の画像（大きく）' }));
  fireEvent.click(q('button[aria-label="閉じる"]') as HTMLElement);
  expect(lb().hidden).toBe(true);
  act(() => useUi.getState().openZoom({ kind: 'img', src: '/asset/demo/a.png', alt: '添付の画像（大きく）' }));
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(lb().hidden).toBe(true);
});

test('フォーカス：開いたとき、拡大表示へ。閉じたとき、開く前の要素へ戻す（フォーカスできる要素だったとき）', () => {
  render(<ZoomModal />);
  const btn = document.createElement('button');
  document.body.append(btn);
  btn.focus();
  act(() => useUi.getState().openZoom({ kind: 'img', src: '/asset/demo/a.png', alt: '図' }));
  expect(document.activeElement).toBe(lb());
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(document.activeElement).toBe(btn);
  // フォーカスできる要素でなかったとき（本文の画像を押した）：戻す先がない（例外なく、閉じる）
  (document.activeElement as HTMLElement).blur();
  act(() => useUi.getState().openZoom({ kind: 'img', src: '/asset/demo/a.png', alt: '図' }));
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(lb().hidden).toBe(true);
});
