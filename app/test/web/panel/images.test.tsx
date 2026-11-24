// @vitest-environment jsdom
// 画像の添付（F24）：貼り付け・ドラッグ・ファイル選択／形式・大きさ・枚数／アップロードの世代／×で外す／送る。添付の画像の拡大表示（F31）
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
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
const png = (name = 'a.png', body = 'x') => new File([body], name, { type: 'image/png' });
const thumbs = (root: ParentNode = document) => qa('.imgbar .thumb img', root).map((i) => i.getAttribute('src'));

/** `data`（base64）から、決まった名前を返す作り物のサーバー（同じ画像は、同じ名前） */
const attachOk: Parameters<typeof renderPanel>[1] = {
  onPost: (path, body) =>
    path === '/api/attach' ? { name: `c-${String(body.data).replace(/\W/g, '')}.png` } : undefined,
};

function openComposer() {
  act(() => {
    useUi.getState().startComposer(anchor('文'));
  });
  return q('textarea[data-key="composer"]') as HTMLTextAreaElement;
}

const paste = (el: HTMLElement, files: File[], types: string[]) =>
  fireEvent.paste(el, { clipboardData: { files, types } });

test('貼り付け：画像だけの貼り付けは、受ける（POST /api/attach { topic, data: base64 }）→ サムネイル（×つき）が出る', async () => {
  const view = renderPanel([], attachOk);
  const ta = openComposer();
  paste(ta, [png('shot.png', 'abc')], ['Files']);
  await waitFor(() => expect(thumbs()).toHaveLength(1));
  expect(view.posts[0]).toMatchObject({ path: '/api/attach', body: { topic: 'demo', data: btoa('abc') } });
  expect(thumbs()[0]).toMatch(/^\/asset\/demo\/c-.*\.png$/);
  const thumb = q('.imgbar .thumb') as HTMLElement;
  expect(q('img', thumb)?.getAttribute('alt')).toBe('添付の画像');
  const x = q('button.x', thumb) as HTMLButtonElement;
  expect([x.title, x.getAttribute('aria-label'), x.textContent]).toEqual(['外す', '画像を外す', '']); // アイコンだけ（名前は aria-label）
  expect(useUi.getState().drafts.imgs.composer).toHaveLength(1);
  expect(useUi.getState().uploading).toBe(0);
});

test('貼り付け：文字を含むとき（text/plain）・画像でないものは、受けない（そのまま貼り付けられる）', async () => {
  const view = renderPanel([], attachOk);
  const ta = openComposer();
  const textToo = paste(ta, [png()], ['Files', 'text/plain']);
  const notImage = paste(ta, [new File(['x'], 'a.txt', { type: 'text/plain' })], ['Files']);
  expect(textToo).toBe(true); // preventDefault されない
  expect(notImage).toBe(true);
  await new Promise((r) => setTimeout(r, 20));
  expect(view.posts).toHaveLength(0);
  const accepted = paste(ta, [png('b.png', 'bbb')], ['Files']);
  expect(accepted).toBe(false); // 画像だけ：受けた（preventDefault）
});

test('ドラッグ：ファイルのドラッグを受ける（dragover を許す）→ 落とすと、付く', async () => {
  renderPanel([], attachOk);
  const ta = openComposer();
  expect(fireEvent.dragOver(ta, { dataTransfer: { types: ['Files'], files: [] } })).toBe(false);
  expect(fireEvent.dragOver(ta, { dataTransfer: { types: ['text/plain'], files: [] } })).toBe(true);
  expect(fireEvent.drop(ta, { dataTransfer: { types: ['Files'], files: [png('d.png', 'ddd')] } })).toBe(false);
  await waitFor(() => expect(thumbs()).toHaveLength(1));
  expect(fireEvent.drop(ta, { dataTransfer: { types: ['text/plain'], files: [] } })).toBe(true);
});

test('ファイル選択：「画像を付ける」→ 選んだ複数のファイルが付く', async () => {
  renderPanel([], attachOk);
  openComposer();
  const input = q('input[type="file"]') as HTMLInputElement;
  expect(input.accept).toBe('image/png,image/jpeg,image/gif,image/webp');
  expect(input.multiple).toBe(true);
  expect(input.hidden).toBe(true);
  const click = vi.spyOn(input, 'click');
  await userEvent.click(screen.getByRole('button', { name: '画像を付ける' }));
  expect(click).toHaveBeenCalled();
  await userEvent.upload(input, [png('a.png', 'aaa'), png('b.png', 'bbb')]);
  await waitFor(() => expect(thumbs()).toHaveLength(2));
});

