// @vitest-environment jsdom
// 返信欄の畳み（P5）：選んでいないカードは、1 行の「返信…」。選ぶ・フォーカスする・書きかけ・画像があるときは、開く。畳んでも、欄は DOM にあり（Tab・読み上げで届く）、書きかけは失われない。
// 「資料を vN に更新」は、最新の更新だけ文字つき（古いものは `↻vN` の小さなリンク）。
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Ask } from '../../../src/shared/types';
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
const reply = (tid: string) => q(`textarea[data-key="reply-${tid}"]`) as HTMLTextAreaElement;
const foot = (tid: string) => q(`.thread[data-tid="${tid}"] .th-foot`) as HTMLElement;
const isOpen = (tid: string) => !foot(tid).classList.contains('fold');
const head = (tid: string) => q(`.thread[data-tid="${tid}"] .th-head`) as HTMLElement;

const two = () =>
  renderPanel([
    thread({ id: 't1', anchor: anchor('文 1'), messages: [user('質問 1'), ai('答え 1')] }),
    thread({ id: 't2', anchor: anchor('文 2'), messages: [user('質問 2'), ai('答え 2')] }),
  ]);

test('選んでいないカード：返信欄は 1 行（「返信…」）で、ボタンは出ない。名前は、畳んでも・開いても、同じ（読み上げ）', () => {
  two();
  for (const id of ['t1', 't2']) {
    expect(isOpen(id)).toBe(false);
    expect(reply(id).rows).toBe(1);
    expect(reply(id).placeholder).toBe('返信…');
    expect(q('button', foot(id))).toBeNull(); // 画像・追加・解決は、開くまで出ない（Tab の停止も増やさない）
  }
  expect(screen.getAllByRole('textbox', { name: '返信・追加の質問' })).toHaveLength(2); // 畳んでも、名前つきで届く
});

test('カードを選ぶ（見出しを押す）と、その場で開く（3 行・画像／追加／解決）。ほかのカードは、畳んだまま。別のカードを選ぶと、移る', async () => {
  two();
  await userEvent.click(head('t1'));
  expect(isOpen('t1')).toBe(true);
  expect(reply('t1').rows).toBe(3);
  expect(reply('t1').placeholder).toContain('⌘/Ctrl+Enter で追加');
  expect(
    [...foot('t1').querySelectorAll('button')].map((b) => b.getAttribute('aria-label') ?? b.textContent?.trim()),
  ).toEqual(['画像を付ける', '追加', '解決']);
  expect(isOpen('t2')).toBe(false);
  await userEvent.click(head('t2'));
  expect(isOpen('t2')).toBe(true);
  expect(isOpen('t1')).toBe(false); // 書きかけがなければ、畳む
});

test('欄にフォーカスする（Tab・クリック）と、そのカードを選んで、開く。続けて Tab で、追加・解決へ届く', async () => {
  two();
  await userEvent.click(reply('t1')); // 1 回のクリックで、選んで・開いて・入力できる
  expect(useUi.getState().active).toBe('t1');
  expect(isOpen('t1')).toBe(true);
  expect(reply('t1')).toHaveFocus();
  await userEvent.tab();
  expect(screen.getAllByRole('button', { name: '画像を付ける' })[0]).toHaveFocus();
  await userEvent.tab();
  expect(screen.getByRole('button', { name: '追加' })).toHaveFocus();
  await userEvent.tab();
  expect(screen.getByRole('button', { name: '解決' })).toHaveFocus();
  expect(isOpen('t1')).toBe(true); // ボタンにフォーカスがあるあいだも、畳まれない
});

test('キーボードだけ：畳んだ欄へ Tab で入ると、開く（マウスを使わない）', async () => {
  two();
  // 先頭から Tab：カード 1 の見出し・本文のリンクなどを経て、欄に届く
  for (let i = 0; i < 20 && document.activeElement !== reply('t1'); i++) await userEvent.tab();
  expect(reply('t1')).toHaveFocus();
  expect(isOpen('t1')).toBe(true);
  await userEvent.keyboard('キーボードで');
  expect(useUi.getState().drafts.reply.t1).toBe('キーボードで');
});

