// @vitest-environment jsdom
// 版を並べて比べる画面（F44）を、アプリ全体（App）で：開く・既定の版（左＝1 つ前・右＝いま見ている版）・版の選択・読み取り専用（本文・コメントの入口・右のコメントがない）・
// Esc・閉じるとフォーカスが戻る・ページを移ると閉じる・版が 1 つのページでは押せない・片方が取れなくても、もう一方は出る・新しい版が増えても、選んだ版を保つ・枠の登録が増えない。
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import type { Meta } from '../../src/shared/types';
import { App } from '../../src/web/App';
import { type TopicState, topicKey } from '../../src/web/api/queries';
import { queryClient } from '../../src/web/api/queryClient';
import { registeredFrames } from '../../src/web/doc/frameRegistry';
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
const pages = (versions: number): Meta['pages'] => ({
  root: { title: '全体', parent: null, versions, createdAt: '' },
  detail: { title: '詳細', parent: 'root', versions: 1, createdAt: '' },
});
const state = (versions: number): TopicState => topicState({ meta: meta({ pages: pages(versions) }) });

/** v<n> の本文：段落の数字だけが、版ごとに違う（版を取り違えると、見て分かる）。html-app の枠を 1 つ持つ */
const doc = (v: number) =>
  `# 題\n\n共通の段落です。\n\n版 ${v} だけの内容。数字は ${v * 11} です。\n\n\`\`\`html-app height=120\n<p>枠 v${v}</p>\n\`\`\`\n`;

function server(
  versions: number,
  over: (v: number) => { status?: number; body: unknown } | undefined = () => undefined,
) {
  return mockFetch((req) => {
    if (req.path === '/api/topics') return { body: [summary('demo')] };
    if (req.path === '/api/topic/demo') return { body: state(versions) };
    const p = /^\/api\/page\/demo\/([^/]+)\/(\d+)$/.exec(req.path);
    if (p) {
      const v = Number(p[2]);
      return over(v) ?? { body: { markdown: p[1] === 'root' ? doc(v) : `# 詳細\n\n本文 v${v}\n` } };
    }
    return undefined;
  });
}

async function openApp(hash = '#/demo/root') {
  location.hash = hash;
  renderWithClient(<App />);
  await waitFor(() => expect(byId('article')).toHaveTextContent('共通の段落'));
}
const openCompare = async () => {
  fireEvent.click(byId('btn-compare'));
  await waitFor(() => expect(byId('compare')).toBeInTheDocument());
};
const select = (side: 'left' | 'right') =>
  document.querySelector(`[data-compare-select="${side}"]`) as HTMLSelectElement;
const cellsOf = (side: 'l' | 'r') => [...document.querySelectorAll<HTMLElement>(`#compare .cmp${side}:not(.cmpgap)`)];

test('開く：本文（#article）は外れ、比べる画面になる。左＝最新の 1 つ前（v2）・右＝最新（v3）。右のコメントは隠す。読み取り専用の説明が出る', async () => {
  const { calls } = server(3);
  await openApp();
  expect(byId('btn-compare')).toHaveAttribute('aria-pressed', 'false');
  await openCompare();
  expect(document.getElementById('article')).toBeNull();
  expect(byId('app')).toHaveClass('comparing');
  expect(select('left').value).toBe('2');
  expect(select('right').value).toBe('3');
  expect(byId('compare')).toHaveTextContent('読み取り専用');
  expect(byId('compare')).toHaveTextContent('最新版の本文で付けます');
  expect(byId('btn-compare')).toHaveAttribute('aria-pressed', 'true');
  await waitFor(() => expect(cellsOf('l').length).toBeGreaterThan(0));
  // 左は v2・右は v3 の本文
  expect(byId('compare').querySelector('.cmpl')).toBeTruthy();
  expect(cellsOf('l').some((c) => c.textContent?.includes('版 2 だけ'))).toBe(true);
  expect(cellsOf('r').some((c) => c.textContent?.includes('版 3 だけ'))).toBe(true);
  expect(cellsOf('l').some((c) => c.textContent?.includes('版 3 だけ'))).toBe(false);
  // 取得した版：v2・v3（既定）
  const fetched = calls.filter((c) => c.path.startsWith('/api/page/demo/root/')).map((c) => c.path.split('/').pop());
  expect(new Set(fetched)).toEqual(new Set(['2', '3']));
  // 札：最新／過去の版
  expect(document.querySelector('[data-side="left"] .cmptag')).toHaveTextContent('過去の版');
  expect(document.querySelector('[data-side="right"] .cmptag')).toHaveTextContent('最新');
  // 変更の数
  expect(byId('compare').querySelector('.cmpsum')).toHaveTextContent(/変更 2・追加 0・削除 0・同じ 2/);
});

