// @vitest-environment jsdom
// 拡大表示（フォーカスビュー。F43）：右のドック（入力欄は、本文のパネルと同じ下書き）・Esc の順序・入口の出し分け（キーボード）・フォーカスの戻り・html-app の拡大表示の枠（同じ隔離・橋の検査・破棄）・
// 本文の更新への追従（対象が消えたら閉じる）・窓の後ろの inert・Tab の輪・範囲の枠の重ね。実際の測定・ドラッグ・画素は、e2e（`app/e2e/focus.spec.ts`）。
import { act, fireEvent } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { type TopicState, topicKey, useTopic } from '../../src/web/api/queries';
import { queryClient } from '../../src/web/api/queryClient';
import { Article } from '../../src/web/doc/Article';
import { registeredFrames } from '../../src/web/doc/frameRegistry';
import { blockAnchor } from '../../src/web/doc/render/blocks';
import { escapeStep } from '../../src/web/lib/escape';
import { useRoute } from '../../src/web/lib/route';
import { buildView } from '../../src/web/lib/view';
import { ThreadsPanel } from '../../src/web/panel/ThreadsPanel';
import { useDoc } from '../../src/web/store/doc';
import { useUi } from '../../src/web/store/ui';
import { installPointerCapture, meta, mockFetch, renderWithClient, resetAll, topicState } from './helpers';
import { msg, stubScroll, thread } from './panel/fixtures';

const MERMAID_SVG = '<svg id="mmd1" viewBox="0 0 1000 500" width="100%" style="max-width: 1000px"><g class="n"/></svg>';
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

const BT = '```';
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
  `${BT}mermaid`,
  'graph LR',
  '  A-->B',
  BT,
  '',
  '<svg id="in1" viewBox="0 0 100 50"><rect width="10" height="10"/></svg>',
  '',
  `${BT}html-app height=200`,
  '<button id="go">押す</button>',
  BT,
  '',
  '終わりの段落です。',
  '',
].join('\n');

let markdown = MD;
let setMarkdown: (md: string) => void = () => {};

/** 本文（Article）と右のパネル（ライトボックス・ドックを含む）を、ルート・トピック（TanStack Query）つきで描く */
function Harness() {
  const route = useRoute();
  const topic = useTopic('demo');
  const [md, setMd] = useState(markdown);
  useEffect(() => {
    setMarkdown = setMd;
  }, []);
  const view = buildView(route, topic.data);
  if (!view) return null;
  return (
    <div id="app">
      <div id="docscroll">
        <Article view={view} markdown={md} prevMarkdown={null} />
      </div>
      <ThreadsPanel view={view} />
    </div>
  );
}

/** 作り物のサーバーの、いまのトピック（取り直しても、これが返る） */
let served: TopicState = topicState();
const setTopic = (t: TopicState): void => {
  served = t;
  act(() => queryClient.setQueryData(topicKey('demo'), t));
};

async function mount(opts: { md?: string; topic?: TopicState; hash?: string } = {}) {
  markdown = opts.md ?? MD;
  served = opts.topic ?? topicState({ threads: [], meta: meta() });
  mockFetch((req) => (req.path === '/api/topic/demo' ? { body: served } : undefined));
  queryClient.setQueryData(topicKey('demo'), served);
  location.hash = opts.hash ?? '#/demo/root';
  renderWithClient(<Harness />);
  await settle();
}

// TanStack Query の通知は、setTimeout(0) で届く：マイクロタスクだけでなく、タイマーも、流す
const settle = async () => {
  for (let i = 0; i < 3; i++)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
};
const q = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) =>
  root.querySelector(sel) as T | null;
const all = (sel: string, root: ParentNode = document) => [...root.querySelectorAll<HTMLElement>(sel)];
const lb = () => q('#lightbox') as HTMLElement;
const ui = () => useUi.getState();
const press = (el: Element) => {
  fireEvent.mouseDown(el, { clientX: 10, clientY: 10 });
  fireEvent.click(el, { clientX: 10, clientY: 10 });
};
const esc = () => fireEvent.keyDown(document, { key: 'Escape' });
const dockComposerArea = () => q<HTMLTextAreaElement>('#lightbox textarea[data-key="composer"]');
const panelComposerArea = () => q<HTMLTextAreaElement>('#threads textarea[data-key="composer"]');
const mermaidSvg = () => q<SVGSVGElement>('#article .mermaid-block svg') as SVGSVGElement;
/** キーボード（Enter）で開く */
const openMermaid = () =>
  fireEvent.keyDown(q('#article .mermaid-block[data-focus-entry]') as Element, { key: 'Enter' });

