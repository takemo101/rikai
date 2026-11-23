// @vitest-environment jsdom
// 操作：コメントを追加・返信・編集・削除・解決・再開。成功したら、下書きを消して、取り直す。失敗は、トースト（下書きは、残す）
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { queryClient } from '../../../src/web/api/queryClient';
import { useUi } from '../../../src/web/store/ui';
import { resetAll } from '../helpers';
import { ai, anchor, renderPanel, stubScroll, thread, user } from './fixtures';

beforeEach(() => {
  resetAll();
  stubScroll();
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

const q = (sel: string, root: ParentNode = document) => root.querySelector<HTMLElement>(sel);
const qa = (sel: string, root: ParentNode = document) => [...root.querySelectorAll<HTMLElement>(sel)];
const text = (el: Element | null) => el?.textContent ?? '';

// ---- コメントを追加（F4・F5） ----
test('コメントを追加：入力欄に書いて「コメントを追加」→ POST（対象・版・文・画像）→ 入力欄が閉じる・追加したカードが選ばれる（active）・「解決済み」の切り替えなら「進行中」へ・1 枚だけ見ていても、一覧へ戻る', async () => {
  const a = anchor('選んだ文');
  const view = renderPanel([thread({ id: 't1', messages: [user('先のコメント')] })], {
    onPost: (path, _body, server) => {
      if (path !== '/api/comment') return undefined;
      server.threads = [
        ...server.threads,
        thread({ id: 't9', anchor: a, messages: [user('新しい質問', { sent: false })] }),
      ];
      return { thread: 't9' };
    },
  });
  act(() => {
    useUi.getState().startComposer(a);
    useUi.getState().setTab('done');
    useUi.getState().openSolo('t1');
  });
  const ta = q('textarea[data-key="composer"]') as HTMLTextAreaElement;
  expect(ta).toHaveFocus();
  await userEvent.type(ta, '  新しい質問  ');
  expect(useUi.getState().drafts.composer).toBe('  新しい質問  ');
  await userEvent.click(screen.getByRole('button', { name: 'コメントを追加' }));

  await waitFor(() => expect(q('.thread[data-tid="t9"]')).not.toBeNull());
  expect(view.posts).toHaveLength(1);
  expect(view.posts[0]).toMatchObject({
    path: '/api/comment',
    body: { topic: 'demo', page: 'root', version: 1, anchor: a, text: '新しい質問', images: [] }, // 前後の空白は、除く
  });
  expect(q('.thread.composer')).toBeNull();
  const ui = useUi.getState();
  expect(ui).toMatchObject({ composer: null, active: 't9', solo: null, tab: 'live' });
  expect(ui.drafts.composer).toBe('');
  expect(q('.thread[data-tid="t9"]')).toHaveClass('active', 'draft');
  expect(qa('#threads .thread').map((c) => c.dataset.tid)).toEqual(['t1', 't9']);
  await waitFor(() =>
    expect(Element.prototype.scrollIntoView).toHaveBeenLastCalledWith({ block: 'nearest', behavior: 'smooth' }),
  );
  // 取り直した（サーバーの、いまのスレッド）
  expect(view.all.some((r) => r.method === 'GET' && r.path === '/api/topic/demo')).toBe(true);
});

test('コメントを追加：空・空白だけは、送らない。⌘/Ctrl+Enter でも追加できる。画像のアップロード中は、断る', async () => {
  const view = renderPanel([], {
    onPost: (path, _body, server) => {
      if (path !== '/api/comment') return undefined;
      server.threads = [thread({ id: 't9', messages: [user('あ', { sent: false })] })];
      return { thread: 't9' };
    },
  });
  act(() => {
    useUi.getState().startComposer(anchor('文'));
  });
  const ta = q('textarea[data-key="composer"]') as HTMLTextAreaElement;
  await userEvent.click(screen.getByRole('button', { name: 'コメントを追加' }));
  await userEvent.type(ta, '   ');
  await userEvent.click(screen.getByRole('button', { name: 'コメントを追加' }));
  expect(view.posts).toHaveLength(0);

  act(() => useUi.getState().beginUpload());
  await userEvent.type(ta, 'あ');
  await userEvent.keyboard('{Control>}{Enter}{/Control}');
  expect(view.posts).toHaveLength(0);
  expect(useUi.getState().toast).toMatchObject({
    msg: '画像のアップロード中です。終わってから、送ってください',
    err: true,
  });
  act(() => useUi.getState().endUpload());

  await userEvent.keyboard('{Control>}{Enter}{/Control}');
  await waitFor(() => expect(view.posts).toHaveLength(1));
  expect(view.posts[0]?.body).toMatchObject({ text: 'あ' });
  await waitFor(() => expect(q('.thread.composer')).toBeNull());
});

test('コメントの追加が失敗したら、トースト・入力欄と書きかけは、残る。送っている間の 2 回押しは、1 件だけ', async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const view = renderPanel([], { onPost: () => ({}) });
  // 失敗する応答に差し替える
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_u: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        await gate;
        return new Response(JSON.stringify({ ok: false, error: '最新版にだけ付けられます' }), { status: 400 });
      }
      return new Response('{}', { status: 404 });
    }),
  );
  act(() => {
    useUi.getState().startComposer(anchor('文'));
  });
  await userEvent.type(q('textarea[data-key="composer"]') as HTMLElement, '書きかけ');
  const add = screen.getByRole('button', { name: 'コメントを追加' });
  await userEvent.click(add);
  await userEvent.click(add);
  release();
  await waitFor(() => expect(useUi.getState().toast).toMatchObject({ msg: '最新版にだけ付けられます', err: true }));
  expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  expect(q('.thread.composer')).not.toBeNull();
  expect(useUi.getState().drafts.composer).toBe('書きかけ');
  expect(view.posts).toHaveLength(0);
});

