// 枠から取った情報（F45）：下書きに持つ形にする（frameMetaOf）・いま送る形にする（effectiveFrameMeta）
import { expect, test } from 'vitest';
import { type PickInfo, parsePick } from '../../../src/shared/htmlapp-bridge';
import { effectiveFrameMeta, frameMetaOf } from '../../../src/web/htmlapp/frameMeta';

const pick = (over: Record<string, unknown> = {}) =>
  parsePick({
    __rikai: 1,
    type: 'pick',
    selector: 'button',
    tag: 'button',
    text: 'x',
    rect: { x: 1, y: 2, w: 3, h: 4 },
    styles: {},
    frame: { w: 10, h: 10 },
    ...over,
  }) as PickInfo;

test('frameMetaOf：pick・状態（JSON の文字列）から、frameMeta を作る。どちらもなければ、なし（ok）', () => {
  expect(frameMetaOf({})).toEqual({ ok: true, meta: undefined });
  expect(frameMetaOf({ stateJson: null })).toEqual({ ok: true, meta: undefined });
  const p = pick();
  expect(frameMetaOf({ pick: p, stateJson: '{"a":1}' })).toEqual({ ok: true, meta: { pick: p, state: '{"a":1}' } });
  expect(frameMetaOf({ stateJson: '[1]' })).toEqual({ ok: true, meta: { state: '[1]' } });
});

test('frameMetaOf：保存・送信の形（16KB）を超えるものは、理由つきで断る（サーバーが断るものを、画面で先に）', () => {
  const zw = (n: number) => '\u200B'.repeat(n);
  const fat = pick({
    selector: zw(200),
    text: zw(80),
    styles: Object.fromEntries(
      [
        'display',
        'position',
        'width',
        'height',
        'margin',
        'padding',
        'border',
        'border-radius',
        'box-shadow',
        'color',
        'background-color',
        'font-family',
        'font-size',
        'font-weight',
        'line-height',
        'gap',
        'opacity',
        'justify-content',
        'align-items',
        'flex-direction',
      ].map((k) => [k, zw(80)]),
    ),
  });
  const state = JSON.stringify(Array.from({ length: 6 }, () => 'a'.repeat(980)));
  const r = frameMetaOf({ pick: fat, stateJson: state });
  expect(r.ok).toBe(false);
  expect(!r.ok && r.reason).toContain('大きすぎ');
});

test('effectiveFrameMeta：枠の画像の印は、枠の画像が、まだ添付されているときだけ。外した・失敗したら、印を外す（残る情報がなければ、なし）', () => {
  const p = pick();
  expect(effectiveFrameMeta(undefined, undefined, [])).toBeUndefined();
  expect(effectiveFrameMeta({ pick: p }, undefined, [])).toEqual({ pick: p });
  // 画像の印：画像が付いている
  expect(effectiveFrameMeta({ imageFromFrame: true }, 'r.png', ['r.png'])).toEqual({ imageFromFrame: true });
  // 画像を外した・まだ付いていない：印は外れる。ほかの情報が残れば、それだけ
  expect(effectiveFrameMeta({ imageFromFrame: true }, 'r.png', [])).toBeUndefined();
  expect(effectiveFrameMeta({ imageFromFrame: true }, undefined, ['other.png'])).toBeUndefined();
  expect(effectiveFrameMeta({ pick: p, imageFromFrame: true }, 'r.png', ['x.png'])).toEqual({ pick: p });
  expect(effectiveFrameMeta({ state: '{}', imageFromFrame: true }, undefined, [])).toEqual({ state: '{}' });
});
