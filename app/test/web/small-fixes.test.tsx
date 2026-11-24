// @vitest-environment jsdom
// 画面の小さな直し（RIK-055。UX の分析 P8・P10）：トーストの読み上げ・Submit が押せない理由・送信後の案内（初回だけ）・空の説明・関連の線の名前・位置の名前の 1 行表示・範囲と要素の排他。
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { AppToolbar } from '../../src/web/doc/AppToolbar';
import type { AppFrame, FrameState } from '../../src/web/doc/appBridge';
import { Toast } from '../../src/web/layout/Toast';
import { TopBar } from '../../src/web/layout/TopBar';
import { parseHash } from '../../src/web/lib/route';
import { buildView } from '../../src/web/lib/view';
import { toast, useUi } from '../../src/web/store/ui';
import { meta, resetAll, topicState } from './helpers';
import { anchor, renderPanel, stubScroll, thread, user } from './panel/fixtures';

beforeEach(() => {
  resetAll();
  stubScroll();
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

const OK = { offline: false, error: null };
const viewOf = (over: Parameters<typeof topicState>[0] = {}) => {
  const v = buildView(parseHash('#/demo/root'), topicState(over));
  if (!v) throw new Error('view');
  return v;
};
const $id = (id: string) => document.getElementById(id) as HTMLElement;

// ---- トースト ----
test('トースト：読み上げの入れ物（#toast-region）は、トーストが出る前から、画面にある。通常は polite・エラーは、#toast 自身が role="alert"（入れ物は off）', () => {
  render(<Toast />);
  const region = $id('toast-region');
  expect(region).toBeInTheDocument();
  expect(region).toHaveAttribute('aria-live', 'polite');
  expect($id('toast')).toHaveAttribute('hidden');
  expect($id('toast')).not.toHaveAttribute('role');

  act(() => toast('コピーしました'));
  expect($id('toast')).not.toHaveAttribute('hidden');
  expect($id('toast')).not.toHaveAttribute('role'); // 通常は、入れ物の polite が読み上げる
  expect($id('toast')).not.toHaveClass('err');
  expect(region).toHaveAttribute('aria-live', 'polite');
  expect(region).toContainElement($id('toast')); // 窓口の中に出る：後から出ても、読み上げられる

  act(() => toast('画像は 4 枚までです', true));
  expect($id('toast')).toHaveAttribute('role', 'alert');
  expect($id('toast')).toHaveClass('err');
  expect(region).toHaveAttribute('aria-live', 'off'); // 同じ文を、2 度、読み上げない
  expect(screen.getByRole('alert')).toHaveTextContent('画像は 4 枚までです');
});

// ---- Submit が押せない理由 ----
test('Submit が押せないとき：理由を title（無効のボタンを包む span にも）と、読み上げの説明（aria-describedby）で言う。コメントがなければ「コメントを書くと、送れます」', () => {
  render(<TopBar view={viewOf()} status={OK} />);
  const b = $id('btn-submit');
  expect(b).toBeDisabled();
  expect(b).toHaveAttribute('title', expect.stringContaining('コメントを書くと、送れます'));
  expect($id('submit-wrap')).toHaveAttribute('title', b.getAttribute('title') as string);
  expect(b).toHaveAccessibleDescription(expect.stringContaining('コメントを書くと、送れます'));
  expect(b).toHaveTextContent('Submit'); // 名前（見える文字）は、変えない
});

test('Submit：状態ごとに理由が違う（AI の返信待ち・あなたの番）。未送信があれば、押せて、理由も説明もない', () => {
  const t = thread({ id: 't1', messages: [] });
  const { rerender } = render(<TopBar view={viewOf({ threads: [t], meta: meta({ pending: [1] }) })} status={OK} />);
  expect($id('btn-submit')).toHaveAttribute('title', expect.stringContaining('AI の返信を待っています'));
  rerender(<TopBar view={viewOf({ threads: [t] })} status={OK} />);
  expect($id('btn-submit')).toHaveAttribute('title', expect.stringContaining('未送信のものがありません'));
  rerender(<TopBar view={viewOf({ threads: [t], unsent: 2 })} status={OK} />);
  expect($id('btn-submit')).toBeEnabled();
  expect($id('btn-submit')).not.toHaveAttribute('title');
  expect($id('btn-submit')).not.toHaveAttribute('aria-describedby');
  expect($id('submit-why')).toBeNull();
  expect($id('submit-wrap')).not.toHaveAttribute('title');
});

// ---- 送信後の案内（Claude Code 以外）：初回だけ ----
test('「Claude Code 以外は…」：初めての「AI の返信待ち」だけ、見える文字。次からは、出さない（コピーのボタンの title に、同じ案内）', () => {
  const waiting = viewOf({ threads: [thread({ id: 't1', messages: [] })], meta: meta({ pending: [1] }) });
  const first = render(<TopBar view={waiting} status={OK} />);
  expect($id('top-status')).toHaveTextContent('Claude Code 以外は「rikai に送りました」と伝えてください');
  expect(localStorage.getItem('rikai-send-hint')).toBe('1');
  first.unmount();

  // 2 回目（新しく開いた画面）：見える文字はなし。ボタンの title に、案内
  render(<TopBar view={waiting} status={OK} />);
  expect($id('top-status')).not.toHaveTextContent('Claude Code 以外は');
  const copy = screen.getByRole('button', { name: 'コピー' });
  expect(copy).toHaveAttribute(
    'title',
    expect.stringContaining('Claude Code 以外は「rikai に送りました」と伝えてください'),
  );
});

// ---- 空の説明 ----
test('コメントがない最初の状態の説明：要点は 2 行。ほかの付け方（範囲）は、畳んである', () => {
  renderPanel([]);
  const empty = document.querySelector('#threads .empty') as HTMLElement;
  expect(empty.querySelectorAll(':scope > p')).toHaveLength(2);
  expect(empty).toHaveTextContent('本文の文を選ぶと「コメント」が出ます。');
  const more = empty.querySelector('details.empty-more') as HTMLDetailsElement;
  expect(more.open).toBe(false);
  expect(more).toHaveTextContent('範囲を選ぶ');
  // 見える部分（畳んだ中を除く）は、短い（旧は、1 段落 100 字ほど）
  const visible = [...empty.querySelectorAll(':scope > p')].map((p) => p.textContent).join('');
  expect(visible.length).toBeLessThan(60);
});

// ---- 関連の線 ----
test('関連の線のボタン：名前は、状態に関係なく「関連の線」。状態は aria-pressed と title（いま：オン／オフ）。押すと切り替わる', async () => {
  renderPanel([thread({ id: 't1', anchor: anchor('文'), messages: [user('質問')] })]);
  const b = screen.getByRole('button', { name: '関連の線' });
  expect(b).toHaveAttribute('aria-pressed', 'true');
  expect(b).toHaveAttribute('title', expect.stringContaining('いま：オン'));
  expect(b).toHaveAttribute('title', expect.stringContaining('押すと、隠します'));
  await userEvent.click(b);
  expect(screen.getByRole('button', { name: '関連の線' })).toHaveAttribute('aria-pressed', 'false');
  expect(b).toHaveAttribute('title', expect.stringContaining('いま：オフ'));
  expect(b).toHaveAttribute('title', expect.stringContaining('押すと、出します'));
});

// ---- 位置の名前は 1 行 ----
test('対象の行：位置の名前（label）は、1 行に収め（qlabel）、全文を title に。選んだ文（quote）は、そのまま（複数行でよい）', () => {
  const long = `範囲：実行できる枠 1（隔離されています。パスワードなどの秘密は…（枠の幅 980px で選択）（枠の画像は、枠自身が作ったもの）`;
  renderPanel([
    thread({ id: 't1', anchor: anchor('', { label: long }), messages: [user('A')] }),
    thread({ id: 't2', anchor: anchor('選んだ文です'), messages: [user('B')] }),
  ]);
  const q = [...document.querySelectorAll<HTMLElement>('#threads .thread[data-tid] .quote')];
  expect(q).toHaveLength(2);
  const byTid = (id: string) => document.querySelector(`#threads .thread[data-tid="${id}"] .quote`) as HTMLElement;
  expect(byTid('t1')).toHaveClass('qlabel');
  expect(byTid('t1')).toHaveAttribute('title', long); // 全文（保存されたラベルのまま）
  expect(byTid('t2')).not.toHaveClass('qlabel');
  expect(byTid('t2')).not.toHaveAttribute('title');
});

// ---- 範囲を選ぶ と 要素を選ぶ は、同時に ON にしない ----
test('要素を選ぶボタン：範囲を選んでいる間に押すと、範囲の選択を止めてから、要素の選択を始める。押している間に、もう一度押すと、やめる', async () => {
  let st: FrameState = { width: 'auto', mode: 'light', forced: false, avail: 600, picking: false };
  const subs = new Set<() => void>();
  const frame = {
    get: () => st,
    subscribe: (cb: () => void) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    setWidth: () => {},
    setMode: () => {},
    startPick: vi.fn(() => {
      st = { ...st, picking: true };
      for (const cb of subs) cb();
    }),
    cancelPick: vi.fn(() => {
      st = { ...st, picking: false };
      for (const cb of subs) cb();
    }),
  } as unknown as AppFrame;
  render(<AppToolbar frame={frame} />);
  const pick = document.querySelector('button[data-pick]') as HTMLButtonElement;

  act(() => useUi.getState().setRegMode('selecting'));
  fireEvent.click(pick);
  expect(useUi.getState().regMode).toBe('idle'); // 範囲の選択は、止まる
  expect(frame.startPick).toHaveBeenCalledTimes(1);
  expect(pick).toHaveAttribute('aria-pressed', 'true');

  fireEvent.click(pick); // もう一度：やめる（範囲には、触らない）
  expect(frame.cancelPick).toHaveBeenCalledTimes(1);
  expect(useUi.getState().regMode).toBe('idle');
});
