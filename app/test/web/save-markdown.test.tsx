// @vitest-environment jsdom
// 「Markdown を保存」（上のバー `#top`）：いま見ているページ・版の、元の Markdown を保存する。押せる条件（本文が届くまで・取得に失敗したら押せない）と、対象の取り違え（版・ページ・差分の表示）。
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { App } from '../../src/web/App';
import { useUi } from '../../src/web/store/ui';
import {
  installDialog,
  installPointerCapture,
  meta,
  mockFetch,
  renderWithClient,
  resetAll,
  summary,
  topicState,
} from './helpers';

beforeAll(() => {
  installDialog();
  installPointerCapture();
});
beforeEach(() => {
  resetAll();
  Object.defineProperty(window, 'innerWidth', { value: 1600, configurable: true });
});
afterEach(() => vi.unstubAllGlobals());

const byId = (id: string) => document.getElementById(id) as HTMLElement;
const pages: Parameters<typeof meta>[0] = {
  pages: {
    root: { title: '全体', parent: null, versions: 3, createdAt: '' },
    sub: { title: '子', parent: 'root', versions: 1, createdAt: '' },
  },
};
/** 作り物の本文。CRLF・BOM・末尾の改行なし・日本語・コードブロック（html-app の枠）を含む：加工されずに、そのまま保存される */
const md = (page: string, v: number): string =>
  `\uFEFF# ${page} の v${v}\r\n\r\nこれは作り物。<b>x</b>\r\n\r\n\`\`\`html-app\r\n<p>枠</p>\r\n\`\`\`\r\n末尾`;

interface Saved {
  name: string;
  text: string;
}
const saved: Saved[] = [];

/** `saveText` の、外から見える結果（<a download> の名前と、Blob の中身）を集める */
function stubSave(): void {
  saved.length = 0;
  const blobs = new Map<string, Blob>();
  Object.assign(URL, {
    createObjectURL: (b: Blob) => {
      const u = `blob:fake/${blobs.size}`;
      blobs.set(u, b);
      return u;
    },
    revokeObjectURL: () => {},
  });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click(this: HTMLAnchorElement) {
    const blob = blobs.get(this.href) as Blob;
    const name = this.download;
    const r = new FileReader();
    r.onload = () =>
      saved.push({ name, text: new TextDecoder('utf-8', { ignoreBOM: true }).decode(r.result as ArrayBuffer) });
    r.readAsArrayBuffer(blob);
  });
}

function server(opts: { pageStatus?: (p: string, v: number) => number } = {}) {
  return mockFetch((req) => {
    if (req.path === '/api/topics') return { body: [summary('demo')] };
    if (/^\/api\/topic\/demo$/.test(req.path)) return { body: topicState({ meta: meta(pages) }) };
    const p = /^\/api\/page\/demo\/([^/]+)\/(\d+)$/.exec(req.path);
    if (p) {
      const [page, v] = [p[1] as string, Number(p[2])];
      const status = opts.pageStatus?.(page, v) ?? 200;
      return status === 200
        ? { body: { markdown: md(page, v) } }
        : { status, body: { ok: false, error: '内部エラー' } };
    }
    return undefined;
  });
}
const saveBtn = () => byId('btn-save-md') as HTMLButtonElement;
const savedAll = () => waitFor(() => expect(saved.length).toBeGreaterThan(0));

test('最新版・過去の版・子ページ：いま見ているページ・版の本文を、元のバイト列のまま、<トピック>-<ページ>-v<版>.md で保存する（変更を重ねていても、差分の装飾は入らない）', async () => {
  stubSave();
  server();
  location.hash = '#/demo/root'; // 最新 v3。既定は、変更を重ねる
  renderWithClient(<App />);
  await waitFor(() => expect(saveBtn()).toBeEnabled());
  expect(useUi.getState().showChanges).toBe(true);
  await waitFor(() => expect(byId('article').querySelector('.changed, .added, .diffbox')).not.toBeNull()); // 本文には、差分の装飾が重なっている
  fireEvent.click(saveBtn());
  await savedAll();
  expect(saved).toEqual([{ name: 'demo-v3.md', text: md('root', 3) }]);
  expect(saved[0]?.text).not.toContain('diff');

  // 過去の版
  saved.length = 0;
  act(() => {
    location.hash = '#/demo/root/v1';
  });
  await waitFor(() => expect(byId('article')).toHaveTextContent('root の v1'));
  await waitFor(() => expect(saveBtn()).toBeEnabled());
  fireEvent.click(saveBtn());
  await savedAll();
  expect(saved).toEqual([{ name: 'demo-v1.md', text: md('root', 1) }]);

  // 子ページ（版が 1 つ）
  saved.length = 0;
  act(() => {
    location.hash = '#/demo/sub';
  });
  await waitFor(() => expect(byId('article')).toHaveTextContent('sub の v1'));
  await waitFor(() => expect(saveBtn()).toBeEnabled());
  fireEvent.click(saveBtn());
  await savedAll();
  expect(saved).toEqual([{ name: 'demo-sub-v1.md', text: md('sub', 1) }]);
});