test('いま過去の版（v2）を見ているときは、左＝v1・右＝v2', async () => {
  server(3);
  await openApp('#/demo/root/v2');
  await openCompare();
  expect(select('left').value).toBe('1');
  expect(select('right').value).toBe('2');
});

test('版の選択：プルダウンで変えると、その版が取られ、左右の本文が替わる。同じ版を左右に選べる。存在しない版は、受けない', async () => {
  const { calls } = server(3);
  await openApp();
  await openCompare();
  await waitFor(() => expect(cellsOf('l').length).toBeGreaterThan(0));
  fireEvent.change(select('left'), { target: { value: '1' } });
  await waitFor(() => expect(cellsOf('l').some((c) => c.textContent?.includes('版 1 だけ'))).toBe(true));
  expect(calls.some((c) => c.path === '/api/page/demo/root/1')).toBe(true);
  expect(cellsOf('r').some((c) => c.textContent?.includes('版 3 だけ'))).toBe(true);
  // 同じ版
  fireEvent.change(select('right'), { target: { value: '1' } });
  await waitFor(() => expect(byId('compare')).toHaveTextContent('同じ版を、左右に選んでいます'));
  // 存在しない版（ストアが断る）
  act(() => useUi.getState().setCompareVersion('left', 9));
  act(() => useUi.getState().setCompareVersion('left', 0));
  act(() => useUi.getState().setCompareVersion('left', 1.5));
  expect(useUi.getState().compare).toMatchObject({ left: 1, right: 1 });
  // プルダウンは、50 版でも、最新から順に並ぶ（v3・v2・v1）
  expect([...select('left').options].map((o) => o.textContent)).toEqual(['v3（最新）', 'v2', 'v1']);
});

test('読み取り専用：枠のツールバー・「この枠にコメント」・拡大表示・要素選択が、ない。比較用ツールバーが、1 つだけある（左右そろえて）', async () => {
  server(3);
  await openApp();
  await openCompare();
  await waitFor(() => expect(document.querySelectorAll('#compare iframe')).toHaveLength(2));
  const c = byId('compare');
  expect(c.querySelectorAll('.apptools, [data-pick], [data-focus-open], button.link')).toHaveLength(0);
  expect(byId('regbtn')).toHaveAttribute('hidden');
  const tb = c.querySelector('.cmptools') as HTMLElement;
  expect(tb).toHaveTextContent('左右で共有しません');
  expect(within(tb).getAllByRole('button', { name: /^枠の幅/ })).toHaveLength(5);
  expect(c.querySelectorAll('.cmptools')).toHaveLength(1);
  // 枠は、左右で版が違う
  const srcs = [...c.querySelectorAll('iframe')].map((f) => f.getAttribute('src'));
  expect(srcs).toEqual(['/appframe/demo/root/2/0?mode=light', '/appframe/demo/root/3/0?mode=light']);
});