// ============================================================================
test('ドックの入力欄は、本文のパネルと同じ下書き：拡大表示で書いた下書きは、閉じたあとも、パネルに残る', async () => {
  await mount();
  press(q('#article img[alt="図"]') as Element);
  expect(lb().classList.contains('fv')).toBe(true);
  expect(q('#lightbox .fv-dock')).not.toBeNull();
  expect(dockComposerArea()).toBeNull(); // 入力欄は、まだない：「この対象全体にコメント」で開く
  fireEvent.click(q('#lightbox .fv-dock button.ghost') as HTMLElement);
  await settle();
  expect(ui().composer?.anchor.label).toContain('画像');
  expect(dockComposerArea()).not.toBeNull();
  fireEvent.change(dockComposerArea() as HTMLTextAreaElement, { target: { value: '書きかけ' } });
  expect(ui().drafts.composer).toBe('書きかけ'); // 本文のパネルと同じストア
  expect(panelComposerArea()?.value).toBe('書きかけ');
  // 拡大表示のあいだ、窓の後ろのパネルの入力欄は、フォーカスを受けない（ドックの入力欄が、受ける）
  expect(document.activeElement).not.toBe(panelComposerArea());
  esc();
  await settle();
  expect(lb().hidden).toBe(true);
  expect(ui().drafts.composer).toBe('書きかけ');
  expect(ui().composer).not.toBeNull();
  expect(panelComposerArea()?.value).toBe('書きかけ'); // パネルに、残る
  expect(dockComposerArea()).toBeNull();
});

test('Esc の順序：道具（範囲選択）の中止 → 入力欄の下書きは触らない → もう一度で、閉じる', async () => {
  await mount();
  press(mermaidSvg());
  await settle();
  fireEvent.click(q('#lightbox .fv-dock button.ghost') as HTMLElement);
  await settle();
  fireEvent.change(dockComposerArea() as HTMLTextAreaElement, { target: { value: '下書き' } });
  const tool = q<HTMLButtonElement>('#lightbox [data-tool="region"]') as HTMLButtonElement;
  expect(tool.disabled).toBe(false); // 図は、viewBox から、大きさが分かる
  fireEvent.click(tool);
  expect(ui().focusTool).toBe('region');
  expect(tool.getAttribute('aria-pressed')).toBe('true');
  expect(q('#lightbox .fv-sel')).not.toBeNull();
  esc(); // 1 回目：道具だけ
  expect(ui().focusTool).toBe('idle');
  expect(lb().hidden).toBe(false);
  expect(ui().drafts.composer).toBe('下書き');
  expect(ui().composer).not.toBeNull();
  expect(q('#lightbox .fv-sel')).toBeNull();
  esc(); // 2 回目：閉じる。下書きは、消えない
  expect(lb().hidden).toBe(true);
  expect(ui().drafts.composer).toBe('下書き');
  expect(ui().composer).not.toBeNull();
});

test('Esc：本文の範囲選択 → ドラッグ中（任せる）→ 道具 → 要素選択 → 閉じる（1 回の押下で、1 段だけ。2 つのリスナーが、二重に処理しない）', () => {
  ui().openZoom({
    kind: 'img',
    src: '/asset/demo/a.png',
    alt: '図',
    focus: { id: 'b0', hash: 'h', src: null, base: true },
  });
  ui().setFocusTool('region');
  ui().setRegMode('selecting');
  const e1 = new KeyboardEvent('keydown', { key: 'Escape' });
  expect(escapeStep(e1)).toBe(true);
  expect(ui().regMode).toBe('idle');
  expect(ui().focusTool).toBe('region');
  expect(escapeStep(e1)).toBe(false); // 同じ押下は、2 度、処理しない
  expect(ui().lightbox).not.toBeNull();
  ui().setRegDrag(true);
  expect(escapeStep(new KeyboardEvent('keydown', { key: 'Escape' }))).toBe(true); // ドラッグ中は、任せる
  expect(ui().focusTool).toBe('region');
  ui().setRegDrag(false);
  expect(escapeStep(new KeyboardEvent('keydown', { key: 'Escape' }))).toBe(true);
  expect(ui().focusTool).toBe('idle');
  expect(ui().lightbox).not.toBeNull();
  expect(escapeStep(new KeyboardEvent('keydown', { key: 'Escape' }))).toBe(true);
  expect(ui().lightbox).toBeNull();
  expect(escapeStep(new KeyboardEvent('keydown', { key: 'Escape' }))).toBe(false);
});

