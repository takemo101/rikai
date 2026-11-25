// @vitest-environment jsdom
import { beforeEach, expect, test } from 'vitest';
import {
  DEFAULT_UI,
  loadSeen,
  loadSendHintSeen,
  loadUi,
  SEEN_KEY,
  SEEN_MAX,
  SEND_HINT_KEY,
  saveSeen,
  saveSendHintSeen,
  saveUi,
  UI_KEY,
} from '../../src/web/lib/storage';

beforeEach(() => localStorage.clear());

test('seen：保存して、読み戻す。新しい 2000 件だけ覚える', () => {
  saveSeen(new Set(['a', 'b']));
  expect([...loadSeen()]).toEqual(['a', 'b']);
  saveSeen(new Set(Array.from({ length: SEEN_MAX + 5 }, (_, i) => `m${i}`)));
  const seen = loadSeen();
  expect(seen.size).toBe(SEEN_MAX);
  expect(seen.has('m4')).toBe(false);
  expect(seen.has(`m${SEEN_MAX + 4}`)).toBe(true);
});

test('seen：壊れていたら、空（配列でない・文字列でない要素）', () => {
  localStorage.setItem(SEEN_KEY, '{oops');
  expect(loadSeen().size).toBe(0);
  localStorage.setItem(SEEN_KEY, '{"a":1}');
  expect(loadSeen().size).toBe(0);
  localStorage.setItem(SEEN_KEY, '["a",1,null,"b"]');
  expect([...loadSeen()]).toEqual(['a', 'b']);
});

test('ui：既定・保存・読み戻し・壊れていたら既定', () => {
  expect(loadUi()).toEqual(DEFAULT_UI);
  expect(DEFAULT_UI).toEqual({
    sideOpen: true,
    panelW: 380,
    panelUser: false,
    links: true,
    regionBoxes: true,
    theme: 'system',
    notify: false,
  });
  saveUi({
    sideOpen: false,
    panelW: 450,
    panelUser: true,
    links: true,
    regionBoxes: false,
    theme: 'system',
    notify: false,
  });
  expect(loadUi()).toEqual({
    sideOpen: false,
    panelW: 450,
    panelUser: true,
    links: true,
    regionBoxes: false, // 範囲の枠を隠す設定は、保存して、読み戻せる（リロード後も、隠したまま）
    theme: 'system',
    notify: false,
  });
  localStorage.setItem(UI_KEY, 'not json');
  expect(loadUi()).toEqual(DEFAULT_UI);
  localStorage.setItem(UI_KEY, JSON.stringify({ sideOpen: 'yes', panelW: 'abc' }));
  expect(loadUi()).toEqual(DEFAULT_UI);
  localStorage.setItem(UI_KEY, JSON.stringify({ panelW: '420' }));
  expect(loadUi()).toEqual({
    sideOpen: true,
    panelW: 420,
    panelUser: false,
    links: true,
    regionBoxes: true,
    theme: 'system',
    notify: false,
  });
  // 範囲の枠（regionBoxes）：真偽値だけ。古い保存（なし）・壊れた値は、表示（既定）。ほかの設定は、読める
  expect(DEFAULT_UI.regionBoxes).toBe(true);
  for (const bad of ['false', 0, null, {}, []]) {
    localStorage.setItem(UI_KEY, JSON.stringify({ regionBoxes: bad, panelW: 410 }));
    expect(loadUi()).toMatchObject({ regionBoxes: true, panelW: 410 });
  }
});

