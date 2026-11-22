// @vitest-environment jsdom
import { beforeEach, expect, test } from 'vitest';
import type { Anchor } from '../../src/shared/types';
import { topicKey } from '../../src/web/api/queries';
import { queryClient } from '../../src/web/api/queryClient';
import { SEEN_KEY, UI_KEY } from '../../src/web/lib/storage';
import { initialUi, useUi } from '../../src/web/store/ui';
import { meta, msg, resetAll, thread, topicState } from './helpers';

const ui = () => useUi.getState();
const anchor: Anchor = {
  blockId: 'b1',
  blockHash: 'h',
  blockTag: 'p',
  blockText: 'テキスト',
  quote: 'テキスト',
  prefix: '',
  suffix: '',
  label: '',
};

beforeEach(resetAll);

/** 見ているトピック（v2 まである）を、ハッシュと、取得済みのデータで用意する */
function openTopic(hash: string): void {
  queryClient.setQueryData(
    topicKey('demo'),
    topicState({
      meta: meta({ pages: { root: { title: 'T', parent: null, versions: 2, createdAt: '' } } }),
    }),
  );
  location.hash = hash;
}

test('初期値：進行中のタブ・差分を表示・左の一覧は開いている・幅 380', () => {
  const s = initialUi();
  expect(s.tab).toBe('live');
  expect(s.showChanges).toBe(true);
  expect(s.ui).toEqual({ sideOpen: true, panelW: 380 });
  expect(s.regMode).toBe('idle');
  expect(s.composer).toBeNull();
  expect(s.solo).toBeNull();
});

test('tab・solo・rowOpen・olderOpen・askOpen', () => {
  ui().setTab('done');
  expect(ui().tab).toBe('done');
  ui().openSolo('t1');
  expect(ui().solo).toBe('t1');
  ui().closeSolo();
  expect(ui().solo).toBeNull();
  ui().setRowOpen('t1', true);
  expect(ui().rowOpen.has('t1')).toBe(true);
  ui().setRowOpen('t1', false);
  expect(ui().rowOpen.has('t1')).toBe(false);
  ui().setOlderOpen('t1:m1', true);
  ui().openAsk('m9');
  expect(ui().olderOpen.has('t1:m1')).toBe(true);
  expect(ui().askOpen.has('m9')).toBe(true);
});

test('変わらない集合の操作は、同じ参照のまま（無駄な再描画をしない）', () => {
  const before = ui().rowOpen;
  ui().setRowOpen('x', false);
  expect(ui().rowOpen).toBe(before);
});

test('下書き：コメント・返信・編集・質問を、別々に持つ。消せる', () => {
  ui().setComposerDraft('下書き');
  ui().setReplyDraft('t1', '返信');
  ui().setEditDraft('m1', '編集');
  ui().setAskDraft('q1', { choice: 'a' });
  expect(ui().drafts).toMatchObject({
    composer: '下書き',
    reply: { t1: '返信' },
    edit: { m1: '編集' },
    ask: { q1: { choice: 'a' } },
  });
  ui().clearEditDraft('m1');
  ui().clearAskDraft('q1');
  expect('m1' in ui().drafts.edit).toBe(false);
  expect('q1' in ui().drafts.ask).toBe(false);
  ui().setAskDraft('q1', null);
  expect(ui().drafts.ask.q1).toBeNull();
});

test('画像：足す（同じ名前は足さない）・外す・空にすると世代が進む・トピックを離れると全部消える', () => {
  expect(ui().addDraftImg('composer', 'a.png')).toBe(true);
  expect(ui().addDraftImg('composer', 'a.png')).toBe(false);
  ui().addDraftImg('composer', 'b.png');
  ui().removeDraftImg('composer', 'a.png');
  expect(ui().drafts.imgs.composer).toEqual(['b.png']);
  ui().resetImgs('composer');
  expect(ui().drafts.imgs.composer).toEqual([]);
  expect(ui().imgGen.composer).toBe(1);
  ui().resetImgs('composer');
  expect(ui().imgGen.composer).toBe(2);
  ui().addDraftImg('reply-t1', 'c.png');
  ui().leaveTopic();
  expect(ui().drafts.imgs).toEqual({});
});

test('アップロードの数：増減・0 より下がらない', () => {
  ui().beginUpload();
  ui().beginUpload();
  expect(ui().uploading).toBe(2);
  ui().endUpload();
  ui().endUpload();
  ui().endUpload();
  expect(ui().uploading).toBe(0);
});

test('seen：AI のメッセージを見たことにして、localStorage に残す。再起動（初期化）でも残る', () => {
  const t = thread({
    resolved: false,
    messages: [
      msg({ id: 'u1' }),
      msg({ id: 'a1', author: 'ai', kind: 'reply' }),
      msg({ id: 'a2', author: 'ai', kind: 'reply' }),
    ],
  });
  ui().focusThread(t);
  expect(ui().active).toBe('t1');
  expect(ui().seen.has('a1') && ui().seen.has('a2')).toBe(true);
  expect(ui().seen.has('u1')).toBe(false);
  expect(JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]')).toEqual(['a1', 'a2']);
  expect(initialUi().seen.has('a2')).toBe(true);
});