// ============================================================================
test('入口の出し分け：フォーカスできる（Tab で届く）のは、画像・Mermaid のブロック・インラインの svg だけ。外部画像・リンクの中・html-app の中の svg は、対象外', async () => {
  await mount();
  const entries = all('#article [data-focus-entry]');
  expect(entries.map((e) => e.tagName.toLowerCase() + (e.classList.contains('mermaid-block') ? '.mm' : ''))).toEqual([
    'img',
    'div.mm',
    'svg',
  ]);
  for (const e of entries) {
    expect(e.getAttribute('tabindex')).toBe('0');
    expect(e.getAttribute('role')).toBe('button');
    expect(e.getAttribute('aria-label')).toContain('拡大表示');
  }
  expect(q('#article img[alt="リンクの画像"]')?.hasAttribute('data-focus-entry')).toBe(false);
  expect(q('#article .img-blocked')?.hasAttribute('data-focus-entry')).toBe(false);
  expect(q('#article .htmlapp svg')?.closest('[data-focus-entry]')).toBeNull(); // 枠の見出しの、アイコン
  // html-app：見出しの「拡大表示」ボタン（Tab で届く）
  const open = q<HTMLButtonElement>('#article .htmlapp button[data-focus-open]');
  expect(open?.getAttribute('aria-label')).toBe('拡大表示');
});

test('キーボード：フォーカスした画像・図で、Enter・Space → 拡大表示（コメントの有無に関係なく）。Esc で閉じると、開いた所にフォーカスが戻る', async () => {
  await mount();
  const [img, mm] = all('#article [data-focus-entry]') as [HTMLElement, HTMLElement];
  img.focus();
  fireEvent.keyDown(img, { key: 'Enter' });
  expect(ui().lightbox).toMatchObject({ kind: 'img', focus: { base: true } });
  expect(document.activeElement).toBe(lb());
  esc();
  expect(lb().hidden).toBe(true);
  expect(document.activeElement).toBe(img);
  mm.focus();
  fireEvent.keyDown(mm, { key: ' ' });
  expect(ui().lightbox).toMatchObject({ kind: 'svg' });
  esc();
  expect(document.activeElement).toBe(mm);
  // 修飾キー・別の要素では、開かない
  fireEvent.keyDown(img, { key: 'Enter', ctrlKey: true });
  fireEvent.keyDown(q('#article p') as Element, { key: 'Enter' });
  expect(ui().lightbox).toBeNull();
});

test('フォーカスの戻り：開いた要素が、なくなっていても（入口のバーのボタンは、押すと消える）、本文の、その画像・図の入口へ戻る', async () => {
  await mount();
  const [img] = all('#article [data-focus-entry]') as [HTMLElement];
  const gone = document.createElement('button');
  document.body.append(gone);
  gone.focus();
  press(img); // 押した時点の、フォーカスは、ボタン（あとで、消える）
  expect(ui().lightbox).not.toBeNull();
  gone.remove();
  esc();
  expect(lb().hidden).toBe(true);
  expect(document.activeElement).toBe(img);
});

test('ドックの中の添付の画像を押す：同じ拡大表示（ステージだけ・見るだけ）が、その上に開く。閉じると、ドックつきの拡大表示へ戻る。最後に閉じると、本文の入口へフォーカスが戻る', async () => {
  await mount();
  const a = blockAnchor(q('#article .mermaid-block') as HTMLElement);
  setTopic(
    topicState({
      threads: [
        thread({ id: 'tm', anchor: a, messages: [msg({ id: 'm1', text: '図へ', sent: true, images: ['c-1.png'] })] }),
      ],
      meta: meta(),
    }),
  );
  await settle();
  const entry = q('#article .mermaid-block[data-focus-entry]') as HTMLElement;
  entry.focus();
  openMermaid();
  await settle();
  const base = ui().lightbox;
  expect(base?.focus).toBeDefined();
  fireEvent.click(q('#lightbox .fv-dock .msg .imgs img') as Element);
  // 上に重なる：ステージだけ（ドック・範囲の道具・ドックつきの見た目は、ない）
  expect(ui().lightbox).toMatchObject({ kind: 'img', alt: '添付の画像（大きく）' });
  expect(ui().lightbox?.focus).toBeUndefined();
  expect(ui().lightboxBack).toBe(base);
  expect(lb().classList.contains('fv')).toBe(false);
  expect(q('#lightbox .fv-dock')).toBeNull();
  expect(q('#lightbox .fv-tools')).toBeNull();
  expect(q('#lightbox .lb-stage img')?.getAttribute('src')).toContain('/asset/demo/c-1.png');
  expect(document.activeElement).toBe(lb());
  // Esc（1 回）：添付だけ閉じて、ドックつきの拡大表示へ戻る
  esc();
  expect(ui().lightbox).toBe(base);
  expect(ui().lightboxBack).toBeNull();
  expect(lb().classList.contains('fv')).toBe(true);
  expect(q('#lightbox .fv-dock')).not.toBeNull();
  expect(lb().hidden).toBe(false);
  // もう一度：閉じる。フォーカスは、本文の入口へ
  esc();
  expect(lb().hidden).toBe(true);
  expect(document.activeElement).toBe(entry);
  // 「×」でも、同じ：添付を閉じると、戻る
  openMermaid();
  await settle();
  fireEvent.click(q('#lightbox .fv-dock .msg .imgs img') as Element);
  fireEvent.click(q('#lightbox button[aria-label="閉じる"]') as Element);
  expect(lb().classList.contains('fv')).toBe(true);
});

