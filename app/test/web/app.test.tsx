// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import type { Anchor, Meta, Thread } from '../../src/shared/types';
import { App } from '../../src/web/App';
import { type TopicState, topicKey } from '../../src/web/api/queries';
import { queryClient } from '../../src/web/api/queryClient';
import { UI_KEY } from '../../src/web/lib/storage';
import { useDoc } from '../../src/web/store/doc';
import { useUi } from '../../src/web/store/ui';
import {
  installDialog,
  installPointerCapture,
  meta,
  mockFetch,
  msg,
  renderWithClient,
  resetAll,
  summary,
  thread,
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

type Summary = ReturnType<typeof summary> | { slug: string; title: string; unsupported: true };

/** サーバーの代用：一覧・トピック・ページの本文 */
function server(
  topics: Summary[],
  states: Record<string, TopicState> = {},
  md: (page: string, v: number) => string = (p, v) => `本文 ${p} v${v}`,
) {
  return mockFetch((req) => {
    if (req.path === '/api/topics') return { body: topics };
    const t = /^\/api\/topic\/([^/]+)$/.exec(req.path);
    if (t) {
      const s = states[t[1] as string];
      return s ? { body: s } : { status: 404, body: { ok: false, error: 'トピックがありません' } };
    }
    const p = /^\/api\/page\/([^/]+)\/([^/]+)\/(\d+)$/.exec(req.path);
    if (p) return { body: { markdown: md(p[2] as string, Number(p[3])) } };
    return undefined;
  });
}

const anchor: Anchor = {
  blockId: 'b',
  blockHash: 'h',
  blockTag: 'p',
  blockText: 't',
  quote: 'q',
  prefix: '',
  suffix: '',
  label: '',
};
const byId = (id: string) => document.getElementById(id) as HTMLElement;
const pages2: Meta['pages'] = {
  root: { title: '全体', parent: null, versions: 2, createdAt: '' },
  detail: { title: '詳細', parent: 'root', versions: 1, createdAt: '' },
};

test('旧 index.html の ID が、そろっている（旧 CSS・旧の確認手順を使い回すため）', async () => {
  server([]);
  renderWithClient(<App />);
  await screen.findByText('トピックがありません。/rikai で資料を作ってください。');
  for (const id of [
    'app',
    'top',
    'btn-side',
    'top-title',
    'top-status',
    'btn-submit',
    'btn-end',
    'side',
    'doc',
    'docbar',
    'docscroll',
    'article',
    'badges',
    'regsel',
    'regbtn',
    'threads',
    'panel-resizer',
    'lightbox',
    'actbar',
    'act-comment',
    'toast',
    'submitdlg',
    'submitdlg-summary',
    'submitdlg-note',
    'submitdlg-ok',
    'enddlg',
    'enddlg-ok',
    'ended',
    'ended-box',
  ]) {
    expect(byId(id), `#${id}`).not.toBeNull();
  }
  expect(byId('article')).toHaveClass('md');
  expect(byId('docscroll')).toContainElement(byId('article'));
  expect(byId('docscroll')).toContainElement(byId('badges'));
  expect(byId('docscroll')).toContainElement(byId('regsel'));
  expect(byId('doc')).toContainElement(byId('regbtn'));
  expect(byId('app')).toContainElement(byId('threads'));
  expect(byId('app')).toContainElement(byId('panel-resizer'));
  expect(byId('app')).not.toContainElement(byId('toast'));
});

test('トピックなし：案内・Submit は押せない・終了のダイアログは開ける', async () => {
  server([]);
  renderWithClient(<App />);
  await screen.findByText('トピックがありません。/rikai で資料を作ってください。');
  expect(byId('btn-submit')).toBeDisabled();
  expect(byId('btn-submit')).toHaveTextContent('Submit');
  expect(byId('top-title')).toHaveTextContent('');
  expect(byId('ended')).toHaveAttribute('hidden');
  fireEvent.click(byId('btn-end'));
  expect((byId('enddlg') as HTMLDialogElement).open).toBe(true);
});

test('読めないトピックだけ：案内と「新しい形式」の印。押せない（リンクにならない）', async () => {
  server([{ slug: 'future', title: '新しい題', unsupported: true }]);
  renderWithClient(<App />);
  await screen.findByText('読めるトピックがありません（新しい形式のトピックだけです）。rikai を更新してください。');
  const side = byId('side');
  expect(within(side).getByText('新しい題').closest('.topic-off')).not.toBeNull(); // 題は、アイコンと並ぶ（押せない行）
  expect(within(side).queryByRole('link')).toBeNull();
  expect(within(side).getByText('新しい形式')).toHaveClass('chip', 'warn', 'small');
  expect(location.hash).toBe('');
});

test('ルートなし：最初の読めるトピックへ移り、題・本文・ページの木が出る', async () => {
  const { calls } = server(
    [{ slug: 'old', title: '読めない', unsupported: true }, summary('demo', { title: 'デモ' })],
    { demo: topicState({ meta: meta({ title: 'デモ' }), threads: [thread()] }) },
  );
  renderWithClient(<App />);
  await waitFor(() => expect(location.hash).toBe('#/demo/root'));
  await waitFor(() => expect(byId('top-title')).toHaveTextContent('デモ'));
  await waitFor(() => expect(byId('article')).toHaveTextContent('本文 root v1'));
  expect(byId('side').querySelector('li.cur')).toHaveTextContent('デモ');
  expect(within(byId('side')).getByText('ページ')).toBeInTheDocument();
  expect(calls.some((c) => c.path === '/api/topic/old')).toBe(false);
  await waitFor(() => expect(useDoc.getState().model?.key).toBe('demo/root/1'));
});

test('読めない形式のトピックを開く：専用の案内・そのトピックは取りにいかない', async () => {
  location.hash = '#/future/root';
  const { calls } = server([{ slug: 'future', title: '新しい題', unsupported: true }]);
  renderWithClient(<App />);
  await screen.findByText('「新しい題」は、この rikai が読めない新しい形式です。rikai を更新してください。');
  expect(calls.some((c) => c.path.startsWith('/api/topic/'))).toBe(false);
  expect(byId('top-title')).toHaveTextContent('');
});

test('上のバー：解決 N/M・回答 K/L・Submit (件数)・押すと、件数の文言つきのダイアログ', async () => {
  location.hash = '#/demo/root';
  const ask: Thread = thread({
    id: 't2',
    resolved: true,
    messages: [
      msg({ id: 'q1', author: 'ai', kind: 'reply', sent: true, ask: { type: 'yes_no', question: '？' } }),
      msg({ id: 'a1', kind: 'answer', to: 'q1', answer: { value: true }, sent: true }),
    ],
  });
  server([summary('demo')], { demo: topicState({ unsent: 2, threads: [thread(), ask] }) });
  renderWithClient(<App />);
  await waitFor(() => expect(byId('top-status')).toHaveTextContent('解決 1/2・回答 1/1'));
  expect(byId('btn-submit')).toHaveTextContent('Submit (2)');
  expect(byId('btn-submit')).toBeEnabled();
  fireEvent.click(byId('btn-submit'));
  expect((byId('submitdlg') as HTMLDialogElement).open).toBe(true);
  expect(byId('submitdlg-summary')).toHaveTextContent('未送信のコメント・回答など 2 件を AI に送ります。');
});

test('AI の返信待ち：札・ヒント・コピー（クリップボードへ）', async () => {
  location.hash = '#/demo/root';
  const writeText = vi.fn(async () => undefined);
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
  server([summary('demo')], { demo: topicState({ meta: meta({ pending: [1] }) }) });
  renderWithClient(<App />);
  await within(byId('top-status')).findByText('AIの返信待ち');
  expect(byId('top-status')).toHaveTextContent('Claude Code 以外は「rikai に送りました」と伝えてください');
  fireEvent.click(within(byId('top-status')).getByRole('button', { name: 'コピー' }));
  expect(writeText).toHaveBeenCalledWith('rikai(demo)に送りました。rikai pull demo で読んで返信してください');
  await waitFor(() => expect(useUi.getState().toast?.msg).toBe('コピーしました'));
});

test('終了したトピック：全面の表示（ほかに開いているトピックがあれば、リンク）', async () => {
  location.hash = '#/demo/root';
  server(
    [
      summary('demo', { closed: true }),
      summary('other', { title: '別の題' }),
      summary('done', { closed: true }),
      { slug: 'x', title: '読めない', unsupported: true },
    ],
    { demo: topicState({ meta: meta({ closed: true }) }) },
  );
  renderWithClient(<App />);
  await waitFor(() => expect(byId('ended')).not.toHaveAttribute('hidden'));
  const box = byId('ended-box');
  expect(within(box).getByRole('heading')).toHaveTextContent('このトピックのレビューを終了しました');
  expect(within(box).getByText('ほかに、開いているトピックがあります。')).toBeInTheDocument();
  const links = within(box).getAllByRole('link');
  expect(links).toHaveLength(1);
  expect(links[0]).toHaveTextContent('別の題');
  expect(links[0]).toHaveAttribute('href', '#/other/root');
});

test('終了したトピック：ほかになければ「このタブは閉じて構いません」', async () => {
  location.hash = '#/demo/root';
  server([summary('demo', { closed: true })], { demo: topicState({ meta: meta({ closed: true }) }) });
  renderWithClient(<App />);
  await waitFor(() => expect(byId('ended')).not.toHaveAttribute('hidden'));
  expect(byId('ended-box')).toHaveTextContent('このタブは閉じて構いません。続きはもう一度 /rikai で開けます。');
  expect(byId('ended-box').querySelector('code')).toHaveTextContent('/rikai');
});

test('接続できない：上のバーに「サーバーに接続できません」。前の表示は残す', async () => {
  location.hash = '#/demo/root';
  let down = false;
  mockFetch((req) => {
    if (down) throw new TypeError('Failed to fetch');
    if (req.path === '/api/topics') return { body: [summary('demo')] };
    if (req.path === '/api/topic/demo') return { body: topicState() };
    return { body: { markdown: '本文' } };
  });
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    renderWithClient(<App />);
    await waitFor(() => expect(byId('top-title')).toHaveTextContent('デモの資料'));
    down = true;
    await act(() => vi.advanceTimersByTimeAsync(1600));
    await act(() => vi.advanceTimersByTimeAsync(100));
    await within(byId('top-status')).findByText('サーバーに接続できません');
    expect(byId('top-title')).toHaveTextContent('デモの資料');
    down = false;
    await act(() => vi.advanceTimersByTimeAsync(1600));
    await act(() => vi.advanceTimersByTimeAsync(100));
    await waitFor(() => expect(within(byId('top-status')).queryByText('サーバーに接続できません')).toBeNull());
  } finally {
    vi.useRealTimers();
  }
});

