// @vitest-environment jsdom
// 画面の状態のスライス（`store/slices/`）：**1 つの操作は、1 回の `set`**（購読者が、中間の状態を見ない）。`createUi` に、偽の `getView` を渡して、操作ごとに、購読者が呼ばれた回数を数える
// （`useUi` と同じ合成。グローバルのストア・ハッシュ・取得済みのトピックに触れない）。スライスをまたぐ操作（比べる）は、別のスライスの項目を、同じ 1 回の `set` で書く。
import { beforeEach, expect, test, vi } from 'vitest';
import type { Anchor, Thread } from '../../../src/shared/types';
import { createUi } from '../../../src/web/store/createUi';
import type { ViewRef } from '../../../src/web/store/deps';

let view: ViewRef | null;
const store = () => createUi({ getView: () => view });
type Store = ReturnType<typeof store>;

beforeEach(() => {
  localStorage.clear();
  view = { key: 'demo/root/2', version: 2, latest: 2, isLatest: true, readOnly: false };
});

/** 操作を 1 回行って、購読者が呼ばれた回数と、呼ばれたときの状態を返す */
function observe(s: Store, op: () => void) {
  const seen: ReturnType<Store['getState']>[] = [];
  const off = s.subscribe((st) => void seen.push(st));
  op();
  off();
  return { calls: seen.length, seen };
}

const anchor: Anchor = {
  blockId: 'b1',
  blockHash: 'h',
  blockTag: 'p',
  blockText: 'テキスト',
  quote: 'テキスト',
  prefix: '',
  suffix: '',
  label: 'テキスト',
};

// ---- E：設定・一時 ----

test('E 設定・一時：1 操作 = 1 回の set', () => {
  const s = store();
  const st = s.getState();
  expect(observe(s, () => st.toggleSide()).calls).toBe(1);
  expect(observe(s, () => st.toggleSide(true)).calls).toBe(1);
  expect(observe(s, () => st.toggleLinks()).calls).toBe(1);
  expect(observe(s, () => st.setNotify(true)).calls).toBe(1);
  expect(observe(s, () => st.setTheme('dark')).calls).toBe(1);
  expect(observe(s, () => st.setPanelW(420)).calls).toBe(1);
  expect(observe(s, () => st.setPanelWNarrow(300)).calls).toBe(1);
  expect(observe(s, () => st.showToast('x')).calls).toBe(1);
  expect(observe(s, () => st.openDialog('end')).calls).toBe(1);
  expect(observe(s, () => st.setLive(true)).calls).toBe(1);
});

test('E 設定・一時：トーストの id は、表示ごとに増え、古い id では消えない', () => {
  const s = store();
  s.getState().showToast('a');
  const first = s.getState().toast?.id as number;
  s.getState().showToast('b', true);
  const second = s.getState().toast;
  expect(second?.id).toBeGreaterThan(first);
  expect(second?.err).toBe(true);
  s.getState().clearToast(first);
  expect(s.getState().toast?.msg).toBe('b');
  s.getState().clearToast(second?.id as number);
  expect(s.getState().toast).toBeNull();
});

// ---- D：拡大表示・範囲 ----

test('D 拡大表示・範囲：1 操作 = 1 回の set。ドックつきの上に、添付の画像を開くと、閉じたら戻る', () => {
  const s = store();
  const st = s.getState();
  const focus = { id: 'b1', hash: 'h', src: null, base: true };
  const dock = { kind: 'img', src: 'a.png', alt: 'a', focus } as const;
  const attached = { kind: 'img', src: 'b.png', alt: 'b' } as const;
  expect(observe(s, () => st.openZoom(dock)).calls).toBe(1);
  expect(observe(s, () => st.openZoom(attached)).calls).toBe(1);
  expect(s.getState().lightbox).toBe(attached);
  expect(s.getState().lightboxBack).toBe(dock);
  expect(observe(s, () => st.closeLightbox()).calls).toBe(1);
  expect(s.getState().lightbox).toBe(dock);
  expect(observe(s, () => st.setRegMode('selecting')).calls).toBe(1);
  expect(observe(s, () => st.setRegDrag(true)).calls).toBe(1);
  expect(observe(s, () => st.setFocusTool('region')).calls).toBe(1);
});

// ---- A：入力欄・下書き ----

