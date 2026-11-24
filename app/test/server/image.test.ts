import assert from 'node:assert/strict';
import { test } from 'vitest';
import { decodeImage, IMG_NAME_RE } from '../../src/server/image';
import { IMG_MAX_BYTES } from '../../src/shared/image';
import { httpError } from './helpers';

const b64 = (bytes: number[]) => Buffer.from(bytes).toString('base64');
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3];

test('画像：形式は先頭のバイトで決め、名前は中身から決める（同じ中身は同じ名前）', () => {
  const png = decodeImage(b64(PNG));
  assert.match(png.name, IMG_NAME_RE);
  assert.ok(png.name.endsWith('.png'));
  assert.equal(decodeImage(b64(PNG)).name, png.name);
  assert.notEqual(decodeImage(b64([...PNG, 4])).name, png.name);
  assert.ok(decodeImage(b64([0xff, 0xd8, 0xff, 0xe0])).name.endsWith('.jpg'));
  assert.ok(decodeImage(Buffer.from('GIF89a..').toString('base64')).name.endsWith('.gif'));
  assert.ok(decodeImage(Buffer.from('GIF87a..').toString('base64')).name.endsWith('.gif'));
  assert.ok(decodeImage(Buffer.from('RIFF....WEBPVP8 ').toString('base64')).name.endsWith('.webp'));
});

test('画像：不正な文字・空・知らない形式（SVG を含む）・大きすぎるものは、400', () => {
  for (const bad of [undefined, null, 5, '', '!!', 'abc def', '====']) {
    assert.throws(() => decodeImage(bad), httpError(400, /画像のデータが不正/), String(bad));
  }
  assert.throws(
    () => decodeImage(Buffer.from('<svg xmlns="x"/>').toString('base64')),
    httpError(400, /png・jpeg・gif・webp/),
  );
  assert.throws(() => decodeImage(b64([1, 2, 3, 4, 5, 6, 7, 8])), httpError(400, /png・jpeg・gif・webp/));
  const big = Buffer.alloc(IMG_MAX_BYTES + 1, 0x41).toString('base64');
  assert.throws(() => decodeImage(big), httpError(400, /大きすぎます（5MB まで）/));
});