test('サーバーのエラー：status つきの失敗は「サーバーのエラー: …」（接続できないとは、別）', async () => {
  location.hash = '#/demo/root';
  mockFetch((req) => {
    if (req.path === '/api/topics') return { body: [summary('demo')] };
    return { status: 500, body: { ok: false, error: '内部エラー' } };
  });
  renderWithClient(<App />);
  const chip = await within(byId('top-status')).findByText('サーバーのエラー: 内部エラー');
  expect(chip).toHaveAttribute('title', '内部エラー');
  expect(within(byId('top-status')).queryByText('サーバーに接続できません')).toBeNull();
});

test('版・ページ：パンくず・版の選択（新しい順・最新に印）・過去の版の警告と「最新版へ」', async () => {
  location.hash = '#/demo/detail';
  server([summary('demo')], { demo: topicState({ meta: meta({ pages: pages2 }) }) });
  renderWithClient(<App />);
  await waitFor(() => expect(byId('article')).toHaveTextContent('本文 detail v1'));
  const crumbs = byId('docbar').querySelector('nav.crumbs') as HTMLElement;
  expect(within(crumbs).getByRole('link', { name: '全体' })).toHaveAttribute('href', '#/demo/root');
  expect(within(crumbs).getByText('詳細')).toHaveClass('here');
  expect(byId('docbar').querySelector('select')).toBeNull(); // 1 版しかない

  act(() => {
    location.hash = '#/demo/root/v1';
  });
  await waitFor(() => expect(byId('article')).toHaveTextContent('本文 root v1'));
  const sel = byId('docbar').querySelector('select') as HTMLSelectElement;
  expect([...sel.options].map((o) => o.textContent)).toEqual(['v2（最新）', 'v1']);
  expect(sel.value).toBe('1');
  expect(byId('docbar')).toHaveTextContent('過去の版 v1 を表示中（コメントは最新版にだけ付けられます）');
  expect(within(byId('docbar')).getByRole('link', { name: '最新版へ' })).toHaveAttribute('href', '#/demo/root');
  expect(byId('docbar').querySelector('[data-key="chk-changes"]')).toBeNull(); // v1 は、差分なし

  fireEvent.change(sel, { target: { value: '2' } });
  expect(location.hash).toBe('#/demo/root'); // 最新版は、版を付けない
  await waitFor(() => expect(byId('article')).toHaveTextContent('本文 root v2'));
  const chk = byId('docbar').querySelector('[data-key="chk-changes"]') as HTMLInputElement;
  expect(chk.checked).toBe(true);
  expect(byId('docbar')).toHaveTextContent('前の版からの変更を表示');
  expect(byId('docbar')).not.toHaveTextContent('過去の版');
  fireEvent.click(chk);
  expect(useUi.getState().showChanges).toBe(false);
  fireEvent.change(sel, { target: { value: '1' } });
  expect(location.hash).toBe('#/demo/root/v1');
});