test('形式・大きさ・枚数の検査：トーストで断る。4 枚まで（5 枚目は、アップロードしない）', async () => {
  const view = renderPanel([], attachOk);
  const ta = openComposer();
  const toast = () => useUi.getState().toast;

  await act(async () => {
    paste(ta, [new File(['<svg/>'], 'a.svg', { type: 'image/svg+xml' })], ['Files']);
  });
  expect(toast()).toMatchObject({ msg: '画像は、png・jpeg・gif・webp だけ付けられます', err: true });

  const big = png('big.png');
  Object.defineProperty(big, 'size', { value: 5 * 1024 * 1024 + 1 });
  await act(async () => {
    paste(ta, [big], ['Files']);
  });
  expect(toast()).toMatchObject({ msg: '画像が大きすぎます（5MB まで）', err: true });
  expect(view.posts).toHaveLength(0);

  for (const n of [1, 2, 3, 4]) {
    paste(ta, [png(`${n}.png`, `n${n}`)], ['Files']);
    await waitFor(() => expect(thumbs()).toHaveLength(n));
  }
  await act(async () => {
    paste(ta, [png('5.png', 'n5')], ['Files']);
  });
  expect(toast()).toMatchObject({ msg: '画像は 4 枚までです', err: true });
  expect(thumbs()).toHaveLength(4);
  expect(view.posts).toHaveLength(4);
});

test('続けて何枚も貼っても（完了を待たない）、付けるのは、4 枚まで。同じ画像は、1 枚', async () => {
  renderPanel([], attachOk);
  const ta = openComposer();
  fireEvent.paste(ta, {
    clipboardData: { files: [1, 2, 3, 4, 5, 6].map((n) => png(`${n}.png`, `m${n}`)), types: ['Files'] },
  });
  await waitFor(() => expect(thumbs().length).toBeGreaterThanOrEqual(4));
  await new Promise((r) => setTimeout(r, 30));
  expect(thumbs()).toHaveLength(4);
  // 同じ中身（同じ名前）は、増えない
  act(() => useUi.getState().resetImgs('composer'));
  paste(ta, [png('x.png', 'same')], ['Files']);
  await waitFor(() => expect(thumbs()).toHaveLength(1));
  paste(ta, [png('y.png', 'same')], ['Files']);
  await new Promise((r) => setTimeout(r, 30));
  expect(thumbs()).toHaveLength(1);
});

test('「アップロード中…」は、その画像を付けている入力欄だけに出す（ほかのカードの高さを、変えない）。全体の数は、送るのを止めるために、数え続ける', () => {
  renderPanel([thread({ id: 't1', messages: [user('質問')] }), thread({ id: 't2', messages: [user('質問')] })]);
  const card = (tid: string) => q(`.thread[data-tid="${tid}"]`) as HTMLElement;
  expect(q('.imgbar')).toBeNull();
  act(() => useUi.getState().beginUpload('reply-t1'));
  expect(q('.imgbar .sl', card('t1'))?.textContent).toBe('アップロード中…');
  expect(q('.imgbar', card('t2'))).toBeNull();
  expect(useUi.getState().uploading).toBe(1);
  act(() => useUi.getState().endUpload('reply-t1'));
  expect(q('.imgbar')).toBeNull();
  expect(useUi.getState().uploadingBy).toEqual({});
});

test('アップロード中は「アップロード中…」。終わるまでに、入力欄をやめたら、その画像は、付けない（世代）。別の入力欄にも、出ない', async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => {
    release = r;
  });
  renderPanel([], {
    onPost: async (path, body) => {
      if (path !== '/api/attach') return undefined;
      await gate;
      return { name: `c-${String(body.data).replace(/\W/g, '')}.png` };
    },
  });
  const ta = openComposer();
  paste(ta, [png('slow.png', 'slow')], ['Files']);
  await waitFor(() => expect(q('.imgbar .sl')?.textContent).toBe('アップロード中…'));
  expect(useUi.getState().uploading).toBe(1);
  // やめる：世代が進む。同じ欄を開き直しても、遅れて終わった画像は、付かない
  await userEvent.click(screen.getByRole('button', { name: 'やめる' }));
  openComposer();
  release();
  await waitFor(() => expect(useUi.getState().uploading).toBe(0));
  expect(thumbs()).toHaveLength(0);
  expect(useUi.getState().drafts.imgs.composer ?? []).toEqual([]);
  expect(q('.imgbar .sl')).toBeNull();
});