test('追加の POST が成功して、直後の取り直しだけ失敗しても：下書きは消え、もう一度押しても、二重に保存されない。取り直しが届いたら、入力欄が閉じる', async () => {
  const a = anchor('選んだ文');
  let failRefresh = true;
  const view = renderPanel([], {
    onPost: (path, _body, server) => {
      if (path !== '/api/comment') return undefined;
      server.threads = [thread({ id: 't9', anchor: a, messages: [user('新しい質問', { sent: false })] })];
      return { thread: 't9' };
    },
  });
  const real = fetch;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (u: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method !== 'POST' && failRefresh) throw new TypeError('Failed to fetch');
      return real(u, init);
    }),
  );
  act(() => {
    useUi.getState().startComposer(a);
  });
  await userEvent.type(q('textarea[data-key="composer"]') as HTMLElement, '新しい質問');
  await userEvent.click(screen.getByRole('button', { name: 'コメントを追加' }));
  await waitFor(() => expect(view.posts).toHaveLength(1));
  await waitFor(() => expect(useUi.getState().drafts.composer).toBe(''));
  expect(useUi.getState().toast).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'コメントを追加' }));
  expect(view.posts).toHaveLength(1);
  // 取り直しが届く（次のポーリング）：入力欄が閉じて、カードが出る
  failRefresh = false;
  await act(async () => {
    await queryClient.refetchQueries({ queryKey: ['topic', 'demo'] });
  });
  await waitFor(() => expect(q('.thread[data-tid="t9"]')).not.toBeNull());
  await waitFor(() => expect(q('.thread.composer')).toBeNull());
  expect(useUi.getState().active).toBe('t9');
});

test('追加の取り直しを待つ間に、別の入力欄（対象の選び直し）が開いたら、それは閉じない', async () => {
  const a = anchor('選んだ文');
  let failRefresh = true;
  renderPanel([], {
    onPost: (path, _body, server) => {
      if (path !== '/api/comment') return undefined;
      server.threads = [thread({ id: 't9', anchor: a, messages: [user('x', { sent: false })] })];
      return { thread: 't9' };
    },
  });
  const real = fetch;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (u: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method !== 'POST' && failRefresh) throw new TypeError('Failed to fetch');
      return real(u, init);
    }),
  );
  act(() => {
    useUi.getState().startComposer(a);
  });
  await userEvent.type(q('textarea[data-key="composer"]') as HTMLElement, 'x');
  await userEvent.click(screen.getByRole('button', { name: 'コメントを追加' }));
  await waitFor(() => expect(useUi.getState().drafts.composer).toBe(''));
  act(() => {
    useUi.getState().startComposer(anchor('別の文'));
  });
  const second = useUi.getState().composer?.id;
  failRefresh = false;
  await act(async () => {
    await queryClient.refetchQueries({ queryKey: ['topic', 'demo'] });
  });
  await waitFor(() => expect(q('.thread[data-tid="t9"]')).not.toBeNull());
  expect(useUi.getState().composer?.id).toBe(second);
  expect(q('.thread.composer')).not.toBeNull();
});