test('v2 を見ていると、前の版（v1）の本文も取る。変更の数は、本文の島が DocModel に入れたもの', async () => {
  location.hash = '#/demo/root';
  const { calls } = server([summary('demo')], { demo: topicState({ meta: meta({ pages: pages2 }) }) });
  renderWithClient(<App />);
  await waitFor(() => expect(byId('article')).toHaveTextContent('本文 root v2'));
  expect(
    calls
      .filter((c) => c.path.startsWith('/api/page/'))
      .map((c) => c.path)
      .sort(),
  ).toEqual(['/api/page/demo/root/1', '/api/page/demo/root/2']);
  act(() => {
    const m = useDoc.getState().model;
    if (m) useDoc.getState().setModel({ ...m, diff: { changed: 2, added: 1, removed: 0 } });
  });
  expect(byId('docbar')).toHaveTextContent('変更 2・追加 1・削除 0');
  expect(byId('docbar')).toHaveTextContent('右端の緑の線：前の版から変えたところ');
  // 別のページ・版の DocModel の件数は、出さない
  act(() => {
    const m = useDoc.getState().model;
    if (m) useDoc.getState().setModel({ ...m, key: 'demo/root/1' });
  });
  expect(byId('docbar')).not.toHaveTextContent('変更 2');
});