test('終わるまでに、別のトピックへ移ったら、付けない', async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => {
    release = r;
  });
  renderPanel([], {
    onPost: async (path) => {
      if (path !== '/api/attach') return undefined;
      await gate;
      return { name: 'c-late.png' };
    },
  });
  const ta = openComposer();
  paste(ta, [png('late.png', 'late')], ['Files']);
  await waitFor(() => expect(useUi.getState().uploading).toBe(1));
  location.hash = '#/other/root';
  release();
  await waitFor(() => expect(useUi.getState().uploading).toBe(0));
  expect(useUi.getState().drafts.imgs.composer ?? []).toEqual([]);
});

test('アップロードが失敗したら、トースト・付かない・アップロード中の表示は、消える', async () => {
  renderPanel([]);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ ok: false, error: '画像ではありません' }), { status: 400 })),
  );
  const ta = openComposer();
  paste(ta, [png()], ['Files']);
  await waitFor(() => expect(useUi.getState().toast).toMatchObject({ msg: '画像ではありません', err: true }));
  expect(useUi.getState().uploading).toBe(0);
  expect(thumbs()).toHaveLength(0);
});

test('×で外す（保存したファイルは、サーバーに残る：外すだけ）', async () => {
  const view = renderPanel([], attachOk);
  const ta = openComposer();
  paste(ta, [png('a.png', 'aaa')], ['Files']);
  paste(ta, [png('b.png', 'bbb')], ['Files']);
  await waitFor(() => expect(thumbs()).toHaveLength(2));
  const [first] = thumbs();
  await userEvent.click(qa('.imgbar .thumb button.x')[0] as HTMLElement);
  expect(thumbs()).toHaveLength(1);
  expect(thumbs()[0]).not.toBe(first);
  expect(view.posts.filter((p) => p.path !== '/api/attach')).toHaveLength(0);
});

test('コメントに、画像だけでも送れる（文が空でも）。送ると、画像の欄は空・世代が進む', async () => {
  const view = renderPanel([], {
    onPost: (path, body, server) => {
      if (path === '/api/attach') return { name: `c-${String(body.data).replace(/\W/g, '')}.png` };
      if (path === '/api/comment') {
        server.threads = [thread({ id: 't9', messages: [user('', { images: body.images as string[] })] })];
        return { thread: 't9' };
      }
      return undefined;
    },
  });
  const ta = openComposer();
  paste(ta, [png('a.png', 'aaa')], ['Files']);
  await waitFor(() => expect(thumbs()).toHaveLength(1));
  const name = useUi.getState().drafts.imgs.composer?.[0];
  const gen = useUi.getState().imgGen.composer ?? 0;
  await userEvent.click(screen.getByRole('button', { name: 'コメントを追加' }));
  await waitFor(() => expect(q('.thread[data-tid="t9"]')).not.toBeNull());
  expect(view.posts.at(-1)).toMatchObject({ path: '/api/comment', body: { text: '', images: [name] } });
  expect(useUi.getState().drafts.imgs.composer).toEqual([]);
  expect(useUi.getState().imgGen.composer).toBeGreaterThan(gen);
  // 送った画像：リンク（新しい窓）・遅延読み込み
  const a = q('.msg.user .imgs a') as HTMLAnchorElement;
  expect([a.target, a.rel, a.getAttribute('href')]).toEqual(['_blank', 'noopener', `/asset/demo/${name}`]);
  expect(q('img', a)?.getAttribute('loading')).toBe('lazy');
});

test('返信にも、画像を付けて送れる（キーは reply-<スレッド ID>）。コメントの入力欄とは、別', async () => {
  const view = renderPanel([thread({ id: 't1', messages: [user('質問', { sent: true })] })], attachOk);
  act(() => {
    useUi.getState().startComposer(anchor('文'));
  });
  const reply = q('textarea[data-key="reply-t1"]') as HTMLTextAreaElement;
  paste(reply, [png('r.png', 'rrr')], ['Files']);
  await waitFor(() => expect(useUi.getState().drafts.imgs['reply-t1']).toHaveLength(1));
  expect(useUi.getState().drafts.imgs.composer ?? []).toEqual([]);
  expect(thumbs(q('.thread[data-tid="t1"]') as HTMLElement)).toHaveLength(1);
  await userEvent.click(screen.getByRole('button', { name: '追加' }));
  await waitFor(() => expect(view.posts.at(-1)?.path).toBe('/api/reply'));
  expect(view.posts.at(-1)?.body).toMatchObject({ thread: 't1', text: '', images: [expect.stringMatching(/^c-/)] });
  await waitFor(() => expect(useUi.getState().drafts.imgs['reply-t1']).toEqual([]));
});