test('比較用ツールバー：幅・外観を選ぶと、左右のすべての枠に効く（ストアにも残る）', async () => {
  server(3);
  await openApp();
  await openCompare();
  await waitFor(() => expect(document.querySelectorAll('#compare iframe')).toHaveLength(2));
  const frames = () => [...document.querySelectorAll<HTMLIFrameElement>('#compare iframe')];
  fireEvent.click(screen.getByRole('button', { name: '枠の幅：スマートフォン（375px）' }));
  expect(frames().map((f) => f.style.width)).toEqual(['375px', '375px']);
  expect(useUi.getState().compare?.width).toBe(375);
  expect(screen.getByRole('button', { name: '枠の幅：スマートフォン（375px）' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  fireEvent.click(screen.getByRole('button', { name: /^枠の外観：ライト/ }));
  expect(frames().map((f) => f.dataset.mode)).toEqual(['dark', 'dark']);
  expect(useUi.getState().compare?.mode).toBe('dark');
  // 版を替えて作り直しても、選びが、新しい枠に引き継がれる
  fireEvent.change(select('left'), { target: { value: '1' } });
  await waitFor(() => expect(frames().map((f) => f.getAttribute('src'))[0]).toContain('/root/1/0'));
  expect(frames().map((f) => f.style.width)).toEqual(['375px', '375px']);
  expect(frames().map((f) => f.dataset.mode)).toEqual(['dark', 'dark']);
});

test('閉じる：Esc・「閉じる」で通常表示に戻り、枠は橋から外れ、フォーカスは「並べて比べる」へ。開閉を繰り返しても、枠の登録が増えない', async () => {
  server(3);
  await openApp();
  for (let i = 0; i < 6; i++) {
    await openCompare();
    await waitFor(() => expect(registeredFrames()).toBe(2)); // 比べる画面の枠 2 つだけ（通常の本文の枠は、外れている）
    if (i % 2) fireEvent.click(document.querySelector('[data-compare-close]') as HTMLElement);
    else fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(document.getElementById('compare')).toBeNull());
    await waitFor(() => expect(byId('article')).toHaveTextContent('共通の段落'));
    await waitFor(() => expect(registeredFrames()).toBe(1)); // 通常の本文の枠
  }
  expect(document.activeElement).toBe(byId('btn-compare'));
  expect(useUi.getState().compare).toBeNull();
  expect(byId('app')).not.toHaveClass('comparing');
});

test('開いたら、左の版の選択にフォーカス', async () => {
  server(3);
  await openApp();
  await openCompare();
  expect(document.activeElement).toBe(select('left'));
});

test('ページを移ると閉じる（子ページ・別のトピック）。同じページの版の切り替え（ハッシュの版）では、閉じない', async () => {
  server(3);
  await openApp();
  await openCompare();
  act(() => {
    location.hash = '#/demo/root/v1';
  });
  await waitFor(() => expect(useUi.getState().compare).not.toBeNull());
  expect(byId('compare')).toBeInTheDocument();
  act(() => {
    location.hash = '#/demo/detail';
  });
  await waitFor(() => expect(useUi.getState().compare).toBeNull());
  await waitFor(() => expect(document.getElementById('compare')).toBeNull());
});

// 旧：破線の押せないボタンを出し、押すと理由のトースト（F44 (1)）。比べる相手がないので、出さない（RIK-055。UX の分析 P8）
test('版が 1 つのページ：「並べて比べる」を出さない。開けない', async () => {
  server(1);
  await openApp();
  expect(document.getElementById('btn-compare')).toBeNull();
  expect(useUi.getState().compare).toBeNull();
  expect(document.getElementById('compare')).toBeNull();
  expect(useUi.getState().openCompare()).toBe(false);
});

test('片方の版が取れない：その欄にエラー（再読み込み）。もう一方は表示される。再読み込みで、取り直せる', async () => {
  let fail = true;
  const { calls } = server(3, (v) =>
    v === 1 && fail ? { status: 500, body: { ok: false, error: 'サーバーのエラー' } } : undefined,
  );
  await openApp();
  await openCompare();
  await waitFor(() => expect(cellsOf('l').length).toBeGreaterThan(0));
  fireEvent.change(select('left'), { target: { value: '1' } }); // v1 は、取れない
  const err = await screen.findByRole('alert');
  expect(err).toHaveTextContent('v1 を読み込めませんでした');
  expect(document.querySelector('[data-side="left"]')).toContainElement(err);
  // 右（v3）は、出ている。左は、空白
  await waitFor(() => expect(cellsOf('r').length).toBeGreaterThan(0));
  expect(cellsOf('l')).toHaveLength(0);
  expect(byId('compare')).not.toHaveTextContent('変更 ');
  fail = false;
  const before = calls.filter((c) => c.path === '/api/page/demo/root/1').length;
  fireEvent.click(within(err).getByRole('button', { name: /再読み込み/ }));
  await waitFor(() => expect(calls.filter((c) => c.path === '/api/page/demo/root/1').length).toBeGreaterThan(before));
  await waitFor(() => expect(cellsOf('l').some((c) => c.textContent?.includes('版 1 だけ'))).toBe(true));
  expect(screen.queryByRole('alert')).toBeNull();
});

test('新しい版が増えても（通知で、取り直し）：選んでいる版は保たれ、「最新」の札が移る。右を最新にする案内が出る。枠は、作り直さない', async () => {
  server(3);
  await openApp();
  await openCompare();
  await waitFor(() => expect(document.querySelectorAll('#compare iframe')).toHaveLength(2));
  const before = [...document.querySelectorAll('#compare iframe')];
  act(() => {
    queryClient.setQueryData(topicKey('demo'), state(4));
  });
  await waitFor(() => expect(document.querySelector('[data-side="right"] .cmptag')).toHaveTextContent('過去の版'));
  expect(select('left').value).toBe('2');
  expect(select('right').value).toBe('3');
  expect([...select('right').options].map((o) => o.textContent)).toEqual(['v4（最新）', 'v3', 'v2', 'v1']);
  expect(document.querySelector('[data-newer]')).toHaveTextContent('新しい版 v4 が届きました');
  expect([...document.querySelectorAll('#compare iframe')]).toEqual(before); // 同じ要素のまま
  fireEvent.click(screen.getByRole('button', { name: '右を v4 にする' }));
  await waitFor(() => expect(select('right').value).toBe('4'));
  expect(document.querySelector('[data-side="right"] .cmptag')).toHaveTextContent('最新');
  expect(document.querySelector('[data-newer]')).toBeNull();
});

test('「変更のある所だけ見る」：同じブロックが折りたたまれる。戻すと、すべて出る', async () => {
  server(3);
  await openApp();
  await openCompare();
  await waitFor(() => expect(document.querySelectorAll('#compare .cmprow')).toHaveLength(4));
  fireEvent.click(screen.getByLabelText('変更のある所だけ見る'));
  await waitFor(() => expect(document.querySelectorAll('#compare details.cmpgroup')).toHaveLength(1));
  expect(useUi.getState().compare?.changesOnly).toBe(true);
  fireEvent.click(screen.getByLabelText('変更のある所だけ見る'));
  await waitFor(() => expect(document.querySelectorAll('#compare details.cmpgroup')).toHaveLength(0));
});

test('変更が多すぎて対応づけられないとき：上部に案内（追加と削除として並べています）。ふつうの比較では、出ない', async () => {
  const many = (tag: string) => Array.from({ length: 150 }, (_, i) => `${tag} の ${i} 番目の段落です。`).join('\n\n');
  server(3, (v) =>
    v === 1 ? { body: { markdown: many('前') } } : v === 3 ? { body: { markdown: many('後') } } : undefined,
  );
  location.hash = '#/demo/root';
  renderWithClient(<App />);
  await waitFor(() => expect(byId('article')).toHaveTextContent('後 の 0 番目'));
  await openCompare();
  await waitFor(() => expect(cellsOf('l').length).toBeGreaterThan(0));
  expect(document.querySelector('[data-limited]')).toBeNull(); // v2 → v3：ふつう
  fireEvent.change(select('left'), { target: { value: '1' } });
  await waitFor(() =>
    expect(document.querySelector('[data-limited]')).toHaveTextContent(
      '変更が多すぎて、対応づけていません（追加と削除として並べています）',
    ),
  );
  fireEvent.change(select('left'), { target: { value: '2' } });
  await waitFor(() => expect(document.querySelector('[data-limited]')).toBeNull());
});

const ANCHOR = {
  blockId: 'b1',
  blockHash: 'h',
  blockTag: 'P',
  blockText: '共通の段落です。',
  quote: '共通の段落です。',
  prefix: '',
  suffix: '',
  label: '',
};

/** 入力欄を開いて（対象つき）、文を書き、範囲の画像も付けた状態 */
function composing() {
  expect(useUi.getState().startComposer(ANCHOR)).toBe(true);
  act(() => {
    useUi.getState().setComposerDraft('書きかけのコメント');
    useUi.getState().addDraftImg('composer', 'c-0123456789abcdef.png');
  });
  const c = useUi.getState().composer;
  act(() => useUi.getState().setComposerRegionImg(c?.id ?? 0, 'c-0123456789abcdef.png'));
  return useUi.getState().composer;
}

test('入力中のコメント：比べる画面を開いても、入力欄の対象・書きかけの文・画像は、そのまま（右のコメント欄が、隠れるだけ）。閉じると、同じ対象・同じ文・同じ画像で、続けられる', async () => {
  server(3);
  await openApp();
  const before = composing();
  expect(before?.anchor.quote).toBe('共通の段落です。');
  await openCompare();
  expect(useUi.getState().composer).toEqual(before);
  expect(useUi.getState().drafts.composer).toBe('書きかけのコメント');
  expect(useUi.getState().drafts.imgs.composer).toEqual(['c-0123456789abcdef.png']);
  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() => expect(document.getElementById('compare')).toBeNull());
  expect(useUi.getState().composer).toEqual(before); // 同じ対象（id・錨・範囲の画像の付き先）
  expect(useUi.getState().drafts.composer).toBe('書きかけのコメント');
  expect(useUi.getState().drafts.imgs.composer).toEqual(['c-0123456789abcdef.png']);
  await waitFor(() => expect(byId('article')).toHaveTextContent('共通の段落'));
});

test('入力中のコメント：比べている間に新しい版が届き、対象が新しい版にもあるとき：その対象で戻る（文・画像も、そのまま）', async () => {
  server(3);
  await openApp();
  const before = composing();
  await openCompare();
  act(() => {
    queryClient.setQueryData(topicKey('demo'), state(4));
  });
  await waitFor(() => expect(document.querySelector('[data-newer]')).not.toBeNull());
  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() => expect(document.getElementById('compare')).toBeNull());
  await waitFor(() => expect(byId('article')).toHaveTextContent('版 4 だけ'));
  await waitFor(() => expect(useUi.getState().composer?.verify).toBeUndefined()); // 新しい本文で、対象が見つかった
  expect(useUi.getState().composer?.anchor).toEqual(before?.anchor);
  expect(useUi.getState().composer?.id).toBe(before?.id);
  expect(useUi.getState().drafts.composer).toBe('書きかけのコメント');
  expect(useUi.getState().drafts.imgs.composer).toEqual(['c-0123456789abcdef.png']);
  expect(useUi.getState().lostDraft).toBeNull();
});