test('左の一覧：進み具合・待ち・終了の印と、ページの木（未解決の数・版）', async () => {
  location.hash = '#/demo/root';
  server(
    [
      summary('demo', {
        title: 'デモ',
        progress: { threads: { total: 9, resolved: 9, open: 0 }, asks: { total: 0, answered: 0 } },
      }),
      summary('b', {
        title: 'ビー',
        pending: 1,
        progress: { threads: { total: 4, resolved: 1, open: 3 }, asks: { total: 0, answered: 0 } },
      }),
      summary('c', { title: 'シー', closed: true }),
    ],
    {
      demo: topicState({
        meta: meta({ pages: pages2 }),
        threads: [
          thread({ id: 't1', page: 'detail' }),
          thread({ id: 't2', page: 'detail', resolved: true }),
          thread({ id: 't3', page: 'root' }),
        ],
      }),
    },
  );
  renderWithClient(<App />);
  const side = byId('side');
  // 開いているトピックは、画面のスレッドから数える（一覧の 9/9 ではなく 1/3）
  await waitFor(() => expect(side.querySelector('li.cur .chip')).toHaveTextContent('1/3'));
  const b = within(side).getByText('ビー').closest('li') as HTMLElement;
  expect(b).toHaveTextContent('1/4');
  expect(within(b).getByText('待ち')).toHaveClass('chip', 'wait', 'small');
  expect(within(within(side).getByText('シー').closest('li') as HTMLElement).getByText('終了')).toBeInTheDocument();
  const tree = side.querySelector('ul.tree') as HTMLElement;
  expect(within(tree).getByRole('link', { name: /全体/ })).toHaveClass('cur');
  const detail = within(tree).getByRole('link', { name: /詳細/ });
  expect(detail).toHaveTextContent('詳細 v11');
  expect(detail.querySelector('.badge')).toHaveTextContent('1');
  expect(detail).toHaveAttribute('href', '#/demo/detail');
});