test('書きかけがあるカードは、選んでいなくても、開いたまま（書いた文が見えなくならない）。文を消すと、畳む。畳んでも失われない', async () => {
  two();
  await userEvent.click(reply('t1'));
  await userEvent.type(reply('t1'), '書きかけ');
  await userEvent.click(head('t2')); // ほかのカードを選ぶ
  expect(useUi.getState().active).toBe('t2');
  expect(isOpen('t1')).toBe(true); // 書きかけ：開いたまま
  expect(reply('t1').value).toBe('書きかけ');
  expect(q('.thread[data-tid="t1"] .th-foot button')).not.toBeNull();
  await userEvent.clear(reply('t1')); // 文を消した（欄にフォーカスがあるあいだは、選んでいる）
  await userEvent.click(head('t2')); // ほかのカードを選ぶと、選んでいないので、畳む
  expect(isOpen('t1')).toBe(false);
  expect(useUi.getState().drafts.reply.t1).toBe('');
});

test('下書きの状態（drafts.reply）は、畳み・開きに、触れない：選び直しても、描き直しても、値は同じ', async () => {
  two();
  act(() => useUi.getState().setReplyDraft('t2', '前からの下書き'));
  expect(isOpen('t2')).toBe(true); // 選んでいなくても、開いている
  expect(reply('t2').value).toBe('前からの下書き');
  await userEvent.click(head('t1'));
  await userEvent.click(head('t2'));
  await userEvent.click(head('t1'));
  expect(reply('t2').value).toBe('前からの下書き');
  expect(useUi.getState().drafts.reply.t2).toBe('前からの下書き');
});

test('付けた画像・アップロード中も、開いたまま（画像が見えなくならない）', () => {
  two();
  act(() => useUi.getState().addDraftImg('reply-t1', 'a.png'));
  expect(isOpen('t1')).toBe(true);
  expect(q('.thread[data-tid="t1"] .imgbar img')).not.toBeNull();
  act(() => useUi.getState().beginUpload('reply-t2'));
  expect(isOpen('t2')).toBe(true);
  act(() => useUi.getState().endUpload('reply-t2'));
  expect(isOpen('t2')).toBe(false);
});

test('追加して送ったあとも、選んでいるあいだは開いたまま。「解決」→ 再開する の 1 行（返信欄なし）は、これまでどおり', async () => {
  const view = renderPanel([thread({ id: 't1', anchor: anchor('文'), messages: [user('質問'), ai('答え')] })], {
    onPost: (path, body, server) => {
      if (path === '/api/reply') {
        server.threads = server.threads.map((t) =>
          t.id === body.thread ? { ...t, messages: [...t.messages, user(String(body.text), { sent: false })] } : t,
        );
      }
      return undefined;
    },
  });
  await userEvent.click(reply('t1'));
  await userEvent.type(reply('t1'), 'つづき');
  await userEvent.click(screen.getByRole('button', { name: '追加' }));
  await vi.waitFor(() => expect(view.posts).toHaveLength(1));
  await vi.waitFor(() => expect(useUi.getState().drafts.reply.t1).toBe(''));
  expect(isOpen('t1')).toBe(true); // まだ選んでいる
});