test('A 入力欄・下書き：1 操作 = 1 回の set（トーストを伴わないもの）', () => {
  const s = store();
  const st = s.getState();
  expect(observe(s, () => expect(st.startComposer(anchor)).toBe(true)).calls).toBe(1);
  const id = s.getState().composer?.id as number;
  expect(observe(s, () => st.setComposerRegionImg(id, 'r.png')).calls).toBe(1);
  expect(observe(s, () => st.noteFrameImage(id)).calls).toBe(1);
  expect(observe(s, () => st.setComposerDraft('下書き')).calls).toBe(1);
  expect(observe(s, () => st.setReplyDraft('t1', '返信')).calls).toBe(1);
  expect(observe(s, () => st.setEditDraft('m1', '直し')).calls).toBe(1);
  expect(observe(s, () => st.setAskDraft('m2', { text: 'x' })).calls).toBe(1);
  expect(observe(s, () => st.addDraftImg('composer', 'a.png')).calls).toBe(1);
  expect(observe(s, () => st.removeDraftImg('composer', 'a.png')).calls).toBe(1);
  expect(observe(s, () => st.beginUpload('composer')).calls).toBe(1);
  expect(observe(s, () => st.endUpload('composer')).calls).toBe(1);
  expect(observe(s, () => st.moveComposer(true)).calls).toBe(1);
  expect(observe(s, () => st.confirmComposer(id)).calls).toBe(1);
  expect(observe(s, () => st.dropComposerTarget()).calls).toBe(1);
});

test('A 入力欄・下書き：最新版でなければ開かず、トーストだけ（見ている版は、作成時に渡した getView から）', () => {
  const s = store();
  view = { key: 'demo/root/1', version: 1, latest: 2, isLatest: false, readOnly: false };
  expect(s.getState().startComposer(anchor)).toBe(false);
  expect(s.getState().composer).toBeNull();
  expect(s.getState().toast?.err).toBe(true);
  view = null; // 見ている版がない
  expect(s.getState().startComposer(anchor)).toBe(false);
});

test('A 入力欄・下書き：終了したトピック（閲覧専用）では、最新版でも開かず、トーストだけ', () => {
  const s = store();
  view = { key: 'demo/root/2', version: 2, latest: 2, isLatest: true, readOnly: true };
  expect(s.getState().startComposer(anchor)).toBe(false);
  expect(s.getState().composer).toBeNull();
  expect(s.getState().toast).toMatchObject({ err: true });
  expect(s.getState().toast?.msg).toContain('終了しています');
  view = { key: 'demo/root/2', version: 2, latest: 2, isLatest: true, readOnly: false };
  expect(s.getState().startComposer(anchor)).toBe(true); // 開き直せば、また開ける
});

test('A 入力欄・下書き：版が変わったとき、最新版へなら確かめの印・過去の版へなら、書きかけを「対象を失った下書き」へ', () => {
  const s = store();
  s.getState().startComposer(anchor);
  s.getState().setComposerDraft('書きかけ');
  s.getState().moveComposer(true);
  expect(s.getState().composer?.verify).toBe(true);
  s.getState().moveComposer(false);
  expect(s.getState().composer).toBeNull();
  expect(s.getState().drafts.composer).toBe('');
  expect(s.getState().lostDraft?.text).toBe('書きかけ');
  expect(s.getState().toast?.msg).toContain('過去の版にあります');
});

test('A 入力欄・下書き：画像の世代は、やめる・送るで進む（遅れて終わるアップロードを捨てるため）', () => {
  const s = store();
  s.getState().resetImgs('composer');
  s.getState().resetImgs('composer');
  expect(s.getState().imgGen.composer).toBe(2);
});

// ---- B：パネルの選択 ----

test('B パネルの選択：1 操作 = 1 回の set', () => {
  const s = store();
  const st = s.getState();
  expect(observe(s, () => st.setActive('t1')).calls).toBe(1);
  expect(observe(s, () => st.setLinked('t1')).calls).toBe(1);
  expect(observe(s, () => st.setShowChanges(false)).calls).toBe(1);
  expect(observe(s, () => st.setTab('done')).calls).toBe(1);
  expect(observe(s, () => st.setOlderOpen('k', true)).calls).toBe(1);
  expect(observe(s, () => st.openAsk('m1')).calls).toBe(1);
  expect(observe(s, () => st.setRowOpen('t1', true)).calls).toBe(1);
  expect(observe(s, () => st.openSolo('t1')).calls).toBe(1);
  expect(observe(s, () => st.closeSolo()).calls).toBe(1);
  expect(observe(s, () => st.markSeen(['a1'])).calls).toBe(1);
});

test('B パネルの選択：解決済みを選ぶと、タブ・開いた行・選択が 1 回の set で変わる（見た印は、そのあと 1 回）', () => {
  const s = store();
  const thread: Pick<Thread, 'id' | 'resolved' | 'messages'> = {
    id: 't1',
    resolved: true,
    messages: [{ id: 'a1', author: 'ai', kind: 'reply', at: '', text: 'x', sent: true }],
  };
  const { calls, seen } = observe(s, () => s.getState().focusThread(thread));
  expect(calls).toBe(2); // 選択（1 回）→ 見た印（1 回）
  expect(seen[0]).toMatchObject({ active: 't1', tab: 'all', focusSeq: 1 });
  expect(seen[0]?.rowOpen.has('t1')).toBe(true);
  expect(seen[1]?.seen.has('a1')).toBe(true);
  // 見た印が変わらないとき（見たもの）は、選択の 1 回だけ
  expect(observe(s, () => s.getState().focusThread(thread)).calls).toBe(1);
});