// 右の幅を、利用者が決めた印（`panelUser`）：幅の値（380）でなく、印で、「既定のまま」と「わざと 380」を見分ける
test('ui：右の幅を利用者が決めた印（panelUser）は、真偽値だけ。古い保存（印なし）は、既定のまま（380 でも）。幅が読めないときは、印も捨てる', () => {
  expect(DEFAULT_UI.panelUser).toBe(false);
  // 古い保存：印がない → 既定のまま
  localStorage.setItem(UI_KEY, JSON.stringify({ sideOpen: true, panelW: 380 }));
  expect(loadUi()).toMatchObject({ panelW: 380, panelUser: false });
  // 380 を、わざと選んだ：保存して、読み戻せる
  saveUi({ ...DEFAULT_UI, panelW: 380, panelUser: true });
  expect(loadUi()).toMatchObject({ panelW: 380, panelUser: true });
  expect(JSON.parse(localStorage.getItem(UI_KEY) ?? '{}')).toMatchObject({ panelW: 380, panelUser: true });
  // 壊れた値（真偽値でない）は、既定（false）。ほかの設定は、読める
  for (const bad of ['true', 1, null, {}, []]) {
    localStorage.setItem(UI_KEY, JSON.stringify({ panelW: 450, panelUser: bad, links: false }));
    expect(loadUi()).toMatchObject({ panelW: 450, panelUser: false, links: false });
  }
  // 幅が読めない（なし・文字・0）：既定の幅。印も、信じない
  for (const bad of [undefined, 'abc', 0, null]) {
    localStorage.setItem(UI_KEY, JSON.stringify({ panelW: bad, panelUser: true }));
    expect(loadUi()).toMatchObject({ panelW: 380, panelUser: false });
  }
});

test('ui：外観のモード（theme）は、light・dark・system だけ。壊れた値・知らない値は、system に戻す。ほかの設定は、そのまま', () => {
  for (const t of ['light', 'dark', 'system'] as const) {
    saveUi({
      sideOpen: false,
      panelW: 450,
      panelUser: false,
      links: false,
      regionBoxes: true,
      theme: t,
      notify: false,
    });
    expect(loadUi()).toEqual({
      sideOpen: false,
      panelW: 450,
      panelUser: false,
      links: false,
      regionBoxes: true,
      theme: t,
      notify: false,
    });
  }
  // 古い保存（theme がない）：既定
  localStorage.setItem(UI_KEY, JSON.stringify({ sideOpen: false, panelW: 420, links: false }));
  expect(loadUi()).toEqual({
    sideOpen: false,
    panelW: 420,
    panelUser: false,
    links: false,
    regionBoxes: true,
    theme: 'system',
    notify: false,
  });
  // 知らない値・型違い：system。ほかの設定は、読める
  for (const bad of ['Dark', 'auto', 1, null, {}, true]) {
    localStorage.setItem(UI_KEY, JSON.stringify({ sideOpen: false, theme: bad }));
    expect(loadUi()).toMatchObject({ sideOpen: false, theme: 'system', notify: false });
  }
});

// F41：ブラウザの通知の設定（既定はオフ）。壊れた値は、オフ。ほかの設定は、そのまま
test('ui：通知（notify）は、真偽値だけ。既定・古い保存・壊れた値は、オフ。ほかの設定は、そのまま', () => {
  expect(DEFAULT_UI.notify).toBe(false);
  saveUi({
    sideOpen: false,
    panelW: 450,
    panelUser: false,
    links: false,
    regionBoxes: true,
    theme: 'dark',
    notify: true,
  });
  expect(loadUi()).toEqual({
    sideOpen: false,
    panelW: 450,
    panelUser: false,
    links: false,
    regionBoxes: true,
    theme: 'dark',
    notify: true,
  });
  localStorage.setItem(UI_KEY, JSON.stringify({ sideOpen: false, panelW: 420 })); // 古い保存
  expect(loadUi().notify).toBe(false);
  for (const bad of ['true', 1, null, {}, []]) {
    localStorage.setItem(UI_KEY, JSON.stringify({ notify: bad, panelW: 410 }));
    expect(loadUi()).toMatchObject({ notify: false, panelW: 410 });
  }
});

test('送信後の案内（Claude Code 以外）：見せたかを覚える。既定は「まだ」・壊れた値も「まだ」', () => {
  expect(loadSendHintSeen()).toBe(false);
  saveSendHintSeen();
  expect(loadSendHintSeen()).toBe(true);
  localStorage.setItem(SEND_HINT_KEY, 'oops');
  expect(loadSendHintSeen()).toBe(false);
});
