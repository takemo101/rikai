// @vitest-environment jsdom
// ブラウザの通知（F41）：ベル（オン・オフ・許可を求める・拒否・denied・未対応・保存の復元）と、更新を受けて通知を出す部分（ベースライン・増えたとき・条件）

import { useQuery } from '@tanstack/react-query';
import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Fresh } from '../../src/shared/fresh';
import { topicKey, topicsKey } from '../../src/web/api/queries';
import { queryClient } from '../../src/web/api/queryClient';
import { NotifyBell } from '../../src/web/layout/NotifyBell';
import { useBrowserNotify } from '../../src/web/layout/useBrowserNotify';
import { NOTIFY_ICON } from '../../src/web/lib/notifyIcon';
import { UI_KEY } from '../../src/web/lib/storage';
import { useUi } from '../../src/web/store/ui';
import { meta, msg, renderWithClient, resetAll, summary, thread, topicState } from './helpers';

/** 偽の Notification：許可・作られた通知を、テストが決める */
class FakeNotification {
  static permission: NotificationPermission = 'granted';
  static requestPermission = vi.fn(async (): Promise<NotificationPermission> => FakeNotification.permission);
  static made: FakeNotification[] = [];
  onclick: (() => void) | null = null;
  close = vi.fn();
  constructor(
    public title: string,
    public options: NotificationOptions = {},
  ) {
    FakeNotification.made.push(this);
  }
}
const stubNotification = (permission: NotificationPermission) => {
  FakeNotification.permission = permission;
  FakeNotification.made = [];
  FakeNotification.requestPermission.mockClear();
  vi.stubGlobal('Notification', FakeNotification);
};
const bell = () => document.getElementById('btn-notify') as HTMLButtonElement;
const savedNotify = () => JSON.parse(localStorage.getItem(UI_KEY) ?? '{}').notify;

