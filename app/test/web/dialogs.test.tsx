// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { queryClient } from '../../src/web/api/queryClient';
import { EndDialog } from '../../src/web/layout/EndDialog';
import { SubmitDialog } from '../../src/web/layout/SubmitDialog';
import { useUi } from '../../src/web/store/ui';
import { installDialog, mockFetch, renderWithClient, resetAll, topicState } from './helpers';

beforeAll(installDialog);
beforeEach(resetAll);
afterEach(() => vi.unstubAllGlobals());

const dlg = (id: string) => document.getElementById(id) as HTMLDialogElement;

test('SubmitDialog：開くまでは閉じている。開くと、件数の文言が出る。confirm は呼ばない', () => {
  const confirm = vi.fn();
  vi.stubGlobal('confirm', confirm);
  renderWithClient(<SubmitDialog slug="demo" unsent={3} />);
  expect(dlg('submitdlg').open).toBe(false);
  act(() => useUi.getState().openDialog('submit'));
  expect(dlg('submitdlg').open).toBe(true);
  expect(screen.getByText('未送信のコメント・回答など 3 件を AI に送ります。')).toBeInTheDocument();
  expect(confirm).not.toHaveBeenCalled();
});

test('SubmitDialog：キャンセルでは、送らない・閉じる・メモは残る', async () => {
  const { fn } = mockFetch(() => ({ body: { ok: true } }));
  renderWithClient(<SubmitDialog slug="demo" unsent={1} />);
  act(() => useUi.getState().openDialog('submit'));
  fireEvent.change(screen.getByPlaceholderText('特定の箇所に紐づかない伝言があれば'), { target: { value: '伝言' } });
  fireEvent.click(screen.getByRole('button', { name: 'キャンセル', hidden: true }));
  expect(dlg('submitdlg').open).toBe(false);
  expect(useUi.getState().dialog).toBeNull();
  await new Promise((r) => setTimeout(r, 20));
  expect(fn).not.toHaveBeenCalled();
  expect(screen.getByDisplayValue('伝言')).toBeInTheDocument();
});

test('SubmitDialog：Esc（value なしで閉じる）でも、送らない', async () => {
  const { fn } = mockFetch(() => ({ body: { ok: true } }));
  renderWithClient(<SubmitDialog slug="demo" unsent={1} />);
  act(() => useUi.getState().openDialog('submit'));
  act(() => dlg('submitdlg').close());
  await new Promise((r) => setTimeout(r, 20));
  expect(fn).not.toHaveBeenCalled();
  expect(useUi.getState().dialog).toBeNull();
});

test('SubmitDialog：「送信する」で、メモつきで送る → 「第N回として送信しました」・メモを空に・トピックを取り直す', async () => {
  queryClient.setQueryData(['topic', 'demo'], topicState({ unsent: 2 }));
  const { calls } = mockFetch((req) =>
    req.method === 'POST' ? { body: { ok: true, round: 4 } } : { body: topicState({ rev: 2, unsent: 0 }) },
  );
  renderWithClient(<SubmitDialog slug="demo" unsent={2} />);
  act(() => useUi.getState().openDialog('submit'));
  fireEvent.change(screen.getByPlaceholderText('特定の箇所に紐づかない伝言があれば'), { target: { value: '伝言' } });
  fireEvent.click(screen.getByRole('button', { name: '送信する', hidden: true }));
  await waitFor(() => expect(useUi.getState().toast?.msg).toBe('第4回として送信しました'));
  expect(calls[0]).toMatchObject({ method: 'POST', path: '/api/submit', body: { topic: 'demo', note: '伝言' } });
  await waitFor(() => expect(calls.some((c) => c.path === '/api/topic/demo')).toBe(true));
  expect(screen.getByPlaceholderText('特定の箇所に紐づかない伝言があれば')).toHaveValue('');
  expect(useUi.getState().toast?.err).toBe(false);
});

test('SubmitDialog：送信に失敗したら、エラーのトースト・メモは残る', async () => {
  mockFetch(() => ({ status: 409, body: { ok: false, error: '送るものがありません' } }));
  renderWithClient(<SubmitDialog slug="demo" unsent={1} />);
  act(() => useUi.getState().openDialog('submit'));
  fireEvent.change(screen.getByPlaceholderText('特定の箇所に紐づかない伝言があれば'), { target: { value: '伝言' } });
  fireEvent.click(screen.getByRole('button', { name: '送信する', hidden: true }));
  await waitFor(() => expect(useUi.getState().toast).toMatchObject({ msg: '送るものがありません', err: true }));
  expect(screen.getByDisplayValue('伝言')).toBeInTheDocument();
});

test('EndDialog：文言・キャンセルでは送らない・「終了する」で /api/end', async () => {
  const confirm = vi.fn();
  vi.stubGlobal('confirm', confirm);
  const { calls } = mockFetch((req) => (req.method === 'POST' ? { body: { ok: true } } : { body: topicState() }));
  renderWithClient(<EndDialog slug="demo" />);
  expect(dlg('enddlg').open).toBe(false);
  act(() => useUi.getState().openDialog('end'));
  expect(dlg('enddlg').open).toBe(true);
  expect(screen.getByText('レビューを終了します')).toBeInTheDocument();
  expect(screen.getByText('未送信のコメントは残りますが、AI には届きません。')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'キャンセル', hidden: true }));
  expect(dlg('enddlg').open).toBe(false);
  await new Promise((r) => setTimeout(r, 20));
  expect(calls).toHaveLength(0);

  act(() => useUi.getState().openDialog('end'));
  fireEvent.click(screen.getByRole('button', { name: '終了する', hidden: true }));
  await waitFor(() => expect(calls.some((c) => c.path === '/api/end')).toBe(true));
  expect(calls.find((c) => c.path === '/api/end')?.body).toEqual({ topic: 'demo' });
  await waitFor(() => expect(calls.some((c) => c.path === '/api/topic/demo')).toBe(true));
  expect(confirm).not.toHaveBeenCalled();
});
