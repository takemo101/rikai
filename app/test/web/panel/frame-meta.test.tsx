// @vitest-environment jsdom
// 枠から取った情報の行（F45）：開閉・外す・すべて文字として描く・札・送信（frameMeta は、本文とは別に送る）・旧い形のコメントの表示
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { FrameMeta } from '../../../src/shared/types';
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
const frameAnchor = anchor('', { blockTag: 'DIV', label: '枠から：button' });
const META: FrameMeta = {
  pick: {
    selector: 'button.primary',
    tag: 'button',
    text: 'ログイン',
    rect: { x: 113, y: 133, w: 93, h: 34 },
    styles: { color: 'rgb(255, 255, 255)', 'border-radius': '6px' },
    frame: { w: 634, h: 400 },
  },
  state: '{"step":2,"cart":[1,2]}',
};

test('情報の行：閉じた状態は 1 行の要約（札「枠から」＋ 要素を選びました（button・x:113 y:133 w:93 h:34））。開くと、読み取り専用のメタデータ。もう一度で、たたむ', async () => {
  renderPanel([]);
  act(() => {
    useUi.getState().startComposer(frameAnchor, META);
  });
  const row = q('.thread.composer .framemeta') as HTMLElement;
  const toggle = q('.fm-toggle', row) as HTMLButtonElement;
  expect(toggle.textContent).toContain('枠から');
  expect(toggle.textContent).toContain('要素を選びました（button・x:113 y:133 w:93 h:34）／枠の状態');
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  expect(q('.fm-body', row)).toBeNull();
  expect(useUi.getState().drafts.composer).toBe(''); // 入力欄は、空
  await userEvent.click(toggle);
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  expect(toggle.getAttribute('aria-controls')).toBe(q('.fm-body', row)?.id);
  const body = q('.fm-body', row) as HTMLElement;
  for (const s of ['button.primary', 'button', 'ログイン', 'x:113 y:133 w:93 h:34', '634×400', 'border-radius', '6px'])
    expect(body.textContent, s).toContain(s);
  expect(body.textContent).toContain('読み取り専用');
  expect(q('pre', body)?.textContent).toBe(JSON.stringify({ step: 2, cart: [1, 2] }, null, 2)); // 状態
  expect(body.querySelector('input, textarea, button')).toBeNull(); // 編集できない
  await userEvent.click(toggle);
  expect(q('.fm-body', row)).toBeNull();
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
});

test('要約：状態だけなら「枠の状態」・画像の印だけなら「枠の画像は、枠自身が作ったもの」', async () => {
  renderPanel([]);
  act(() => {
    useUi.getState().startComposer(frameAnchor, { state: '{"a":1}' });
  });
  expect(q('.thread.composer .fm-sum')?.textContent).toBe('枠の状態');
  act(() => {
    useUi.getState().startComposer(frameAnchor, { state: '{"a":1}' });
    useUi.getState().setComposerRegionImg(useUi.getState().composer?.id as number, 'a.png');
    useUi.getState().addDraftImg('composer', 'a.png');
    useUi.getState().noteFrameImage(useUi.getState().composer?.id as number);
  });
  expect(q('.thread.composer .fm-sum')?.textContent).toBe('枠の状態／枠の画像は、枠自身が作ったもの');
});

test('「外す」：メタデータだけを外す（錨・本文は残る）。トーストで知らせる。外したあとは、行も札もない。元に戻せない', async () => {
  renderPanel([]);
  act(() => {
    useUi.getState().startComposer(frameAnchor, META);
    useUi.getState().setComposerDraft('私の依頼');
  });
  await userEvent.click(screen.getByRole('button', { name: /外す/ }));
  expect(q('.thread.composer .framemeta')).toBeNull();
  expect(q('.thread.composer .fromframe')).toBeNull();
  expect(q('.thread.composer')?.hasAttribute('data-from-frame')).toBe(false);
  expect(useUi.getState().composer?.frameMeta).toBeUndefined();
  expect(useUi.getState().composer?.anchor.label).toBe('枠から：button'); // 錨は残る
  expect((q('textarea[data-key="composer"]') as HTMLTextAreaElement).value).toBe('私の依頼'); // 本文は残る
  expect(useUi.getState().toast?.msg).toContain('外しました');
  expect(screen.queryByRole('button', { name: /外す/ })).toBeNull();
});