test('解決済みのカードは、返信欄を持たない（「再開する」だけ）。質問（ask）のカードは、返信欄が畳まれても、答える欄は、いつも出る', async () => {
  const ask: Ask = {
    type: 'single_choice',
    question: 'どちら？',
    options: [
      { id: 'a', label: '左' },
      { id: 'b', label: '右' },
    ],
    allowOther: false,
  };
  renderPanel([
    thread({ id: 't1', anchor: anchor('文 1'), messages: [user('質問'), ai('これです', { ask })] }),
    thread({ id: 't2', anchor: anchor('文 2'), resolved: true, messages: [user('質問'), ai('答え')] }),
  ]);
  expect(isOpen('t1')).toBe(false);
  const card = q('.thread[data-tid="t1"]') as HTMLElement;
  expect(card.querySelectorAll('.ask input[type="radio"]')).toHaveLength(2); // 質問の表示は、そのまま
  expect(card.querySelector('.ask')).not.toBeNull();
  await userEvent.click(card.querySelectorAll<HTMLInputElement>('.ask input[type="radio"]')[0] as HTMLInputElement);
  expect(useUi.getState().drafts.ask).toBeDefined();
  // 解決済みは、タブ「解決済み」の 1 行（開くと「再開する」だけ）
  await userEvent.click(screen.getByRole('tab', { name: /解決済み/ }));
  await userEvent.click(q('.donerow') as HTMLElement);
  const open = q('.rowopen .thread[data-tid="t2"]') as HTMLElement;
  expect(open.querySelector('textarea')).toBeNull();
  expect(screen.getByRole('button', { name: '再開する' })).toBeInTheDocument();
});

// ---- 資料の更新 ----
test('「資料を vN に更新」：最新の更新だけ文字つき（札と「vN を見る」）。古い更新は `↻vN` の小さなリンク（名前は残る・押すとその版へ）', () => {
  renderPanel(
    [
      thread({
        id: 't1',
        page: 'root',
        messages: [
          user('質問 1'),
          ai('直しました（1 回目）', { revision: 2 }),
          user('質問 2'),
          ai('もう一度直しました', { revision: 3 }),
          ai('補足です'), // 更新のない、新しい返信：最新の更新は、v3 のまま
        ],
      }),
    ],
    { versions: 3 },
  );
  const [old, latest, note] = [...document.querySelectorAll<HTMLElement>('.msg.ai')];
  // 古い更新：緑の札も「v2 を見る」の文字もない。小さなリンクだけ
  expect(old?.querySelector('.chip.ok')).toBeNull();
  const small = old?.querySelector<HTMLAnchorElement>('a.rev-old');
  expect(small?.textContent).toBe('v2');
  expect(small?.getAttribute('href')).toBe('#/demo/root/v2');
  expect(small?.getAttribute('aria-label')).toBe('資料を v2 に更新した版を見る');
  expect(screen.getByRole('link', { name: '資料を v2 に更新した版を見る' })).toBe(small);
  // 最新の更新：これまでどおり
  expect(latest?.querySelector('.chip.ok')?.textContent).toBe('資料を v3 に更新');
  expect(latest?.querySelector('a.btnlink:not(.rev-old)')?.textContent).toBe('v3 を見る');
  expect(latest?.querySelector('a.rev-old')).toBeNull();
  expect(note?.querySelector('.row.meta')).toBeNull();
  expect(document.querySelectorAll('.chip.ok')).toHaveLength(1); // 緑の札は、カードに 1 つ
});

test('折りたたまれた古いやり取りの中の更新も、同じ規則（最新の更新だけ文字つき）', async () => {
  renderPanel(
    [
      thread({
        id: 't1',
        page: 'root',
        messages: [
          user('1'),
          ai('更新 1', { revision: 2 }),
          user('2'),
          ai('更新 2', { revision: 3 }),
          user('3'),
          ai('更新 3', { revision: 4 }),
        ],
      }),
    ],
    { versions: 4 },
  );
  await userEvent.click(screen.getByText(/これまでのやり取り/));
  expect([...document.querySelectorAll('.chip.ok')].map((c) => c.textContent)).toEqual(['資料を v4 に更新']);
  expect([...document.querySelectorAll('a.rev-old')].map((a) => a.textContent)).toEqual(['v2', 'v3']);
});