// ============================================================================
test('窓の後ろは inert：開いている間、本文・パネル・上のバーが届かない。閉じたら、外す。Tab は、窓の中を回る', async () => {
  await mount();
  const app = q('#app') as HTMLElement;
  const others = [...app.children].filter((c) => c !== lb());
  expect(others.length).toBeGreaterThan(1);
  press(mermaidSvg());
  await settle();
  for (const c of others) expect(c.hasAttribute('inert')).toBe(true);
  expect(lb().hasAttribute('inert')).toBe(false);
  // Tab：最後の要素から、最初の要素へ。Shift+Tab：最初から、最後へ
  const items = [
    ...lb().querySelectorAll<HTMLElement>('button:not(:disabled), textarea, [tabindex]:not([tabindex="-1"])'),
  ].filter((e) => e !== lb());
  expect(items.length).toBeGreaterThan(2);
  (items[items.length - 1] as HTMLElement).focus();
  fireEvent.keyDown(lb(), { key: 'Tab' });
  expect(document.activeElement).toBe(items[0]);
  fireEvent.keyDown(lb(), { key: 'Tab', shiftKey: true });
  expect(document.activeElement).toBe(items[items.length - 1]);
  esc();
  for (const c of others) expect(c.hasAttribute('inert')).toBe(false);
});

// ============================================================================
test('ドックに、このブロックのコメントだけが出る。未送信の数も（AI に送る は、画面のバーのまま：ここには、押すボタンがない）', async () => {
  await mount();
  const a = blockAnchor(q('#article .mermaid-block') as HTMLElement);
  const other = blockAnchor(q('#article img[alt="図"]')?.closest('[data-bid]') as HTMLElement);
  const threads = [
    thread({ id: 'tm', anchor: a, messages: [msg({ id: 'm1', text: '図へのコメント', sent: false })] }),
    thread({ id: 'to', anchor: other, messages: [msg({ id: 'm2', text: '画像へのコメント', sent: true })] }),
  ];
  const topic = topicState({ threads, unsent: 1, meta: meta() });
  setTopic(topic);
  await settle();
  openMermaid();
  await settle();
  const cards = all('#lightbox .fv-dock .thread[data-tid]');
  expect(cards.map((c) => c.dataset.tid)).toEqual(['tm']);
  expect(q('#lightbox .fv-dock')?.textContent).toContain('図へのコメント');
  expect(q('#lightbox .fv-dock')?.textContent).not.toContain('画像へのコメント');
  expect(q('#lightbox .fv-unsent')?.textContent).toBe('未送信 1 件');
  expect(q('#lightbox .fv-dock #btn-submit')).toBeNull();
  // 返信が届く（トピックの更新）：拡大表示は、開いたまま、ドックのカードが増える
  const next = topicState({
    threads: [
      thread({
        id: 'tm',
        anchor: a,
        messages: [
          msg({ id: 'm1', text: '図へのコメント', sent: true }),
          msg({ id: 'm3', author: 'ai', kind: 'reply', text: 'AI の返信です', sent: true }),
        ],
      }),
    ],
    unsent: 0,
    meta: meta(),
  });
  setTopic(next);
  await settle();
  expect(lb().hidden).toBe(false);
  expect(q('#lightbox .fv-dock')?.textContent).toContain('AI の返信です');
  expect(q('#lightbox .fv-unsent')).toBeNull();
});

