// rikai の版：ルートの package.json の `version` が正本（plugin.json との一致は、test/server/plugin.test.ts が確かめる）。
// 実行時にファイルを読まない（配布した 1 ファイルで動くこと）：ビルドのとき、`__RIKAI_VERSION__` を、この値で置き換える（esbuild・Vite・Vitest の `define`）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json');

function readVersion(): string {
  const v = (JSON.parse(fs.readFileSync(pkgFile, 'utf8')) as { version?: unknown }).version;
  if (typeof v !== 'string' || !/^\d+\.\d+\.\d+/.test(v))
    throw new Error(`${pkgFile} の version が、x.y.z の形ではありません`);
  return v;
}

export const RIKAI_VERSION: string = readVersion();

/** バンドラの `define`：ソースの `__RIKAI_VERSION__`（`src/shared/version.ts`）を、版の文字列に置き換える */
export const versionDefine: Record<string, string> = { __RIKAI_VERSION__: JSON.stringify(RIKAI_VERSION) };
