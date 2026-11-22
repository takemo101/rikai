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
