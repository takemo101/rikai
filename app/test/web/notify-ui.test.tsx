// @vitest-environment jsdom
// ブラウザの通知（F41）：ベル（オン・オフ・許可を求める・拒否・denied・未対応・保存の復元）と、更新を受けて通知を出す部分（ベースライン・増えたとき・条件）
import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { topicKey } from '../../src/web/api/queries';
import { queryClient } from '../../src/web/api/queryClient';
import { NotifyBell } from '../../src/web/layout/NotifyBell';
import { useBrowserNotify } from '../../src/web/layout/useBrowserNotify';
import { UI_KEY } from '../../src/web/lib/storage';
import { useUi } from '../../src/web/store/ui';
import { meta, msg, renderWithClient, resetAll, thread, topicState } from './helpers';

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

test('最初の読み込みでは出ない（ベースライン）。AI の返信が増えたら、1 回出る：題 rikai・トピック名と件数だけ・tag はトピックごと・icon なし', () => {
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
  expect(n.options.icon).toBeUndefined();
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