test('アップロード中は、送れない（トースト）', async () => {
  renderPanel([thread({ id: 't1', messages: [user('質問')] })]);
  act(() => useUi.getState().beginUpload());
  await userEvent.type(q('textarea[data-key="reply-t1"]') as HTMLElement, 'x');
  await userEvent.click(screen.getByRole('button', { name: '追加' }));
  expect(useUi.getState().toast).toMatchObject({
    msg: '画像のアップロード中です。終わってから、追加してください',
    err: true,
  });
});

// ---- F31・F37：添付の画像も、同じ拡大表示（ズーム・移動。見るだけ） ----
test('添付の画像：サムネイル・送った画像を押すと、拡大表示で出る（ステージの img の src）。見るだけ（ドックなし）。×・Esc で閉じる。リンクは、開かない', async () => {
  renderPanel([thread({ id: 't1', messages: [user('', { images: ['c-1.png'], sent: true })] })], attachOk);
  act(() => {
    useUi.getState().startComposer(anchor('文'));
    useUi.getState().addDraftImg('composer', 'c-2.png');
  });
  const lb = q('#lightbox') as HTMLElement;
  expect(lb.hidden).toBe(true);

  const sent = q('.msg .imgs img') as HTMLImageElement;
  const notPrevented = fireEvent.click(sent);
  expect(notPrevented).toBe(false); // <a> の遷移を止める
  expect(lb.hidden).toBe(false);
  expect((q('.lb-stage img', lb) as HTMLImageElement).src).toBe(sent.src);
  expect(q('.lb-tools button[aria-label="ズームイン"]', lb)).not.toBeNull(); // 本文の画像と同じ、拡大表示の道具
  expect(q('.fv-dock', lb)).toBeNull(); // 見るだけ：ドックも、範囲の道具も、ない
  expect(q('.fv-tools', lb)).toBeNull();
  // 状態は、型つき（本文の画像と同じ形。`focus` がない＝ステージだけ）
  expect(useUi.getState().lightbox).toEqual({ kind: 'img', src: sent.src, alt: '添付の画像（大きく）' });
  await userEvent.click(q('button[aria-label="閉じる"]', lb) as HTMLElement);
  expect(lb.hidden).toBe(true);
  expect(useUi.getState().lightbox).toBeNull();

  await userEvent.click(q('.imgbar .thumb img') as HTMLElement); // 入力欄のサムネイルも
  expect(lb.hidden).toBe(false);
  expect((q('.lb-stage img', lb) as HTMLImageElement).src).toContain('/asset/demo/c-2.png');
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(lb.hidden).toBe(true);
});

test('拡大表示：画像以外（本文・ボタン）を押しても、出ない。範囲の枠をつかんでいる間の Esc は、閉じない（元に戻すほうが、受ける）', async () => {
  renderPanel([thread({ id: 't1', messages: [user('文', { images: ['c-1.png'], sent: true })] })]);
  await userEvent.click(q('.msg .body') as HTMLElement);
  expect(useUi.getState().lightbox).toBeNull();
  act(() => useUi.getState().openZoom({ kind: 'img', src: '/asset/demo/c-1.png', alt: '添付の画像（大きく）' }));
  act(() => useUi.getState().setRegDrag(true));
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(useUi.getState().lightbox).not.toBeNull();
  act(() => useUi.getState().setRegDrag(false));
  fireEvent.keyDown(document, { key: 'Enter' });
  expect(useUi.getState().lightbox).not.toBeNull();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(useUi.getState().lightbox).toBeNull();
});

test('AI の返信の画像（Markdown の assets/）も、押すと、拡大表示で開く（添付の画像と同じ形：ステージだけ）', () => {
  renderPanel([thread({ id: 't1', messages: [ai('![図](assets/fig.png)')] })]);
  const img = q('.msg.ai .body img') as HTMLImageElement;
  expect(img.getAttribute('src')).toBe('/asset/demo/fig.png');
  fireEvent.click(img);
  expect(useUi.getState().lightbox).toMatchObject({ kind: 'img', src: expect.stringContaining('/asset/demo/fig.png') });
  expect(useUi.getState().lightbox?.focus).toBeUndefined();
});
