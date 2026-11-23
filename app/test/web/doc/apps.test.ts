// @vitest-environment jsdom
// html-app の枠の置き場：sandbox は allow-scripts だけ・src は数だけから（?mode は、画面の外観）・ソースは表から・古いサーバーでは説明・最新版にだけ「この枠にコメント」・
// 見出しの行のツールバー（幅・枠のライト/ダーク。アイコンだけ）・高さ（height=N は固定・なし／auto は自動の高さ）。
import { act, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { initialFrameState, releaseApps } from '../../../src/web/doc/appBridge';
import { fillApps } from '../../../src/web/doc/render/apps';
import { markBlocks } from '../../../src/web/doc/render/blocks';
import { mdToFragment } from '../../../src/web/doc/render/markdown';
import { buildView } from '../../../src/web/lib/view';
import { meta, topicState } from '../helpers';

let seq = 0;
beforeEach(() => {
  initialFrameState(`reset/${++seq}`, 0, 'light', true); // 版の印を変えて、覚えている状態（モジュールの状態）を、テストごとに空にする
});
afterEach(() => releaseApps(document));

const APP = '```html-app height=500\n<button>押す</button>\n<!-- </pre><img src=x onerror=1> -->\n```\n';

function boxes(appframe: boolean, version = 1, latest = 1, md = `${APP}\n${APP}`) {
  const topic = topicState({
    meta: meta({ pages: { root: { title: 'T', parent: null, versions: latest, createdAt: '' } } }),
  });
  if (!appframe) Reflect.deleteProperty(topic, 'appframe'); // 古いサーバーは、この項目を持たない
  const view = buildView({ slug: 'my topic', page: 'root', version }, topic);
  if (!view) throw new Error('view');
  const frag = mdToFragment(md, { slug: 'my topic', kind: 'doc' });
  markBlocks(frag);
  const root = document.createElement('div');
  root.append(frag);
  document.body.append(root); // 画面に付ける（iframe の contentWindow が、できる）
  const onComment = vi.fn();
  act(() => fillApps(root, { view, onComment })); // ツールバー（React の根）の描画まで
  return { root, onComment };
}

test('枠：iframe は sandbox="allow-scripts" だけ（allow-same-origin なし）。src は、数と、ページ・版から。allow は空・referrer なし・高さは、置き場の値', () => {
  const { root } = boxes(true);
  const frames = [...root.querySelectorAll('iframe')];
  expect(frames).toHaveLength(2);
  const f = frames[1] as HTMLIFrameElement;
  expect(f.getAttribute('sandbox')).toBe('allow-scripts');
  expect(f.getAttributeNames().filter((n) => /^on/.test(n))).toEqual([]);
  expect(f.getAttribute('src')).toBe('/appframe/my%20topic/root/1/1?mode=light');
  expect(f.getAttribute('allow')).toBe('');
  expect(f.getAttribute('referrerpolicy')).toBe('no-referrer');
  expect(f.getAttribute('height')).toBe('500');
  expect(f.className).toBe('appframe');
  expect(f.title).toBe('実行できる枠 2');
  expect(root.querySelectorAll('.mm-err')).toHaveLength(0);
});

test('ソースを見る：ソースは、文字として出す（タグにならない）。表から付けたソースだけ', () => {
  const { root } = boxes(true);
  const src = root.querySelector('details.appsrc');
  expect(src?.querySelector('summary')?.textContent).toBe('ソースを見る');
  expect(src?.querySelector('pre')?.textContent).toBe('<button>押す</button>\n<!-- </pre><img src=x onerror=1> -->');
  expect(src?.querySelector('img, button')).toBeNull();
});

test('古いサーバー（/appframe を持たない）：枠は動かせない説明を出す（iframe は入れない）。ソースは、見られる', () => {
  const { root } = boxes(false);
  expect(root.querySelector('iframe')).toBeNull();
  expect(root.querySelector('.mm-err')?.textContent).toContain('サーバーが古い');
  expect(root.querySelector('details.appsrc')).not.toBeNull();
});

test('「この枠にコメント」：最新版だけ。押すと、その枠が、渡される', () => {
  const { root, onComment } = boxes(true);
  const btn = root.querySelectorAll<HTMLButtonElement>('.htmlapp .cap button.link');
  expect(btn).toHaveLength(2);
  expect(btn[1]?.textContent).toBe('この枠にコメント');
  btn[1]?.click();
  expect(onComment).toHaveBeenCalledWith(root.querySelectorAll('.htmlapp')[1]);
  // 最新版でない（v1 を見ていて、最新が v2）
  const old = boxes(true, 1, 2);
  expect(old.root.querySelector('.cap button.link')).toBeNull();
  expect(old.root.querySelector('iframe')?.getAttribute('src')).toBe('/appframe/my%20topic/root/1/0?mode=light');
});

const AUTO = '```html-app\n<p>自動</p>\n```\n';
const AUTO2 = '```html-app height=auto\n<p>自動 2</p>\n```\n';
const frameMessage = (source: Window | null, data: unknown): void => {
  const e = new MessageEvent('message', { data });
  Object.defineProperty(e, 'source', { value: source });
  window.dispatchEvent(e);
};

test('高さ：height なし・height=auto は、自動（最初は小さめ）。height=N は、固定', () => {
  const { root } = boxes(true, 1, 1, `${AUTO}\n${AUTO2}\n${APP}`);
  const f = [...root.querySelectorAll('iframe')];
  expect(f.map((x) => x.getAttribute('height'))).toEqual(['200', '200', '500']);
});

test('橋：自動の枠は、知らせた高さに従う。固定の枠は、知らせを、無視する。別の枠の高さは、変えない', async () => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout', 'Date'] });
  try {
    const { root } = boxes(true, 1, 1, `${AUTO}\n${APP}\n${AUTO2}`);
    const [a, fixed, c] = [...root.querySelectorAll('iframe')] as HTMLIFrameElement[];
    frameMessage((a as HTMLIFrameElement).contentWindow, { __rikai: 1, type: 'resize', height: 640 });
    frameMessage((fixed as HTMLIFrameElement).contentWindow, { __rikai: 1, type: 'resize', height: 640 });
    vi.advanceTimersByTime(50);
    expect([a, fixed, c].map((x) => x?.getAttribute('height'))).toEqual(['640', '500', '200']);
  } finally {
    vi.useRealTimers();
  }
});