test('左の一覧の開閉・右の幅は、保存した設定から。#app に、side-collapsed と --panel-w', async () => {
  localStorage.setItem(
    UI_KEY,
    JSON.stringify({ sideOpen: false, panelW: 500, links: true, theme: 'system', notify: false }),
  );
  useUi.setState({ ui: { sideOpen: false, panelW: 500, links: true, theme: 'system', notify: false } });
  server([]);
  renderWithClient(<App />);
  await screen.findByText('トピックがありません。/rikai で資料を作ってください。');
  expect(byId('app')).toHaveClass('side-collapsed');
  expect(byId('app').style.getPropertyValue('--panel-w')).toBe('500px');
  expect(byId('btn-side')).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(byId('btn-side'));
  expect(byId('app')).not.toHaveClass('side-collapsed');
  expect(byId('btn-side')).toHaveAttribute('aria-expanded', 'true');
  expect(JSON.parse(localStorage.getItem(UI_KEY) ?? '{}').sideOpen).toBe(true);
  // 窓が狭いと、上限で抑える
  act(() => {
    Object.defineProperty(window, 'innerWidth', { value: 900, configurable: true });
    window.dispatchEvent(new Event('resize'));
  });
  expect(byId('app').style.getPropertyValue('--panel-w')).toBe('332px'); // 900 − 168（狭い窓の左の一覧）− 400（狭い窓の、本文の最小）。狭い窓（〜900px）は、本文を広く残す（RIK-040）
});

test('トースト：出る・エラーは 6 秒・通常は 2.8 秒で消える', async () => {
  server([]);
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    renderWithClient(<App />);
    await screen.findByText('トピックがありません。/rikai で資料を作ってください。');
    expect(byId('toast')).toHaveAttribute('hidden');
    act(() => useUi.getState().showToast('保存しました'));
    expect(byId('toast')).not.toHaveAttribute('hidden');
    expect(byId('toast')).toHaveTextContent('保存しました');
    expect(byId('toast')).not.toHaveClass('err');
    await act(() => vi.advanceTimersByTimeAsync(2700));
    expect(byId('toast')).not.toHaveAttribute('hidden');
    await act(() => vi.advanceTimersByTimeAsync(200));
    expect(byId('toast')).toHaveAttribute('hidden');
    act(() => useUi.getState().showToast('失敗', true));
    expect(byId('toast')).toHaveClass('err');
    await act(() => vi.advanceTimersByTimeAsync(5900));
    expect(byId('toast')).not.toHaveAttribute('hidden');
    await act(() => vi.advanceTimersByTimeAsync(200));
    expect(byId('toast')).toHaveAttribute('hidden');
    // 出し直すと、消す時刻も、取り直す
    act(() => useUi.getState().showToast('1'));
    await act(() => vi.advanceTimersByTimeAsync(2000));
    act(() => useUi.getState().showToast('2'));
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(byId('toast')).toHaveTextContent('2');
    expect(byId('toast')).not.toHaveAttribute('hidden');
  } finally {
    vi.useRealTimers();
  }
});

test('資料が更新された：最新版を見ていれば「資料が vN に更新されました」', async () => {
  location.hash = '#/demo/root';
  let versions = 1;
  mockFetch((req) => {
    if (req.path === '/api/topics') return { body: [summary('demo')] };
    if (req.path === '/api/topic/demo')
      return {
        body: topicState({
          rev: versions,
          meta: meta({ rev: versions, pages: { root: { title: 'T', parent: null, versions, createdAt: '' } } }),
        }),
      };
    return { body: { markdown: '本文' } };
  });
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    renderWithClient(<App />);
    await waitFor(() => expect(byId('article')).toHaveTextContent('本文'));
    expect(useUi.getState().toast).toBeNull();
    versions = 2;
    await act(() => vi.advanceTimersByTimeAsync(1600));
    await act(() => vi.advanceTimersByTimeAsync(100));
    await waitFor(() => expect(useUi.getState().toast?.msg).toBe('資料が v2 に更新されました'));
  } finally {
    vi.useRealTimers();
  }
});