test('入力中のコメント：新しい版に、対象がなくなったとき：別の対象に付けない（次に開く入力欄に、文・画像が入らない）。知らせて、「対象を失った下書き」として残す（コピー・破棄）', async () => {
  server(3, (v) => (v >= 4 ? { body: { markdown: '# 題\n\nまったく別の内容だけの版です。\n' } } : undefined));
  await openApp();
  composing();
  await openCompare();
  act(() => {
    queryClient.setQueryData(topicKey('demo'), state(4));
  });
  await waitFor(() => expect(document.querySelector('[data-newer]')).not.toBeNull());
  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() => expect(document.getElementById('compare')).toBeNull());
  await waitFor(() => expect(byId('article')).toHaveTextContent('まったく別の内容'));
  await waitFor(() => expect(useUi.getState().lostDraft).not.toBeNull());
  const s = useUi.getState();
  expect(s.composer).toBeNull();
  expect(s.drafts.composer).toBe(''); // 次の入力欄に、入らない
  expect(s.drafts.imgs.composer ?? []).toEqual([]);
  expect(s.lostDraft).toEqual({
    text: '書きかけのコメント',
    imgs: ['c-0123456789abcdef.png'],
    reason: '新しい版でなくなりました',
  });
  expect(byId('toast')).toHaveTextContent(
    '書きかけのコメントの対象が、新しい版でなくなりました。文は、下書きとして残しています',
  );
  // 別の対象で入力欄を開く：前の文・画像は、入っていない
  expect(useUi.getState().startComposer({ ...ANCHOR, quote: 'まったく別の内容だけの版です。' })).toBe(true);
  expect(useUi.getState().drafts.composer).toBe('');
  expect(useUi.getState().drafts.imgs.composer ?? []).toEqual([]);
  // パネルに、注記つきで出る。文は、そのまま（文字として）。コピー・破棄
  const note = document.querySelector('[data-lost-draft]') as HTMLElement;
  expect(note).toHaveTextContent('対象を失った下書き');
  expect(note).toHaveTextContent('書きかけのコメント');
  expect(note).toHaveTextContent('画像：1 枚');
  const writeText = vi.fn(async () => {});
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
  fireEvent.click(within(note).getByRole('button', { name: 'コピー' }));
  expect(writeText).toHaveBeenCalledWith('書きかけのコメント');
  fireEvent.click(within(note).getByRole('button', { name: '破棄' }));
  expect(document.querySelector('[data-lost-draft]')).toBeNull();
  expect(useUi.getState().lostDraft).toBeNull();
});