test('既存の範囲コメントの枠・番号が、ステージに重なる：保存した比率の位置・押すと、そのスレッドが選ばれる・入力中の範囲は破線', async () => {
  await mount();
  const a = { ...blockAnchor(q('#article .mermaid-block') as HTMLElement), rect: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 } };
  const topic = topicState({ threads: [thread({ id: 'tr', anchor: a })], meta: meta() });
  setTopic(topic);
  await settle();
  openMermaid();
  await settle();
  const box = q<HTMLElement>('#lightbox .fv-box[data-tid="tr"]');
  expect(box).not.toBeNull();
  expect(box?.querySelector('.fv-no')?.textContent).toBe('1');
  // 全体に合わせる：窓（1024×768。測れないので窓の大きさ）に、92%・90% で収まる。viewBox は 1000×500
  const fit = Math.min((1024 * 0.92) / 1000, (768 * 0.9) / 500);
  const [w, h] = [1000 * fit, 500 * fit];
  const [left, top] = [512 - w / 2, 384 - h / 2];
  expect(Number.parseFloat(box?.style.left ?? '')).toBeCloseTo(left + 0.1 * w, 1);
  expect(Number.parseFloat(box?.style.top ?? '')).toBeCloseTo(top + 0.2 * h, 1);
  expect(Number.parseFloat(box?.style.width ?? '')).toBeCloseTo(0.3 * w, 1);
  expect(Number.parseFloat(box?.style.height ?? '')).toBeCloseTo(0.4 * h, 1);
  // ズームすると、同じ割合で、追従する（＋ 1 段）
  fireEvent.keyDown(document, { key: '+' });
  const w2 = w * 1.25;
  expect(Number.parseFloat(q<HTMLElement>('#lightbox .fv-box[data-tid="tr"]')?.style.width ?? '')).toBeCloseTo(
    0.3 * w2,
    1,
  );
  // 押すと、そのスレッドが選ばれ、拡大表示は、開いたまま
  fireEvent.click(q('#lightbox .fv-box[data-tid="tr"]') as HTMLElement);
  expect(ui().active).toBe('tr');
  expect(lb().hidden).toBe(false);
  // 入力中の対象（この図の範囲）は、破線の枠
  act(() => {
    ui().startComposer({ ...a, rect: { x: 0.5, y: 0.5, w: 0.2, h: 0.2 } });
  });
  await settle();
  expect(q('#lightbox .fv-box.pending .fv-no')?.textContent).toBe('新');
});

test('対象のブロックが、更新で消えたら、閉じて、知らせる（書きかけは、パネルに残る）。内容が同じなら、描き直されても、開いたまま', async () => {
  await mount();
  press(mermaidSvg());
  await settle();
  fireEvent.click(q('#lightbox .fv-dock button.ghost') as HTMLElement);
  await settle();
  fireEvent.change(dockComposerArea() as HTMLTextAreaElement, { target: { value: '消えるまえの下書き' } });
  // 本文が、描き直される（段落が増えた：ブロックの番号は変わるが、内容は同じ）
  act(() => setMarkdown(`前に足した段落です。\n\n${MD}`));
  await settle();
  expect(lb().hidden).toBe(false);
  expect(q('#lightbox .fv-dock textarea')).not.toBeNull();
  // 図が、本文から消える
  act(() => setMarkdown('# 題\n\n図は、なくなりました。\n'));
  await settle();
  expect(lb().hidden).toBe(true);
  expect(ui().toast?.msg).toContain('拡大表示の対象が見つからなくなった');
  expect(ui().drafts.composer).toBe('消えるまえの下書き');
});

// ============================================================================
const bodyFrame = () => q<HTMLIFrameElement>('#article iframe.appframe') as HTMLIFrameElement;
const focusFrame = () => q<HTMLIFrameElement>('#lightbox iframe.appframe') as HTMLIFrameElement;
const send = (data: unknown, source: Window | null) =>
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data, source }));
  });
const PICK = {
  __rikai: 1,
  type: 'pick',
  selector: 'button#go',
  tag: 'button',
  text: '押す',
  rect: { x: 1, y: 2, w: 30, h: 20 },
  styles: {},
  frame: { w: 100, h: 100 },
};