test('ページ・版を移ると、入力欄は閉じる。同じ版（最新版を /v2 と明示）なら、閉じない。トピックを移ると、添付の画像も捨てる', async () => {
  location.hash = '#/demo/root';
  server([summary('demo'), summary('other')], {
    demo: topicState({ meta: meta({ pages: pages2 }) }),
    other: topicState({ meta: meta({ slug: 'other' }) }),
  });
  renderWithClient(<App />);
  await waitFor(() => expect(byId('article')).toHaveTextContent('本文 root v2'));
  act(() => {
    useUi.getState().startComposer(anchor);
    useUi.getState().setComposerDraft('書きかけ');
    useUi.getState().addDraftImg('composer', 'a.png');
    useUi.getState().addDraftImg('reply-t1', 'b.png');
    useUi.getState().setActive('t1');
  });
  expect(useUi.getState().composer).not.toBeNull();

  act(() => {
    location.hash = '#/demo/root/v2';
  });
  await waitFor(() => expect(useUi.getState().active).toBeNull()); // 見ている場所が変わった
  expect(useUi.getState().composer).not.toBeNull(); // でも、同じ版

  act(() => {
    location.hash = '#/demo/detail';
  });
  await waitFor(() => expect(useUi.getState().composer).toBeNull());
  expect(useUi.getState().drafts.composer).toBe('');
  expect(useUi.getState().drafts.imgs['reply-t1']).toEqual(['b.png']); // 同じトピックの返信の画像は、残る

  act(() => {
    location.hash = '#/other/root';
  });
  await waitFor(() => expect(byId('top-title')).toHaveTextContent('デモの資料'));
  expect(useUi.getState().drafts.imgs).toEqual({ composer: [] }); // 入力欄を閉じると、空の composer が入る（旧と同じ）
});

test('本文の中のページへのリンク（a.pagelink・a.pagecard）を押すと、入力欄の対象を閉じる（書きかけは残す）', async () => {
  location.hash = '#/demo/root';
  server([summary('demo')], { demo: topicState({ meta: meta({ pages: pages2 }) }) });
  renderWithClient(<App />);
  await waitFor(() => expect(byId('article')).toHaveTextContent('本文 root v2'));
  act(() => {
    useUi.getState().startComposer(anchor);
    useUi.getState().setComposerDraft('書きかけ');
  });
  const a = document.createElement('a');
  a.className = 'pagelink';
  a.href = '#/demo/detail';
  byId('article').append(a);
  fireEvent.click(a);
  expect(useUi.getState().composer).toBeNull();
  expect(useUi.getState().drafts.composer).toBe('書きかけ');
});

test('存在しない版（範囲外）は、トーストで知らせる', async () => {
  location.hash = '#/demo/root/v9';
  mockFetch((req) => {
    if (req.path === '/api/topics') return { body: [summary('demo')] };
    if (req.path === '/api/topic/demo') return { body: topicState() };
    return { status: 404, body: { ok: false, error: 'ページがありません' } };
  });
  renderWithClient(<App />);
  await waitFor(() => expect(useUi.getState().toast).toMatchObject({ msg: 'ページがありません', err: true }));
});

test('キャッシュは、テスト間で持ち越さない（確認）', () => {
  expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
});