beforeEach(() => {
  resetAll();
  stubNotification('default');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test('ベル：既定はオフ。押すと、許可を求める（default のとき）。許可されたら、オンで、保存する', async () => {
  render(<NotifyBell />);
  expect(bell().dataset.notify).toBe('off');
  expect(bell().disabled).toBe(false);
  expect(bell().getAttribute('aria-label')).toContain('通知：オフ');
  expect(bell().title).toBe(bell().getAttribute('aria-label'));
  FakeNotification.requestPermission.mockImplementationOnce(async () => {
    FakeNotification.permission = 'granted';
    return 'granted';
  });
  await act(async () => fireEvent.click(bell()));
  expect(FakeNotification.requestPermission).toHaveBeenCalledTimes(1);
  expect(bell().dataset.notify).toBe('on');
  expect(bell().getAttribute('aria-pressed')).toBe('true');
  expect(savedNotify()).toBe(true);
  // もう一度：オフ（許可は、もう求めない）
  await act(async () => fireEvent.click(bell()));
  expect(FakeNotification.requestPermission).toHaveBeenCalledTimes(1);
  expect(bell().dataset.notify).toBe('off');
  expect(savedNotify()).toBe(false);
});

test('許可を拒否された：オフのまま・保存しない。ベルは、押せなくなる（ブロックされている理由）', async () => {
  render(<NotifyBell />);
  FakeNotification.requestPermission.mockImplementationOnce(async () => {
    FakeNotification.permission = 'denied';
    return 'denied';
  });
  await act(async () => fireEvent.click(bell()));
  expect(useUi.getState().ui.notify).toBe(false);
  expect(localStorage.getItem(UI_KEY)).toBeNull();
  expect(bell().dataset.notify).toBe('disabled');
  expect(bell().disabled).toBe(true);
  expect(bell().getAttribute('aria-label')).toBe('通知がブロックされています。ブラウザの設定で許可してください');
});

test('許可が default のままのとき（ダイアログを閉じた）：オフのまま・押せる', async () => {
  render(<NotifyBell />);
  await act(async () => fireEvent.click(bell())); // requestPermission は、default を返す
  expect(FakeNotification.requestPermission).toHaveBeenCalled();
  expect(bell().dataset.notify).toBe('off');
  expect(bell().disabled).toBe(false);
  expect(useUi.getState().ui.notify).toBe(false);
});

test('denied・未対応（Notification がない）：ベルは、押せない。理由は、title・aria-label', () => {
  stubNotification('denied');
  const r = render(<NotifyBell />);
  expect(bell().disabled).toBe(true);
  expect(bell().title).toBe('通知がブロックされています。ブラウザの設定で許可してください');
  r.unmount();
  vi.stubGlobal('Notification', undefined);
  render(<NotifyBell />);
  expect(bell().disabled).toBe(true);
  expect(bell().getAttribute('aria-label')).toBe('このブラウザでは通知が使えません');
  expect(bell().title).toBe('このブラウザでは通知が使えません');
});

test('保存の復元：保存がオンでも、許可が granted でなければ、オフとして扱う。granted なら、オン', () => {
  localStorage.setItem(UI_KEY, JSON.stringify({ notify: true }));
  useUi.setState({ ui: { ...useUi.getState().ui, notify: true } });
  stubNotification('default');
  const r = render(<NotifyBell />);
  expect(bell().dataset.notify).toBe('off'); // 許可がない：オフ
  r.unmount();
  stubNotification('granted');
  render(<NotifyBell />);
  expect(bell().dataset.notify).toBe('on');
});

// ---- 更新を受けて、通知を出す ----
const ASK = { type: 'yes_no', question: '？' } as const;
const ai = (id: string, over = {}) => msg({ id, author: 'ai', kind: 'reply', sent: true, text: '返信の本文', ...over });
const state = (messages: ReturnType<typeof ai>[], versions = 1, rev = 1) =>
  topicState({
    rev,
    meta: meta({ rev, title: '猫の資料', pages: { root: { title: 'R', parent: null, versions, createdAt: '' } } }),
    threads: [thread({ id: 't1', messages: [msg({ sent: true }), ...messages] })],
  });
const put = (s: ReturnType<typeof state>) => act(() => void queryClient.setQueryData(topicKey('demo'), s));

function Harness() {
  useBrowserNotify();
  return null;
}
function setup(over: { enabled?: boolean; permission?: NotificationPermission; focused?: boolean } = {}) {
  stubNotification(over.permission ?? 'granted');
  useUi.setState({ ui: { ...useUi.getState().ui, notify: over.enabled ?? true } });
  vi.spyOn(document, 'hasFocus').mockReturnValue(over.focused ?? false);
  location.hash = '#/demo/root';
  renderWithClient(<Harness />);
}

test('最初の読み込みでは出ない（ベースライン）。AI の返信が増えたら、1 回出る：題 rikai・トピック名と件数だけ・tag はトピックごと・icon は rikai の PNG（data:）だけ', () => {
  setup();
  put(state([ai('a1')])); // 最初：すでに、新着の返信がある（ベースラインを取るだけ）
  expect(FakeNotification.made).toHaveLength(0);
  put(state([ai('a1'), ai('a2', { ask: ASK }), ai('a3')], 2, 2)); // 返信 1（a3）・質問 1（a2：質問付きの 1 通は、質問だけ）・新しい版 1
  expect(FakeNotification.made).toHaveLength(1);
  const n = FakeNotification.made[0] as FakeNotification;
  expect(n.title).toBe('rikai');
  expect(n.options.body).toBe('猫の資料：AI から返信が届きました（返信 1・新しい版 1・質問 1）');
  expect(n.options.tag).toBe('rikai-demo');
  expect(n.options.silent).toBe(false);
  // 意図した変更：icon は、rikai の PNG の data: だけ（外のものではない）。badge・data は、付けない
  expect(n.options.icon).toBe(NOTIFY_ICON);
  expect(n.options.icon).toMatch(/^data:image\/png;base64,/);
  expect(n.options).not.toHaveProperty('badge');
  expect(n.options).not.toHaveProperty('data');
  expect(JSON.stringify(n.options)).not.toContain('返信の本文'); // 返信の本文は、載せない（N6）
});

test('同じ状態の取り直し・読んだときは、出ない。もう一度増えたら、また出る（同じ tag）', () => {
  setup();
  put(state([ai('a1')]));
  put(state([ai('a1')], 1, 2)); // 取り直しただけ
  expect(FakeNotification.made).toHaveLength(0);
  act(() => useUi.getState().markSeen(['a1'])); // 読んだ
  put(state([ai('a1')], 1, 3));
  expect(FakeNotification.made).toHaveLength(0);
  put(state([ai('a1'), ai('a2')], 1, 4));
  put(state([ai('a1'), ai('a2'), ai('a3')], 1, 5));
  expect(FakeNotification.made).toHaveLength(2);
  expect(FakeNotification.made.map((n) => n.options.tag)).toEqual(['rikai-demo', 'rikai-demo']);
});

test('オフの間の増加は、出さない。オンにしたあとに増えたら、出す（オフの間も、ベースラインは、進む）', () => {
  setup({ enabled: false });
  put(state([]));
  put(state([ai('a1')], 1, 2));
  expect(FakeNotification.made).toHaveLength(0);
  useUi.setState({ ui: { ...useUi.getState().ui, notify: true } });
  put(state([ai('a1'), ai('a2')], 1, 3)); // オンにした：増えた
  expect(FakeNotification.made).toHaveLength(1);
});

test('許可がない（denied）：出さない', () => {
  setup({ permission: 'denied' });
  put(state([]));
  put(state([ai('a1')], 1, 2));
  expect(FakeNotification.made).toHaveLength(0);
});

test('画面を見ている（フォーカスあり・可視）：出さない。見ている間に増えた分は、あとで、出さない', () => {
  setup({ focused: true });
  put(state([]));
  put(state([ai('a1')], 1, 2)); // 見ている：出さない
  expect(FakeNotification.made).toHaveLength(0);
  vi.spyOn(document, 'hasFocus').mockReturnValue(false); // 離れた
  put(state([ai('a1')], 1, 3)); // 同じ状態：出さない（先の増加は、すでに、ベースライン）
  expect(FakeNotification.made).toHaveLength(0);
  put(state([ai('a1'), ai('a2')], 1, 4));
  expect(FakeNotification.made).toHaveLength(1);
});

test('可視でない（visibilityState: hidden）なら、フォーカスがあっても出す', () => {
  setup({ focused: true });
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  put(state([]));
  put(state([ai('a1')], 1, 2));
  expect(FakeNotification.made).toHaveLength(1);
});

test('つながり直した（ui.live が立つ）直後の取得は、ベースライン：その間の増加は、通知しない。次からは、出す', () => {
  setup();
  put(state([ai('a1')]));
  act(() => useUi.getState().setLive(false));
  act(() => useUi.getState().setLive(true)); // 再接続：全体を取り直す
  put(state([ai('a1'), ai('a2')], 1, 2)); // 切れている間に増えた分
  expect(FakeNotification.made).toHaveLength(0);
  put(state([ai('a1'), ai('a2'), ai('a3')], 1, 3));
  expect(FakeNotification.made).toHaveLength(1);
});

test('通知を押す：画面へ戻って、そのトピックの、最初の新着のカードを選ぶ。通知は、閉じる', () => {
  setup();
  const focus = vi.spyOn(window, 'focus').mockImplementation(() => {});
  put(state([]));
  put(state([ai('a2')], 1, 2));
  const n = FakeNotification.made[0] as FakeNotification;
  location.hash = '#/other/root'; // 別のトピックを見ている間に押す：そのトピックを開く
  n.onclick?.();
  expect(focus).toHaveBeenCalled();
  expect(n.close).toHaveBeenCalled();
  expect(location.hash).toBe('#/demo/root');
  n.onclick?.(); // そのトピックを見ている：新着のカードを選ぶ
  expect(useUi.getState().active).toBe('t1');
});

// 意図した変更（RIK-045 の再レビュー）：新着は、件数の差でなく、前回に知っていた ID との差。読んだあとの新着も、出る
test('読んだあとに来た返信：画面を見ている間に返信 a → 読む（取得は起きない）→ 画面を離れる → 返信 b → 通知される', () => {
  setup({ focused: true });
  put(state([])); // ベースライン
  put(state([ai('a')], 1, 2)); // 見ている間に、返信 a（出さない。a は、前回の集合に入る）
  expect(FakeNotification.made).toHaveLength(0);
  act(() => useUi.getState().markSeen(['a'])); // 読んだ（取得は、起きない）
  vi.spyOn(document, 'hasFocus').mockReturnValue(false); // 別のアプリへ
  put(state([ai('a'), ai('b')], 1, 3)); // 返信 b
  expect(FakeNotification.made).toHaveLength(1);
  expect(FakeNotification.made[0]?.options.body).toBe('猫の資料：AI から返信が届きました（返信 1）');
});

test('自分の操作では出ない：解決の取り消し（未解決に戻る）・読んだこと', () => {
  setup();
  const withState = (resolved: boolean, rev: number) =>
    topicState({
      rev,
      meta: meta({ rev, title: '猫の資料', pages: { root: { title: 'R', parent: null, versions: 1, createdAt: '' } } }),
      threads: [thread({ id: 't1', resolved, messages: [msg({ sent: true }), ai('a1'), ai('q1', { ask: ASK })] })],
    });
  put(withState(false, 1));
  put(withState(true, 2)); // 解決
  put(withState(false, 3)); // 解決の取り消し：未読・未回答の質問が、また、数えられる
  expect(FakeNotification.made).toHaveLength(0);
});

test('累計：画面を見ていない間は、通知を置き換えるたびに、溜まった新着の合計を出す（返信 1 → 返信 2）。見える状態に戻ったら、0', () => {
  setup();
  put(state([ai('a1')]));
  put(state([ai('a1'), ai('a2')], 1, 2));
  put(state([ai('a1'), ai('a2'), ai('a3')], 1, 3));
  expect(FakeNotification.made.map((n) => n.options.body)).toEqual([
    '猫の資料：AI から返信が届きました（返信 1）',
    '猫の資料：AI から返信が届きました（返信 2）', // 前の通知が、置き換わっても、件数が消えない
  ]);
  // 画面が見える状態に戻った（focus）：累計を、0 に戻す
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  act(() => void window.dispatchEvent(new Event('focus')));
  vi.spyOn(document, 'hasFocus').mockReturnValue(false);
  put(state([ai('a1'), ai('a2'), ai('a3'), ai('a4')], 1, 4));
  expect(FakeNotification.made[2]?.options.body).toBe('猫の資料：AI から返信が届きました（返信 1）');
});

test('累計は、トピックごと：別のトピックの累計は、別。tag も、トピックごと', () => {
  setup();
  const other = (n: number) =>
    topicState({
      rev: n,
      meta: meta({
        slug: 'other',
        rev: n,
        title: '別の資料',
        pages: { root: { title: 'R', parent: null, versions: 1, createdAt: '' } },
      }),
      threads: [thread({ id: 'o1', messages: Array.from({ length: n }, (_, i) => ai(`o${i}`)) })],
    });
  put(state([ai('a1')]));
  act(() => void queryClient.setQueryData(topicKey('other'), other(0)));
  put(state([ai('a1'), ai('a2')], 1, 2));
  act(() => void queryClient.setQueryData(topicKey('other'), other(1)));
  put(state([ai('a1'), ai('a2'), ai('a3')], 1, 3));
  const made = FakeNotification.made.map((n) => [n.options.tag, n.options.body]);
  expect(made).toEqual([
    ['rikai-demo', '猫の資料：AI から返信が届きました（返信 1）'],
    ['rikai-other', '別の資料：AI から返信が届きました（返信 1）'],
    ['rikai-demo', '猫の資料：AI から返信が届きました（返信 2）'],
  ]);
});

test('トピックを開き直したとき（ベースライン）は、累計も 0。つながり直したあとも', () => {
  setup();
  put(state([ai('a1')]));
  put(state([ai('a1'), ai('a2')], 1, 2));
  expect(FakeNotification.made).toHaveLength(1);
  act(() => useUi.getState().setLive(false));
  act(() => useUi.getState().setLive(true));
  put(state([ai('a1'), ai('a2'), ai('a3')], 1, 3)); // ベースライン：出さない・累計を 0
  put(state([ai('a1'), ai('a2'), ai('a3'), ai('a4')], 1, 4));
  expect(FakeNotification.made[1]?.options.body).toBe('猫の資料：AI から返信が届きました（返信 1）'); // 累計が、前の 1 から、続かない
});

// Minor 3：許可を求める：新しい形（Promise）・古い形（コールバック。戻りは undefined）
test('許可を求める：古い形（コールバックを渡し、戻りは Promise でない）でも、1 回押しただけで、オンになる', async () => {
  const OldStyle = Object.assign(class extends FakeNotification {}, {
    permission: 'default' as NotificationPermission,
    // 古い形：戻りは undefined。結果は、あとから、コールバックに渡される（許可も、そのときに変わる）
    requestPermission: vi.fn((cb?: (p: NotificationPermission) => void) => {
      setTimeout(() => {
        (OldStyle as unknown as { permission: string }).permission = 'granted';
        cb?.('granted');
      }, 5);
      return undefined;
    }),
  });
  vi.stubGlobal('Notification', OldStyle);
  render(<NotifyBell />);
  await act(async () => {
    fireEvent.click(bell());
    await new Promise((r) => setTimeout(r, 30)); // コールバックが、あとから呼ばれる
  });
  expect(OldStyle.requestPermission).toHaveBeenCalledTimes(1);
  expect(bell().dataset.notify).toBe('on');
  expect(useUi.getState().ui.notify).toBe(true);
});

test('許可を求める：新しい形（Promise）でも、古い形のコールバックが、あとから呼ばれても、1 回だけ処理する。コールバックで拒否も、反映する', async () => {
  const Both = Object.assign(class extends FakeNotification {}, {
    permission: 'default' as NotificationPermission,
    requestPermission: vi.fn((cb?: (p: NotificationPermission) => void) => {
      (Both as unknown as { permission: string }).permission = 'granted';
      cb?.('granted'); // 両方の形に対応した実装（Promise も、コールバックも）
      return Promise.resolve('granted' as NotificationPermission);
    }),
  });
  vi.stubGlobal('Notification', Both);
  const r = render(<NotifyBell />);
  await act(async () => fireEvent.click(bell()));
  expect(Both.requestPermission).toHaveBeenCalledTimes(1);
  expect(bell().dataset.notify).toBe('on');
  r.unmount();
  useUi.getState().setNotify(false);
  const Deny = Object.assign(class extends FakeNotification {}, {
    permission: 'default' as NotificationPermission,
    requestPermission: vi.fn((cb?: (p: NotificationPermission) => void) => {
      (Deny as unknown as { permission: string }).permission = 'denied';
      cb?.('denied');
      return undefined;
    }),
  });
  vi.stubGlobal('Notification', Deny);
  render(<NotifyBell />);
  await act(async () => fireEvent.click(bell()));
  expect(useUi.getState().ui.notify).toBe(false);
  expect(bell().dataset.notify).toBe('disabled');
});

// ---- ほかのトピックの新着（F46）：一覧の `fresh` の、前回との差 ----
const fresh = (over: Partial<Fresh> = {}): Fresh => ({
  replies: [],
  asks: [],
  openAsks: [],
  versions: ['root@1'],
  ...over,
});
const item = (slug: string, f?: Fresh, over: Record<string, unknown> = {}) =>
  summary(slug, { title: `${slug} の資料`, ...(f ? { fresh: f } : {}), ...over });
const putList = (...items: ReturnType<typeof item>[]) => act(() => void queryClient.setQueryData(topicsKey, items));
const bodies = () => FakeNotification.made.map((n) => [n.options.tag, n.options.body]);

test('ほかのトピック：最初の一覧は、ベースライン（出さない）。AI の返信が増えたら、そのトピックの名前と件数で、1 回出る。tag はトピックごと。押すと、そのトピックを開く', () => {
  setup();
  putList(item('b', fresh({ replies: ['m1'] })));
  expect(FakeNotification.made).toHaveLength(0);
  putList(item('b', fresh({ replies: ['m1', 'secret-id-2'], versions: ['root@1', 'root@2'] })));
  expect(bodies()).toEqual([['rikai-b', 'b の資料：AI から返信が届きました（返信 1・新しい版 1）']]);
  expect(JSON.stringify(FakeNotification.made[0]?.options)).not.toContain('secret-id-2'); // ID は、載せない
  location.hash = '#/demo/root';
  (FakeNotification.made[0] as FakeNotification).onclick?.();
  expect(location.hash).toBe('#/b/root');
});

test('ほかのトピック：同じ一覧の取り直し・読んだだけ・解決の取り消し（未回答の質問が戻る）・ID が減るだけでは、出ない。ID の入れ替え・質問は、出る', () => {
  setup();
  putList(item('b', fresh({ replies: ['m1'], asks: ['m2'], openAsks: [] })));
  putList(item('b', fresh({ replies: ['m1'], asks: ['m2'], openAsks: [] }), { rev: 2 })); // 取り直し
  putList(item('b', fresh({ replies: ['m1'], asks: ['m2'], openAsks: ['m2'] }))); // 解決の取り消し：質問が、また未回答になる（前回の asks に、ある）
  putList(item('b', fresh({ replies: [], asks: [], openAsks: [] }))); // 減る
  expect(FakeNotification.made).toHaveLength(0);
  putList(item('b', fresh({ replies: ['m9'], asks: [], openAsks: [] }))); // 入れ替え：新しい ID
  putList(item('b', fresh({ replies: ['m9'], asks: ['m10'], openAsks: ['m10'] })));
  expect(bodies()).toEqual([
    ['rikai-b', 'b の資料：AI から返信が届きました（返信 1）'],
    ['rikai-b', 'b の資料：AI から返信が届きました（返信 1・質問 1）'], // 累計：前の 1 に、質問 1
  ]);
});

test('ほかのトピック：新しく一覧に現れたトピックは、ベースライン。閉じたトピック・fresh のないもの（上限超え・読めない）・読めない形式は、対象外。fresh が戻っても、すべて新着にはならない', () => {
  setup();
  putList(item('b', fresh({ replies: ['m1'] })));
  putList(item('b', fresh({ replies: ['m1'] })), item('c', fresh({ replies: ['c1', 'c2'] }))); // c が現れた
  expect(FakeNotification.made).toHaveLength(0);
  putList(
    item('b', fresh({ replies: ['m1'] }), { closed: true }),
    item('c', undefined), // fresh なし：触らない
    { slug: 'u', title: '新しい形式', unsupported: true } as unknown as ReturnType<typeof item>,
  );
  putList(item('b', fresh({ replies: ['m1', 'm2'] }), { closed: true }));
  expect(FakeNotification.made).toHaveLength(0); // 閉じたトピック
  putList(item('c', fresh({ replies: ['c1', 'c2'] }))); // fresh が戻った：前回と同じ → 出ない
  expect(FakeNotification.made).toHaveLength(0);
  putList(item('c', fresh({ replies: ['c1', 'c2', 'c3'] })));
  expect(bodies()).toEqual([['rikai-c', 'c の資料：AI から返信が届きました（返信 1）']]);
});

test('ほかのトピック：累計は、トピックごと（別のトピックの件数と混ざらない）。画面が見える状態に戻ったら 0。つながり直した直後は、ベースライン', () => {
  setup();
  putList(item('b', fresh({ replies: ['b1'] })), item('c', fresh({ replies: ['c1'] })));
  putList(item('b', fresh({ replies: ['b1', 'b2'] })), item('c', fresh({ replies: ['c1'] })));
  putList(item('b', fresh({ replies: ['b1', 'b2', 'b3'] })), item('c', fresh({ replies: ['c1', 'c2'] })));
  expect(bodies()).toEqual([
    ['rikai-b', 'b の資料：AI から返信が届きました（返信 1）'],
    ['rikai-b', 'b の資料：AI から返信が届きました（返信 2）'],
    ['rikai-c', 'c の資料：AI から返信が届きました（返信 1）'],
  ]);
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  act(() => void window.dispatchEvent(new Event('focus')));
  vi.spyOn(document, 'hasFocus').mockReturnValue(false);
  putList(item('b', fresh({ replies: ['b1', 'b2', 'b3', 'b4'] })), item('c', fresh({ replies: ['c1', 'c2'] })));
  expect(FakeNotification.made[3]?.options.body).toBe('b の資料：AI から返信が届きました（返信 1）');
  act(() => useUi.getState().setLive(false));
  act(() => useUi.getState().setLive(true)); // 再接続
  putList(item('b', fresh({ replies: ['b1', 'b2', 'b3', 'b4', 'b5'] })), item('c', fresh({ replies: ['c1', 'c2'] })));
  expect(FakeNotification.made).toHaveLength(4); // 切れている間の増加は、ベースライン
  putList(
    item('b', fresh({ replies: ['b1', 'b2', 'b3', 'b4', 'b5', 'b6'] })),
    item('c', fresh({ replies: ['c1', 'c2'] })),
  );
  expect(FakeNotification.made[4]?.options.body).toBe('b の資料：AI から返信が届きました（返信 1）');
});

test('ほかのトピック：画面を見ているとき・ベルがオフ・許可なしでは、出ない', () => {
  for (const o of [{ focused: true }, { enabled: false }, { permission: 'denied' as const }]) {
    resetAll();
    setup(o);
    putList(item('b', fresh({ replies: ['m1'] })));
    putList(item('b', fresh({ replies: ['m1', 'm2'] })));
    expect(FakeNotification.made, JSON.stringify(o)).toHaveLength(0);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  }
});

/** 開いている（トピックの取得を見ている）トピック：取得の結果は、`data.current[slug]` */
function Open({ slug, data }: { slug: string; data: { current: Record<string, ReturnType<typeof state>> } }) {
  useQuery({
    queryKey: topicKey(slug),
    queryFn: async () => data.current[slug] as ReturnType<typeof state>,
    staleTime: 0,
  });
  return null;
}
const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));