test('html-app：拡大表示は、新しい iframe（sandbox は allow-scripts だけ・allow は空・同じ src の形）。本文の枠は、動かさない。閉じたら、破棄して、登録簿から外す', async () => {
  await mount();
  const body = bodyFrame();
  expect(registeredFrames()).toBe(1);
  fireEvent.click(q('#article .htmlapp button[data-focus-open]') as HTMLElement);
  await settle();
  expect(ui().lightbox).toMatchObject({ kind: 'app', app: { n: 0, fixed: 200 }, focus: { base: true } });
  const f = focusFrame();
  expect(f).not.toBe(body);
  expect(bodyFrame()).toBe(body); // 本文の枠は、同じ要素のまま（移動していない・作り直されていない）
  expect(body.closest('#article')).not.toBeNull();
  expect(f.getAttribute('sandbox')).toBe('allow-scripts');
  expect(f.getAttribute('allow')).toBe('');
  expect(f.getAttribute('src')).toBe(body.getAttribute('src')); // 同じ内容（同じ番号・同じ版）。?mode も、同じ外観
  expect(f.getAttribute('referrerpolicy')).toBe('no-referrer');
  expect(registeredFrames()).toBe(2);
  // 拡大表示の枠には、「拡大表示」ボタンがない（本文の枠の見出しにだけ）
  expect(q('#lightbox button[data-focus-open]')).toBeNull();
  expect(q('#lightbox button[data-pick]')).not.toBeNull();
  esc();
  expect(lb().hidden).toBe(true);
  expect(q('#lightbox iframe')).toBeNull();
  expect(registeredFrames()).toBe(1);
  expect(document.querySelectorAll('iframe').length).toBe(1);
});

test('開閉を 50 回：iframe・登録簿が、増えない。message の受け口も、増えない', async () => {
  await mount();
  const add = vi.spyOn(window, 'addEventListener');
  const remove = vi.spyOn(window, 'removeEventListener');
  const open = q('#article .htmlapp button[data-focus-open]') as HTMLElement;
  for (let i = 0; i < 50; i++) {
    fireEvent.click(open);
    await settle();
    expect(registeredFrames()).toBe(2);
    esc();
    await settle();
    expect(registeredFrames()).toBe(1);
    expect(document.querySelectorAll('iframe').length).toBe(1);
  }
  const added = add.mock.calls.filter(([t]) => t === 'message').length;
  const removed = remove.mock.calls.filter(([t]) => t === 'message').length;
  expect(added).toBe(0); // 本文の枠があるので、受け口は、1 つのまま（拡大表示の枠が、足さない・外さない）
  expect(removed).toBe(0);
  add.mockRestore();
  remove.mockRestore();
});

test('拡大表示の枠からの pick は、本文の枠と同じ検査で受ける：その枠が選択モードのときだけ・送り元の窓で。錨は、本文の、元の枠（ブロック）', async () => {
  await mount();
  const block = q('#article .htmlapp') as HTMLElement;
  fireEvent.click(q('#article .htmlapp button[data-focus-open]') as HTMLElement);
  await settle();
  const win = focusFrame().contentWindow as Window;
  const bodyWin = bodyFrame().contentWindow as Window;
  // 選択モードでない：枠が、勝手に送っても、下書きは、作らない
  send(PICK, win);
  expect(ui().composer).toBeNull();
  // 選択モード：拡大表示の枠
  fireEvent.click(q('#lightbox button[data-pick]') as HTMLElement);
  expect(q('#lightbox button[data-pick]')?.getAttribute('aria-pressed')).toBe('true');
  // なりすまし：本文の枠・ウィンドウ自身・送り元なし・兄弟の窓は、受けない
  send(PICK, bodyWin);
  send(PICK, window);
  send(PICK, null);
  expect(ui().composer).toBeNull();
  // 形の不正（余分なキー・タグ）は、捨てる
  send({ ...PICK, extra: 1 }, win);
  send({ ...PICK, tag: 'a" onload="x' }, win);
  expect(ui().composer).toBeNull();
  // 本物
  send(PICK, win);
  await settle();
  expect(ui().composer?.anchor.label).toBe('枠から：button');
  expect(ui().composer?.anchor.blockId).toBe(block.dataset.bid); // 本文の、元の枠（ブロック）
  expect(ui().composer?.anchor.blockHash).toBe(block.dataset.bhash);
  expect(ui().composer?.anchor.blockTag).toBe('DIV');
  expect(ui().drafts.composer).toBe(''); // 入力欄は、空（本文に、機械的な文章・JSON は、書かない）
  expect(ui().composer?.frameMeta?.pick?.tag).toBe('button');
  expect(q('#lightbox .fv-dock .framemeta')?.textContent).toContain('要素を選びました'); // ドックの入力欄の上に、情報の行
  // 1 つ選ぶと、終わる：続けて届いても、下書きは、増えない
  const id = ui().composer?.id;
  send({ ...PICK, selector: 'b' }, win);
  expect(ui().composer?.id).toBe(id);
  expect(q('#lightbox button[data-pick]')?.getAttribute('aria-pressed')).toBe('false');
  // 状態：拡大表示の枠の `state` が、次の下書きに添う（本文の枠の状態ではない）
  send({ __rikai: 1, type: 'state', json: '{"slider":7}' }, bodyWin);
  send({ __rikai: 1, type: 'state', json: '{"slider":70}' }, win);
  ui().closeComposer();
  fireEvent.click(q('#lightbox button[data-pick]') as HTMLElement);
  send(PICK, win);
  await settle();
  expect(ui().drafts.composer).toBe('');
  expect(JSON.parse(ui().composer?.frameMeta?.state as string)).toEqual({ slider: 70 });
});

