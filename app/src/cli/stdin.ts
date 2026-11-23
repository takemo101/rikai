// 標準入力を、最後まで読む（`new`・`apply`）。副作用がない（読み込んでも、何も動かない：テストが、直接読める）。
import type { Readable } from 'node:stream';
import { HttpError } from '../server/util';

/**
 * `fs.readFileSync(0)` は使わない：パイプ・ヒアドキュメントがノンブロッキングのとき、入力が途切れた瞬間に `EAGAIN` で失敗した（約 18 万バイト以上）。
 * ストリームで読み、**バイトのまま集めてから**、1 度だけ UTF-8 にする（チャンクの境目で、日本語・絵文字が割れない）。
 * 端末（TTY）が、そのまま標準入力のとき（何も渡されていない）は、待たずに、すぐ、案内して失敗する
 */
export async function readStdin(input: Readable & { isTTY?: boolean } = process.stdin): Promise<string> {
  if (input.isTTY) throw new HttpError(400, '標準入力で渡してください');
  const chunks: Buffer[] = [];
  for await (const chunk of input) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  return Buffer.concat(chunks).toString('utf8');
}