// ---- C：比較 ----

test('C 比較：1 操作 = 1 回の set。開くと、範囲選択の終了・カードの光りの消去が、同じ 1 回の set で起こる', () => {
  const s = store();
  s.getState().setRegMode('selecting');
  s.getState().setLinked('t1');
  const { calls, seen } = observe(s, () => expect(s.getState().openCompare(120)).toBe(true));
  expect(calls).toBe(1);
  const opened = seen[0];
  expect(opened?.compare).toMatchObject({ left: 1, right: 2, width: 'auto', changesOnly: false });
  expect(opened?.compare?.from).toEqual({ key: 'demo/root/2', scrollTop: 120 });
  expect(opened?.regMode).toBe('idle');
  expect(opened?.linkedTid).toBeNull();

  const st = s.getState();
  expect(observe(s, () => st.setCompareVersion('left', 2)).calls).toBe(1);
  expect(observe(s, () => st.setCompareWidth(768)).calls).toBe(1);
  expect(observe(s, () => st.setCompareMode('dark')).calls).toBe(1);
  expect(observe(s, () => st.setCompareChangesOnly(true)).calls).toBe(1);
  expect(observe(s, () => st.closeCompare()).calls).toBe(1);
});

test('C 比較：閉じたとき、見ている版が同じ（key が同じ）ときだけ、スクロール位置を戻す。受け取れるのは 1 度だけ', () => {
  const s = store();
  s.getState().openCompare(300);
  s.getState().closeCompare();
  expect(s.getState().compare).toBeNull();
  expect(s.getState().takeScrollRestore()).toBe(300);
  expect(s.getState().takeScrollRestore()).toBeNull();

  s.getState().openCompare(300);
  view = { key: 'demo/root/3', version: 3, latest: 3, isLatest: true, readOnly: false }; // 新しい版が届いて、最新版が替わった
  s.getState().closeCompare();
  expect(s.getState().takeScrollRestore()).toBeNull();

  view = { key: 'demo/root/2', version: 2, latest: 2, isLatest: true, readOnly: false };
  s.getState().openCompare(50);
  s.getState().closeCompare(false); // ページ・トピックを移ったとき
  expect(s.getState().takeScrollRestore()).toBeNull();
});

test('C 比較：版が 1 つのページ・版のないときは開かない。存在しない版は受けない。入力欄・選択は、そのまま持つ', () => {
  const s = store();
  view = { key: 'demo/root/1', version: 1, latest: 1, isLatest: true, readOnly: false };
  expect(s.getState().openCompare()).toBe(false);
  view = null;
  expect(s.getState().openCompare()).toBe(false);
  view = { key: 'demo/root/3', version: 3, latest: 3, isLatest: true, readOnly: false };
  s.getState().startComposer(anchor);
  s.getState().setActive('t1');
  expect(s.getState().openCompare()).toBe(true);
  expect(s.getState().composer).not.toBeNull();
  expect(s.getState().active).toBe('t1');
  s.getState().setCompareVersion('left', 0);
  s.getState().setCompareVersion('left', 4);
  s.getState().setCompareVersion('left', 1.5);
  expect(s.getState().compare?.left).toBe(2);
  s.getState().setCompareVersion('left', 3);
  expect(s.getState().compare?.left).toBe(3);
});

// ---- 入口（ui.ts）：見ている版の結び ----

test('bindView：結ばないまま、見ている版が要る操作（入力欄を開く・比べる）をすると、失敗する（黙って「版なし」にしない）', async () => {
  vi.resetModules(); // 共通の準備（test/setup/web.ts）が結んだものと別の、結んでいない useUi
  const fresh = await import('../../../src/web/store/ui');
  const unbound = /bindView/;
  expect(() => fresh.useUi.getState().startComposer(anchor)).toThrow(unbound);
  expect(() => fresh.useUi.getState().openCompare()).toThrow(unbound);
  expect(() => fresh.useUi.getState().setCompareVersion('left', 1)).toThrow(unbound);
  fresh.useUi.setState({
    compare: { left: 1, right: 2, width: 'auto', mode: null, changesOnly: false, from: { key: 'k', scrollTop: 0 } },
  });
  expect(() => fresh.useUi.getState().closeCompare()).toThrow(unbound);
  // 結べば、使える（結んだ関数の返す版で動く）
  fresh.bindView(() => ({ key: 'demo/root/1', version: 1, latest: 1, isLatest: true, readOnly: false }));
  expect(fresh.useUi.getState().startComposer(anchor)).toBe(true);
});
