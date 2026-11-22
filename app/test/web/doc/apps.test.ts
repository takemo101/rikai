// @vitest-environment jsdom
// html-app の枠の置き場：sandbox は allow-scripts だけ・src は数だけから・ソースは表から・古いサーバーでは説明・最新版にだけ「この枠にコメント」。
import { expect, test, vi } from 'vitest';
import { fillApps } from '../../../src/web/doc/render/apps';
import { markBlocks } from '../../../src/web/doc/render/blocks';
import { mdToFragment } from '../../../src/web/doc/render/markdown';
import { buildView } from '../../../src/web/lib/view';
import { meta, topicState } from '../helpers';

const APP = '```html-app height=500\n<button>押す</button>\n<!-- </pre><img src=x onerror=1> -->\n```\n';

function boxes(appframe: boolean, version = 1, latest = 1) {
  const topic = topicState({
    meta: meta({ pages: { root: { title: 'T', parent: null, versions: latest, createdAt: '' } } }),
  });
  if (!appframe) Reflect.deleteProperty(topic, 'appframe'); // 古いサーバーは、この項目を持たない
  const view = buildView({ slug: 'my topic', page: 'root', version }, topic);
  if (!view) throw new Error('view');
  const frag = mdToFragment(`${APP}\n${APP}`, { slug: 'my topic', kind: 'doc' });
  markBlocks(frag);
  const root = document.createElement('div');
  root.append(frag);
  const onComment = vi.fn();
  fillApps(root, { view, onComment });
  return { root, onComment };
}

test('枠：iframe は sandbox="allow-scripts" だけ（allow-same-origin なし）。src は、数と、ページ・版から。allow は空・referrer なし・高さは、置き場の値', () => {
  const { root } = boxes(true);
  const frames = [...root.querySelectorAll('iframe')];
  expect(frames).toHaveLength(2);
  const f = frames[1] as HTMLIFrameElement;
  expect(f.getAttribute('sandbox')).toBe('allow-scripts');
  expect(f.getAttributeNames().filter((n) => /^on/.test(n))).toEqual([]);
  expect(f.getAttribute('src')).toBe('/appframe/my%20topic/root/1/1');
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
  expect(old.root.querySelector('.cap button')).toBeNull();
  expect(old.root.querySelector('iframe')?.getAttribute('src')).toBe('/appframe/my%20topic/root/1/0');
});