test('「やめる」：入力欄・書きかけの文・画像が消える（画像の世代が進む）', async () => {
  renderPanel([]);
  act(() => {
    useUi.getState().startComposer(anchor('文'));
    useUi.getState().addDraftImg('composer', 'c-1.png');
  });
  await userEvent.type(q('textarea[data-key="composer"]') as HTMLElement, '書きかけ');
  const gen = useUi.getState().imgGen.composer ?? 0;
  await userEvent.click(screen.getByRole('button', { name: 'やめる' }));
  expect(q('.thread.composer')).toBeNull();
  expect(useUi.getState()).toMatchObject({ composer: null });
  expect(useUi.getState().drafts.composer).toBe('');
  expect(useUi.getState().drafts.imgs.composer).toEqual([]);
  expect(useUi.getState().imgGen.composer).toBe(gen + 1);
});

// ---- 返信 ----
test('返信：書いて「追加」→ POST（文・画像）→ 下書きが消える。⌘+Enter でも。空は送らない', async () => {
  const view = renderPanel([thread({ id: 't1', anchor: anchor('x'), messages: [user('質問', { sent: true })] })], {
    onPost: (path, body, server) => {
      if (path === '/api/reply')
        server.threads = server.threads.map((t) =>
          t.id === body.thread ? { ...t, messages: [...t.messages, user(String(body.text), { sent: false })] } : t,
        );
      return undefined;
    },
  });
  const ta = q('textarea[data-key="reply-t1"]') as HTMLTextAreaElement;
  expect(ta.placeholder).toContain('⌘/Ctrl+Enter で追加');
  await userEvent.click(screen.getByRole('button', { name: '追加' }));
  expect(view.posts).toHaveLength(0);
  await userEvent.type(ta, '  追加の質問  ');
  expect(useUi.getState().drafts.reply.t1).toBe('  追加の質問  ');
  await userEvent.keyboard('{Meta>}{Enter}{/Meta}');
  await waitFor(() => expect(view.posts).toHaveLength(1));
  expect(view.posts[0]).toMatchObject({
    path: '/api/reply',
    body: { topic: 'demo', thread: 't1', text: '追加の質問', images: [] },
  });
  expect(useUi.getState().drafts.reply.t1).toBe('');
  await waitFor(() => expect(qa('.thread[data-tid="t1"] .msg.user')).toHaveLength(2));
  expect((q('textarea[data-key="reply-t1"]') as HTMLTextAreaElement).value).toBe('');
});

test('返信が失敗したら、トースト・書きかけは残る', async () => {
  renderPanel([thread({ id: 't1', messages: [user('質問')] })]);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ ok: false, error: '送信済みです' }), { status: 400 })),
  );
  await userEvent.type(q('textarea[data-key="reply-t1"]') as HTMLElement, 'x');
  await userEvent.click(screen.getByRole('button', { name: '追加' }));
  await waitFor(() => expect(useUi.getState().toast).toMatchObject({ msg: '送信済みです', err: true }));
  expect(useUi.getState().drafts.reply.t1).toBe('x');
});

// ---- 編集・削除（未送信だけ） ----
test('未送信のユーザーの発言だけ、「編集」「削除」が出る。送信済みの発言・AI の発言には出ない', () => {
  renderPanel([
    thread({
      id: 't1',
      messages: [user('送信済み', { id: 's1' }), ai('AI'), user('未送信', { id: 'd1', sent: false })],
    }),
  ]);
  const msgs = qa('.thread .msg');
  expect(msgs.map((m) => [m.className, qa('.row.meta button', m).map((b) => b.getAttribute('aria-label'))])).toEqual([
    ['msg user', []],
    ['msg ai fresh', []],
    ['msg user', ['編集', '削除']],
  ]);
});