test('開いているトピックは、一覧の経路から除く：二重に通知しない（トピックの取得の経路だけで、1 回）。閉じて開き直すと、一覧の経路が見る', async () => {
  setup();
  const data = { current: { demo: state([ai('a1')]) } };
  const opened = renderWithClient(<Open slug="demo" data={data} />);
  await flush(); // トピックの取得：ベースライン
  putList(item('demo', fresh({ replies: ['a1'] })));
  // 返信 a2 が届く：一覧の更新が先・トピックの取得が後（逆でも同じ）
  putList(item('demo', fresh({ replies: ['a1', 'a2'] }), { rev: 2 }));
  expect(FakeNotification.made).toHaveLength(0); // 一覧の経路は、開いているトピックを見ない
  data.current.demo = state([ai('a1'), ai('a2')], 1, 2);
  await act(async () => void (await queryClient.invalidateQueries({ queryKey: topicKey('demo') })));
  expect(bodies()).toEqual([['rikai-demo', '猫の資料：AI から返信が届きました（返信 1）']]); // 1 回だけ
  // 一覧が、もう一度、同じ内容で届く：二重にならない
  putList(item('demo', fresh({ replies: ['a1', 'a2'] }), { rev: 3 }));
  expect(FakeNotification.made).toHaveLength(1);
  // 別のトピックへ移る（取得を見なくなる）：一覧の経路が、このトピックを見る。前回（全体）との差だけ
  opened.unmount();
  putList(item('demo', fresh({ replies: ['a1', 'a2', 'a3'] }), { rev: 4 }));
  expect(FakeNotification.made).toHaveLength(2);
  expect(FakeNotification.made[1]?.options.body).toBe('demo の資料：AI から返信が届きました（返信 2）'); // 画面を見ていない間の累計（先の 1 ＋ 今回の 1）
});