test('html-app の拡大表示：Esc の順序（要素選択の中止 → 閉じる）。ドックの「この枠にコメント」に、拡大表示の枠の状態が添う', async () => {
  await mount();
  fireEvent.click(q('#article .htmlapp button[data-focus-open]') as HTMLElement);
  await settle();
  const win = focusFrame().contentWindow as Window;
  fireEvent.click(q('#lightbox button[data-pick]') as HTMLElement);
  expect(q('#lightbox button[data-pick]')?.getAttribute('aria-pressed')).toBe('true');
  esc(); // 1 回目：要素選択の中止だけ
  expect(q('#lightbox button[data-pick]')?.getAttribute('aria-pressed')).toBe('false');
  expect(lb().hidden).toBe(false);
  esc(); // 2 回目：閉じる
  expect(lb().hidden).toBe(true);
  // 状態の添付
  fireEvent.click(q('#article .htmlapp button[data-focus-open]') as HTMLElement);
  await settle();
  send({ __rikai: 1, type: 'state', json: '{"clicks":3}' }, focusFrame().contentWindow as Window);
  fireEvent.click(q('#lightbox .fv-dock button.ghost') as HTMLElement);
  await settle();
  expect(ui().drafts.composer).toBe(''); // 状態は、本文に書かない
  expect(ui().composer?.frameMeta).toEqual({ state: '{"clicks":3}' });
  expect(q('#lightbox .fv-dock .framemeta')?.textContent).toContain('枠の状態'); // ドックの入力欄の上に、情報の行
  expect(win).not.toBe(focusFrame().contentWindow); // 開き直すたびに、新しい枠
});

test('最新版でないとき：コメントの道具は使えない（読める）。ステージの拡大・移動は、これまでどおり', async () => {
  const topic = topicState({
    threads: [],
    meta: meta({ pages: { root: { title: 'T', parent: null, versions: 2, createdAt: '' } } }),
  });
  await mount({ topic, hash: '#/demo/root/v1' });
  expect(useDoc.getState().model?.key).toBe('demo/root/1'); // v1（最新は v2）
  press(mermaidSvg());
  await settle();
  expect((q('#lightbox [data-tool="region"]') as HTMLButtonElement).disabled).toBe(true);
  expect(q('#lightbox .fv-dock')?.textContent).toContain('最新版');
  fireEvent.keyDown(document, { key: '+' });
  expect(q('.lb-pct')?.textContent).not.toBe('94%');
});

test('枠の中の Esc（橋が転送）：拡大表示の枠からだけ、閉じる・道具の中止の順序に流れる。本文の枠からは、何も起きない。選択モードの Esc は、二重にならない', async () => {
  await mount();
  const ESC = { __rikai: 1, type: 'esc' };
  const bodyWin = bodyFrame().contentWindow as Window;
  send(ESC, bodyWin); // 本文の枠（拡大表示が閉じているとき）：何もしない
  fireEvent.click(q('#article .htmlapp button[data-focus-open]') as HTMLElement);
  await settle();
  const win = focusFrame().contentWindow as Window;
  send(ESC, bodyWin); // 本文の枠からの esc は、拡大表示を閉じない
  expect(lb().hidden).toBe(false);
  ui().setFocusTool('region');
  send(ESC, win); // 1 回目：道具の中止
  expect(ui().focusTool).toBe('idle');
  expect(lb().hidden).toBe(false);
  // 要素選択：橋は、Esc を pick-cancel で知らせる（esc は、送らない）。親は、選択だけ中止して、閉じない
  fireEvent.click(q('#lightbox button[data-pick]') as HTMLElement);
  expect(q('#lightbox button[data-pick]')?.getAttribute('aria-pressed')).toBe('true');
  send({ __rikai: 1, type: 'pick-cancel' }, win);
  expect(q('#lightbox button[data-pick]')?.getAttribute('aria-pressed')).toBe('false');
  expect(lb().hidden).toBe(false);
  send(ESC, win); // もう一度：閉じる
  expect(lb().hidden).toBe(true);
  expect(registeredFrames()).toBe(1);
  send(ESC, win); // 閉じたあとの、古い枠からは、何もしない
  expect(ui().lightbox).toBeNull();
});

