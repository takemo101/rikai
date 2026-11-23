import zlib from 'node:zlib';

// 作り物の資料（実際の資料・コメントは使わない。SPEC N6）。

export const DOC_BASIC = `# 猫の観察日記

これは猫についての作り物の資料です。猫は朝によく鳴きます。

## 食事

猫は一日に三回、ごはんを食べます。水もたくさん飲みます。

- 朝のごはんは七時です
- 夜のごはんは十九時です

| 時間 | 内容 |
| --- | --- |
| 朝 | カリカリ |
| 夜 | ウェット |

\`\`\`js
const meals = 3;
\`\`\`

## 睡眠

猫は一日に十六時間ほど眠ります。日向でよく丸くなります。
`;

// 画像（assets/ に置いた PNG）を含む資料の、画像の参照
export const IMG_NAME = 'sample.png';

// 縞（左は赤・右は青）の PNG を、zlib で作る（外部の画像は使わない）
function crc32(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
// 縞（左は赤・右は青）の PNG。幅・高さを指定できる
export function makePng(w: number, h: number): Buffer {
  const row = Buffer.alloc(1 + w * 3);
  for (let x = 0; x < w; x++) {
    const o = 1 + x * 3;
    if (x < w / 2) {
      row[o] = 200;
      row[o + 1] = 60;
      row[o + 2] = 60;
    } else {
      row[o] = 60;
      row[o + 1] = 60;
      row[o + 2] = 200;
    }
  }
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// 灰色の地（230）に、緑の四角（0, 160, 0）が 1 つある PNG：範囲の位置・大きさを、画素で確かめる（個別表示：F43）
export function makeSquarePng(w: number, h: number, sq: { x: number; y: number; w: number; h: number }): Buffer {
  const rows: Buffer[] = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(1 + w * 3, 230);
    row[0] = 0; // フィルターなし
    if (y >= sq.y && y < sq.y + sq.h) {
      for (let x = sq.x; x < sq.x + sq.w; x++) {
        const o = 1 + x * 3;
        row[o] = 0;
        row[o + 1] = 160;
        row[o + 2] = 0;
      }
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// PNG（8 ビット・RGB か RGBA・インターレースなし）を、RGBA の画素に戻す（保存された範囲の画像を、画素で確かめる）
export interface DecodedPng {
  w: number;
  h: number;
  at: (x: number, y: number) => [number, number, number, number];
}
export function decodePng(file: Buffer): DecodedPng {
  if (file.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('PNG ではありません');
  let w = 0;
  let h = 0;
  let color = 0;
  const idat: Buffer[] = [];
  for (let p = 8; p < file.length; ) {
    const len = file.readUInt32BE(p);
    const type = file.subarray(p + 4, p + 8).toString('latin1');
    const data = file.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      color = data[9] as number;
      if (data[8] !== 8 || data[12] !== 0) throw new Error('未対応の PNG（8 ビット・インターレースなしだけ）');
    } else if (type === 'IDAT') idat.push(data);
    p += 12 + len;
  }
  const bpp = color === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)] as number;
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x] as number;
      const a = x >= bpp ? (px[y * stride + x - bpp] as number) : 0;
      const b = y > 0 ? (px[(y - 1) * stride + x] as number) : 0;
      const c = x >= bpp && y > 0 ? (px[(y - 1) * stride + x - bpp] as number) : 0;
      let add = 0;
      if (f === 1) add = a;
      else if (f === 2) add = b;
      else if (f === 3) add = (a + b) >> 1;
      else if (f === 4) {
        const pp = a + b - c;
        const pa = Math.abs(pp - a);
        const pb = Math.abs(pp - b);
        const pc = Math.abs(pp - c);
        add = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      px[y * stride + x] = (v + add) & 255;
    }
  }
  return {
    w,
    h,
    at: (x, y) => {
      const o = y * stride + x * bpp;
      return [px[o] as number, px[o + 1] as number, px[o + 2] as number, bpp === 4 ? (px[o + 3] as number) : 255];
    },
  };
}