test('トピックの切り替えの競合：切り替えの瞬間に届いた一覧・取得で、二重にも洩れにもならない。開いたトピックは、取得で、ベースラインを取り直す（一覧の窓とは、比べない）', async () => {
  setup();
  const data = { current: { demo: state([ai('a1')]), other: state([ai('o1')]) } };
  // other の資料の題を使うため、別の meta
  data.current.other = topicState({
    rev: 1,
    meta: meta({
      slug: 'other',
      title: '別の資料',
      pages: { root: { title: 'R', parent: null, versions: 1, createdAt: '' } },
    }),
    threads: [thread({ id: 'o', messages: [msg({ sent: true }), ai('o1')] })],
  });
  const first = renderWithClient(<Open slug="demo" data={data} />);
  await flush();
  putList(item('demo', fresh({ replies: ['a1'] })), item('other', fresh({ replies: ['o1'] })));
  // demo → other へ：other の取得を見始める（取得の結果は、o2 まで進んでいる：一覧の前回は、o1）。その間に、一覧が届く
  data.current.other = topicState({
    rev: 2,
    meta: meta({
      slug: 'other',
      rev: 2,
      title: '別の資料',
      pages: { root: { title: 'R', parent: null, versions: 1, createdAt: '' } },
    }),
    threads: [thread({ id: 'o', messages: [msg({ sent: true }), ai('o1'), ai('o2')] })],
  });
  const second = renderWithClient(<Open slug="other" data={data} />);
  putList(
    item('demo', fresh({ replies: ['a1', 'a2'] }), { rev: 2 }), // demo：まだ取得を見ている（first が生きている）→ 一覧の経路は、見ない
    item('other', fresh({ replies: ['o1', 'o2'] }), { rev: 2 }), // other：取得を見ている → 一覧の経路は、見ない
  );
  first.unmount();
  await flush(); // other の取得：一覧から取得への切り替え → ベースライン（o2 を、新着にしない）
  expect(bodies()).toEqual([]);
  putList(
    item('demo', fresh({ replies: ['a1', 'a2'] }), { rev: 3 }),
    item('other', fresh({ replies: ['o1', 'o2'] }), { rev: 3 }),
  );
  expect(bodies()).toEqual([['rikai-demo', 'demo の資料：AI から返信が届きました（返信 1）']]); // demo（もう開いていない）：1 回。other は、出ない
  // 開いた other に、次の返信 o3：取得の経路で、1 回
  data.current.other = topicState({
    rev: 3,
    meta: meta({
      slug: 'other',
      rev: 3,
      title: '別の資料',
      pages: { root: { title: 'R', parent: null, versions: 1, createdAt: '' } },
    }),
    threads: [thread({ id: 'o', messages: [msg({ sent: true }), ai('o1'), ai('o2'), ai('o3')] })],
  });
  await act(async () => void (await queryClient.invalidateQueries({ queryKey: topicKey('other') })));
  expect(bodies()[1]).toEqual(['rikai-other', '別の資料：AI から返信が届きました（返信 1）']);
  second.unmount();
});