test('入力中のコメント：ページを移って閉じたときも、戻さない（別のページの対象になるため）。書きかけは、対象を失った下書きに（次の入力欄に入らない）', async () => {
  server(3);
  await openApp();
  composing();
  await openCompare();
  act(() => {
    location.hash = '#/demo/detail';
  });
  await waitFor(() => expect(useUi.getState().compare).toBeNull());
  expect(useUi.getState().composer).toBeNull();
  expect(useUi.getState().drafts.composer).toBe(''); // 別のページの入力欄に、入らない
  expect(useUi.getState().drafts.imgs.composer ?? []).toEqual([]);
  expect(useUi.getState().lostDraft).toEqual({
    text: '書きかけのコメント',
    imgs: ['c-0123456789abcdef.png'],
    reason: '別のページにあります',
  });
});

test('選んでいたスレッドも、開いている間も、閉じたあとも、そのまま（控えて戻すのでなく、持ったまま）', async () => {
  server(3);
  await openApp();
  act(() => useUi.getState().setActive('t9'));
  await openCompare();
  expect(useUi.getState().active).toBe('t9');
  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() => expect(document.getElementById('compare')).toBeNull());
  expect(useUi.getState().active).toBe('t9');
});

test('スクロール位置：開く前の位置を控えて、閉じて本文を描き直したあと、戻す（ページを移って閉じたときは、先頭）', async () => {
  server(3);
  await openApp();
  const scroller = byId('docscroll');
  scroller.scrollTop = 366;
  await openCompare();
  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() => expect(document.getElementById('compare')).toBeNull());
  await waitFor(() => expect(byId('article')).toHaveTextContent('共通の段落'));
  await waitFor(() => expect(byId('docscroll').scrollTop).toBe(366));
  expect(useUi.getState().scrollRestore).toBeNull(); // 1 度だけ
  // ページを移って閉じる：戻さない
  byId('docscroll').scrollTop = 200;
  await openCompare();
  act(() => {
    location.hash = '#/demo/detail';
  });
  await waitFor(() => expect(useUi.getState().compare).toBeNull());
  await waitFor(() => expect(byId('docscroll').scrollTop).toBe(0));
});