test('本文の取得に失敗した：トピックの更新が来たら、取り直す。失敗している間は、前のトピックの本文の上に、コメントの入口（範囲を選ぶ）を出さない', async () => {
  location.hash = '#/a/root';
  let failB = 1;
  mockFetch((req) => {
    if (req.path === '/api/topics') return { body: [summary('a'), summary('b')] };
    const t = /^\/api\/topic\/([^/]+)$/.exec(req.path);
    if (t) return { body: topicState({ meta: meta({ slug: t[1] as string, title: `題 ${t[1]}` }) }) };
    const p = /^\/api\/page\/([^/]+)\//.exec(req.path);
    if (p?.[1] === 'b' && failB-- > 0) return { status: 500, body: { ok: false, error: '一時的な失敗' } };
    return { body: { markdown: `本文 ${p?.[1]}` } };
  });
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    renderWithClient(<App />);
    await waitFor(() => expect(byId('article')).toHaveTextContent('本文 a'));
    await waitFor(() => expect(byId('regbtn')).not.toHaveAttribute('hidden'));
    act(() => {
      location.hash = '#/b/root';
    });
    await waitFor(() => expect(byId('top-title')).toHaveTextContent('題 b'));
    await waitFor(() => expect(useUi.getState().toast?.msg).toContain('一時的な失敗'));
    // 上のバーは b・本文は a のまま：食い違っている間は、入口を出さない
    expect(byId('article')).toHaveTextContent('本文 a');
    expect(byId('regbtn')).toHaveAttribute('hidden');
    // 次のトピックの更新で、取り直す
    await act(() => vi.advanceTimersByTimeAsync(1600));
    await act(() => vi.advanceTimersByTimeAsync(100));
    await waitFor(() => expect(byId('article')).toHaveTextContent('本文 b'));
    await waitFor(() => expect(byId('regbtn')).not.toHaveAttribute('hidden'));
  } finally {
    vi.useRealTimers();
  }
});