// ---- 日本語の変換中（IME）：Esc・Enter は、変換の操作：閉じない・送信しない ----
test('IME の変換中（isComposing・keyCode 229）の Esc は、拡大表示を閉じない・道具を止めない。変換が終われば、ふつうに閉じる', async () => {
  await mount();
  press(mermaidSvg());
  await settle();
  ui().setFocusTool('region');
  fireEvent.keyDown(document, { key: 'Escape', isComposing: true });
  fireEvent.keyDown(document, { key: 'Escape', keyCode: 229 });
  expect(ui().focusTool).toBe('region');
  expect(lb().hidden).toBe(false);
  esc();
  expect(ui().focusTool).toBe('idle');
  fireEvent.keyDown(document, { key: 'Escape', isComposing: true });
  expect(lb().hidden).toBe(false);
  esc();
  expect(lb().hidden).toBe(true);
});

test('IME の変換中の Ctrl/⌘+Enter は、ドックの入力欄・パネルの入力欄で、送信しない（変換が終われば、送信する）', async () => {
  await mount();
  press(mermaidSvg());
  await settle();
  fireEvent.click(q('#lightbox .fv-dock button.ghost') as HTMLElement);
  await settle();
  const posts = () =>
    vi.mocked(fetch).mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST').length;
  for (const area of [dockComposerArea(), panelComposerArea()]) {
    fireEvent.change(area as HTMLTextAreaElement, { target: { value: '変換中の文' } });
    fireEvent.keyDown(area as HTMLTextAreaElement, { key: 'Enter', ctrlKey: true, isComposing: true });
    fireEvent.keyDown(area as HTMLTextAreaElement, { key: 'Enter', metaKey: true, keyCode: 229 });
  }
  await settle();
  expect(posts()).toBe(0);
  expect(ui().composer).not.toBeNull();
  fireEvent.keyDown(dockComposerArea() as HTMLTextAreaElement, { key: 'Enter', ctrlKey: true });
  await settle();
  expect(posts()).toBe(1); // 変換が終わっていれば、送る
});

test('本文の枠（onEsc なし）から esc が来ても、拡大表示は閉じず、道具も止まらない（拡大表示の枠だけが、esc を受ける）', async () => {
  await mount();
  fireEvent.click(q('#article .htmlapp button[data-focus-open]') as HTMLElement);
  await settle();
  const ESC = { __rikai: 1, type: 'esc' };
  ui().setFocusTool('region');
  for (let i = 0; i < 3; i++) send(ESC, bodyFrame().contentWindow as Window);
  expect(ui().focusTool).toBe('region');
  expect(lb().hidden).toBe(false);
  send(ESC, focusFrame().contentWindow as Window); // 拡大表示の枠からは、効く
  expect(ui().focusTool).toBe('idle');
});

test('html-app の拡大表示：幅の既定は、本文の枠がいま選んでいる幅（プリセット）。幅が違うときだけ、注記が出る', async () => {
  await mount();
  const body = bodyFrame();
  // 本文の枠の幅を 1280 に
  fireEvent.click(q('#article .htmlapp button[data-width="1280"]') as HTMLElement);
  Object.defineProperty(body, 'offsetWidth', { value: 1280, configurable: true });
  fireEvent.click(q('#article .htmlapp button[data-focus-open]') as HTMLElement);
  await settle();
  const f = focusFrame();
  expect(f.style.width).toBe('1280px'); // 本文と同じプリセット
  expect(q('#lightbox button[data-width="1280"]')?.getAttribute('aria-pressed')).toBe('true');
  Object.defineProperty(f, 'offsetWidth', { value: 1280, configurable: true });
  fireEvent.click(q('#lightbox button[data-width="768"]') as HTMLElement); // 幅を変える（再描画のきっかけ）
  Object.defineProperty(f, 'offsetWidth', { value: 768, configurable: true });
  fireEvent.click(q('#lightbox button[data-width="375"]') as HTMLElement);
  await settle();
  expect(q('#lightbox .fv-widthnote')?.textContent).toBe('本文の枠と幅が違います（本文 1280px）');
  Object.defineProperty(f, 'offsetWidth', { value: 1280, configurable: true });
  fireEvent.click(q('#lightbox button[data-width="1280"]') as HTMLElement);
  await settle();
  expect(q('#lightbox .fv-widthnote')).toBeNull(); // 同じ幅なら、出さない
});