test('一覧の窓（fresh.window）：窓が広がったトピックは、ベースライン（古い ID が、新しく窓に入っても、新着にしない）。狭まるだけなら、古い ID が窓から消えるだけ。窓いっぱいの新着は、「以上」', () => {
  setup();
  const win = (ids: string[], window: number) => item('b', fresh({ replies: ids, window }));
  const ids = (a: number, b: number, p = 'r') => Array.from({ length: b - a + 1 }, (_, i) => `${p}${a + i}`);
  putList(win(ids(11, 20), 10)); // 窓 10：r11〜r20
  putList(win(ids(15, 20), 6)); // 狭まる（トピックが増えた）：窓から、古い ID が消えるだけ
  expect(FakeNotification.made).toHaveLength(0);
  putList(win(ids(11, 20), 10)); // 広がる（トピックが減った）：r11〜r14 が、新しく窓に入る：新着ではない（ベースライン）
  expect(FakeNotification.made).toHaveLength(0);
  putList(win(ids(12, 21), 10)); // 本当の新着 r21
  expect(bodies()).toEqual([['rikai-b', 'b の資料：AI から返信が届きました（返信 1）']]);
  // 窓いっぱい（10 件）が、すべて新着：「10 以上」。さらに累計
  putList(win(ids(22, 31), 10));
  expect(FakeNotification.made[1]?.options.body).toBe('b の資料：AI から返信が届きました（返信 11 以上）');
});

test('閉じたトピックは、記憶を消す：ベースラインにしてから、閉じて、開き直したあとは、閉じている間に増えた分を、新着にしない（誤通知なし）。次の新着は、正しく出る', () => {
  setup();
  putList(item('b', fresh({ replies: ['m1'] })));
  putList(item('b', fresh({ replies: ['m1'] }), { closed: true }));
  putList(item('b', fresh({ replies: ['m1', 'm2', 'm3'] }))); // 開き直した：ベースライン（閉じている間の分は、新着にしない）
  expect(FakeNotification.made).toHaveLength(0);
  putList(item('b', fresh({ replies: ['m1', 'm2', 'm3', 'm4'] })));
  expect(bodies()).toEqual([['rikai-b', 'b の資料：AI から返信が届きました（返信 1）']]);
});