test('ユーザーの発言は、文字として出す（HTML として解釈しない）。AI の返信は、Markdown（無害化済み）', () => {
  renderPanel([
    thread({
      id: 't1',
      messages: [
        user('<img src=x onerror="window.pwned=1"><b>太字</b>\n2 行目', { id: 'u1' }),
        ai('**強調** <script>window.pwned=2</script><img src="x" onerror="window.pwned=3">'),
      ],
    }),
  ]);
  const u = q('.msg.user .body.pre') as HTMLElement;
  expect(u.children).toHaveLength(0);
  expect(u.textContent).toBe('<img src=x onerror="window.pwned=1"><b>太字</b>\n2 行目');
  const body = q('.msg.ai .body.md') as HTMLElement;
  expect(q('strong', body)?.textContent).toBe('強調');
  expect(q('script', body)).toBeNull();
  expect(body.innerHTML).not.toMatch(/onerror/);
  expect((window as unknown as { pwned?: number }).pwned).toBeUndefined();
});

test('編集：「編集」→ 欄（元の文）→ 書き換え → 「保存」→ POST（文）→ 編集が終わる。「キャンセル」は、下書きも捨てる', async () => {
  const view = renderPanel([thread({ id: 't1', messages: [user('元の文', { id: 'd1', sent: false })] })], {
    onPost: (path, body, server) => {
      if (path === '/api/edit')
        server.threads = server.threads.map((t) => ({
          ...t,
          messages: t.messages.map((m) => (m.id === body.msg ? { ...m, text: String(body.text) } : m)),
        }));
      return undefined;
    },
  });
  await userEvent.click(screen.getByRole('button', { name: '編集' }));
  const ta = q('textarea[data-key="edit-d1"]') as HTMLTextAreaElement;
  expect(ta.value).toBe('元の文');
  expect([ta.selectionStart, ta.selectionEnd]).toEqual([3, 3]); // カーソルは、文字の最後（旧と同じ）
  expect(useUi.getState().editing).toBe('d1');
  await userEvent.clear(ta);
  await userEvent.type(ta, '直した文');
  expect(useUi.getState().drafts.edit.d1).toBe('直した文');
  await userEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(q('textarea[data-key="edit-d1"]')).toBeNull());
  expect(view.posts[0]).toMatchObject({
    path: '/api/edit',
    body: { topic: 'demo', thread: 't1', msg: 'd1', text: '直した文' },
  });
  expect(useUi.getState().editing).toBeNull();
  expect(useUi.getState().drafts.edit.d1).toBeUndefined();
  await waitFor(() => expect(text(q('.msg.user .body'))).toBe('直した文'));

  // キャンセル
  await userEvent.click(screen.getByRole('button', { name: '編集' }));
  await userEvent.type(q('textarea[data-key="edit-d1"]') as HTMLElement, 'あと');
  await userEvent.click(screen.getByRole('button', { name: 'キャンセル' }));
  expect(useUi.getState().editing).toBeNull();
  expect(useUi.getState().drafts.edit.d1).toBeUndefined();
  expect(text(q('.msg.user .body'))).toBe('直した文');
  expect(view.posts).toHaveLength(1);
});

test('編集の保存が失敗したら、編集のまま・書き換えは残る', async () => {
  renderPanel([thread({ id: 't1', messages: [user('元', { id: 'd1', sent: false })] })]);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ ok: false, error: '空です' }), { status: 400 })),
  );
  await userEvent.click(screen.getByRole('button', { name: '編集' }));
  await userEvent.type(q('textarea[data-key="edit-d1"]') as HTMLElement, '足す');
  await userEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(useUi.getState().toast?.msg).toBe('空です'));
  expect(useUi.getState().editing).toBe('d1');
  expect((q('textarea[data-key="edit-d1"]') as HTMLTextAreaElement).value).toBe('元足す');
});

test('削除：確認なしで POST → 取り直して、消える', async () => {
  const view = renderPanel(
    [thread({ id: 't1', messages: [user('送信済み', { id: 's1' }), user('消す', { id: 'd1', sent: false })] })],
    {
      onPost: (path, body, server) => {
        if (path === '/api/delete')
          server.threads = server.threads.map((t) => ({ ...t, messages: t.messages.filter((m) => m.id !== body.msg) }));
        return undefined;
      },
    },
  );
  await userEvent.click(screen.getByRole('button', { name: '削除' }));
  await waitFor(() => expect(qa('.thread .msg.user')).toHaveLength(1));
  expect(view.posts[0]).toMatchObject({ path: '/api/delete', body: { topic: 'demo', thread: 't1', msg: 'd1' } });
});