test('本文が届くまで・取得に失敗したあいだは、押せない（成功に見せない）。届けば、押せる', async () => {
  stubSave();
  let fail = true;
  server({ pageStatus: () => (fail ? 500 : 200) });
  location.hash = '#/demo/sub';
  renderWithClient(<App />);
  await waitFor(() => expect(saveBtn()).toBeInTheDocument());
  expect(saveBtn()).toBeDisabled();
  await waitFor(() => expect(saveBtn()).toHaveAttribute('title', '本文を取得できないため、保存できません'));
  fireEvent.click(saveBtn());
  expect(saved).toEqual([]);
  fail = false;
  // 取り直しは、トピックの更新が契機：版の切り替えで、別のキーを取る
  act(() => {
    location.hash = '#/demo/root/v2';
  });
  await waitFor(() => expect(saveBtn()).toBeEnabled());
  expect(saveBtn().getAttribute('title')).toContain('demo-v2.md');
});

test('版を切り替えた直後は、新しい版が届くまで押せない（前の版の本文を、新しい版の名前で保存しない）', async () => {
  stubSave();
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => {
    release = r;
  });
  mockFetch(async (req) => {
    if (req.path === '/api/topics') return { body: [summary('demo')] };
    if (/^\/api\/topic\/demo$/.test(req.path)) return { body: topicState({ meta: meta(pages) }) };
    const p = /^\/api\/page\/demo\/([^/]+)\/(\d+)$/.exec(req.path);
    if (p) {
      if (p[2] === '1') await gate;
      return { body: { markdown: md(p[1] as string, Number(p[2])) } };
    }
    return undefined;
  });
  location.hash = '#/demo/root/v3';
  renderWithClient(<App />);
  await waitFor(() => expect(saveBtn()).toBeEnabled());
  act(() => {
    location.hash = '#/demo/root/v1';
  });
  await waitFor(() => expect(saveBtn()).toBeDisabled());
  fireEvent.click(saveBtn());
  expect(saved).toEqual([]);
  await act(async () => release());
  await waitFor(() => expect(saveBtn()).toBeEnabled());
  fireEvent.click(saveBtn());
  await savedAll();
  expect(saved).toEqual([{ name: 'demo-v1.md', text: md('root', 1) }]);
});

test('ファイルを作れなかったら、エラーのトーストで知らせる（成功に見せない）', async () => {
  server();
  Object.assign(URL, {
    createObjectURL: () => {
      throw new Error('no blob');
    },
    revokeObjectURL: () => {},
  });
  location.hash = '#/demo/root';
  renderWithClient(<App />);
  await waitFor(() => expect(saveBtn()).toBeEnabled());
  fireEvent.click(saveBtn());
  await screen.findByText(/保存できませんでした/);
  expect(byId('toast')).toHaveClass('err');
});

test('並べて比べる画面では、出さない（左右のどちらの版か、決まらない）。閉じると、戻る', async () => {
  stubSave();
  server();
  location.hash = '#/demo/root';
  renderWithClient(<App />);
  await waitFor(() => expect(saveBtn()).toBeEnabled());
  fireEvent.click(document.getElementById('btn-compare') as Element);
  await waitFor(() => expect(document.getElementById('compare')).not.toBeNull());
  expect(document.getElementById('btn-save-md')).toBeNull();
  fireEvent.click(document.querySelector('#docbar [data-mode="normal"]') as Element);
  await waitFor(() => expect(document.getElementById('compare')).toBeNull());
  await waitFor(() => expect(saveBtn()).toBeEnabled());
});