test('すべて文字として描く：HTML・スクリプト・見えない文字（見える形にした文字）の入った値も、要素にならない。innerHTML を使わない', async () => {
  const evil: FrameMeta = {
    pick: {
      selector: '<img src=x onerror=alert(1)>',
      tag: 'button',
      text: '<script>alert(2)</script>',
      rect: { x: 0, y: 0, w: 1, h: 1 },
      styles: { color: '"><svg onload=alert(3)>' },
      frame: { w: 1, h: 1 },
    },
    state: JSON.stringify({ '<b>k</b>': '<iframe src=//evil></iframe>' }),
  };
  renderPanel([]);
  act(() => {
    useUi.getState().startComposer(frameAnchor, evil);
  });
  await userEvent.click(q('.thread.composer .fm-toggle') as HTMLElement);
  const body = q('.thread.composer .fm-body') as HTMLElement;
  expect(body.querySelector('img, script, svg, iframe, b')).toBeNull();
  expect(body.textContent).toContain('<img src=x onerror=alert(1)>');
  expect(body.textContent).toContain('<script>alert(2)</script>');
  expect(body.textContent).toContain('"><svg onload=alert(3)>');
  expect(q('pre', body)?.textContent).toContain('<iframe src=//evil></iframe>');
});

test('送信後のカード：同じ情報の行（開ける・「外す」は、ない）・札「枠から」。本文（text）は、利用者の言葉だけ', async () => {
  renderPanel([thread({ id: 't1', anchor: frameAnchor, messages: [user('この色にしたい', { frameMeta: META })] })]);
  const card = q('.thread[data-tid="t1"]') as HTMLElement;
  expect(card.hasAttribute('data-from-frame')).toBe(true);
  expect(q('.th-head .fromframe', card)?.textContent).toBe('枠から');
  expect(q('.msg.user .body', card)?.textContent).toBe('この色にしたい'); // 機械的な文章・JSON は、入らない
  expect(screen.queryByRole('button', { name: /外す/ })).toBeNull();
  expect(q('.msg .fromframe', card)).toBeNull(); // 札は、見出しに 1 つ（行の中では、二重にしない）
  const toggle = q('.msg .fm-toggle', card) as HTMLButtonElement;
  expect(toggle.textContent).toContain('要素を選びました（button・x:113 y:133 w:93 h:34）');
  await userEvent.click(toggle);
  expect(q('.fm-body', card)?.textContent).toContain('button.primary');
});

test('旧い形のコメント（frameMeta なし・本文に見出しと JSON）：そのまま表示される（情報の行は出ない・札は、旧い判定で付く）', () => {
  const legacy =
    '【枠から】要素を選びました（枠の自己申告。下の JSON）：button（x:1 y:2 w:3 h:4）\n\n```json\n{\n  "selector": "button.primary"\n}\n```\n\n色を変えたい';
  renderPanel([thread({ id: 't1', anchor: frameAnchor, messages: [user(legacy)] })]);
  const card = q('.thread[data-tid="t1"]') as HTMLElement;
  expect(q('.msg.user .body', card)?.textContent).toBe(legacy); // 文字として、そのまま
  expect(q('.framemeta', card)).toBeNull();
  expect(q('.th-head .fromframe', card)).not.toBeNull();
});

test('コメントを追加：frameMeta は、本文（text）とは別の項目で送る。利用者の言葉だけが text。送ったあと、入力欄は閉じる', async () => {
  const view = renderPanel([], {
    onPost: (path, _body, server) => {
      if (path !== '/api/comment') return undefined;
      server.threads = [
        thread({ id: 't9', anchor: frameAnchor, messages: [user('この色にしたい', { sent: false, frameMeta: META })] }),
      ];
      return { thread: 't9' };
    },
  });
  act(() => {
    useUi.getState().startComposer(frameAnchor, META);
  });
  await userEvent.type(q('textarea[data-key="composer"]') as HTMLTextAreaElement, 'この色にしたい');
  await userEvent.click(screen.getByRole('button', { name: 'コメントを追加' }));
  await waitFor(() => expect(view.posts).toHaveLength(1));
  const sent = view.posts[0]?.body as { text: string; frameMeta: FrameMeta };
  expect(sent.text).toBe('この色にしたい');
  expect(sent.frameMeta).toEqual(META);
  await waitFor(() => expect(q('.thread.composer')).toBeNull());
  await waitFor(() => expect(q('.thread[data-tid="t9"] .framemeta')).not.toBeNull());
});