test('ツールバー：見出しの行に、幅（4 つの数＋自動）と枠のライト/ダーク。アイコンだけ（本文の文字を増やさない）・aria-label と title・「この枠にコメント」は、そのまま', () => {
  const { root, onComment } = boxes(true);
  const cap = root.querySelector('.htmlapp .cap') as HTMLElement;
  const tools = cap.querySelector('.apptools') as HTMLElement;
  expect(tools.getAttribute('role')).toBe('group');
  const buttons = [...tools.querySelectorAll('button')];
  expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual([
    '枠の幅：スマートフォン（375px）',
    '枠の幅：タブレット（768px）',
    '枠の幅：デスクトップ（1280px）',
    '枠の幅：ワイドデスクトップ（1920px）',
    '枠の幅：本文の幅いっぱい',
    '枠の外観：ライト。押すと、ダークにします',
  ]);
  for (const b of buttons) {
    const label = b.getAttribute('aria-label') as string;
    // 幅の数は、本文より広いと、本文の幅いっぱいになる：title で伝える
    expect(b.title).toBe(label); // 本文の幅に収まるとき（jsdom：幅は測れない）は、縮小率を足さない
    expect(b.textContent).toBe(''); // テキストなし
    expect(b.querySelector('svg')).not.toBeNull();
  }
  expect(
    buttons.map(
      (b) =>
        b
          .querySelector('svg')
          ?.getAttribute('class')
          ?.match(/lucide-([a-z-]+)/)?.[1],
    ),
  ).toEqual(['smartphone', 'tablet', 'monitor', 'tv', 'arrow-left-right', 'sun']);
  expect(tools.textContent).toBe('');
  // コメントのボタン：ツールバーの外・あとに、そのまま
  const link = cap.querySelector('button.link') as HTMLButtonElement;
  expect(tools.contains(link)).toBe(false);
  expect(tools.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  link.click();
  expect(onComment).toHaveBeenCalledTimes(1);
  // 古いサーバー：iframe がないので、ツールバーも出さない
  expect(boxes(false).root.querySelector('.apptools')).toBeNull();
  // 最新版でない版：コメントのボタンはなく、ツールバーは、ある
  const old = boxes(true, 1, 2).root;
  expect(old.querySelector('.cap button.link')).toBeNull();
  expect(old.querySelector('.cap .apptools')).not.toBeNull();
});

test('ツールバー：幅を選ぶと、その枠の iframe の幅（375/768/1280px）。aria-pressed で、いまの幅が分かる。自動で、解く。別の枠は、変わらない', () => {
  const { root } = boxes(true);
  const [f0, f1] = [...root.querySelectorAll('iframe')] as HTMLIFrameElement[];
  const tools = [...root.querySelectorAll('.apptools')] as HTMLElement[];
  const width = (t: HTMLElement, w: string) => t.querySelector(`button[data-width="${w}"]`) as HTMLButtonElement;
  expect(width(tools[1] as HTMLElement, 'auto').getAttribute('aria-pressed')).toBe('true');
  for (const w of ['375', '768', '1280', '1920']) {
    fireEvent.click(width(tools[0] as HTMLElement, w));
    expect(f0?.style.width).toBe(`${w}px`);
    expect(width(tools[0] as HTMLElement, w).getAttribute('aria-pressed')).toBe('true');
    expect(width(tools[0] as HTMLElement, 'auto').getAttribute('aria-pressed')).toBe('false');
    expect(f1?.style.width).toBe('');
  }
  fireEvent.click(width(tools[0] as HTMLElement, 'auto'));
  expect(f0?.style.width).toBe('');
});

test('ツールバー：枠のライト/ダーク。押すと theme を送る（再読み込みしない：src は、そのまま）。名前と、アイコンが、変わる。画面の外観が変わると、枠も従う', () => {
  const { root } = boxes(true);
  const f0 = root.querySelector('iframe') as HTMLIFrameElement;
  const src = f0.getAttribute('src');
  const send = vi.spyOn(f0.contentWindow as Window, 'postMessage');
  const mode = () => root.querySelector('.apptools button[data-frame-mode]') as HTMLButtonElement;
  fireEvent.click(mode());
  expect(send).toHaveBeenCalledWith({ __rikai: 1, type: 'theme', mode: 'dark', by: 'user' }, '*');
  expect(mode().getAttribute('aria-label')).toBe('枠の外観：ダーク。押すと、ライトにします');
  expect(mode().querySelector('svg')?.getAttribute('class')).toContain('lucide-moon');
  expect(f0.getAttribute('src')).toBe(src);
  fireEvent.click(mode());
  expect(send).toHaveBeenLastCalledWith({ __rikai: 1, type: 'theme', mode: 'light', by: 'user' }, '*');
  expect(mode().querySelector('svg')?.getAttribute('class')).toContain('lucide-sun');
});

test('描き直し（同じ版）：幅・枠だけの外観を覚えている。src の ?mode も、それ。外す（releaseApps）と、ツールバーも片づく', async () => {
  const first = boxes(true);
  fireEvent.click(first.root.querySelector('button[data-width="768"]') as HTMLButtonElement);
  fireEvent.click(first.root.querySelector('button[data-frame-mode]') as HTMLButtonElement);
  releaseApps(first.root);
  await act(async () => {}); // 根の unmount（microtask）
  expect(first.root.querySelector('.apptools')?.children.length).toBe(0);
  const again = boxes(true);
  const f = again.root.querySelector('iframe') as HTMLIFrameElement;
  expect(f.style.width).toBe('768px');
  expect(f.getAttribute('src')).toContain('?mode=dark');
  expect(again.root.querySelector('button[data-width="768"]')?.getAttribute('aria-pressed')).toBe('true');
});

const FOLLOW = '```html-app\n<p style="color: var(--color-ink)">対応を示す</p>\n```\n';

test('従来の枠（配色への対応を示さない）：画面がダークでも、ツールバーは「ライト」。画面の外観が変わっても触らない。対応を示した枠は、画面の外観に従う', () => {
  document.documentElement.setAttribute('data-theme', 'dark');
  try {
    const { root } = boxes(true, 1, 1, `${APP}\n${FOLLOW}`);
    const [legacy, follow] = [...root.querySelectorAll('iframe')] as HTMLIFrameElement[];
    expect(legacy?.getAttribute('src')).toContain('?mode=light');
    expect(follow?.getAttribute('src')).toContain('?mode=dark');
    const labels = [...root.querySelectorAll('button[data-frame-mode]')].map((b) => b.getAttribute('aria-label'));
    expect(labels).toEqual(['枠の外観：ライト。押すと、ダークにします', '枠の外観：ダーク。押すと、ライトにします']);
    // ツールバー（利用者の明示の操作）は、従来の枠でも、効く
    const send = vi.spyOn(legacy?.contentWindow as Window, 'postMessage');
    fireEvent.click(root.querySelector('button[data-frame-mode]') as HTMLButtonElement);
    expect(send).toHaveBeenCalledWith({ __rikai: 1, type: 'theme', mode: 'dark', by: 'user' }, '*');
  } finally {
    document.documentElement.removeAttribute('data-theme');
  }
});

test('ツールバー：選んだ幅が本文より広いとき、title に縮小率（下限 50%）。下限で止まるときは「横にスクロールできます」。aria-label は、そのまま。狭い幅は、縮小なし', () => {
  const desc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 640 });
  try {
    const { root } = boxes(true);
    const btn = (w: string) => root.querySelector(`button[data-width="${w}"]`) as HTMLButtonElement;
    expect(btn('375').title).toBe('枠の幅：スマートフォン（375px）');
    expect(btn('768').title).toBe('枠の幅：タブレット（768px・表示は 83% に縮小）');
    expect(btn('1280').title).toBe('枠の幅：デスクトップ（1280px・表示は 50% に縮小）'); // 640px ちょうどで、収まる：横にスクロールしない
    expect(btn('1920').title).toBe('枠の幅：ワイドデスクトップ（1920px・表示は 50% に縮小。横にスクロールできます）');
    expect(btn('1280').getAttribute('aria-label')).toBe('枠の幅：デスクトップ（1280px）');
    expect(btn('auto').title).toBe('枠の幅：本文の幅いっぱい');
    fireEvent.click(btn('1280'));
    const f = root.querySelector('iframe') as HTMLIFrameElement;
    expect(f.style.width).toBe('1280px');
    expect(f.style.transform).toBe('scale(0.5)');
    expect(f.parentElement?.className).toContain('appscaled');
    expect(f.parentElement?.style.height).toBe('250px'); // 枠の高さ（500）× 0.5
  } finally {
    if (desc) Object.defineProperty(HTMLElement.prototype, 'clientWidth', desc);
    else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
  }
});
