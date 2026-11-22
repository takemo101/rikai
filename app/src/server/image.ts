// コメントに添付する画像：形式の見分けと、名前の決め方。ほかのモジュールは、これを使うだけ。
// 画像は、利用者が貼り付けた・選んだもので、非信頼のデータ。形式は、中身の先頭のバイトで決め（申告・拡張子は、信用しない）、
// 名前は、中身から、サーバーが決める（クライアントの名前を、パスに使わない）。SVG は、スクリプトを持てるので、受けない。
import crypto from 'node:crypto';
import { HttpError } from './util';

export const IMG_MAX = 5 * 1024 * 1024; // 1 枚の上限（バイト）
export const MAX_IMAGES = 4; // 1 つのコメント・返信に付けられる枚数
export const IMG_NAME_RE = /^c-[0-9a-f]{16}\.(png|jpg|gif|webp)$/;

function sniffExt(buf: Buffer): 'png' | 'jpg' | 'gif' | 'webp' | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return 'png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length >= 6 && (buf.toString('latin1', 0, 6) === 'GIF87a' || buf.toString('latin1', 0, 6) === 'GIF89a'))
    return 'gif';
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP')
    return 'webp';
  return null;
}

// base64 の文字列から、画像の中身と、保存する名前を作る。不正なら 400（何も書かない前に、すべて検査する）
export function decodeImage(data: unknown): { buf: Buffer; name: string } {
  if (typeof data !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(data))
    throw new HttpError(400, '画像のデータが不正です');
  const buf = Buffer.from(data, 'base64');
  if (!buf.length) throw new HttpError(400, '画像のデータが不正です');
  if (buf.length > IMG_MAX) throw new HttpError(400, `画像が大きすぎます（${IMG_MAX / 1024 / 1024}MB まで）`);
  const ext = sniffExt(buf);
  if (!ext) throw new HttpError(400, '画像は、png・jpeg・gif・webp だけ付けられます');
  const name = `c-${crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16)}.${ext}`;
  return { buf, name };
}