test('「外す」のあとに送ると、frameMeta は付かない（text だけ）。枠の画像を外したら、画像の印も付かない', async () => {
  const view = renderPanel([], { onPost: (path) => (path === '/api/comment' ? { thread: 't9' } : undefined) });
  act(() => {
    useUi.getState().startComposer(frameAnchor, META);
  });
  await userEvent.click(screen.getByRole('button', { name: /外す/ }));
  await userEvent.type(q('textarea[data-key="composer"]') as HTMLTextAreaElement, '一言');
  await userEvent.click(screen.getByRole('button', { name: 'コメントを追加' }));
  await waitFor(() => expect(view.posts).toHaveLength(1));
  expect(view.posts[0]?.body).not.toHaveProperty('frameMeta');
  expect(view.posts[0]?.body).toMatchObject({ text: '一言' });
});

test('枠の画像の印は、枠の画像が添付されているときだけ：外す・添付に失敗した入力欄には、行も印もない', () => {
  renderPanel([]);
  act(() => {
    useUi.getState().startComposer(frameAnchor);
    useUi.getState().noteFrameImage(useUi.getState().composer?.id as number);
  });
  expect(useUi.getState().composer?.frameMeta).toEqual({ imageFromFrame: true });
  expect(q('.thread.composer .framemeta')).toBeNull(); // まだ（添付に失敗した・これから）：画像がない
  act(() => {
    useUi.getState().addDraftImg('composer', 'r.png');
    useUi.getState().setComposerRegionImg(useUi.getState().composer?.id as number, 'r.png');
  });
  expect(q('.thread.composer .fm-sum')?.textContent).toBe('枠の画像は、枠自身が作ったもの');
  act(() => useUi.getState().removeDraftImg('composer', 'r.png')); // 利用者が、画像を外した
  expect(q('.thread.composer .framemeta')).toBeNull();
});

test('枠から取った情報だけでは、送れない：本文も画像もなければ、トースト（エラー）で知らせて、入力欄へフォーカスを戻す。何も送らない。本文を書けば、送れる', async () => {
  const view = renderPanel([], { onPost: (path) => (path === '/api/comment' ? { thread: 't9' } : undefined) });
  act(() => {
    useUi.getState().startComposer(frameAnchor, META);
  });
  const ta = q('textarea[data-key="composer"]') as HTMLTextAreaElement;
  act(() => ta.blur()); // フォーカスを、入力欄から外す
  expect(ta).not.toHaveFocus();
  await userEvent.click(screen.getByRole('button', { name: 'コメントを追加' }));
  expect(useUi.getState().toast?.msg).toBe('コメントの本文を書いてください（枠から取った情報だけでは送れません）');
  expect(useUi.getState().toast?.err).toBe(true);
  expect(ta).toHaveFocus();
  expect(view.posts).toHaveLength(0);
  expect(useUi.getState().composer?.frameMeta).toEqual(META); // 下書きは、そのまま
  // 情報のない入力欄は、これまでどおり、黙って何もしない
  act(() => {
    useUi.getState().showToast('x');
    useUi.getState().removeFrameMeta();
    useUi.getState().showToast('y');
  });
  await userEvent.click(screen.getByRole('button', { name: 'コメントを追加' }));
  expect(useUi.getState().toast?.msg).toBe('y');
  expect(view.posts).toHaveLength(0);
});

test('状態の表示：見える化した文字（タグ文字・RLO）は、`\\` 1 つで出る（JSON の書き直しで、二重にならない）。文字として描く', async () => {
  const state = JSON.stringify({ 'k\\u{E0049}': 'v\\u202E', note: '<b>x</b>\\u{E0047}' });
  renderPanel([thread({ id: 't1', anchor: frameAnchor, messages: [user('一言', { frameMeta: { state } })] })]);
  const card = q('.thread[data-tid="t1"]') as HTMLElement;
  await userEvent.click(q('.msg .fm-toggle', card) as HTMLElement);
  const pre = q('.fm-body pre', card) as HTMLElement;
  expect(pre.textContent).toContain('"k\\u{E0049}": "v\\u202E"');
  expect(pre.textContent).toContain('<b>x</b>\\u{E0047}');
  expect(pre.textContent).not.toContain('\\\\u');
  expect(pre.querySelector('b')).toBeNull();
});

test('AI のメッセージに frameMeta があるデータ（手で作った threads.json）でも、札・情報の行は出ない（利用者のメッセージだけに出す）', () => {
  renderPanel([
    thread({
      id: 't1',
      anchor: frameAnchor,
      messages: [user('私の一言'), ai('AI の返信', { frameMeta: META })],
    }),
  ]);
  const card = q('.thread[data-tid="t1"]') as HTMLElement;
  expect(card.hasAttribute('data-from-frame')).toBe(false);
  expect(q('.fromframe', card)).toBeNull();
  expect(q('.framemeta', card)).toBeNull();
});