// ---- 解決・再開 ----
test('「解決」→ POST（resolved: true）→ 進行中から消え、解決済みの 1 行へ。開いていた行の状態は、戻る', async () => {
  const view = renderPanel(
    [thread({ id: 't1', anchor: anchor('文'), messages: [user('質問'), ai('答え')] }), thread({ id: 't2' })],
    {
      onPost: (path, body, server) => {
        if (path === '/api/resolve')
          server.threads = server.threads.map((t) =>
            t.id === body.thread ? { ...t, resolved: body.resolved === true } : t,
          );
        return undefined;
      },
    },
  );
  act(() => useUi.getState().setRowOpen('t1', true)); // 古い「開いた」状態が残っていても、解決で、行に戻る
  const card = q('.thread[data-tid="t1"]') as HTMLElement;
  await userEvent.click(within(card).getByRole('button', { name: '解決' }));
  await waitFor(() => expect(qa('#threads .thread')).toHaveLength(1));
  expect(view.posts[0]).toMatchObject({ path: '/api/resolve', body: { topic: 'demo', thread: 't1', resolved: true } });
  expect(useUi.getState().rowOpen.has('t1')).toBe(false);
  expect(screen.getByRole('tab', { name: /解決済み/ })).toHaveTextContent('解決済み1');
  await userEvent.click(screen.getByRole('tab', { name: /解決済み/ }));
  expect(q('.donerow[data-tid="t1"]')).not.toBeNull();

  // 再開
  await userEvent.click(q('.donerow') as HTMLElement);
  const open = q('.rowopen .thread[data-tid="t1"]') as HTMLElement;
  expect(q('.th-foot textarea', open)).toBeNull();
  await userEvent.click(within(open).getByRole('button', { name: '再開する' }));
  await waitFor(() => expect(view.posts).toHaveLength(2));
  expect(view.posts[1]).toMatchObject({ path: '/api/resolve', body: { thread: 't1', resolved: false } });
  await waitFor(() => expect(screen.getByRole('tab', { name: /進行中/ })).toHaveTextContent('進行中2'));
  expect(useUi.getState().rowOpen.has('t1')).toBe(false);
  await userEvent.click(screen.getByRole('tab', { name: /進行中/ }));
  expect(qa('#threads .thread').map((c) => c.dataset.tid)).toEqual(['t1', 't2']);
  expect(q('.thread[data-tid="t1"] textarea[data-key="reply-t1"]')).not.toBeNull();
});

// ---- AI のメッセージ：資料の更新・ページのカード ----
test('AI の返信：「資料を v2 に更新」と「v2 を見る」・ページへのカード（ページがあるときだけ）', () => {
  renderPanel(
    [
      thread({
        id: 't1',
        page: 'root',
        messages: [user('質問'), ai('直しました', { revision: 2, page: 'sub' }), ai('消えたページ', { page: 'gone' })],
      }),
    ],
    { versions: 2 },
  );
  const [m1, m2] = qa('.msg.ai');
  expect(q('.who svg', m1)).toBeNull(); // 発言者の「AI」には、アイコンを付けない（札の Sparkles と、重ねない）
  expect(text(q('.row.meta .chip.ok.small', m1))).toBe('資料を v2 に更新');
  const link = q('.row.meta a.btnlink', m1) as HTMLAnchorElement;
  expect(link.getAttribute('href')).toBe('#/demo/root/v2');
  expect(link.textContent).toBe('v2 を見る');
  const card = q('a.pagecard', m1) as HTMLAnchorElement;
  expect(card.getAttribute('href')).toBe('#/demo/sub');
  expect([...card.children].map((c) => [c.getAttribute('class'), c.textContent])).toEqual([
    ['pc-l', '詳しく見る'],
    ['pc-t', '子ページ'],
    ['lucide lucide-arrow-right pc-a', ''], // 矢印は、アイコン（SVG）
  ]);
  expect(q('a.pagecard', m2)).toBeNull();
});
