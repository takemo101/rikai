// ビルドした CSS の検査：Tailwind の utilities は、`tw:` の接頭辞つきだけ。
// 資料（AI が書いた HTML）の `class` は、無害化を通る。`<div class="hidden">` が、画面のクラス（.hidden など）に当たって、消えたり、位置が動いたりしないように。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { afterAll, beforeAll, expect, test } from 'vitest';

let outDir = '';
let css = '';

beforeAll(async () => {
  outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rikai-css-'));
  await build({
    configFile: path.join(import.meta.dirname, '../../vite.config.ts'),
    logLevel: 'silent',
    build: { outDir, emptyOutDir: true },
  });
  const assets = path.join(outDir, 'assets');
  css = fs
    .readdirSync(assets)
    .filter((f) => f.endsWith('.css'))
    .map((f) => fs.readFileSync(path.join(assets, f), 'utf8'))
    .join('\n');
}, 120_000);
afterAll(() => fs.rmSync(outDir, { recursive: true, force: true }));

// Tailwind の、よくある utilities（ソースの語から、勝手に作られると、AI の HTML の class に効く）
const BARE = [
  'hidden',
  'block',
  'inline',
  'flex',
  'grid',
  'table',
  'absolute',
  'relative',
  'fixed',
  'sticky',
  'static',
  'container',
  'resize',
  'visible',
  'invisible',
  'truncate',
  'underline',
  'italic',
  'border',
  'shadow',
  'rounded',
  'transition',
  'outline',
  'filter',
  'blur',
  'ring',
  'sr-only',
  'collapse',
  'contents',
];

test('ビルドした CSS に、utilities の、接頭辞なしのクラス（.hidden・.absolute・.container・.table・.resize など）が、残らない', () => {
  expect(css.length).toBeGreaterThan(1000); // 画面の CSS（legacy.css）は、入っている
  const found = BARE.filter((name) => new RegExp(`\\.${name}(?![\\w-])`).test(css));
  expect(found).toEqual([]);
});

test('ライセンスの一覧：同じ名前の別の版が、バンドルに 2 つ入っているときは、版ごとに載る（marked が 2 つの版）', () => {
  const text = fs.readFileSync(path.join(outDir, 'THIRD-PARTY-LICENSES.txt'), 'utf8');
  const marked = [...text.matchAll(/^### marked (\S+)$/gm)].map((m) => m[1]);
  expect(marked.length).toBeGreaterThanOrEqual(2);
  expect(new Set(marked).size).toBe(marked.length);
  // 同じ「名前 版」の見出しは、1 度だけ
  const heads = [...text.matchAll(/^### .+$/gm)].map((m) => m[0]);
  expect(new Set(heads).size).toBe(heads.length);
});