test('focusThread：解決済みを本文から選ぶと、進行中のタブなら「すべて」へ・1 行を開く。solo 中は動かさない', () => {
  const t = thread({ id: 'r1', resolved: true });
  ui().focusThread(t);
  expect(ui().tab).toBe('all');
  expect(ui().rowOpen.has('r1')).toBe(true);
  ui().setTab('done');
  ui().setRowOpen('r1', false);
  ui().focusThread(t);
  expect(ui().tab).toBe('done');
  expect(ui().rowOpen.has('r1')).toBe(true);
  ui().setRowOpen('r1', false);
  ui().openSolo('r1');
  ui().focusThread(t);
  expect(ui().rowOpen.has('r1')).toBe(false);
});

test('startComposer：最新版でないと、断ってトーストを出す。最新版なら開く（書きかけの文は残す）', () => {
  openTopic('#/demo/root/v1');
  ui().setComposerDraft('書きかけ');
  expect(ui().startComposer(anchor)).toBe(false);
  expect(ui().composer).toBeNull();
  expect(ui().toast).toMatchObject({ msg: 'コメントは最新版にだけ付けられます', err: true });

  openTopic('#/demo/root');
  expect(ui().startComposer(anchor)).toBe(true);
  expect(ui().composer?.anchor).toBe(anchor);
  expect(ui().drafts.composer).toBe('書きかけ');
});

test('startComposer：対象を選び直すと、前の範囲の切り出し画像だけを外す（ユーザーの画像は残す）', () => {
  openTopic('#/demo');
  ui().startComposer(anchor);
  const first = ui().composer;
  expect(first).not.toBeNull();
  ui().addDraftImg('composer', 'mine.png');
  ui().addDraftImg('composer', 'crop.png');
  ui().setComposerRegionImg(first?.id ?? -1, 'crop.png');
  ui().startComposer(anchor);
  expect(ui().drafts.imgs.composer).toEqual(['mine.png']);
  expect(ui().composer?.id).not.toBe(first?.id);
  // 古い入力欄の id では、付けられない
  ui().setComposerRegionImg(first?.id ?? -1, 'late.png');
  expect(ui().composer?.regionImg).toBeUndefined();
});

test('closeComposer：対象・書きかけ・画像を消し、世代を進める。dropComposerTarget は、対象だけ', () => {
  openTopic('#/demo');
  ui().startComposer(anchor);
  ui().setComposerDraft('x');
  ui().addDraftImg('composer', 'a.png');
  ui().dropComposerTarget();
  expect(ui().composer).toBeNull();
  expect(ui().drafts.composer).toBe('x');
  ui().startComposer(anchor);
  ui().closeComposer();
  expect(ui().composer).toBeNull();
  expect(ui().drafts.composer).toBe('');
  expect(ui().drafts.imgs.composer).toEqual([]);
  expect(ui().imgGen.composer).toBe(1);
});

test('画面の広さ：開閉・幅を localStorage に保存する。ドラッグ中（save: false）は保存せず、persistUi で保存', () => {
  ui().toggleSide();
  expect(ui().ui.sideOpen).toBe(false);
  expect(JSON.parse(localStorage.getItem(UI_KEY) ?? '{}')).toEqual({ sideOpen: false, panelW: 380 });
  ui().setPanelW(500, { save: false });
  expect(JSON.parse(localStorage.getItem(UI_KEY) ?? '{}').panelW).toBe(380);
  ui().persistUi();
  expect(JSON.parse(localStorage.getItem(UI_KEY) ?? '{}')).toEqual({ sideOpen: false, panelW: 500 });
  ui().setPanelW(410);
  expect(initialUi().ui).toEqual({ sideOpen: false, panelW: 410 });
});

test('トースト：出すたびに id が変わる。古い id では消えない', () => {
  ui().showToast('a');
  const first = ui().toast;
  ui().showToast('b', true);
  expect(ui().toast).toMatchObject({ msg: 'b', err: true });
  ui().clearToast(first?.id ?? -1);
  expect(ui().toast?.msg).toBe('b');
  ui().clearToast(ui().toast?.id ?? -1);
  expect(ui().toast).toBeNull();
});

test('ダイアログ・ライトボックス・範囲の状態', () => {
  ui().openDialog('submit');
  expect(ui().dialog).toBe('submit');
  ui().closeDialog();
  expect(ui().dialog).toBeNull();
  ui().openLightbox('/asset/x/a.png');
  expect(ui().lightbox).toBe('/asset/x/a.png');
  ui().closeLightbox();
  ui().setRegMode('selecting');
  ui().setRegDrag(true);
  expect(ui().regMode).toBe('selecting');
  expect(ui().regDrag).toBe(true);
});