test('スクロール位置：戻したあと、2 フレームのあいだに、利用者がスクロールしたら、巻き戻さない（置き直しは、動かしていないときだけ）', async () => {
  server(3);
  await openApp();
  byId('docscroll').scrollTop = 366;
  await openCompare();
  // フレームを、手で進める（2 回目の置き直しの前に、利用者が動かす）
  const queue: FrameRequestCallback[] = [];
  const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => queue.push(cb));
  try {
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(document.getElementById('compare')).toBeNull());
    await waitFor(() => expect(byId('docscroll').scrollTop).toBe(366)); // 描き終えて、すぐ、戻した
    byId('docscroll').scrollTop = 50; // 利用者が、動かした
    for (let i = 0; i < 6 && queue.length; i++) for (const cb of queue.splice(0)) cb(0); // 保留中のフレームを、すべて進める
    expect(byId('docscroll').scrollTop).toBe(50);
  } finally {
    raf.mockRestore();
  }
});

// ---- 変更の見せ方の切り替え（通常｜変更を重ねる｜並べて比べる）：旧「前の版からの変更を表示」と「並べて比べる」の、1 つの入口 ----
const seg = (mode: 'normal' | 'overlay' | 'side') =>
  document.querySelector(`#docbar [data-mode="${mode}"]`) as HTMLElement;
const pressed = () =>
  (['normal', 'overlay', 'side'] as const).filter((m) => seg(m)?.getAttribute('aria-pressed') === 'true');