test('外観の変化（上のバーのボタン）で、配色への対応を示した html-app の枠に theme（by: auto）が届く（再読み込みしない：iframe は、同じもの・src も、そのまま）', async () => {
  location.hash = '#/a/root';
  document.documentElement.removeAttribute('data-theme');
  mockFetch((req) => {
    if (req.path === '/api/topics') return { body: [summary('a')] };
    if (/^\/api\/topic\/a$/.test(req.path)) return { body: topicState({ meta: meta({ slug: 'a', title: '題 a' }) }) };
    if (/^\/api\/page\//.test(req.path))
      return { body: { markdown: '```html-app\n<b style="color:var(--color-ink)">x</b>\n```\n' } };
    return undefined;
  });
  renderWithClient(<App />);
  await waitFor(() => expect(document.querySelector('#article iframe.appframe')).not.toBeNull());
  const frame = document.querySelector('#article iframe.appframe') as HTMLIFrameElement;
  const src = frame.getAttribute('src');
  expect(src).toMatch(/\?mode=light$/);
  const send = vi.spyOn(frame.contentWindow as Window, 'postMessage');
  // system → light（見た目は、同じ light：送らない）→ dark（送る）
  fireEvent.click(byId('btn-theme'));
  await act(async () => {});
  expect(send).not.toHaveBeenCalled();
  fireEvent.click(byId('btn-theme'));
  await act(async () => {});
  expect(send).toHaveBeenCalledWith({ __rikai: 1, type: 'theme', mode: 'dark', by: 'auto' }, '*');
  expect(document.querySelector('#article iframe.appframe')).toBe(frame);
  expect(frame.getAttribute('src')).toBe(src);
  document.documentElement.removeAttribute('data-theme');
});

// 自動で隠す窓（788px 未満）の左の一覧（ドロワー）・狭い窓の取っ手の幅：どちらも保存しない一時の状態（RIK-040）
const resizeTo = (w: number) =>
  act(() => {
    Object.defineProperty(window, 'innerWidth', { value: w, configurable: true });
    window.dispatchEvent(new Event('resize'));
  });

test('〜787px：☰ で、左の一覧が、本文の上に重なる（side-drawer）。本文・右の幅は、変わらない。Esc・外を押す・☰ で、しまう', async () => {
  server([]);
  renderWithClient(<App />);
  await screen.findByText('トピックがありません。/rikai で資料を作ってください。');
  resizeTo(600);
  const panelW = () => byId('app').style.getPropertyValue('--panel-w');
  expect(byId('app')).toHaveClass('side-collapsed');
  expect(byId('app')).not.toHaveClass('side-drawer');
  expect(byId('btn-side')).toHaveAttribute('aria-expanded', 'false');
  const before = panelW();
  fireEvent.click(byId('btn-side'));
  expect(byId('app')).toHaveClass('side-collapsed', 'side-drawer'); // 列の幅は 0 のまま（本文は、つぶれない）
  expect(byId('btn-side')).toHaveAttribute('aria-expanded', 'true');
  expect(panelW()).toBe(before);
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(byId('app')).not.toHaveClass('side-drawer');
  fireEvent.click(byId('btn-side'));
  fireEvent.pointerDown(byId('doc'));
  expect(byId('app')).not.toHaveClass('side-drawer');
  fireEvent.click(byId('btn-side'));
  fireEvent.pointerDown(byId('side')); // 一覧の中は、閉じない
  expect(byId('app')).toHaveClass('side-drawer');
  fireEvent.pointerDown(byId('btn-side'));
  fireEvent.click(byId('btn-side')); // ☰ で、しまう
  expect(byId('app')).not.toHaveClass('side-drawer');
  expect(localStorage.getItem(UI_KEY)).toBeNull(); // どれも、保存しない
});

test('回帰：600px で ☰ → 800px で ☰（しまう：保存）→ 600px に戻しても、左の一覧は、勝手に出てこない', async () => {
  server([]);
  renderWithClient(<App />);
  await screen.findByText('トピックがありません。/rikai で資料を作ってください。');
  resizeTo(600);
  fireEvent.click(byId('btn-side'));
  expect(byId('app')).toHaveClass('side-drawer');
  resizeTo(800); // 自動で隠す窓を出る：重ねた一覧は、しまう
  expect(byId('app')).not.toHaveClass('side-drawer');
  expect(useUi.getState().narrowSideOpen).toBe(false);
  expect(byId('app')).not.toHaveClass('side-collapsed'); // 保存した開閉（開）：並ぶ
  fireEvent.click(byId('btn-side')); // しまう（保存）
  expect(byId('app')).toHaveClass('side-collapsed');
  expect(JSON.parse(localStorage.getItem(UI_KEY) ?? '{}').sideOpen).toBe(false);
  resizeTo(600);
  expect(byId('app')).not.toHaveClass('side-drawer');
  expect(byId('btn-side')).toHaveAttribute('aria-expanded', 'false');
});

test('狭い窓の取っ手の幅は、窓を広げると、捨てる：保存した幅（380）のまま、書き換わらない', async () => {
  server([]);
  renderWithClient(<App />);
  await screen.findByText('トピックがありません。/rikai で資料を作ってください。');
  resizeTo(800);
  expect(byId('app').style.getPropertyValue('--panel-w')).toBe('232px');
  fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowRight' });
  expect(byId('app').style.getPropertyValue('--panel-w')).toBe('220px');
  expect(useUi.getState().ui.panelW).toBe(380);
  expect(localStorage.getItem(UI_KEY)).toBeNull();
  resizeTo(1200);
  expect(useUi.getState().panelWNarrow).toBeNull();
  expect(byId('app').style.getPropertyValue('--panel-w')).toBe('380px');
});

test('タブのタイトル（F39）：いま、誰の番か・資料の題。状態が変わると、変わる。トピックがないとき rikai', async () => {
  location.hash = '#/demo/root';
  server([summary('demo')], { demo: topicState({ unsent: 3, threads: [thread()] }) });
  renderWithClient(<App />);
  await waitFor(() => expect(document.title).toBe('未送信 3 件 | デモの資料 | rikai'));
  // Submit 済み → AI の返信待ち
  queryClient.setQueryData(
    topicKey('demo'),
    topicState({ rev: 2, meta: meta({ rev: 2, pending: [1] }), threads: [thread()] }),
  );
  await waitFor(() => expect(document.title).toBe('AIの返信待ち | デモの資料 | rikai'));
  // AI が返信：あなたの番（新着の返信 1）
  queryClient.setQueryData(
    topicKey('demo'),
    topicState({
      rev: 3,
      meta: meta({ rev: 3 }),
      threads: [thread({ messages: [msg({ id: 'a1', author: 'ai', kind: 'reply', sent: true })] })],
    }),
  );
  await waitFor(() => expect(document.title).toBe('(1) あなたの番 | デモの資料 | rikai'));
});
