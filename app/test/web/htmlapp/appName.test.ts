// 実行できる枠の名前・安全の注意（見える文字にしない）・旧い版が書き込んだ注意の除去（表示だけ）
import { expect, test } from 'vitest';
import { APP_NOTICE, appName, appNotice, stripAppNotice } from '../../../src/web/htmlapp/appName';

test('名前は 1 から。注意は、名前＋（隔離されています。パスワードなどの秘密は、入力しないでください）', () => {
  expect(appName(0)).toBe('実行できる枠 1');
  expect(appNotice(2)).toBe('実行できる枠 3（隔離されています。パスワードなどの秘密は、入力しないでください）');
  expect(APP_NOTICE).toContain('パスワードなどの秘密は、入力しないでください');
});

test('旧い版が保存した範囲の名前から、注意だけを除く（全文の形・30 字で切った形。後ろの付記は、残す）。新しい名前は、そのまま', () => {
  const full = '範囲：実行できる枠 1（隔離されています。パスワードなどの秘密は、入力しないでください）';
  const cut =
    '範囲：実行できる枠 4（隔離されています。パスワードなどの秘密は…（枠の幅 1028px で選択）（枠の画像は、枠自身が作ったもの）';
  expect(stripAppNotice(full)).toBe('範囲：実行できる枠 1');
  expect(stripAppNotice(cut)).toBe('範囲：実行できる枠 4（枠の幅 1028px で選択）（枠の画像は、枠自身が作ったもの）');
  for (const same of [
    '実行できる枠',
    '範囲：実行できる枠 1',
    '範囲：実行できる枠 1（枠の幅 980px で選択）',
    '枠から：button',
    '図',
    '',
  ]) {
    expect(stripAppNotice(same)).toBe(same);
  }
});