test('変更の見せ方：どれも 1 クリック。通常⇄変更を重ねる⇄並べて比べるを、行き来できる（並べて比べる画面の中からも、同じ切り替えで戻れる）。`ui.showChanges`・`ui.compare` の意味は、そのまま', async () => {
  server(3);
  await openApp();
  expect(byId('docbar').querySelector('[role="group"]')).toHaveAttribute('aria-label', '変更の見せ方');
  expect(pressed()).toEqual(['overlay']); // 既定：変更を重ねる（最新版 v3 には、前の版がある）
  // 重ねる → 並べて比べる（1 クリック）：重ねるの印（showChanges）は、そのまま
  fireEvent.click(seg('side'));
  await waitFor(() => expect(byId('compare')).toBeInTheDocument());
  expect(pressed()).toEqual(['side']);
  expect(useUi.getState().showChanges).toBe(true);
  // 並べて比べる画面の中から：「通常」（1 クリック）で、戻る。通常になる（重ねるは、止まる）
  fireEvent.click(seg('normal'));
  await waitFor(() => expect(document.getElementById('compare')).toBeNull());
  expect(pressed()).toEqual(['normal']);
  expect(useUi.getState().compare).toBeNull();
  expect(useUi.getState().showChanges).toBe(false);
  // 通常 → 変更を重ねる（1 クリック）
  fireEvent.click(seg('overlay'));
  expect(useUi.getState().showChanges).toBe(true);
  expect(pressed()).toEqual(['overlay']);
  // 並べて比べる画面の中から：「変更を重ねる」（1 クリック）で、閉じて、重ねる
  fireEvent.click(seg('side'));
  await waitFor(() => expect(byId('compare')).toBeInTheDocument());
  fireEvent.click(seg('overlay'));
  await waitFor(() => expect(document.getElementById('compare')).toBeNull());
  expect(pressed()).toEqual(['overlay']);
  expect(useUi.getState().showChanges).toBe(true);
  // 押している「並べて比べる」を、もう一度押す：閉じる（開く前の、重ねるへ）。押している「変更を重ねる」を、もう一度押す：止める
  fireEvent.click(seg('side'));
  await waitFor(() => expect(byId('compare')).toBeInTheDocument());
  fireEvent.click(seg('side'));
  await waitFor(() => expect(document.getElementById('compare')).toBeNull());
  expect(pressed()).toEqual(['overlay']);
  fireEvent.click(seg('overlay'));
  expect(pressed()).toEqual(['normal']);
  expect(useUi.getState().showChanges).toBe(false);
});

test('変更の見せ方：v1 を見ているときは、「変更を重ねる」を出さない（前の版がない）。「通常」と「並べて比べる」は、ある', async () => {
  server(3);
  await openApp('#/demo/root/v1');
  expect(seg('overlay')).toBeNull();
  expect(pressed()).toEqual(['normal']);
  fireEvent.click(seg('side'));
  await waitFor(() => expect(byId('compare')).toBeInTheDocument());
  expect(pressed()).toEqual(['side']);
  expect(seg('overlay')).toBeNull();
  fireEvent.click(seg('normal'));
  await waitFor(() => expect(document.getElementById('compare')).toBeNull());
  expect(pressed()).toEqual(['normal']);
});

test('変更の見せ方：「通常」を押して戻ったとき、フォーカスは、押したボタンのまま。Esc で閉じたときは、「並べて比べる」へ', async () => {
  server(3);
  await openApp();
  await openCompare();
  seg('normal').focus();
  fireEvent.click(seg('normal'));
  await waitFor(() => expect(document.getElementById('compare')).toBeNull());
  expect(document.activeElement).toBe(seg('normal'));
  await openCompare();
  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() => expect(document.getElementById('compare')).toBeNull());
  expect(document.activeElement).toBe(byId('btn-compare'));
});

test('入力中のコメント：比べている間に、見ている版が過去の版へ変わったとき（ブラウザの「戻る」）：比べないときと同じ道（moveComposer）で、書きかけは「対象を失った下書き」へ。比べる画面は、開いたまま', async () => {
  server(3);
  await openApp();
  composing();
  await openCompare();
  act(() => {
    location.hash = '#/demo/root/v2';
  });
  await waitFor(() => expect(useUi.getState().lostDraft).not.toBeNull());
  expect(useUi.getState().compare).not.toBeNull(); // 同じページの中の、版の切り替えでは、閉じない
  expect(useUi.getState().composer).toBeNull();
  expect(useUi.getState().drafts.composer).toBe('');
  expect(useUi.getState().lostDraft).toEqual({
    text: '書きかけのコメント',
    imgs: ['c-0123456789abcdef.png'],
    reason: '過去の版にあります',
  });
});
