// readStdin（src/cli/stdin.ts）：端末（TTY）のときは、待たずに、すぐ、案内して失敗する・ストリームは、バイトのまま集めて、1 度だけ UTF-8 にする。
import { Readable } from 'node:stream';
import { expect, test } from 'vitest';
import { readStdin } from '../../src/cli/stdin';
import { HttpError } from '../../src/server/util';

/** 終わらない端末の代用（TTY の確認を外すと、読み始めて、終わらない：時間切れで、落ちる） */
const tty = (): Readable & { isTTY: boolean } => Object.assign(new Readable({ read() {} }), { isTTY: true });

test('端末（TTY）が標準入力：待たずに、「標準入力で渡してください」（400）で、すぐ返る', {
  timeout: 2000,
}, async () => {
  const t0 = Date.now();
  const e = await readStdin(tty()).catch((x: unknown) => x);
  expect(e).toBeInstanceOf(HttpError);
  expect((e as HttpError).message).toBe('標準入力で渡してください');
  expect((e as HttpError).status).toBe(400);
  expect(Date.now() - t0).toBeLessThan(500);
});

test('端末でなければ（TTY なし）、最後まで読む。チャンクの境目で割れたマルチバイトも、壊れない。空は、空の文字列', async () => {
  const bytes = Buffer.from('猫🐈と犬🐕');
  const chunks = [...bytes].map((b) => Buffer.from([b])); // 1 バイトずつ
  expect(await readStdin(Readable.from(chunks, { objectMode: false }) as Readable)).toBe('猫🐈と犬🐕');
  expect(await readStdin(Readable.from([]) as Readable)).toBe('');
});
